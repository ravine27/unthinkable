import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';

const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

export function getOAuth2Client(): OAuth2Client | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/calendar/callback';

  if (!clientId || !clientSecret) {
    return null;
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

// ─── 1. OAUTH FLOW ─────────────────────────────────────────────────────────────

export function generateAuthUrl(userId: number, jwtSecret: string): string | null {
  const oauth2Client = getOAuth2Client();
  if (!oauth2Client) {
    console.warn('[Calendar] Google OAuth credentials not configured in environment');
    return null;
  }

  // Create secure signed state to prevent cross-account linking
  const state = jwt.sign(
    { userId, purpose: 'google_calendar_oauth' },
    jwtSecret,
    { expiresIn: '15m' }
  );

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: CALENDAR_SCOPES,
    state,
  });
}

export async function handleOAuthCallback(
  code: string,
  state: string,
  jwtSecret: string
): Promise<{ success: boolean; userId?: number; error?: string }> {
  try {
    const oauth2Client = getOAuth2Client();
    if (!oauth2Client) {
      return { success: false, error: 'Google OAuth not configured' };
    }

    // Verify and decode state
    const decoded = jwt.verify(state, jwtSecret) as { userId: number; purpose: string };
    if (!decoded || decoded.purpose !== 'google_calendar_oauth' || !decoded.userId) {
      return { success: false, error: 'Invalid or expired state parameter' };
    }

    const userId = decoded.userId;

    // Exchange authorization code for tokens
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.access_token) {
      return { success: false, error: 'No access token returned by Google' };
    }

    const expiryDate = tokens.expiry_date ? new Date(tokens.expiry_date) : null;

    // Persist tokens securely in database
    const existing = await db
      .select()
      .from(schema.userGoogleTokens)
      .where(eq(schema.userGoogleTokens.userId, userId));

    if (existing.length > 0) {
      await db
        .update(schema.userGoogleTokens)
        .set({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || existing[0].refreshToken,
          expiryDate,
          scope: tokens.scope || existing[0].scope,
          tokenType: tokens.token_type || 'Bearer',
          updatedAt: new Date(),
        })
        .where(eq(schema.userGoogleTokens.userId, userId));
    } else {
      await db.insert(schema.userGoogleTokens).values({
        userId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        expiryDate,
        scope: tokens.scope || null,
        tokenType: tokens.token_type || 'Bearer',
      });
    }

    console.log(`[Calendar] Successfully connected Google Calendar for user ${userId}`);
    return { success: true, userId };
  } catch (err: any) {
    console.error('[Calendar] Error in handleOAuthCallback:', err?.message || err);
    return { success: false, error: err?.message || 'OAuth callback failed' };
  }
}

// ─── 2. STATUS & DISCONNECT ───────────────────────────────────────────────────

export async function isUserCalendarConnected(userId: number): Promise<boolean> {
  try {
    const tokens = await db
      .select({ id: schema.userGoogleTokens.id })
      .from(schema.userGoogleTokens)
      .where(eq(schema.userGoogleTokens.userId, userId))
      .limit(1);

    return tokens.length > 0;
  } catch (err) {
    console.error(`[Calendar] Error checking status for user ${userId}:`, err);
    return false;
  }
}

export async function disconnectUserCalendar(userId: number): Promise<boolean> {
  try {
    const [tokenRow] = await db
      .select()
      .from(schema.userGoogleTokens)
      .where(eq(schema.userGoogleTokens.userId, userId));

    if (tokenRow) {
      // Best-effort revocation with Google
      const oauth2Client = getOAuth2Client();
      if (oauth2Client && tokenRow.accessToken) {
        oauth2Client.revokeToken(tokenRow.accessToken).catch(() => {});
      }

      await db.delete(schema.userGoogleTokens).where(eq(schema.userGoogleTokens.userId, userId));
      console.log(`[Calendar] Disconnected Google Calendar for user ${userId}`);
    }
    return true;
  } catch (err: any) {
    console.error(`[Calendar] Error disconnecting user ${userId}:`, err?.message || err);
    return false;
  }
}

// ─── 3. AUTHENTICATED CALENDAR CLIENT WITH AUTO-REFRESH ───────────────────────

