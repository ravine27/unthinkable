import cron from 'node-cron';
import { eq, and, sql, gte, lte, lt, or } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { sendEmail } from '../lib/email.js';
import {
  patientBookingConfirmationTemplate,
  doctorBookingConfirmationTemplate,
  patientCancellationTemplate,
  doctorCancellationTemplate,
  patientRescheduleTemplate,
  doctorRescheduleTemplate,
  patientLeaveConflictTemplate,
  patientReminderTemplate,
  doctorReminderTemplate,
  patientMedicationReminderTemplate,
} from '../lib/emailTemplates.js';
import { parsePrescription } from '../lib/medicationParser.js';

export type NotificationType =
  | 'BOOKING_CONFIRMATION'
  | 'APPOINTMENT_REMINDER'
  | 'CANCELLATION'
  | 'RESCHEDULE'
  | 'LEAVE_CONFLICT'
  | 'MEDICATION_REMINDER';

export type NotificationStatus = 'PENDING' | 'SENDING' | 'SENT' | 'FAILED';

export interface CreateNotificationParams {
  appointmentId?: number;
  recipientUserId?: number;
  recipientEmail: string;
  type: NotificationType;
  subject: string;
  text: string;
  html?: string;
  scheduledFor?: Date;
  idempotencyKey?: string;
}

// ─── 1. CORE NOTIFICATION DISPATCHER ───────────────────────────────────────────

export async function createAndSendNotification(params: CreateNotificationParams): Promise<void> {
  const {
    appointmentId,
    recipientUserId,
    recipientEmail,
    type,
    subject,
    text,
    html,
    scheduledFor = new Date(),
    idempotencyKey,
  } = params;

  try {
    const payload = JSON.stringify({ subject, text, html });

    // Check idempotencyKey if provided
    if (idempotencyKey) {
      const existing = await db
        .select({ id: schema.notificationLogs.id })
        .from(schema.notificationLogs)
        .where(eq(schema.notificationLogs.idempotencyKey, idempotencyKey))
        .limit(1);

      if (existing.length > 0) {
        return; // Duplicate prevented
      }
    }

    // 1. Insert notification record as PENDING
    const [log] = await db
      .insert(schema.notificationLogs)
      .values({
        appointmentId: appointmentId || null,
        recipientUserId: recipientUserId || null,
        userId: recipientUserId || null,
        recipientEmail,
        type,
        channel: 'email',
        status: 'PENDING',
        retryCount: 0,
        scheduledFor,
        payload,
        idempotencyKey: idempotencyKey || null,
      })
      .returning();

    // 2. If scheduled for the future, leave in PENDING for cron worker
    if (scheduledFor.getTime() > Date.now() + 5000) {
      return;
    }

    // 3. Attempt immediate asynchronous sending
    sendNotificationLog(log.id, recipientEmail, subject, text, html).catch(err => {
      console.error(`[NotificationService] Background send error for log ${log.id}:`, err?.message || err);
    });
  } catch (err: any) {
    if (err?.code === '23505' || err?.message?.includes('duplicate key')) {
      // Duplicate idempotency caught at database level
      return;
    }
    // Failure here must NEVER throw to the caller / HTTP handler
    console.error('[NotificationService] Failed to create notification log:', err?.message || err);
  }
}

async function sendNotificationLog(
  logId: number,
  to: string,
  subject: string,
  text: string,
  html?: string
): Promise<void> {
  try {
    // Mark as SENDING
    await db
      .update(schema.notificationLogs)
      .set({ status: 'SENDING' })
      .where(eq(schema.notificationLogs.id, logId));

    const result = await sendEmail({ to, subject, text, html });

    if (result.success) {
      await db
        .update(schema.notificationLogs)
        .set({
          status: 'SENT',
          sentAt: new Date(),
          lastError: null,
          errorMessage: null,
        })
        .where(eq(schema.notificationLogs.id, logId));
    } else {
      const isTransient = result.isTransient !== false;
      const nextAttempt = isTransient
        ? new Date(Date.now() + 60 * 1000) // retry in 1 minute
        : new Date();

      await db
        .update(schema.notificationLogs)
        .set({
          status: isTransient ? 'PENDING' : 'FAILED',
          retryCount: 1,
          lastError: result.error || 'Send failed',
          errorMessage: result.error || 'Send failed',
          scheduledFor: nextAttempt,
        })
        .where(eq(schema.notificationLogs.id, logId));
    }
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    await db
      .update(schema.notificationLogs)
      .set({
        status: 'PENDING',
        retryCount: 1,
        lastError: errorMsg,
        errorMessage: errorMsg,
        scheduledFor: new Date(Date.now() + 60 * 1000),
      })
      .where(eq(schema.notificationLogs.id, logId));
  }
}

