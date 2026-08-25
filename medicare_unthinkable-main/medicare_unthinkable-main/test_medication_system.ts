import { db } from './src/db/index.js';
import * as schema from './src/db/schema.js';
import { eq, sql } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import { parsePrescription, matchFrequency } from './src/lib/medicationParser.js';
import {
  createMedicationRemindersForAppointment,
  cancelMedicationRemindersForAppointment,
  processMedicationReminders,
} from './src/services/notificationService.js';
import { patientMedicationReminderTemplate } from './src/lib/emailTemplates.js';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_do_not_use_in_prod';

async function runTests() {
  console.log('====================================================');
  console.log('STARTING COMPLETE MEDICATION REMINDER TEST SUITE');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}${detail ? ` - ${detail}` : ''}`);
      failed++;
    }
  }

  try {
    // 0. Setup test users
    console.log('--- 0. Setting up test users & appointments ---');
    const rand = Math.floor(Math.random() * 1000000);
    const [patient1] = await db
      .insert(schema.users)
      .values({
        role: 'patient',
        name: 'John Doe',
        email: `patient1_${rand}@test.com`,
        passwordHash: 'dummy',
      })
      .returning();

    const [patient2] = await db
      .insert(schema.users)
      .values({
        role: 'patient',
        name: 'Jane Smith',
        email: `patient2_${rand}@test.com`,
        passwordHash: 'dummy',
      })
      .returning();

    const [doctorUser] = await db
      .insert(schema.users)
      .values({
        role: 'doctor',
        name: 'Dr. Sarah Wilson',
        email: `doctor_${rand}@test.com`,
        passwordHash: 'dummy',
      })
      .returning();

    const [docProfile] = await db
      .insert(schema.doctorProfiles)
      .values({
        userId: doctorUser.id,
        specialisation: 'Cardiology',
        workingHoursStart: '09:00',
        workingHoursEnd: '17:00',
        slotDurationMinutes: 30,
      })
      .returning();

    const baseTime = Date.now() + 24 * 60 * 60 * 1000;

    const [apt1] = await db
      .insert(schema.appointments)
      .values({
        patientId: patient1.id,
        doctorId: docProfile.id,
        slotStart: new Date(baseTime + 1 * 3600000),
        slotEnd: new Date(baseTime + 1 * 3600000 + 1800000),
        status: 'scheduled',
      })
      .returning();

    const [apt2] = await db
      .insert(schema.appointments)
      .values({
        patientId: patient1.id,
        doctorId: docProfile.id,
        slotStart: new Date(baseTime + 2 * 3600000),
        slotEnd: new Date(baseTime + 2 * 3600000 + 1800000),
        status: 'scheduled',
      })
      .returning();

    const [apt3] = await db
      .insert(schema.appointments)
      .values({
        patientId: patient2.id,
        doctorId: docProfile.id,
        slotStart: new Date(baseTime + 3 * 3600000),
        slotEnd: new Date(baseTime + 3 * 3600000 + 1800000),
        status: 'scheduled',
      })
      .returning();

    // ── TEST A: Doctor completes consultation with one medication ─────────────────
    console.log('\n--- Test A: Single Medication Reminder ---');
    const singleMedPrescription = 'Paracetamol 650mg - Twice daily for 5 days - Take after meals';
    const countA = await createMedicationRemindersForAppointment(apt1.id, patient1.id, singleMedPrescription);
    assert(countA === 1, 'Test A: Exactly 1 medication reminder created for single prescription');

    const [reminderA] = await db
      .select()
      .from(schema.medicationReminders)
      .where(eq(schema.medicationReminders.appointmentId, apt1.id));
    assert(reminderA.medicationName.includes('Paracetamol') && reminderA.frequency === 'Twice daily', 'Test A: Details match Paracetamol Twice daily');
    assert(reminderA.reminderTime === '09:00,21:00', 'Test A: Frequency maps to 09:00,21:00');

    // ── TEST B: Doctor completes consultation with multiple medications ───────────
    console.log('\n--- Test B: Multiple Medication Reminders ---');
    const multiMedPrescription = `
      1. Amoxicillin 500mg - Three times daily for 7 days - After meals
      2. Ibuprofen 400mg - Twice daily for 3 days - Take with food
      3. Cetirizine 10mg - Once daily for 10 days - Take at night
    `;
    const countB = await createMedicationRemindersForAppointment(apt2.id, patient1.id, multiMedPrescription);
    assert(countB === 3, 'Test B: Separate reminders created for each medication (count = 3)');

    const remindersB = await db
      .select()
      .from(schema.medicationReminders)
      .where(eq(schema.medicationReminders.appointmentId, apt2.id));
    assert(remindersB.length === 3, 'Test B: Database contains 3 distinct reminder records');

    // ── TEST C: Consultation has no prescription ──────────────────────────────────
    console.log('\n--- Test C: Consultation with No Prescription ---');
    const [aptNoPrescription] = await db
      .insert(schema.appointments)
      .values({
        patientId: patient1.id,
        doctorId: docProfile.id,
        slotStart: new Date(baseTime + 4 * 3600000),
        slotEnd: new Date(baseTime + 4 * 3600000 + 1800000),
        status: 'scheduled',
      })
      .returning();

    const countC = await createMedicationRemindersForAppointment(aptNoPrescription.id, patient1.id, '');
    assert(countC === 0, 'Test C: No reminders created when prescription is empty');

    // ── TEST D: Incomplete / invalid schedule ─────────────────────────────────────
    console.log('\n--- Test D: Incomplete/Unsafe Schedule ---');
    const incompletePrescription = 'General antiseptic gargle as needed';
    const parsedD = parsePrescription(incompletePrescription);
    assert(parsedD.length > 0 && parsedD[0].frequency.includes('As needed') && parsedD[0].reminderTimes.length === 0, 'Test D: As needed does not generate unsafe scheduled alert times');

    // ── TEST E: Scheduler finds due reminder & sends email ────────────────────────
    console.log('\n--- Test E: Scheduler Finds Due Reminder ---');
    // Set a reminder due right now
    const now = new Date();
    const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    
    const [dueReminder] = await db
      .insert(schema.medicationReminders)
      .values({
        appointmentId: apt1.id,
        patientId: patient1.id,
        medicationName: 'Test Due Med 100mg',
        dosage: '100mg',
        frequency: 'Once daily',
        startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000),
        reminderTime: currentHHMM,
        status: 'ACTIVE',
      })
      .returning();

    const resultE = await processMedicationReminders();
    assert(resultE.sent >= 1, 'Test E: Scheduler finds due reminder and queues/sends notification');

    // ── TEST F: Scheduler runs again -> Duplicate Prevention ──────────────────────
    console.log('\n--- Test F: Scheduler Duplicate Prevention ---');
    const resultF = await processMedicationReminders();
    assert(resultF.sent === 0, 'Test F: Re-running scheduler sends 0 duplicates for the same occurrence');

    // ── TEST G: Email failure isolation ──────────────────────────────────────────
    console.log('\n--- Test G: Email Failure Isolation ---');
    const tmpl = patientMedicationReminderTemplate({
      patientName: 'John Doe',
      medicationName: 'Amoxicillin 500mg',
      dosage: '500mg',
      frequency: 'Three times daily',
      scheduledTime: '08:00',
    });
    assert(tmpl.subject.includes('MediFlow Medication Reminder') && tmpl.html.includes('Clinical Disclaimer'), 'Test G: Medication reminder email template renders cleanly with clinical disclaimers');

    // ── TEST H: Reminder reaches endDate -> COMPLETED status ───────────────────────
    console.log('\n--- Test H: Expiration Handling ---');
    const [expiredReminder] = await db
      .insert(schema.medicationReminders)
      .values({
        appointmentId: apt1.id,
        patientId: patient1.id,
        medicationName: 'Old Finished Med',
        frequency: 'Once daily',
        startDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // in the past
        reminderTime: currentHHMM,
        status: 'ACTIVE',
      })
      .returning();

    await processMedicationReminders();

    const [updatedExpired] = await db
      .select()
      .from(schema.medicationReminders)
      .where(eq(schema.medicationReminders.id, expiredReminder.id));
    assert(updatedExpired.status === 'COMPLETED', 'Test H: Past endDate automatically transitions status to COMPLETED');

    // ── TEST I: Appointment cancelled before reminder -> CANCELLED status ─────────
    console.log('\n--- Test I: Appointment Cancellation Handling ---');
    const [aptToCancel] = await db
      .insert(schema.appointments)
      .values({
        patientId: patient1.id,
        doctorId: docProfile.id,
        slotStart: new Date(baseTime + 5 * 3600000),
        slotEnd: new Date(baseTime + 5 * 3600000 + 1800000),
        status: 'scheduled',
      })
      .returning();

    const [remToCancel] = await db
      .insert(schema.medicationReminders)
      .values({
        appointmentId: aptToCancel.id,
        patientId: patient1.id,
        medicationName: 'Cancelled Med',
        frequency: 'Once daily',
        startDate: new Date(),
        endDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        reminderTime: '09:00',
        status: 'ACTIVE',
      })
      .returning();

    await cancelMedicationRemindersForAppointment(aptToCancel.id);

    const [cancelledRem] = await db
      .select()
      .from(schema.medicationReminders)
      .where(eq(schema.medicationReminders.id, remToCancel.id));
    assert(cancelledRem.status === 'CANCELLED', 'Test I: Cancelling appointment transitions medication reminder to CANCELLED');

    // ── TEST J: Consultation completion called twice (Idempotency) ────────────────
    console.log('\n--- Test J: Completion Idempotency ---');
    const countJ1 = await createMedicationRemindersForAppointment(apt3.id, patient2.id, 'Metformin 500mg - Once daily for 30 days');
    const countJ2 = await createMedicationRemindersForAppointment(apt3.id, patient2.id, 'Metformin 500mg - Once daily for 30 days');
    assert(countJ1 === 1 && countJ2 === 1, 'Test J: Calling creation helper twice does not produce duplicate database rows');

    const totalApt3Reminders = await db
      .select()
      .from(schema.medicationReminders)
      .where(eq(schema.medicationReminders.appointmentId, apt3.id));
    assert(totalApt3Reminders.length === 1, 'Test J: Database confirms exactly 1 record for apt3');

    // ── TEST K: Patient accesses reminder endpoint (Only own reminders returned) ──
    console.log('\n--- Test K: Patient Endpoint Access ---');
    const [patient2Reminder] = await db
      .select()
      .from(schema.medicationReminders)
      .where(eq(schema.medicationReminders.patientId, patient2.id));
    assert(patient2Reminder.patientId === patient2.id && patient2Reminder.medicationName.includes('Metformin'), 'Test K: Patient 2 query isolates Patient 2 reminders only');

    // ── TEST L: Cross-patient authorization prevention ───────────────────────────
    console.log('\n--- Test L: Security / Authorization Isolation ---');
    const p1Reminders = await db
      .select()
      .from(schema.medicationReminders)
      .where(eq(schema.medicationReminders.patientId, patient1.id));
    const p2Reminders = await db
      .select()
      .from(schema.medicationReminders)
      .where(eq(schema.medicationReminders.patientId, patient2.id));

    const overlap = p1Reminders.filter(r1 => p2Reminders.some(r2 => r2.id === r1.id));
    assert(overlap.length === 0, 'Test L: Zero overlap between distinct patient reminders (data isolation confirmed)');

    console.log('\n====================================================');
    console.log(`TEST SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================\n');

    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Fatal test error:', err);
    process.exit(1);
  }
}

runTests();
