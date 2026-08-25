import { pgTable, serial, text, varchar, timestamp, integer, boolean, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  role: varchar('role', { length: 20 }).notNull(), // 'patient', 'doctor', 'admin'
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const doctorProfiles = pgTable('doctor_profiles', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull().unique(),
  specialisation: text('specialisation').notNull(),
  workingHoursStart: varchar('working_hours_start', { length: 5 }).notNull(), // '09:00'
  workingHoursEnd: varchar('working_hours_end', { length: 5 }).notNull(), // '17:00'
  slotDurationMinutes: integer('slot_duration_minutes').notNull().default(30),
  isActive: boolean('is_active').default(true).notNull(),
});

export const doctorLeaveDays = pgTable('doctor_leave_days', {
  id: serial('id').primaryKey(),
  doctorId: integer('doctor_id').references(() => doctorProfiles.id).notNull(),
  date: varchar('date', { length: 10 }).notNull(), // 'YYYY-MM-DD'
  reason: text('reason'),
});

export const appointments = pgTable('appointments', {
  id: serial('id').primaryKey(),
  patientId: integer('patient_id').references(() => users.id).notNull(),
  doctorId: integer('doctor_id').references(() => doctorProfiles.id).notNull(),
  slotStart: timestamp('slot_start').notNull(),
  slotEnd: timestamp('slot_end').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('scheduled'), // 'scheduled', 'completed', 'cancelled'
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('unique_doctor_slot_active').on(table.doctorId, table.slotStart).where(sql`${table.status} != 'cancelled'`)
]);

export const slotHolds = pgTable('slot_holds', {
  id: serial('id').primaryKey(),
  doctorId: integer('doctor_id').references(() => doctorProfiles.id).notNull(),
  slotStart: timestamp('slot_start').notNull(),
  patientId: integer('patient_id').references(() => users.id).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
}, (table) => [
  uniqueIndex('unique_doctor_slot_hold').on(table.doctorId, table.slotStart)
]);

export const symptomForms = pgTable('symptom_forms', {
  id: serial('id').primaryKey(),
  appointmentId: integer('appointment_id').references(() => appointments.id).notNull().unique(),
  rawSymptoms: text('raw_symptoms').notNull(),
  urgency: varchar('urgency', { length: 10 }), // 'Low', 'Medium', 'High'
  chiefComplaint: text('chief_complaint'),
  suggestedQuestions: text('suggested_questions'), // Stored as JSON array string or comma separated
  aiStatus: varchar('ai_status', { length: 20 }).default('PENDING').notNull(), // 'PENDING', 'COMPLETED', 'UNAVAILABLE'
  aiGeneratedAt: timestamp('ai_generated_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const visitNotes = pgTable('visit_notes', {
  id: serial('id').primaryKey(),
  appointmentId: integer('appointment_id').references(() => appointments.id).notNull().unique(),
  clinicalNotes: text('clinical_notes').notNull(),
  prescriptionRaw: text('prescription_raw'),
  followUpInstructions: text('follow_up_instructions'),
  patientSummary: text('patient_summary'),
  aiStatus: varchar('ai_status', { length: 20 }).default('PENDING').notNull(),
  aiGeneratedAt: timestamp('ai_generated_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const medicationReminders = pgTable('medication_reminders', {
  id: serial('id').primaryKey(),
  appointmentId: integer('appointment_id').references(() => appointments.id).notNull(),
  patientId: integer('patient_id').references(() => users.id).notNull(),
  medicationName: text('medication_name').notNull(),
  dosage: text('dosage'),
  instructions: text('instructions'),
  frequency: varchar('frequency', { length: 100 }).notNull(),
  startDate: timestamp('start_date').notNull(),
  endDate: timestamp('end_date').notNull(),
  reminderTime: varchar('reminder_time', { length: 255 }).notNull(),
  status: varchar('status', { length: 20 }).default('ACTIVE').notNull(), // 'ACTIVE', 'COMPLETED', 'CANCELLED'
  lastSentAt: timestamp('last_sent_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const notificationLogs = pgTable('notification_logs', {
  id: serial('id').primaryKey(),
  appointmentId: integer('appointment_id').references(() => appointments.id),
  recipientUserId: integer('recipient_user_id').references(() => users.id),
  userId: integer('user_id').references(() => users.id),
  recipientEmail: text('recipient_email').notNull(),
  type: varchar('type', { length: 50 }).notNull(), // 'BOOKING_CONFIRMATION', 'APPOINTMENT_REMINDER', 'CANCELLATION', 'RESCHEDULE', 'LEAVE_CONFLICT', 'MEDICATION_REMINDER'
  channel: varchar('channel', { length: 20 }).default('email').notNull(),
  status: varchar('status', { length: 20 }).default('PENDING').notNull(), // 'PENDING', 'SENDING', 'SENT', 'FAILED'
  retryCount: integer('retry_count').default(0).notNull(),
  lastError: text('last_error'),
  errorMessage: text('error_message'),
  scheduledFor: timestamp('scheduled_for').defaultNow().notNull(),
  sentAt: timestamp('sent_at'),
  payload: text('payload'),
  idempotencyKey: text('idempotency_key').unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const userGoogleTokens = pgTable('user_google_tokens', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull().unique(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'),
  expiryDate: timestamp('expiry_date'),
  scope: text('scope'),
  tokenType: varchar('token_type', { length: 50 }).default('Bearer'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const calendarEvents = pgTable('calendar_events', {
  id: serial('id').primaryKey(),
  appointmentId: integer('appointment_id').references(() => appointments.id).notNull().unique(),
  userId: integer('user_id').references(() => users.id),
  googleEventId: text('google_event_id'),
  calendarId: text('calendar_id').default('primary'),
  patientGoogleEventId: text('patient_google_event_id'),
  doctorGoogleEventId: text('doctor_google_event_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