// ─── 2. DOMAIN NOTIFICATION HELPERS ───────────────────────────────────────────

export async function notifyBookingCreated(appointmentId: number): Promise<void> {
  try {
    const result = await db.execute(sql`
      SELECT 
        a.id AS "appointmentId",
        a.slot_start AS "slotStart",
        p.id AS "patientId",
        p.name AS "patientName",
        p.email AS "patientEmail",
        d.id AS "doctorId",
        d.name AS "doctorName",
        d.email AS "doctorEmail",
        dp.specialisation AS "specialisation",
        sf.raw_symptoms AS "rawSymptoms"
      FROM appointments a
      JOIN users p ON a.patient_id = p.id
      JOIN doctor_profiles dp ON a.doctor_id = dp.id
      JOIN users d ON dp.user_id = d.id
      LEFT JOIN symptom_forms sf ON sf.appointment_id = a.id
      WHERE a.id = ${appointmentId}
    `);

    const row = result.rows[0] as any;
    if (!row) return;

    // Send to Patient
    const patientTmpl = patientBookingConfirmationTemplate({
      patientName: row.patientName,
      doctorName: row.doctorName,
      specialisation: row.specialisation,
      slotStart: row.slotStart,
      rawSymptoms: row.rawSymptoms,
    });
    await createAndSendNotification({
      appointmentId: row.appointmentId,
      recipientUserId: row.patientId,
      recipientEmail: row.patientEmail,
      type: 'BOOKING_CONFIRMATION',
      subject: patientTmpl.subject,
      text: patientTmpl.text,
      html: patientTmpl.html,
    });

    // Send to Doctor
    const doctorTmpl = doctorBookingConfirmationTemplate({
      doctorName: row.doctorName,
      patientName: row.patientName,
      slotStart: row.slotStart,
      rawSymptoms: row.rawSymptoms,
    });
    await createAndSendNotification({
      appointmentId: row.appointmentId,
      recipientUserId: row.doctorId,
      recipientEmail: row.doctorEmail,
      type: 'BOOKING_CONFIRMATION',
      subject: doctorTmpl.subject,
      text: doctorTmpl.text,
      html: doctorTmpl.html,
    });
  } catch (err: any) {
    console.error(`[NotificationService] notifyBookingCreated error for apt ${appointmentId}:`, err?.message || err);
  }
}

export async function notifyAppointmentCancelled(appointmentId: number): Promise<void> {
  try {
    // Also cancel any active medication reminders associated with this appointment
    await cancelMedicationRemindersForAppointment(appointmentId);

    const result = await db.execute(sql`
      SELECT 
        a.id AS "appointmentId",
        a.slot_start AS "slotStart",
        p.id AS "patientId",
        p.name AS "patientName",
        p.email AS "patientEmail",
        d.id AS "doctorId",
        d.name AS "doctorName",
        d.email AS "doctorEmail"
      FROM appointments a
      JOIN users p ON a.patient_id = p.id
      JOIN doctor_profiles dp ON a.doctor_id = dp.id
      JOIN users d ON dp.user_id = d.id
      WHERE a.id = ${appointmentId}
    `);

    const row = result.rows[0] as any;
    if (!row) return;

    // Patient cancellation email
    const patientTmpl = patientCancellationTemplate({
      patientName: row.patientName,
      doctorName: row.doctorName,
      slotStart: row.slotStart,
    });
    await createAndSendNotification({
      appointmentId: row.appointmentId,
      recipientUserId: row.patientId,
      recipientEmail: row.patientEmail,
      type: 'CANCELLATION',
      subject: patientTmpl.subject,
      text: patientTmpl.text,
      html: patientTmpl.html,
    });

    // Doctor cancellation email
    const doctorTmpl = doctorCancellationTemplate({
      doctorName: row.doctorName,
      patientName: row.patientName,
      slotStart: row.slotStart,
    });
    await createAndSendNotification({
      appointmentId: row.appointmentId,
      recipientUserId: row.doctorId,
      recipientEmail: row.doctorEmail,
      type: 'CANCELLATION',
      subject: doctorTmpl.subject,
      text: doctorTmpl.text,
      html: doctorTmpl.html,
    });
  } catch (err: any) {
    console.error(`[NotificationService] notifyAppointmentCancelled error for apt ${appointmentId}:`, err?.message || err);
  }
}

