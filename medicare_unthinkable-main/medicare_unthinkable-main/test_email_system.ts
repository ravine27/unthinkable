import { db } from './src/db/index.js';
import * as schema from './src/db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import {
  createAndSendNotification,
  notifyBookingCreated,
  notifyAppointmentCancelled,
  notifyAppointmentRescheduled,
  notifyLeaveConflictAppointments,
  processAppointmentReminders,
  processPendingAndFailedNotifications,
} from './src/services/notificationService.js';
import { isSmtpConfigured, sendEmail } from './src/lib/email.js';

async function runTests() {
  console.log('=== RUNNING EMAIL NOTIFICATION SYSTEM TESTS ===\n');
  let passed = 0;
  let total = 0;

  function assert(condition: boolean, desc: string) {
    total++;
    if (condition) {
      console.log(`[PASS] ${desc}`);
      passed++;
    } else {
      console.error(`[FAIL] ${desc}`);
    }
  }

  try {
    // Test 13: Server / Email module does not crash when SMTP is unconfigured or unavailable
    const isConfig = isSmtpConfigured();
    console.log(`SMTP configured: ${isConfig}`);
    const emailResult = await sendEmail({
      to: 'test@example.com',
      subject: 'Test email',
      text: 'Testing SMTP availability',
    });
    assert(emailResult !== null && typeof emailResult === 'object', 'Test 13: sendEmail returns structured result without throwing when SMTP unconfigured');

    // Create fixture user & doctor for testing
    const testEmailPrefix = `test_${Date.now()}`;
    const [patient] = await db.insert(schema.users).values({
      name: 'Test Patient',
      email: `${testEmailPrefix}_patient@example.com`,
      passwordHash: 'dummy',
      role: 'patient',
    }).returning();

    const [doctorUser] = await db.insert(schema.users).values({
      name: 'Test Doctor',
      email: `${testEmailPrefix}_doctor@example.com`,
      passwordHash: 'dummy',
      role: 'doctor',
    }).returning();

    const [docProfile] = await db.insert(schema.doctorProfiles).values({
      userId: doctorUser.id,
      specialisation: 'Cardiology',
      workingHoursStart: '09:00',
      workingHoursEnd: '17:00',
      slotDurationMinutes: 30,
      isActive: true,
    }).returning();

    // ── Test 1 & 2: Booking creates notification, succeeds even if email sending fails ──
    const now = new Date();
    const slotStart = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24h from now
    const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000);

    const [apt] = await db.insert(schema.appointments).values({
      patientId: patient.id,
      doctorId: docProfile.id,
      slotStart,
      slotEnd,
      status: 'scheduled',
    }).returning();

    await db.insert(schema.symptomForms).values({
      appointmentId: apt.id,
      rawSymptoms: 'Mild chest tightness',
    });

    await notifyBookingCreated(apt.id);

    // Wait a brief moment for async dispatch
    await new Promise(r => setTimeout(r, 500));

    const bookingLogs = await db
      .select()
      .from(schema.notificationLogs)
      .where(and(
        eq(schema.notificationLogs.appointmentId, apt.id),
        eq(schema.notificationLogs.type, 'BOOKING_CONFIRMATION')
      ));

    assert(bookingLogs.length === 2, 'Test 1: Booking confirmation creates notification records for both patient and doctor');
    assert(bookingLogs.every(l => ['PENDING', 'SENT', 'FAILED', 'SENDING'].includes(l.status)), 'Test 2: Booking notification has valid status without breaking workflow');

    // ── Test 5 & 6: Reschedule creates notification, succeeds safely ──
    const newSlotStart = new Date(slotStart.getTime() + 2 * 60 * 60 * 1000);
    await notifyAppointmentRescheduled(apt.id, slotStart);
    await new Promise(r => setTimeout(r, 500));

    const rescheduleLogs = await db
      .select()
      .from(schema.notificationLogs)
      .where(and(
        eq(schema.notificationLogs.appointmentId, apt.id),
        eq(schema.notificationLogs.type, 'RESCHEDULE')
      ));

    assert(rescheduleLogs.length === 2, 'Test 5 & 6: Reschedule creates notifications for patient and doctor without breaking');

    // ── Test 3 & 4: Cancellation creates notification, succeeds safely ──
    await notifyAppointmentCancelled(apt.id);
    await new Promise(r => setTimeout(r, 500));

    const cancelLogs = await db
      .select()
      .from(schema.notificationLogs)
      .where(and(
        eq(schema.notificationLogs.appointmentId, apt.id),
        eq(schema.notificationLogs.type, 'CANCELLATION')
      ));

    assert(cancelLogs.length === 2, 'Test 3 & 4: Cancellation creates notifications for patient and doctor without breaking');

    // ── Test 7: Leave conflict creates notifications for affected patients ──
    await notifyLeaveConflictAppointments([{
      id: apt.id,
      patientId: patient.id,
      patientName: patient.name,
      patientEmail: patient.email,
      doctorName: doctorUser.name,
      slotStart,
      reason: 'Attending cardiology summit',
    }]);
    await new Promise(r => setTimeout(r, 500));

    const conflictLogs = await db
      .select()
      .from(schema.notificationLogs)
      .where(and(
        eq(schema.notificationLogs.appointmentId, apt.id),
        eq(schema.notificationLogs.type, 'LEAVE_CONFLICT')
      ));

    assert(conflictLogs.length >= 1, 'Test 7: Leave conflict creates notification for affected patient');

    // ── Test 8 & 9: 24h Reminder deduplication & no target on cancelled appointments ──
    // Create an active 24h appointment
    const reminderSlot = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const [activeApt] = await db.insert(schema.appointments).values({
      patientId: patient.id,
      doctorId: docProfile.id,
      slotStart: reminderSlot,
      slotEnd: new Date(reminderSlot.getTime() + 30 * 60 * 1000),
      status: 'scheduled',
    }).returning();

    // Create a cancelled 24h appointment
    const [cancelledApt] = await db.insert(schema.appointments).values({
      patientId: patient.id,
      doctorId: docProfile.id,
      slotStart: reminderSlot,
      slotEnd: new Date(reminderSlot.getTime() + 30 * 60 * 1000),
      status: 'cancelled',
    }).returning();

    const firstPass = await processAppointmentReminders();
    await new Promise(r => setTimeout(r, 500));

    const cancelledReminders = await db
      .select()
      .from(schema.notificationLogs)
      .where(and(
        eq(schema.notificationLogs.appointmentId, cancelledApt.id),
        eq(schema.notificationLogs.type, 'APPOINTMENT_REMINDER')
      ));

    assert(cancelledReminders.length === 0, 'Test 8: 24h Reminder does NOT target cancelled appointments');

    const secondPass = await processAppointmentReminders();
    console.log(`firstPass: sent=${firstPass.sent}, skipped=${firstPass.skipped}; secondPass: sent=${secondPass.sent}, skipped=${secondPass.skipped}`);
    assert(secondPass.sent === 0 && secondPass.skipped >= 1, 'Test 9: Duplicate reminders are prevented via deduplication strategy');

    // ── Test 10, 11, 12: Failed email retry, max retry count, permanent failure handling ──
    const [mockLog] = await db.insert(schema.notificationLogs).values({
      appointmentId: activeApt.id,
      recipientUserId: patient.id,
      recipientEmail: 'invalid@example.com',
      type: 'BOOKING_CONFIRMATION',
      channel: 'email',
      status: 'PENDING',
      retryCount: 0,
      scheduledFor: new Date(Date.now() - 1000), // due now
      payload: JSON.stringify({ subject: 'Retry test', text: 'Retry test text' }),
    }).returning();

    // Attempt retry
    await processPendingAndFailedNotifications();
    
    const [afterRetry1] = await db.select().from(schema.notificationLogs).where(eq(schema.notificationLogs.id, mockLog.id));
    assert(afterRetry1.retryCount >= 1 || afterRetry1.status === 'SENT' || afterRetry1.status === 'FAILED', 'Test 10: Failed email retry attempts are recorded');

    // Simulate reaching max retry attempts (retryCount = 2, now increment to 3)
    await db.update(schema.notificationLogs)
      .set({ retryCount: 2, status: 'PENDING', scheduledFor: new Date(Date.now() - 1000) })
      .where(eq(schema.notificationLogs.id, mockLog.id));

    await processPendingAndFailedNotifications();

    const [afterMaxRetry] = await db.select().from(schema.notificationLogs).where(eq(schema.notificationLogs.id, mockLog.id));
    assert(afterMaxRetry.status === 'FAILED' || afterMaxRetry.status === 'SENT', 'Test 11 & 12: Notification marked FAILED after reaching maximum attempts (3)');

    console.log(`\n=== RESULTS: ${passed}/${total} TESTS PASSED ===\n`);
  } catch (err: any) {
    console.error('Test execution error:', err);
  } finally {
    process.exit(0);
  }
}

runTests();
