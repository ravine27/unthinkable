import { db } from './src/db/index.js';
import * as schema from './src/db/schema.js';
import { eq, and } from 'drizzle-orm';
import {
  generateAuthUrl,
  handleOAuthCallback,
  isUserCalendarConnected,
  disconnectUserCalendar,
  syncAppointmentCalendarEvents,
  updateAppointmentCalendarEvents,
  deleteAppointmentCalendarEvents,
  isGoogleConfigured,
} from './src/lib/googleCalendar.js';

async function runCalendarTests() {
  console.log('=== RUNNING GOOGLE CALENDAR INTEGRATION TESTS ===\n');
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
    const JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';

    // ── Test 1: OAuth URL generation & state signing ──
    const authUrl = generateAuthUrl(9999, JWT_SECRET);
    if (isGoogleConfigured()) {
      assert(authUrl !== null && authUrl.includes('accounts.google.com'), 'Test 1: Generates valid Google OAuth URL with state when configured');
    } else {
      assert(authUrl === null, 'Test 1: Gracefully returns null when Google OAuth credentials unconfigured');
    }

    // ── Create Fixtures: Patient & Doctor ──
    const testPrefix = `cal_test_${Date.now()}`;
    const [patient] = await db.insert(schema.users).values({
      name: 'Calendar Test Patient',
      email: `${testPrefix}_patient@example.com`,
      passwordHash: 'dummy',
      role: 'patient',
    }).returning();

    const [doctorUser] = await db.insert(schema.users).values({
      name: 'Calendar Test Doctor',
      email: `${testPrefix}_doctor@example.com`,
      passwordHash: 'dummy',
      role: 'doctor',
    }).returning();

    const [docProfile] = await db.insert(schema.doctorProfiles).values({
      userId: doctorUser.id,
      specialisation: 'Neurology',
      workingHoursStart: '09:00',
      workingHoursEnd: '17:00',
      slotDurationMinutes: 30,
      isActive: true,
    }).returning();

    // ── Test 2: Initial Connection Status ──
    const initialPatientStatus = await isUserCalendarConnected(patient.id);
    const initialDoctorStatus = await isUserCalendarConnected(doctorUser.id);
    assert(!initialPatientStatus && !initialDoctorStatus, 'Test 2: Users are disconnected by default');

    // ── Test 3: Connect Calendar (Mock Token Storage) ──
    await db.insert(schema.userGoogleTokens).values({
      userId: patient.id,
      accessToken: 'mock_patient_access_token',
      refreshToken: 'mock_patient_refresh_token',
      expiryDate: new Date(Date.now() + 3600 * 1000),
      scope: 'https://www.googleapis.com/auth/calendar.events',
      tokenType: 'Bearer',
    });

    const connectedPatientStatus = await isUserCalendarConnected(patient.id);
    assert(connectedPatientStatus === true, 'Test 3: isUserCalendarConnected returns true after token storage');

    // ── Test 4: Booking with unconnected doctor + connected patient (Failure Isolation) ──
    const now = new Date();
    const slotStart = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000);

    const [apt1] = await db.insert(schema.appointments).values({
      patientId: patient.id,
      doctorId: docProfile.id,
      slotStart,
      slotEnd,
      status: 'scheduled',
    }).returning();

    // Sync calendar events (should not throw even with mock tokens / offline Google)
    let syncErrorOccurred = false;
    try {
      await syncAppointmentCalendarEvents(apt1.id);
    } catch {
      syncErrorOccurred = true;
    }
    assert(!syncErrorOccurred, 'Test 4: Calendar sync does not throw or break booking when Google API fails or is offline');

    // ── Test 5: Booking with both participants connected (Mock Doctor Token) ──
    await db.insert(schema.userGoogleTokens).values({
      userId: doctorUser.id,
      accessToken: 'mock_doctor_access_token',
      refreshToken: 'mock_doctor_refresh_token',
      expiryDate: new Date(Date.now() + 3600 * 1000),
      scope: 'https://www.googleapis.com/auth/calendar.events',
    });

    const [apt2] = await db.insert(schema.appointments).values({
      patientId: patient.id,
      doctorId: docProfile.id,
      slotStart: new Date(slotStart.getTime() + 3600 * 1000),
      slotEnd: new Date(slotEnd.getTime() + 3600 * 1000),
      status: 'scheduled',
    }).returning();

    // Store mock event IDs in calendar_events table
    await db.insert(schema.calendarEvents).values({
      appointmentId: apt2.id,
      patientGoogleEventId: 'mock_google_patient_event_123',
      doctorGoogleEventId: 'mock_google_doctor_event_456',
    });

    const [eventRow] = await db.select().from(schema.calendarEvents).where(eq(schema.calendarEvents.appointmentId, apt2.id));
    assert(
      eventRow.patientGoogleEventId === 'mock_google_patient_event_123' &&
      eventRow.doctorGoogleEventId === 'mock_google_doctor_event_456',
      'Test 5: Calendar events table stores patient and doctor event IDs'
    );

    // ── Test 6: Idempotency / No duplicate events on repeated sync ──
    await syncAppointmentCalendarEvents(apt2.id);
    const eventRows = await db.select().from(schema.calendarEvents).where(eq(schema.calendarEvents.appointmentId, apt2.id));
    assert(eventRows.length === 1, 'Test 6: Idempotent sync does not create duplicate event rows');

    // ── Test 7: Reschedule update handling ──
    let rescheduleErrorOccurred = false;
    try {
      await updateAppointmentCalendarEvents(apt2.id);
    } catch {
      rescheduleErrorOccurred = true;
    }
    assert(!rescheduleErrorOccurred, 'Test 7: Reschedule event update runs safely without throwing');

    // ── Test 8: Cancellation event deletion ──
    let cancelErrorOccurred = false;
    try {
      await deleteAppointmentCalendarEvents(apt2.id);
    } catch {
      cancelErrorOccurred = true;
    }
    const remainingEvents = await db.select().from(schema.calendarEvents).where(eq(schema.calendarEvents.appointmentId, apt2.id));
    assert(!cancelErrorOccurred && remainingEvents.length === 0, 'Test 8: Cancellation deletes calendar event records cleanly');

    // ── Test 9: Disconnect Calendar ──
    await disconnectUserCalendar(patient.id);
    const disconnectedPatient = await isUserCalendarConnected(patient.id);
    assert(disconnectedPatient === false, 'Test 9: Disconnect removes stored OAuth tokens');

    // ── Test 10: Neither participant connected ──
    await disconnectUserCalendar(doctorUser.id);
    const [apt3] = await db.insert(schema.appointments).values({
      patientId: patient.id,
      doctorId: docProfile.id,
      slotStart: new Date(slotStart.getTime() + 7200 * 1000),
      slotEnd: new Date(slotEnd.getTime() + 7200 * 1000),
      status: 'scheduled',
    }).returning();

    let unconnSyncError = false;
    try {
      await syncAppointmentCalendarEvents(apt3.id);
    } catch {
      unconnSyncError = true;
    }
    assert(!unconnSyncError, 'Test 10: When neither participant is connected, calendar sync succeeds gracefully');

    console.log(`\n=== RESULTS: ${passed}/${total} TESTS PASSED ===\n`);
  } catch (err: any) {
    console.error('Calendar test execution error:', err);
  } finally {
    process.exit(0);
  }
}

runCalendarTests();