export async function notifyAppointmentRescheduled(appointmentId: number, oldSlotStart: Date): Promise<void> {
  try {
    const result = await db.execute(sql`
      SELECT 
        a.id AS "appointmentId",
        a.slot_start AS "newSlotStart",
        p.id AS "patientId",
        p.name AS "patientName",
        p.email AS "patientEmail",
        d.id AS "doctorId",
        d.name AS "doctorName",
        d.email AS "doctorEmail"
      FROM appointments a
      JOIN users p ON a.patient_id = p.id
      JOIN doctor_profiles dp ON a.doctor_id = dp.id
      JOIN users d ON dp.user_id = d.id
      WHERE a.id = ${appointmentId}
    `);

    const row = result.rows[0] as any;
    if (!row) return;

    // Patient reschedule email
    const patientTmpl = patientRescheduleTemplate({
      patientName: row.patientName,
      doctorName: row.doctorName,
      oldSlotStart,
      newSlotStart: row.newSlotStart,
    });
    await createAndSendNotification({
      appointmentId: row.appointmentId,
      recipientUserId: row.patientId,
      recipientEmail: row.patientEmail,
      type: 'RESCHEDULE',
      subject: patientTmpl.subject,
      text: patientTmpl.text,
      html: patientTmpl.html,
    });

    // Doctor reschedule email
    const doctorTmpl = doctorRescheduleTemplate({
      doctorName: row.doctorName,
      patientName: row.patientName,
      oldSlotStart,
      newSlotStart: row.newSlotStart,
    });
    await createAndSendNotification({
      appointmentId: row.appointmentId,
      recipientUserId: row.doctorId,
      recipientEmail: row.doctorEmail,
      type: 'RESCHEDULE',
      subject: doctorTmpl.subject,
      text: doctorTmpl.text,
      html: doctorTmpl.html,
    });
  } catch (err: any) {
    console.error(`[NotificationService] notifyAppointmentRescheduled error for apt ${appointmentId}:`, err?.message || err);
  }
}

export async function notifyLeaveConflictAppointments(
  affectedAppointments: Array<{
    id: number;
    patientId: number;
    patientName: string;
    patientEmail: string;
    doctorName: string;
    slotStart: Date | string;
    reason?: string;
  }>
): Promise<void> {
  for (const apt of affectedAppointments) {
    try {
      await cancelMedicationRemindersForAppointment(apt.id);

      const tmpl = patientLeaveConflictTemplate({
        patientName: apt.patientName,
        doctorName: apt.doctorName,
        slotStart: apt.slotStart,
        reason: apt.reason,
      });

      await createAndSendNotification({
        appointmentId: apt.id,
        recipientUserId: apt.patientId,
        recipientEmail: apt.patientEmail,
        type: 'LEAVE_CONFLICT',
        subject: tmpl.subject,
        text: tmpl.text,
        html: tmpl.html,
      });
    } catch (err: any) {
      console.error(`[NotificationService] notifyLeaveConflict error for apt ${apt.id}:`, err?.message || err);
    }
  }
}

// ─── 3. MEDICATION REMINDER CREATION & CANCELLATION ────────────────────────────

export async function createMedicationRemindersForAppointment(
  appointmentId: number,
  patientId: number,
  rawPrescription?: string | null
): Promise<number> {
  if (!rawPrescription || !rawPrescription.trim()) {
    return 0;
  }

  try {
    // Idempotency: verify no reminders already exist for this appointment
    const existing = await db
      .select({ id: schema.medicationReminders.id })
      .from(schema.medicationReminders)
      .where(eq(schema.medicationReminders.appointmentId, appointmentId));

    if (existing.length > 0) {
      return existing.length;
    }

    const parsedList = parsePrescription(rawPrescription);
    if (parsedList.length === 0) {
      return 0;
    }

    let createdCount = 0;
    const now = new Date();

    for (const item of parsedList) {
      const startDate = new Date(now);
      const endDate = new Date(now.getTime() + item.durationDays * 24 * 60 * 60 * 1000);
      const reminderTimeStr = item.reminderTimes.length > 0 ? item.reminderTimes.join(',') : '09:00';

      await db.insert(schema.medicationReminders).values({
        appointmentId,
        patientId,
        medicationName: item.medicationName,
        dosage: item.dosage || null,
        instructions: item.instructions || null,
        frequency: item.frequency,
        startDate,
        endDate,
        reminderTime: reminderTimeStr,
        status: 'ACTIVE',
      });
      createdCount++;
    }

    console.log(`[MedicationReminders] Created ${createdCount} reminder(s) for appointment ${appointmentId}`);
    return createdCount;
  } catch (err: any) {
    console.error(`[MedicationReminders] Error creating reminders for apt ${appointmentId}:`, err?.message || err);
    return 0;
  }
}