async function getCalendarClientForUser(userId: number) {
  const oauth2Client = getOAuth2Client();
  if (!oauth2Client) return null;

  const [tokenRow] = await db
    .select()
    .from(schema.userGoogleTokens)
    .where(eq(schema.userGoogleTokens.userId, userId));

  if (!tokenRow || !tokenRow.accessToken) {
    return null;
  }

  oauth2Client.setCredentials({
    access_token: tokenRow.accessToken,
    refresh_token: tokenRow.refreshToken || undefined,
    expiry_date: tokenRow.expiryDate ? tokenRow.expiryDate.getTime() : undefined,
  });

  // Listen for automatic token refresh events and save back to database
  oauth2Client.on('tokens', async (newTokens) => {
    try {
      await db
        .update(schema.userGoogleTokens)
        .set({
          accessToken: newTokens.access_token || tokenRow.accessToken,
          refreshToken: newTokens.refresh_token || tokenRow.refreshToken,
          expiryDate: newTokens.expiry_date ? new Date(newTokens.expiry_date) : tokenRow.expiryDate,
          updatedAt: new Date(),
        })
        .where(eq(schema.userGoogleTokens.userId, userId));
      console.log(`[Calendar] Refreshed Google OAuth tokens for user ${userId}`);
    } catch (e) {
      console.error(`[Calendar] Failed to update refreshed tokens for user ${userId}:`, e);
    }
  });

  return google.calendar({ version: 'v3', auth: oauth2Client });
}

// ─── 4. APPOINTMENT EVENT SYNCHRONIZATION ──────────────────────────────────────

export async function syncAppointmentCalendarEvents(appointmentId: number): Promise<void> {
  try {
    console.log(`[Calendar] Creating event for appointment ${appointmentId}`);

    const result = await db.execute(sql`
      SELECT 
        a.id AS "appointmentId",
        a.slot_start AS "slotStart",
        a.slot_end AS "slotEnd",
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
      WHERE a.id = ${appointmentId}
    `);

    const apt = result.rows[0] as any;
    if (!apt || apt.status === 'cancelled') return;

    // Check existing calendar record
    const [existingRecord] = await db
      .select()
      .from(schema.calendarEvents)
      .where(eq(schema.calendarEvents.appointmentId, appointmentId));

    let patientEventId = existingRecord?.patientGoogleEventId || null;
    let doctorEventId = existingRecord?.doctorGoogleEventId || null;

    const startIso = new Date(apt.slotStart).toISOString();
    const endIso = new Date(apt.slotEnd).toISOString();

    // 1. Patient Calendar Event (if patient connected & event not yet created)
    if (!patientEventId) {
      try {
        const patientCal = await getCalendarClientForUser(apt.patientId);
        if (patientCal) {
          const res = await patientCal.events.insert({
            calendarId: 'primary',
            requestBody: {
              summary: `MediFlow: Appointment with Dr. ${apt.doctorName}`,
              description: `Consultation with Dr. ${apt.doctorName} (${apt.specialisation}).\nReference: MediFlow Appointment #${apt.appointmentId}`,
              start: { dateTime: startIso },
              end: { dateTime: endIso },
              status: 'confirmed',
            },
          });
          patientEventId = res.data.id || null;
          console.log(`[Calendar] Event created for patient (Event ID: ${patientEventId})`);
        }
      } catch (err: any) {
        console.error(`[Calendar] Failed to create patient event for appointment ${appointmentId}:`, err?.message || err);
      }
    }

    // 2. Doctor Calendar Event (if doctor connected & event not yet created)
    if (!doctorEventId) {
      try {
        const doctorCal = await getCalendarClientForUser(apt.doctorId);
        if (doctorCal) {
          const res = await doctorCal.events.insert({
            calendarId: 'primary',
            requestBody: {
              summary: `MediFlow: Consultation with ${apt.patientName}`,
              description: `Patient Consultation with ${apt.patientName}.\nReference: MediFlow Appointment #${apt.appointmentId}`,
              start: { dateTime: startIso },
              end: { dateTime: endIso },
              status: 'confirmed',
            },
          });
          doctorEventId = res.data.id || null;
          console.log(`[Calendar] Event created for doctor (Event ID: ${doctorEventId})`);
        }
      } catch (err: any) {
        console.error(`[Calendar] Failed to create doctor event for appointment ${appointmentId}:`, err?.message || err);
      }
    }

    // Persist IDs in calendarEvents table
    if (patientEventId || doctorEventId) {
      if (existingRecord) {
        await db
          .update(schema.calendarEvents)
          .set({
            patientGoogleEventId: patientEventId,
            doctorGoogleEventId: doctorEventId,
            updatedAt: new Date(),
          })
          .where(eq(schema.calendarEvents.appointmentId, appointmentId));
      } else {
        await db.insert(schema.calendarEvents).values({
          appointmentId,
          patientGoogleEventId: patientEventId,
          doctorGoogleEventId: doctorEventId,
        });
      }
    }
  } catch (err: any) {
    console.error(`[Calendar] Error syncing appointment ${appointmentId}:`, err?.message || err);
  }
}

