import express from 'express';
import path from 'path';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import { db } from './src/db/index.js';
import * as schema from './src/db/schema.js';
import { eq, and, or, sql, gte, lte } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { generatePreVisitSummary, generatePostVisitSummary } from './src/lib/gemini.js';
import {
  startNotificationCronJobs,
  notifyBookingCreated,
  notifyAppointmentCancelled,
  notifyAppointmentRescheduled,
  notifyLeaveConflictAppointments,
  createMedicationRemindersForAppointment,
} from './src/services/notificationService.js';
import {
  generateAuthUrl,
  handleOAuthCallback,
  isUserCalendarConnected,
  disconnectUserCalendar,
  syncAppointmentCalendarEvents,
  updateAppointmentCalendarEvents,
  deleteAppointmentCalendarEvents,
} from './src/lib/googleCalendar.js';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // --- Auth Middleware ---
  const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_do_not_use_in_prod';
  
  const authenticateToken = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
      if (err) return res.sendStatus(403);
      (req as any).user = user;
      next();
    });
  };

  // --- Admin Middleware ---
  const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if ((req as any).user?.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden. Admin access required.' });
    }
    next();
  };

  // --- API Routes ---
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Auth Routes
  app.post("/api/auth/register", async (req, res) => {
    try {
      const { role, name, email, password } = req.body;
      if (!['patient', 'doctor', 'admin'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }

      const existing = await db.select().from(schema.users).where(eq(schema.users.email, email));
      if (existing.length > 0) {
        return res.status(400).json({ error: 'Email already in use' });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const [user] = await db.insert(schema.users).values({
        role,
        name,
        email,
        passwordHash
      }).returning();

      if (role === 'doctor') {
        await db.insert(schema.doctorProfiles).values({
          userId: user.id,
          specialisation: 'General', // Default, can be updated later
          workingHoursStart: '09:00',
          workingHoursEnd: '17:00',
          slotDurationMinutes: 30
        });
      }

      const token = jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: '24h' });
      res.json({ user: { id: user.id, role: user.role, name: user.name, email: user.email }, token });
    } catch (e: any) {
      console.error('Registration error:', e);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      const users = await db.select().from(schema.users).where(eq(schema.users.email, email));
      if (users.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

      const user = users[0];
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

      const token = jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: '24h' });
      res.json({ user: { id: user.id, role: user.role, name: user.name, email: user.email }, token });
    } catch (e: any) {
      console.error('Login error:', e);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // --- Google Calendar Routes ---

  // 1. Initiate Google Calendar OAuth connection
  app.get("/api/calendar/connect", authenticateToken, (req, res) => {
    try {
      const userId = (req as any).user.id;
      const url = generateAuthUrl(userId, JWT_SECRET);
      if (!url) {
        return res.status(400).json({ error: 'Google Calendar integration is not configured on the server' });
      }
      res.json({ url });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 2. Google OAuth Callback
  app.get("/api/calendar/callback", async (req, res) => {
    try {
      const { code, state, error } = req.query;

      if (error) {
        console.warn('[Calendar] Google OAuth denied:', error);
        return res.redirect('/?calendar_error=access_denied');
      }

      if (!code || !state) {
        return res.status(400).send('Missing code or state parameter');
      }

      const result = await handleOAuthCallback(code as string, state as string, JWT_SECRET);

      if (result.success) {
        res.redirect('/?calendar=connected');
      } else {
        res.redirect(`/?calendar_error=${encodeURIComponent(result.error || 'connection_failed')}`);
      }
    } catch (e: any) {
      console.error('[Calendar] Callback error:', e);
      res.redirect('/?calendar_error=server_error');
    }
  });

  // 3. Check Google Calendar connection status
  app.get("/api/calendar/status", authenticateToken, async (req, res) => {
    try {
      const userId = (req as any).user.id;
      const connected = await isUserCalendarConnected(userId);
      res.json({ connected });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 4. Disconnect Google Calendar
  app.post("/api/calendar/disconnect", authenticateToken, async (req, res) => {
    try {
      const userId = (req as any).user.id;
      await disconnectUserCalendar(userId);
      res.json({ success: true, connected: false });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Admin Routes ---

  // 1. Get all doctors (including inactive)
  app.get("/api/admin/doctors", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const doctors = await db.select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        profile: schema.doctorProfiles
      })
      .from(schema.users)
      .innerJoin(schema.doctorProfiles, eq(schema.users.id, schema.doctorProfiles.userId))
      .where(eq(schema.users.role, 'doctor'));
      res.json(doctors);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 2. Create a new doctor
  app.post("/api/admin/doctors", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const { name, email, password, specialisation, workingHoursStart, workingHoursEnd, slotDurationMinutes } = req.body;
      
      const existing = await db.select().from(schema.users).where(eq(schema.users.email, email));
      if (existing.length > 0) return res.status(400).json({ error: 'Email already in use' });

      const passwordHash = await bcrypt.hash(password, 10);
      
      await db.transaction(async (tx) => {
        const [user] = await tx.insert(schema.users).values({
          role: 'doctor', name, email, passwordHash
        }).returning();

        await tx.insert(schema.doctorProfiles).values({
          userId: user.id,
          specialisation: specialisation || 'General',
          workingHoursStart: workingHoursStart || '09:00',
          workingHoursEnd: workingHoursEnd || '17:00',
          slotDurationMinutes: slotDurationMinutes ? parseInt(slotDurationMinutes) : 30
        });
      });

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 3. Edit doctor (soft delete / update)
  app.put("/api/admin/doctors/:profileId", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const profileId = parseInt(req.params.profileId);
      const { specialisation, workingHoursStart, workingHoursEnd, slotDurationMinutes, isActive } = req.body;
      
      await db.update(schema.doctorProfiles)
        .set({ specialisation, workingHoursStart, workingHoursEnd, slotDurationMinutes, isActive })
        .where(eq(schema.doctorProfiles.id, profileId));
        
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 4. Leave management (check conflicts, then confirm)
  app.post("/api/admin/leaves", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const { doctorId, date, reason, confirm } = req.body; // date in YYYY-MM-DD
      
      // Check existing appointments on that date
      const startOfDay = new Date(`${date}T00:00:00Z`);
      const endOfDay = new Date(`${date}T23:59:59Z`);
      
      const conflicts = await db.select().from(schema.appointments)
        .where(and(
          eq(schema.appointments.doctorId, doctorId),
          gte(schema.appointments.slotStart, startOfDay),
          lte(schema.appointments.slotStart, endOfDay),
          eq(schema.appointments.status, 'scheduled')
        ));

      if (conflicts.length > 0 && !confirm) {
        return res.status(409).json({ 
          error: 'Conflicts found', 
          conflictsCount: conflicts.length,
          message: `There are ${conflicts.length} appointments scheduled for this date. Confirming will flag them for cancellation/reschedule.` 
        });
      }

      // Fetch affected appointments with patient and doctor details for notification
      const conflictAppointments = await db.execute(sql`
        SELECT 
          a.id,
          a.slot_start AS "slotStart",
          p.id AS "patientId",
          p.name AS "patientName",
          p.email AS "patientEmail",
          d.name AS "doctorName"
        FROM appointments a
        JOIN users p ON a.patient_id = p.id
        JOIN doctor_profiles dp ON a.doctor_id = dp.id
        JOIN users d ON dp.user_id = d.id
        WHERE a.doctor_id = ${doctorId}
          AND a.slot_start >= ${startOfDay}
          AND a.slot_start <= ${endOfDay}
          AND a.status = 'scheduled'
      `);

      await db.transaction(async (tx) => {
        // Insert leave
        await tx.insert(schema.doctorLeaveDays).values({ doctorId, date, reason });
        
        if (conflicts.length > 0) {
          // Flag appointments as cancelled due to leave
          await tx.update(schema.appointments)
            .set({ status: 'cancelled' })
            .where(and(
              eq(schema.appointments.doctorId, doctorId),
              gte(schema.appointments.slotStart, startOfDay),
              lte(schema.appointments.slotStart, endOfDay),
              eq(schema.appointments.status, 'scheduled')
            ));
        }
      });

      // Send leave conflict notification asynchronously after transaction commits
      if (conflictAppointments.rows.length > 0) {
        notifyLeaveConflictAppointments(
          conflictAppointments.rows.map((row: any) => ({
            id: row.id,
            patientId: row.patientId,
            patientName: row.patientName,
            patientEmail: row.patientEmail,
            doctorName: row.doctorName,
            slotStart: row.slotStart,
            reason: reason || undefined,
          }))
        ).catch(err => console.error('[Leave] Conflict notification error:', err));

        // Delete associated calendar events asynchronously
        conflictAppointments.rows.forEach((row: any) => {
          deleteAppointmentCalendarEvents(row.id).catch(err => {
            console.error('[Leave] Calendar event deletion error:', err);
          });
        });
      }

      res.json({ success: true, affected: conflicts.length });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  // 4b. Get leaves
  app.get("/api/admin/leaves", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const result = await db.execute(sql`
        SELECT 
          l.id, 
          l.date, 
          l.reason, 
          d.name AS "doctorName",
          dp.id AS "doctorId"
        FROM doctor_leave_days l
        JOIN doctor_profiles dp ON l.doctor_id = dp.id
        JOIN users d ON dp.user_id = d.id
        ORDER BY l.date DESC
      `);
      res.json(result.rows);
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  // 5. Appointments Overview
  app.get("/api/admin/appointments", authenticateToken, requireAdmin, async (req, res) => {
    try {
      const result = await db.execute(sql`
        SELECT 
          a.id, 
          a.slot_start AS "slotStart", 
          a.slot_end AS "slotEnd", 
          a.status, 
          p.name AS "patientName", 
          d.name AS "doctorName", 
          dp.specialisation AS "doctorSpecialisation"
        FROM appointments a
        JOIN users p ON a.patient_id = p.id
        JOIN doctor_profiles dp ON a.doctor_id = dp.id
        JOIN users d ON dp.user_id = d.id
        ORDER BY a.slot_start DESC
      `);
      res.json(result.rows);
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  // Doctor Routes
  app.get("/api/doctors", authenticateToken, async (req, res) => {
    try {
      // Return all doctors and their profiles
      const doctors = await db.select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        profile: schema.doctorProfiles
      })
      .from(schema.users)
      .innerJoin(schema.doctorProfiles, eq(schema.users.id, schema.doctorProfiles.userId))
      .where(eq(schema.users.role, 'doctor'));
      
      res.json(doctors);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get available slots for a doctor on a specific date
  app.get("/api/doctors/:doctorId/available", authenticateToken, async (req, res) => {
    try {
      const doctorId = parseInt(req.params.doctorId);
      if (isNaN(doctorId)) {
        return res.status(400).json({ error: 'Invalid doctor ID' });
      }

      const [doctor] = await db.select().from(schema.doctorProfiles).where(eq(schema.doctorProfiles.id, doctorId));
      if (!doctor || !doctor.isActive) {
        return res.status(404).json({ error: 'Doctor not found or inactive' });
      }

      const dateStr = req.query.date as string;
      if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return res.status(400).json({ error: 'Invalid date format. Expected YYYY-MM-DD' });
      }

      const [year, month, day] = dateStr.split('-').map(Number);
      const dateObj = new Date(Date.UTC(year, month - 1, day));
      if (
        isNaN(dateObj.getTime()) ||
        dateObj.getUTCFullYear() !== year ||
        dateObj.getUTCMonth() !== month - 1 ||
        dateObj.getUTCDate() !== day
      ) {
        return res.status(400).json({ error: 'Invalid calendar date' });
      }

      // Check if doctor is on leave on this date
      const [leave] = await db.select().from(schema.doctorLeaveDays)
        .where(and(eq(schema.doctorLeaveDays.doctorId, doctorId), eq(schema.doctorLeaveDays.date, dateStr)));
      if (leave) {
        res.setHeader('X-Doctor-On-Leave', 'true');
        return res.json([]);
      }

      // Parse doctor working hours
      const [startHour, startMin] = (doctor.workingHoursStart || '09:00').split(':').map(Number);
      const [endHour, endMin] = (doctor.workingHoursEnd || '17:00').split(':').map(Number);
      const duration = doctor.slotDurationMinutes || 30;

      const startMinutes = startHour * 60 + startMin;
      const endMinutes = endHour * 60 + endMin;

      if (startMinutes >= endMinutes || duration <= 0) {
        res.setHeader('X-Doctor-On-Leave', 'false');
        return res.json([]);
      }

      // Generate all candidate slots inside working hours
      const candidateSlots: Date[] = [];
      for (let timeMinutes = startMinutes; timeMinutes + duration <= endMinutes; timeMinutes += duration) {
        const h = Math.floor(timeMinutes / 60);
        const m = timeMinutes % 60;
        const slotDate = new Date(Date.UTC(year, month - 1, day, h, m, 0, 0));
        candidateSlots.push(slotDate);
      }

      if (candidateSlots.length === 0) {
        res.setHeader('X-Doctor-On-Leave', 'false');
        return res.json([]);
      }

      const startOfDay = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
      const endOfDay = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
      const now = new Date();

      // Query active appointments
      const bookedAppointments = await db.select({
        slotStart: schema.appointments.slotStart
      }).from(schema.appointments)
      .where(and(
        eq(schema.appointments.doctorId, doctorId),
        gte(schema.appointments.slotStart, startOfDay),
        lte(schema.appointments.slotStart, endOfDay),
        sql`${schema.appointments.status} != 'cancelled'`
      ));

      const bookedTimes = new Set(bookedAppointments.map(a => new Date(a.slotStart).getTime()));

      // Query active (non-expired) slot holds
      const activeHolds = await db.select({
        slotStart: schema.slotHolds.slotStart
      }).from(schema.slotHolds)
      .where(and(
        eq(schema.slotHolds.doctorId, doctorId),
        gte(schema.slotHolds.slotStart, startOfDay),
        lte(schema.slotHolds.slotStart, endOfDay),
        gte(schema.slotHolds.expiresAt, now)
      ));

      const heldTimes = new Set(activeHolds.map(h => new Date(h.slotStart).getTime()));

      // Filter slots: exclude past, booked, or actively held
      const availableSlots = candidateSlots
        .filter(slot => {
          const t = slot.getTime();
          if (slot <= now) return false;
          if (bookedTimes.has(t)) return false;
          if (heldTimes.has(t)) return false;
          return true;
        })
        .map(slot => slot.toISOString());

      res.setHeader('X-Doctor-On-Leave', 'false');
      res.json(availableSlots);
    } catch (e: any) {
      console.error('Error fetching available slots:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // --- Booking Flow ---

  // 1. Patient requests a slot (starts hold)
  app.post("/api/appointments/hold", authenticateToken, async (req, res) => {
    try {
      const { doctorId, slotStart } = req.body;
      const patientId = (req as any).user.id;
      const slotDate = new Date(slotStart);

      if (isNaN(slotDate.getTime())) return res.status(400).json({ error: 'Invalid slotStart date' });
      if (slotDate <= new Date()) return res.status(400).json({ error: 'Slot must be in the future' });

      // Basic validation
      const [doctor] = await db.select().from(schema.doctorProfiles).where(eq(schema.doctorProfiles.id, doctorId));
      if (!doctor || !doctor.isActive) return res.status(400).json({ error: 'Doctor not found or inactive' });

      const slotTimeStr = slotDate.toISOString().split('T')[1].substring(0, 5);
      if (slotTimeStr < doctor.workingHoursStart || slotTimeStr >= doctor.workingHoursEnd) {
        return res.status(400).json({ error: 'Slot outside working hours' });
      }

      const dateStr = slotDate.toISOString().split('T')[0];
      const [leave] = await db.select().from(schema.doctorLeaveDays)
        .where(and(eq(schema.doctorLeaveDays.doctorId, doctorId), eq(schema.doctorLeaveDays.date, dateStr)));
      if (leave) return res.status(400).json({ error: 'Doctor is on leave this day' });

      await db.transaction(async (tx) => {
        // Lock the doctor row to serialize hold creation for this doctor, avoiding T1/T2 race conditions checking/inserting.
        await tx.execute(sql`SELECT 1 FROM doctor_profiles WHERE id = ${doctorId} FOR UPDATE`);

        // Clean up ALL expired holds for this doctor to free unique index
        await tx.delete(schema.slotHolds)
          .where(and(
            eq(schema.slotHolds.doctorId, doctorId), 
            sql`${schema.slotHolds.expiresAt} < NOW()`
          ));

        const existingBooking = await tx.select().from(schema.appointments)
          .where(and(
            eq(schema.appointments.doctorId, doctorId),
            eq(schema.appointments.slotStart, slotDate),
            sql`${schema.appointments.status} != 'cancelled'`
          ));
        
        if (existingBooking.length > 0) throw new Error('CONFLICT: Slot is already booked');

        const existingHold = await tx.select().from(schema.slotHolds)
          .where(and(
            eq(schema.slotHolds.doctorId, doctorId),
            eq(schema.slotHolds.slotStart, slotDate)
          ));
        
        if (existingHold.length > 0) throw new Error('CONFLICT: Slot is currently held');

        const expiresAt = new Date(Date.now() + 5 * 60000); // 5 minutes
        const [hold] = await tx.insert(schema.slotHolds).values({
          doctorId,
          patientId,
          slotStart: slotDate,
          expiresAt
        }).returning();

        res.json({ hold });
      });
    } catch (e: any) {
      if (e.code === '23505' || e.message.includes('CONFLICT')) {
        return res.status(409).json({ error: 'Slot conflict: already held or booked' });
      }
      res.status(400).json({ error: e.message });
    }
  });

  // 2. Patient confirms booking (submits pre-visit form)
  app.post("/api/appointments/book", authenticateToken, async (req, res) => {
    try {
      const { holdId, rawSymptoms } = req.body;
      const patientId = (req as any).user.id;

      await db.transaction(async (tx) => {
        // First verify hold
        const holds = await tx.select().from(schema.slotHolds).where(eq(schema.slotHolds.id, holdId));
        if (holds.length === 0) throw new Error('NOT_FOUND: Hold not found or expired');
        
        const hold = holds[0];
        if (hold.patientId !== patientId) throw new Error('FORBIDDEN: Hold belongs to another user');
        if (hold.expiresAt.getTime() < Date.now()) throw new Error('NOT_FOUND: Hold expired');

        // Lock doctor
        await tx.execute(sql`SELECT 1 FROM doctor_profiles WHERE id = ${hold.doctorId} FOR UPDATE`);

        // Get doctor profile to know slot duration
        const [doctor] = await tx.select().from(schema.doctorProfiles).where(eq(schema.doctorProfiles.id, hold.doctorId));
        if (!doctor) throw new Error('NOT_FOUND: Doctor not found');

        const slotEnd = new Date(hold.slotStart.getTime() + doctor.slotDurationMinutes * 60000);

        // We can safely try inserting because we have the DB unique constraint, but we check anyway:
        const existingBooking = await tx.select().from(schema.appointments)
          .where(and(
            eq(schema.appointments.doctorId, hold.doctorId),
            eq(schema.appointments.slotStart, hold.slotStart),
            sql`${schema.appointments.status} != 'cancelled'`
          ));
        if (existingBooking.length > 0) throw new Error('CONFLICT: Slot booked by another transaction');

        const [appointment] = await tx.insert(schema.appointments).values({
          patientId,
          doctorId: hold.doctorId,
          slotStart: hold.slotStart,
          slotEnd,
          status: 'scheduled'
        }).returning();

        // Ensure rawSymptoms string exists (even if empty) to avoid DB null constraint failure if required.
        await tx.insert(schema.symptomForms).values({
          appointmentId: appointment.id,
          rawSymptoms: rawSymptoms || ''
        });

        await tx.delete(schema.slotHolds).where(eq(schema.slotHolds.id, hold.id));
        
        // Background AI pre-visit summary processing
        if (rawSymptoms) {
          generatePreVisitSummary(rawSymptoms).then(async (aiResult) => {
            await db.update(schema.symptomForms)
              .set({
                urgency: aiResult.urgency,
                chiefComplaint: aiResult.chiefComplaint,
                suggestedQuestions: JSON.stringify(aiResult.questions),
                aiStatus: 'COMPLETED',
                aiGeneratedAt: new Date()
              })
              .where(eq(schema.symptomForms.appointmentId, appointment.id));
          }).catch(async (e) => {
            console.error("Pre-visit AI failed:", e);
            await db.update(schema.symptomForms)
              .set({ aiStatus: 'UNAVAILABLE' })
              .where(eq(schema.symptomForms.appointmentId, appointment.id));
          });
        }

        res.json({ appointment });

        // Trigger booking confirmation email asynchronously after response
        notifyBookingCreated(appointment.id).catch(err => {
          console.error('[Booking] Email notification error:', err);
        });

        // Trigger Google Calendar event creation asynchronously
        syncAppointmentCalendarEvents(appointment.id).catch(err => {
          console.error('[Booking] Calendar sync error:', err);
        });
      });
    } catch (e: any) {
      if (e.code === '23505' || e.message.includes('CONFLICT')) {
        return res.status(409).json({ error: 'Slot conflict: already held or booked' });
      }
      if (e.message.includes('NOT_FOUND')) return res.status(404).json({ error: e.message.replace('NOT_FOUND: ', '') });
      if (e.message.includes('FORBIDDEN')) return res.status(403).json({ error: e.message.replace('FORBIDDEN: ', '') });
      res.status(400).json({ error: e.message });
    }
  });

  // 3. Cancel appointment
  app.post("/api/appointments/:id/cancel", authenticateToken, async (req, res) => {
    try {
      const appointmentId = parseInt(req.params.id);
      const userId = (req as any).user.id;
      const userRole = (req as any).user.role;

      await db.transaction(async (tx) => {
        const [appointment] = await tx.select().from(schema.appointments).where(eq(schema.appointments.id, appointmentId));
        if (!appointment) throw new Error('NOT_FOUND: Appointment not found');
        
        if (userRole === 'patient' && appointment.patientId !== userId) throw new Error('FORBIDDEN: Access denied');
        if (userRole === 'doctor') {
           const [docProfile] = await tx.select().from(schema.doctorProfiles).where(eq(schema.doctorProfiles.userId, userId));
           if (!docProfile || appointment.doctorId !== docProfile.id) throw new Error('FORBIDDEN: Access denied');
        }

        await tx.update(schema.appointments)
          .set({ status: 'cancelled' })
          .where(eq(schema.appointments.id, appointmentId));
        
        res.json({ success: true });

        // Trigger cancellation email asynchronously after response
        notifyAppointmentCancelled(appointmentId).catch(err => {
          console.error('[Cancellation] Email notification error:', err);
        });

        // Trigger Google Calendar event deletion asynchronously
        deleteAppointmentCalendarEvents(appointmentId).catch(err => {
          console.error('[Cancellation] Calendar deletion error:', err);
        });
      });
    } catch (e: any) {
      if (e.message.includes('NOT_FOUND')) return res.status(404).json({ error: e.message.replace('NOT_FOUND: ', '') });
      if (e.message.includes('FORBIDDEN')) return res.status(403).json({ error: e.message.replace('FORBIDDEN: ', '') });
      res.status(400).json({ error: e.message });
    }
  });

  // 4. Reschedule appointment
  app.post("/api/appointments/:id/reschedule", authenticateToken, async (req, res) => {
    try {
      const appointmentId = parseInt(req.params.id);
      const { newSlotStart } = req.body;
      const userId = (req as any).user.id;
      
      const slotDate = new Date(newSlotStart);
      if (isNaN(slotDate.getTime())) return res.status(400).json({ error: 'Invalid newSlotStart date' });
      if (slotDate <= new Date()) return res.status(400).json({ error: 'Slot must be in the future' });

      await db.transaction(async (tx) => {
        const [appointment] = await tx.select().from(schema.appointments).where(eq(schema.appointments.id, appointmentId));
        if (!appointment) throw new Error('NOT_FOUND: Appointment not found');
        if (appointment.patientId !== userId) throw new Error('FORBIDDEN: Access denied');

        const doctorId = appointment.doctorId;

        // Lock doctor
        await tx.execute(sql`SELECT 1 FROM doctor_profiles WHERE id = ${doctorId} FOR UPDATE`);

        const [doctor] = await tx.select().from(schema.doctorProfiles).where(eq(schema.doctorProfiles.id, doctorId));
        if (!doctor || !doctor.isActive) throw new Error('BAD_REQUEST: Doctor not available');

        const slotTimeStr = slotDate.toISOString().split('T')[1].substring(0, 5);
        if (slotTimeStr < doctor.workingHoursStart || slotTimeStr >= doctor.workingHoursEnd) {
          throw new Error('BAD_REQUEST: Slot outside working hours');
        }

        const dateStr = slotDate.toISOString().split('T')[0];
        const [leave] = await tx.select().from(schema.doctorLeaveDays)
          .where(and(eq(schema.doctorLeaveDays.doctorId, doctorId), eq(schema.doctorLeaveDays.date, dateStr)));
        if (leave) throw new Error('BAD_REQUEST: Doctor is on leave this day');

        // Check conflicts
        await tx.delete(schema.slotHolds)
          .where(and(eq(schema.slotHolds.doctorId, doctorId), sql`${schema.slotHolds.expiresAt} < NOW()`));

        const existingBooking = await tx.select().from(schema.appointments)
          .where(and(
            eq(schema.appointments.doctorId, doctorId),
            eq(schema.appointments.slotStart, slotDate),
            sql`${schema.appointments.status} != 'cancelled'`
          ));
        if (existingBooking.length > 0) throw new Error('CONFLICT: Slot is already booked');

        const existingHold = await tx.select().from(schema.slotHolds)
          .where(and(
            eq(schema.slotHolds.doctorId, doctorId),
            eq(schema.slotHolds.slotStart, slotDate)
          ));
        if (existingHold.length > 0) throw new Error('CONFLICT: Slot is currently held');

        const oldSlotStart = appointment.slotStart;
        const slotEnd = new Date(slotDate.getTime() + doctor.slotDurationMinutes * 60000);

        await tx.update(schema.appointments)
          .set({ slotStart: slotDate, slotEnd })
          .where(eq(schema.appointments.id, appointmentId));
        
        res.json({ success: true, slotStart: slotDate });

        // Trigger reschedule email asynchronously after response
        notifyAppointmentRescheduled(appointmentId, oldSlotStart).catch(err => {
          console.error('[Reschedule] Email notification error:', err);
        });

        // Trigger Google Calendar event update asynchronously
        updateAppointmentCalendarEvents(appointmentId).catch(err => {
          console.error('[Reschedule] Calendar update error:', err);
        });
      });
    } catch (e: any) {
      if (e.code === '23505' || e.message.includes('CONFLICT')) {
        return res.status(409).json({ error: 'Slot conflict' });
      }
      if (e.message.includes('NOT_FOUND')) return res.status(404).json({ error: e.message.replace('NOT_FOUND: ', '') });
      if (e.message.includes('FORBIDDEN')) return res.status(403).json({ error: e.message.replace('FORBIDDEN: ', '') });
      if (e.message.includes('BAD_REQUEST')) return res.status(400).json({ error: e.message.replace('BAD_REQUEST: ', '') });
      res.status(400).json({ error: e.message });
    }
  });

  // 5. Get My Appointments (Patient or Doctor)
  app.get("/api/appointments", authenticateToken, async (req, res) => {
    try {
      const user = (req as any).user;
      
      let result;
      if (user.role === 'patient') {
        result = await db.execute(sql`
          SELECT a.*, d.name as doctor_name, dp.specialisation 
          FROM appointments a
          JOIN doctor_profiles dp ON a.doctor_id = dp.id
          JOIN users d ON dp.user_id = d.id
          WHERE a.patient_id = ${user.id}
          ORDER BY a.slot_start DESC
        `);
      } else if (user.role === 'doctor') {
        const [doc] = await db.select().from(schema.doctorProfiles).where(eq(schema.doctorProfiles.userId, user.id));
        if (!doc) return res.json([]);
        result = await db.execute(sql`
          SELECT a.*, p.name as patient_name 
          FROM appointments a
          JOIN users p ON a.patient_id = p.id
          WHERE a.doctor_id = ${doc.id}
          ORDER BY a.slot_start DESC
        `);
      } else {
        return res.status(403).json({ error: 'Admins should use /api/admin/appointments' });
      }
      
      res.json(result.rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 5b. Complete appointment
  app.post("/api/appointments/:id/complete", authenticateToken, async (req, res) => {
    try {
      const appointmentId = parseInt(req.params.id);
      const user = (req as any).user;
      const { clinicalNotes, prescriptionRaw, followUpInstructions } = req.body;

      if (user.role !== 'doctor') {
        return res.status(403).json({ error: 'Only doctors can complete appointments' });
      }

      let patientId: number | null = null;

      await db.transaction(async (tx) => {
        const [doc] = await tx.select().from(schema.doctorProfiles).where(eq(schema.doctorProfiles.userId, user.id));
        const [appointment] = await tx.select().from(schema.appointments).where(eq(schema.appointments.id, appointmentId));

        if (!appointment || appointment.doctorId !== doc.id) {
          throw new Error('FORBIDDEN: Access denied');
        }

        patientId = appointment.patientId;

        await tx.update(schema.appointments)
          .set({ status: 'completed' })
          .where(eq(schema.appointments.id, appointmentId));

        await tx.insert(schema.visitNotes).values({
          appointmentId,
          clinicalNotes,
          prescriptionRaw,
          followUpInstructions
        });
      });

      // Create medication reminder records asynchronously if prescription exists
      if (patientId && prescriptionRaw) {
        createMedicationRemindersForAppointment(appointmentId, patientId, prescriptionRaw).catch(err => {
          console.error('[MedicationReminders] Error creating reminders after completion:', err);
        });
      }

      // AI post-visit summary processing
      generatePostVisitSummary(clinicalNotes, prescriptionRaw).then(async (summary) => {
        await db.update(schema.visitNotes)
          .set({
            patientSummary: summary,
            aiStatus: 'COMPLETED',
            aiGeneratedAt: new Date()
          })
          .where(eq(schema.visitNotes.appointmentId, appointmentId));
      }).catch(async (e) => {
        console.error("Post-visit AI failed:", e);
        await db.update(schema.visitNotes)
          .set({ aiStatus: 'UNAVAILABLE' })
          .where(eq(schema.visitNotes.appointmentId, appointmentId));
      });

      res.json({ success: true });
    } catch (e: any) {
      if (e.message.includes('FORBIDDEN')) return res.status(403).json({ error: e.message.replace('FORBIDDEN: ', '') });
      res.status(500).json({ error: e.message });
    }
  });

  // 5c. Get a single appointment
  app.get("/api/appointments/:id", authenticateToken, async (req, res) => {
    try {
      const appointmentId = parseInt(req.params.id);
      const user = (req as any).user;

      const [appointment] = await db.select().from(schema.appointments).where(eq(schema.appointments.id, appointmentId));
      
      if (!appointment) return res.status(404).json({ error: 'Appointment not found' });

      if (user.role === 'patient' && appointment.patientId !== user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      if (user.role === 'doctor') {
        const [doc] = await db.select().from(schema.doctorProfiles).where(eq(schema.doctorProfiles.userId, user.id));
        if (!doc || appointment.doctorId !== doc.id) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }
      
      const [symptomForm] = await db.select().from(schema.symptomForms).where(eq(schema.symptomForms.appointmentId, appointmentId));
      const [visitNote] = await db.select().from(schema.visitNotes).where(eq(schema.visitNotes.appointmentId, appointmentId));
      const medicationReminders = await db
        .select()
        .from(schema.medicationReminders)
        .where(eq(schema.medicationReminders.appointmentId, appointmentId));

      res.json({ ...appointment, symptomForm, visitNote, medicationReminders });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 6. Medication Reminders Endpoint
  app.get("/api/medications/reminders", authenticateToken, async (req, res) => {
    try {
      const user = (req as any).user;

      if (user.role === 'patient') {
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
            mr.created_at AS "createdAt",
            d.name AS "doctorName",
            dp.specialisation AS "specialisation"
          FROM medication_reminders mr
          JOIN appointments a ON mr.appointment_id = a.id
          JOIN doctor_profiles dp ON a.doctor_id = dp.id
          JOIN users d ON dp.user_id = d.id
          WHERE mr.patient_id = ${user.id}
          ORDER BY mr.created_at DESC
        `);
        return res.json(result.rows);
      } else if (user.role === 'doctor') {
        const [doc] = await db.select().from(schema.doctorProfiles).where(eq(schema.doctorProfiles.userId, user.id));
        if (!doc) return res.json([]);

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
            mr.created_at AS "createdAt",
            p.name AS "patientName"
          FROM medication_reminders mr
          JOIN appointments a ON mr.appointment_id = a.id
          JOIN users p ON mr.patient_id = p.id
          WHERE a.doctor_id = ${doc.id}
          ORDER BY mr.created_at DESC
        `);
        return res.json(result.rows);
      } else if (user.role === 'admin') {
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
            mr.created_at AS "createdAt",
            p.name AS "patientName",
            d.name AS "doctorName"
          FROM medication_reminders mr
          JOIN appointments a ON mr.appointment_id = a.id
          JOIN doctor_profiles dp ON a.doctor_id = dp.id
          JOIN users d ON dp.user_id = d.id
          JOIN users p ON mr.patient_id = p.id
          ORDER BY mr.created_at DESC
        `);
        return res.json(result.rows);
      }

      return res.status(403).json({ error: 'Access denied' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    // Start background notification cron jobs (5-min interval)
    startNotificationCronJobs();
  });
}

startServer().catch(console.error);