export async function cancelMedicationRemindersForAppointment(appointmentId: number): Promise<void> {
  try {
    await db
      .update(schema.medicationReminders)
      .set({ status: 'CANCELLED', updatedAt: new Date() })
      .where(
        and(
          eq(schema.medicationReminders.appointmentId, appointmentId),
          eq(schema.medicationReminders.status, 'ACTIVE')
        )
      );
  } catch (err: any) {
    console.error(`[MedicationReminders] Error cancelling reminders for apt ${appointmentId}:`, err?.message || err);
  }
}

// ─── 4. BACKGROUND MEDICATION REMINDER ENGINE ─────────────────────────────────

export async function processMedicationReminders(): Promise<{ sent: number; skipped: number }> {
  let sent = 0;
  let skipped = 0;

  try {
    const now = new Date();
    const todayDateStr = now.toISOString().split('T')[0];
    const currentHours = now.getHours();
    const currentMinutes = now.getMinutes();
    const currentTotalMin = currentHours * 60 + currentMinutes;

    // Fetch all active medication reminders
    const result = await db.execute(sql`
      SELECT 
        mr.id,
        mr.appointment_id AS "appointmentId",
        mr.patient_id AS "patientId",
        mr.medication_name AS "medicationName",
        mr.dosage,
        mr.instructions,
        mr.frequency,
        mr.start_date AS "startDate",
        mr.end_date AS "endDate",
        mr.reminder_time AS "reminderTime",
        mr.status,
        mr.last_sent_at AS "lastSentAt",
        p.name AS "patientName",
        p.email AS "patientEmail",
        a.status AS "appointmentStatus"
      FROM medication_reminders mr
      JOIN users p ON mr.patient_id = p.id
      JOIN appointments a ON mr.appointment_id = a.id
      WHERE mr.status = 'ACTIVE'
    `);

    const activeReminders = result.rows as any[];

    for (const rem of activeReminders) {
      // 1. Appointment cancelled check
      if (rem.appointmentStatus === 'cancelled') {
        await db
          .update(schema.medicationReminders)
          .set({ status: 'CANCELLED', updatedAt: now })
          .where(eq(schema.medicationReminders.id, rem.id));
        continue;
      }

      const startDate = new Date(rem.startDate);
      const endDate = new Date(rem.endDate);

      // 2. Expiration check (now > endDate)
      if (now.getTime() > endDate.getTime()) {
        await db
          .update(schema.medicationReminders)
          .set({ status: 'COMPLETED', updatedAt: now })
          .where(eq(schema.medicationReminders.id, rem.id));
        continue;
      }

      // 3. Not started yet
      if (now.getTime() < startDate.getTime() - 5 * 60 * 1000) {
        continue;
      }

      // 4. PRN / As-needed check
      if (rem.frequency.toLowerCase().includes('as needed') || rem.frequency.toLowerCase().includes('prn')) {
        continue;
      }

      // 5. Parse reminder times (e.g. "09:00" or "09:00,21:00")
      const times = rem.reminderTime
        .split(',')
        .map((t: string) => t.trim())
        .filter((t: string) => /^\d{1,2}:\d{2}$/.test(t));

      for (const timeStr of times) {
        const [th, tm] = timeStr.split(':').map(Number);
        const targetTotalMin = th * 60 + tm;
        
        // Window check: matches within 15 minutes of scheduled time
        const diffMinutes = Math.abs(currentTotalMin - targetTotalMin);
        if (diffMinutes <= 15 || (targetTotalMin >= currentTotalMin - 15 && targetTotalMin <= currentTotalMin + 15)) {
          const occurrenceKey = `med_reminder_${rem.id}_${todayDateStr}_${timeStr}`;

          // Check duplicate occurrence
          const existingLog = await db
            .select({ id: schema.notificationLogs.id })
            .from(schema.notificationLogs)
            .where(eq(schema.notificationLogs.idempotencyKey, occurrenceKey))
            .limit(1);

          if (existingLog.length === 0) {
            const tmpl = patientMedicationReminderTemplate({
              patientName: rem.patientName,
              medicationName: rem.medicationName,
              dosage: rem.dosage || undefined,
              instructions: rem.instructions || undefined,
              frequency: rem.frequency,
              scheduledTime: timeStr,
              startDate: rem.startDate,
              endDate: rem.endDate,
            });

            await createAndSendNotification({
              appointmentId: rem.appointmentId,
              recipientUserId: rem.patientId,
              recipientEmail: rem.patientEmail,
              type: 'MEDICATION_REMINDER',
              subject: tmpl.subject,
              text: tmpl.text,
              html: tmpl.html,
              idempotencyKey: occurrenceKey,
            });

            await db
              .update(schema.medicationReminders)
              .set({ lastSentAt: now, updatedAt: now })
              .where(eq(schema.medicationReminders.id, rem.id));

            sent++;
          } else {
            skipped++;
          }
        }
      }
    }
  } catch (err: any) {
    console.error('[NotificationService] processMedicationReminders error:', err?.message || err);
  }

  return { sent, skipped };
}