export async function updateAppointmentCalendarEvents(appointmentId: number): Promise<void> {
  try {
    console.log(`[Calendar] Updating event for appointment ${appointmentId}`);

    const result = await db.execute(sql`
      SELECT 
        a.id AS "appointmentId",
        a.slot_start AS "slotStart",
        a.slot_end AS "slotEnd",
        p.id AS "patientId",
        d.id AS "doctorId"
      FROM appointments a
      JOIN users p ON a.patient_id = p.id
      JOIN doctor_profiles dp ON a.doctor_id = dp.id
      JOIN users d ON dp.user_id = d.id
      WHERE a.id = ${appointmentId}
    `);

    const apt = result.rows[0] as any;
    if (!apt) return;

    const [eventRecord] = await db
      .select()
      .from(schema.calendarEvents)
      .where(eq(schema.calendarEvents.appointmentId, appointmentId));

    if (!eventRecord) return;

    const startIso = new Date(apt.slotStart).toISOString();
    const endIso = new Date(apt.slotEnd).toISOString();

    // Update patient calendar event
    if (eventRecord.patientGoogleEventId) {
      try {
        const patientCal = await getCalendarClientForUser(apt.patientId);
        if (patientCal) {
          await patientCal.events.patch({
            calendarId: 'primary',
            eventId: eventRecord.patientGoogleEventId,
            requestBody: {
              start: { dateTime: startIso },
              end: { dateTime: endIso },
            },
          });
          console.log(`[Calendar] Patient event updated (Event ID: ${eventRecord.patientGoogleEventId})`);
        }
      } catch (err: any) {
        console.error(`[Calendar] Failed to update patient event ${eventRecord.patientGoogleEventId}:`, err?.message || err);
      }
    }

    // Update doctor calendar event
    if (eventRecord.doctorGoogleEventId) {
      try {
        const doctorCal = await getCalendarClientForUser(apt.doctorId);
        if (doctorCal) {
          await doctorCal.events.patch({
            calendarId: 'primary',
            eventId: eventRecord.doctorGoogleEventId,
            requestBody: {
              start: { dateTime: startIso },
              end: { dateTime: endIso },
            },
          });
          console.log(`[Calendar] Doctor event updated (Event ID: ${eventRecord.doctorGoogleEventId})`);
        }
      } catch (err: any) {
        console.error(`[Calendar] Failed to update doctor event ${eventRecord.doctorGoogleEventId}:`, err?.message || err);
      }
    }
  } catch (err: any) {
    console.error(`[Calendar] Error updating appointment events ${appointmentId}:`, err?.message || err);
  }
}

export async function deleteAppointmentCalendarEvents(appointmentId: number): Promise<void> {
  try {
    console.log(`[Calendar] Deleting event for appointment ${appointmentId}`);

    const result = await db.execute(sql`
      SELECT 
        a.id AS "appointmentId",
        p.id AS "patientId",
        d.id AS "doctorId"
      FROM appointments a
      JOIN users p ON a.patient_id = p.id
      JOIN doctor_profiles dp ON a.doctor_id = dp.id
      JOIN users d ON dp.user_id = d.id
      WHERE a.id = ${appointmentId}
    `);

    const apt = result.rows[0] as any;
    if (!apt) return;

    const [eventRecord] = await db
      .select()
      .from(schema.calendarEvents)
      .where(eq(schema.calendarEvents.appointmentId, appointmentId));

    if (!eventRecord) return;

    // Delete patient calendar event
    if (eventRecord.patientGoogleEventId) {
      try {
        const patientCal = await getCalendarClientForUser(apt.patientId);
        if (patientCal) {
          await patientCal.events.delete({
            calendarId: 'primary',
            eventId: eventRecord.patientGoogleEventId,
          });
          console.log(`[Calendar] Patient event deleted (Event ID: ${eventRecord.patientGoogleEventId})`);
        }
      } catch (err: any) {
        // 404/410 means already deleted
        if (err?.code !== 404 && err?.code !== 410) {
          console.error(`[Calendar] Failed to delete patient event ${eventRecord.patientGoogleEventId}:`, err?.message || err);
        }
      }
    }

    // Delete doctor calendar event
    if (eventRecord.doctorGoogleEventId) {
      try {
        const doctorCal = await getCalendarClientForUser(apt.doctorId);
        if (doctorCal) {
          await doctorCal.events.delete({
            calendarId: 'primary',
            eventId: eventRecord.doctorGoogleEventId,
          });
          console.log(`[Calendar] Doctor event deleted (Event ID: ${eventRecord.doctorGoogleEventId})`);
        }
      } catch (err: any) {
        if (err?.code !== 404 && err?.code !== 410) {
          console.error(`[Calendar] Failed to delete doctor event ${eventRecord.doctorGoogleEventId}:`, err?.message || err);
        }
      }
    }

    // Clean up record
    await db.delete(schema.calendarEvents).where(eq(schema.calendarEvents.appointmentId, appointmentId));
  } catch (err: any) {
    console.error(`[Calendar] Error deleting appointment events ${appointmentId}:`, err?.message || err);
  }
}