// ─── 5. 24-HOUR APPOINTMENT REMINDERS (BACKGROUND) ───────────────────────────

export async function processAppointmentReminders(): Promise<{ sent: number; skipped: number }> {
  let sent = 0;
  let skipped = 0;

  try {
    // Window: between 23 and 25 hours from now
    const now = new Date();
    const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    const result = await db.execute(sql`
      SELECT 
        a.id AS "appointmentId",
        a.slot_start AS "slotStart",
        a.status AS "status",
        p.id AS "patientId",
        p.name AS "patientName",
        p.email AS "patientEmail",
        d.id AS "doctorId",
        d.name AS "doctorName",
        d.email AS "doctorEmail",
        dp.specialisation AS "specialisation"
      FROM appointments a
      JOIN users p ON a.patient_id = p.id
      JOIN doctor_profiles dp ON a.doctor_id = dp.id
      JOIN users d ON dp.user_id = d.id
      WHERE a.status = 'scheduled'
        AND a.slot_start >= ${windowStart.toISOString()}::timestamp
        AND a.slot_start <= ${windowEnd.toISOString()}::timestamp
    `);

    const upcomingAppointments = result.rows as any[];

    for (const apt of upcomingAppointments) {
      // 1. Patient reminder deduplication check
      const existingPatientReminder = await db
        .select({ id: schema.notificationLogs.id })
        .from(schema.notificationLogs)
        .where(
          and(
            eq(schema.notificationLogs.appointmentId, apt.appointmentId),
            eq(schema.notificationLogs.type, 'APPOINTMENT_REMINDER'),
            eq(schema.notificationLogs.recipientUserId, apt.patientId)
          )
        )
        .limit(1);

      if (existingPatientReminder.length === 0) {
        const pTmpl = patientReminderTemplate({
          patientName: apt.patientName,
          doctorName: apt.doctorName,
          specialisation: apt.specialisation,
          slotStart: apt.slotStart,
        });

        await createAndSendNotification({
          appointmentId: apt.appointmentId,
          recipientUserId: apt.patientId,
          recipientEmail: apt.patientEmail,
          type: 'APPOINTMENT_REMINDER',
          subject: pTmpl.subject,
          text: pTmpl.text,
          html: pTmpl.html,
        });
        sent++;
      } else {
        skipped++;
      }

      // 2. Doctor reminder deduplication check
      const existingDoctorReminder = await db
        .select({ id: schema.notificationLogs.id })
        .from(schema.notificationLogs)
        .where(
          and(
            eq(schema.notificationLogs.appointmentId, apt.appointmentId),
            eq(schema.notificationLogs.type, 'APPOINTMENT_REMINDER'),
            eq(schema.notificationLogs.recipientUserId, apt.doctorId)
          )
        )
        .limit(1);

      if (existingDoctorReminder.length === 0) {
        const dTmpl = doctorReminderTemplate({
          doctorName: apt.doctorName,
          patientName: apt.patientName,
          slotStart: apt.slotStart,
        });

        await createAndSendNotification({
          appointmentId: apt.appointmentId,
          recipientUserId: apt.doctorId,
          recipientEmail: apt.doctorEmail,
          type: 'APPOINTMENT_REMINDER',
          subject: dTmpl.subject,
          text: dTmpl.text,
          html: dTmpl.html,
        });
        sent++;
      } else {
        skipped++;
      }
    }
  } catch (err: any) {
    console.error('[NotificationService] processAppointmentReminders error:', err?.message || err);
  }

  return { sent, skipped };
}

// ─── 6. RETRY ENGINE (BACKGROUND) ─────────────────────────────────────────────

export async function processPendingAndFailedNotifications(): Promise<{ retried: number; failed: number }> {
  let retried = 0;
  let failed = 0;

  try {
    const now = new Date();

    // Query pending notifications due for delivery with retryCount < 3
    const pendingLogs = await db
      .select()
      .from(schema.notificationLogs)
      .where(
        and(
          or(
            eq(schema.notificationLogs.status, 'PENDING'),
            and(
              eq(schema.notificationLogs.status, 'FAILED'),
              lt(schema.notificationLogs.retryCount, 3)
            )
          ),
          lte(schema.notificationLogs.scheduledFor, now)
        )
      )
      .limit(25);

    for (const log of pendingLogs) {
      try {
        let subject = 'MediFlow Notification';
        let text = 'You have a new update from MediFlow.';
        let html: string | undefined = undefined;

        if (log.payload) {
          try {
            const parsed = JSON.parse(log.payload);
            subject = parsed.subject || subject;
            text = parsed.text || text;
            html = parsed.html || html;
          } catch {
            // keep fallback
          }
        }

        // Set to SENDING during attempt
        await db
          .update(schema.notificationLogs)
          .set({ status: 'SENDING' })
          .where(eq(schema.notificationLogs.id, log.id));

        const result = await sendEmail({
          to: log.recipientEmail,
          subject,
          text,
          html,
        });

        if (result.success) {
          await db
            .update(schema.notificationLogs)
            .set({
              status: 'SENT',
              sentAt: new Date(),
              lastError: null,
              errorMessage: null,
            })
            .where(eq(schema.notificationLogs.id, log.id));
          retried++;
        } else {
          const nextRetry = log.retryCount + 1;
          const isTransient = result.isTransient !== false;
          const isFinalFailure = nextRetry >= 3 || !isTransient;

          // Backoff delays: attempt 1 -> 1 min, attempt 2 -> 5 min
          const backoffDelay = nextRetry === 1 ? 60 * 1000 : 5 * 60 * 1000;
          const nextScheduled = isFinalFailure
            ? now
            : new Date(now.getTime() + backoffDelay);

          await db
            .update(schema.notificationLogs)
            .set({
              status: isFinalFailure ? 'FAILED' : 'PENDING',
              retryCount: nextRetry,
              lastError: result.error || 'Retry failed',
              errorMessage: result.error || 'Retry failed',
              scheduledFor: nextScheduled,
            })
            .where(eq(schema.notificationLogs.id, log.id));

          if (isFinalFailure) failed++;
        }
      } catch (innerErr: any) {
        console.error(`[NotificationService] Error processing retry log ${log.id}:`, innerErr?.message || innerErr);
      }
    }
  } catch (err: any) {
    console.error('[NotificationService] processPendingAndFailedNotifications error:', err?.message || err);
  }

  return { retried, failed };
}

// ─── 7. BACKGROUND CRON SCHEDULER ─────────────────────────────────────────────

export function startNotificationCronJobs(): void {
  try {
    // Run every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      console.log('[NotificationService] Running scheduled reminder & retry cycle...');
      try {
        const aptReminders = await processAppointmentReminders();
        if (aptReminders.sent > 0) {
          console.log(`[NotificationService] Sent ${aptReminders.sent} appointment reminder(s)`);
        }
      } catch (e: any) {
        console.error('[NotificationService] Cron appointment reminder error:', e?.message || e);
      }

      try {
        const medReminders = await processMedicationReminders();
        if (medReminders.sent > 0) {
          console.log(`[NotificationService] Sent ${medReminders.sent} medication reminder(s)`);
        }
      } catch (e: any) {
        console.error('[NotificationService] Cron medication reminder error:', e?.message || e);
      }

      try {
        const retries = await processPendingAndFailedNotifications();
        if (retries.retried > 0 || retries.failed > 0) {
          console.log(`[NotificationService] Processed retries: ${retries.retried} sent, ${retries.failed} failed`);
        }
      } catch (e: any) {
        console.error('[NotificationService] Cron retry error:', e?.message || e);
      }
    });

    console.log('[NotificationService] Background cron initialized (5-min interval)');
  } catch (err: any) {
    console.error('[NotificationService] Failed to start cron jobs:', err?.message || err);
  }
}
