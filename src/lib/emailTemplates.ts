function formatDateTime(date: Date | string): { dateStr: string; timeStr: string } {
  const d = new Date(date);
  if (isNaN(d.getTime())) return { dateStr: '—', timeStr: '—' };
  const dateStr = d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const timeStr = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return { dateStr, timeStr };
}

function baseHtml(title: string, bodyContent: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #F0F2F7; margin: 0; padding: 24px; color: #0F172A; }
    .container { max-width: 560px; margin: 0 auto; background: #FFFFFF; border-radius: 12px; border: 1px solid #E2E8F0; overflow: hidden; }
    .header { background: #1B2559; padding: 24px; text-align: left; }
    .logo { color: #FFFFFF; font-size: 20px; font-weight: 700; letter-spacing: -0.5px; }
    .badge { display: inline-block; background: #3B5BD5; color: #FFFFFF; font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 4px; margin-left: 8px; vertical-align: middle; }
    .content { padding: 28px 24px; }
    .card { background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin: 18px 0; }
    .card-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; border-bottom: 1px solid #EDF2F7; }
    .card-row:last-child { border-bottom: none; }
    .label { color: #64748B; font-weight: 500; }
    .val { color: #0F172A; font-weight: 600; text-align: right; }
    .footer { padding: 20px 24px; background: #F8FAFC; border-top: 1px solid #E2E8F0; font-size: 12px; color: #94A3B8; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <span class="logo">MediFlow</span>
      <span class="badge">Healthcare</span>
    </div>
    <div class="content">
      ${bodyContent}
    </div>
    <div class="footer">
      This is an automated notification from MediFlow Healthcare System.
    </div>
  </div>
</body>
</html>
  `.trim();
}

// ─── 1. BOOKING CONFIRMATION ──────────────────────────────────────────────────

export function patientBookingConfirmationTemplate({
  patientName,
  doctorName,
  specialisation,
  slotStart,
  rawSymptoms,
}: {
  patientName: string;
  doctorName: string;
  specialisation: string;
  slotStart: Date | string;
  rawSymptoms?: string;
}) {
  const { dateStr, timeStr } = formatDateTime(slotStart);
  const subject = `Appointment Confirmed: Dr. ${doctorName} on ${dateStr}`;
  const text = `
Hello ${patientName},

Your appointment with Dr. ${doctorName} (${specialisation}) has been confirmed.

Details:
- Date: ${dateStr}
- Time: ${timeStr}
- Status: Scheduled
- Recorded Symptoms: ${rawSymptoms || 'None provided'}

Thank you for choosing MediFlow.
  `.trim();

  const bodyHtml = `
    <h2 style="margin: 0 0 12px; font-size: 18px; color: #0F172A;">Appointment Confirmed</h2>
    <p style="margin: 0 0 16px; font-size: 14px; color: #475569;">Hello ${patientName}, your upcoming appointment has been scheduled successfully.</p>
    
    <div class="card">
      <div class="card-row"><span class="label">Doctor</span><span class="val">Dr. ${doctorName}</span></div>
      <div class="card-row"><span class="label">Specialisation</span><span class="val">${specialisation}</span></div>
      <div class="card-row"><span class="label">Date</span><span class="val">${dateStr}</span></div>
      <div class="card-row"><span class="label">Time</span><span class="val">${timeStr}</span></div>
      <div class="card-row"><span class="label">Status</span><span class="val" style="color: #2563EB;">Scheduled</span></div>
      ${rawSymptoms ? `<div class="card-row"><span class="label">Symptoms</span><span class="val" style="font-weight: 400; font-style: italic;">"${rawSymptoms}"</span></div>` : ''}
    </div>
    <p style="font-size: 13px; color: #64748B; margin-top: 16px;">Our AI clinical assistant has queued a pre-visit summary for Dr. ${doctorName} prior to your consultation.</p>
  `;

  return { subject, text, html: baseHtml(subject, bodyHtml) };
}

export function doctorBookingConfirmationTemplate({
  doctorName,
  patientName,
  slotStart,
  rawSymptoms,
}: {
  doctorName: string;
  patientName: string;
  slotStart: Date | string;
  rawSymptoms?: string;
}) {
  const { dateStr, timeStr } = formatDateTime(slotStart);
  const subject = `New Appointment: ${patientName} on ${dateStr} at ${timeStr}`;
  const text = `
Dr. ${doctorName},

A new appointment has been scheduled.

Patient: ${patientName}
Date: ${dateStr}
Time: ${timeStr}
Symptoms: ${rawSymptoms || 'None provided'}

Please review the patient summary in your MediFlow doctor dashboard.
  `.trim();

  const bodyHtml = `
    <h2 style="margin: 0 0 12px; font-size: 18px; color: #0F172A;">New Appointment Scheduled</h2>
    <p style="margin: 0 0 16px; font-size: 14px; color: #475569;">Dr. ${doctorName}, a patient has booked a consultation with you.</p>
    
    <div class="card">
      <div class="card-row"><span class="label">Patient</span><span class="val">${patientName}</span></div>
      <div class="card-row"><span class="label">Date</span><span class="val">${dateStr}</span></div>
      <div class="card-row"><span class="label">Time</span><span class="val">${timeStr}</span></div>
      <div class="card-row"><span class="label">Status</span><span class="val" style="color: #2563EB;">Scheduled</span></div>
      ${rawSymptoms ? `<div class="card-row"><span class="label">Symptoms</span><span class="val" style="font-weight: 400; font-style: italic;">"${rawSymptoms}"</span></div>` : ''}
    </div>
    <p style="font-size: 13px; color: #64748B;">You can review the pre-visit AI summary directly in your clinician workspace.</p>
  `;

  return { subject, text, html: baseHtml(subject, bodyHtml) };
}

// ─── 2. CANCELLATION ──────────────────────────────────────────────────────────

export function patientCancellationTemplate({
  patientName,
  doctorName,
  slotStart,
}: {
  patientName: string;
  doctorName: string;
  slotStart: Date | string;
}) {
  const { dateStr, timeStr } = formatDateTime(slotStart);
  const subject = `Appointment Cancelled: Dr. ${doctorName} on ${dateStr}`;
  const text = `
Hello ${patientName},

Your appointment with Dr. ${doctorName} on ${dateStr} at ${timeStr} has been cancelled.

If you wish to reschedule or book a new time, please visit the MediFlow patient portal.
  `.trim();

  const bodyHtml = `
    <h2 style="margin: 0 0 12px; font-size: 18px; color: #DC2626;">Appointment Cancelled</h2>
    <p style="margin: 0 0 16px; font-size: 14px; color: #475569;">Hello ${patientName}, your appointment has been cancelled.</p>
    
    <div class="card">
      <div class="card-row"><span class="label">Doctor</span><span class="val">Dr. ${doctorName}</span></div>
      <div class="card-row"><span class="label">Date & Time</span><span class="val">${dateStr} at ${timeStr}</span></div>
      <div class="card-row"><span class="label">Status</span><span class="val" style="color: #DC2626;">Cancelled</span></div>
    </div>
    <p style="font-size: 13px; color: #64748B;">If you need further medical consultation, please book an alternative slot via your dashboard.</p>
  `;

  return { subject, text, html: baseHtml(subject, bodyHtml) };
}

export function doctorCancellationTemplate({
  doctorName,
  patientName,
  slotStart,
}: {
  doctorName: string;
  patientName: string;
  slotStart: Date | string;
}) {
  const { dateStr, timeStr } = formatDateTime(slotStart);
  const subject = `Appointment Cancelled: ${patientName} on ${dateStr}`;
  const text = `
Dr. ${doctorName},

The appointment with ${patientName} scheduled for ${dateStr} at ${timeStr} has been cancelled.

The slot has been made available for booking.
  `.trim();

  const bodyHtml = `
    <h2 style="margin: 0 0 12px; font-size: 18px; color: #DC2626;">Appointment Cancelled</h2>
    <p style="margin: 0 0 16px; font-size: 14px; color: #475569;">Dr. ${doctorName}, the following appointment has been cancelled.</p>
    
    <div class="card">
      <div class="card-row"><span class="label">Patient</span><span class="val">${patientName}</span></div>
      <div class="card-row"><span class="label">Date & Time</span><span class="val">${dateStr} at ${timeStr}</span></div>
      <div class="card-row"><span class="label">Status</span><span class="val" style="color: #DC2626;">Cancelled</span></div>
    </div>
    <p style="font-size: 13px; color: #64748B;">Your schedule has been updated automatically.</p>
  `;

  return { subject, text, html: baseHtml(subject, bodyHtml) };
}

// ─── 3. RESCHEDULE ────────────────────────────────────────────────────────────

export function patientRescheduleTemplate({
  patientName,
  doctorName,
  oldSlotStart,
  newSlotStart,
}: {
  patientName: string;
  doctorName: string;
  oldSlotStart: Date | string;
  newSlotStart: Date | string;
}) {
  const oldDt = formatDateTime(oldSlotStart);
  const newDt = formatDateTime(newSlotStart);
  const subject = `Appointment Rescheduled: Dr. ${doctorName} on ${newDt.dateStr}`;
  const text = `
Hello ${patientName},

Your appointment with Dr. ${doctorName} has been rescheduled.

Previous Time: ${oldDt.dateStr} at ${oldDt.timeStr}
New Time: ${newDt.dateStr} at ${newDt.timeStr}
Status: Scheduled

Thank you for choosing MediFlow.
  `.trim();

  const bodyHtml = `
    <h2 style="margin: 0 0 12px; font-size: 18px; color: #0F172A;">Appointment Rescheduled</h2>
    <p style="margin: 0 0 16px; font-size: 14px; color: #475569;">Hello ${patientName}, your appointment details have been updated.</p>
    
    <div class="card">
      <div class="card-row"><span class="label">Doctor</span><span class="val">Dr. ${doctorName}</span></div>
      <div class="card-row"><span class="label">Previous Date/Time</span><span class="val" style="color: #64748B; text-decoration: line-through;">${oldDt.dateStr} at ${oldDt.timeStr}</span></div>
      <div class="card-row"><span class="label">New Date/Time</span><span class="val" style="color: #2563EB;">${newDt.dateStr} at ${newDt.timeStr}</span></div>
      <div class="card-row"><span class="label">Status</span><span class="val" style="color: #2563EB;">Scheduled</span></div>
    </div>
  `;

  return { subject, text, html: baseHtml(subject, bodyHtml) };
}

export function doctorRescheduleTemplate({
  doctorName,
  patientName,
  oldSlotStart,
  newSlotStart,
}: {
  doctorName: string;
  patientName: string;
  oldSlotStart: Date | string;
  newSlotStart: Date | string;
}) {
  const oldDt = formatDateTime(oldSlotStart);
  const newDt = formatDateTime(newSlotStart);
  const subject = `Appointment Rescheduled: ${patientName} on ${newDt.dateStr}`;
  const text = `
Dr. ${doctorName},

An appointment with ${patientName} has been rescheduled.

Previous Time: ${oldDt.dateStr} at ${oldDt.timeStr}
New Time: ${newDt.dateStr} at ${newDt.timeStr}
Status: Scheduled
  `.trim();

  const bodyHtml = `
    <h2 style="margin: 0 0 12px; font-size: 18px; color: #0F172A;">Appointment Rescheduled</h2>
    <p style="margin: 0 0 16px; font-size: 14px; color: #475569;">Dr. ${doctorName}, the following appointment has been moved to a new slot.</p>
    
    <div class="card">
      <div class="card-row"><span class="label">Patient</span><span class="val">${patientName}</span></div>
      <div class="card-row"><span class="label">Previous Date/Time</span><span class="val" style="color: #64748B; text-decoration: line-through;">${oldDt.dateStr} at ${oldDt.timeStr}</span></div>
      <div class="card-row"><span class="label">New Date/Time</span><span class="val" style="color: #2563EB;">${newDt.dateStr} at ${newDt.timeStr}</span></div>
      <div class="card-row"><span class="label">Status</span><span class="val" style="color: #2563EB;">Scheduled</span></div>
    </div>
  `;

  return { subject, text, html: baseHtml(subject, bodyHtml) };
}

// ─── 4. DOCTOR LEAVE CONFLICT ─────────────────────────────────────────────────

export function patientLeaveConflictTemplate({
  patientName,
  doctorName,
  slotStart,
  reason,
}: {
  patientName: string;
  doctorName: string;
  slotStart: Date | string;
  reason?: string;
}) {
  const { dateStr, timeStr } = formatDateTime(slotStart);
  const subject = `Urgent: Doctor Unavailable for Appointment on ${dateStr}`;
  const text = `
Hello ${patientName},

We regret to inform you that Dr. ${doctorName} is unavailable on ${dateStr}${reason ? ` (${reason})` : ''}.

Your scheduled appointment on ${dateStr} at ${timeStr} has been cancelled due to physician leave.

Please log in to your MediFlow dashboard to book an alternative appointment at your earliest convenience.

We sincerely apologize for the inconvenience.
  `.trim();

  const bodyHtml = `
    <h2 style="margin: 0 0 12px; font-size: 18px; color: #D97706;">Physician Leave Notice</h2>
    <p style="margin: 0 0 16px; font-size: 14px; color: #475569;">Hello ${patientName}, we regret to inform you that Dr. ${doctorName} will be on leave on your scheduled consultation date.</p>
    
    <div class="card" style="border-left: 4px solid #D97706;">
      <div class="card-row"><span class="label">Doctor</span><span class="val">Dr. ${doctorName}</span></div>
      <div class="card-row"><span class="label">Scheduled Time</span><span class="val">${dateStr} at ${timeStr}</span></div>
      ${reason ? `<div class="card-row"><span class="label">Reason</span><span class="val">${reason}</span></div>` : ''}
      <div class="card-row"><span class="label">Status</span><span class="val" style="color: #D97706;">Cancelled due to Leave</span></div>
    </div>
    
    <p style="font-size: 13px; color: #475569; line-height: 1.5;">Please visit your MediFlow patient portal to select a new available time or book with another specialist.</p>
  `;

  return { subject, text, html: baseHtml(subject, bodyHtml) };
}

// ─── 5. 24-HOUR APPOINTMENT REMINDER ───────────────────────────────────────────

export function patientReminderTemplate({
  patientName,
  doctorName,
  specialisation,
  slotStart,
}: {
  patientName: string;
  doctorName: string;
  specialisation: string;
  slotStart: Date | string;
}) {
  const { dateStr, timeStr } = formatDateTime(slotStart);
  const subject = `Reminder: Upcoming Appointment Tomorrow with Dr. ${doctorName}`;
  const text = `
Hello ${patientName},

This is a reminder for your appointment tomorrow with Dr. ${doctorName} (${specialisation}).

Time: ${dateStr} at ${timeStr}

Please ensure you are ready on time.
  `.trim();

  const bodyHtml = `
    <h2 style="margin: 0 0 12px; font-size: 18px; color: #0F172A;">Appointment Reminder</h2>
    <p style="margin: 0 0 16px; font-size: 14px; color: #475569;">Hello ${patientName}, this is a reminder for your consultation scheduled for tomorrow.</p>
    
    <div class="card">
      <div class="card-row"><span class="label">Doctor</span><span class="val">Dr. ${doctorName}</span></div>
      <div class="card-row"><span class="label">Specialisation</span><span class="val">${specialisation}</span></div>
      <div class="card-row"><span class="label">Date & Time</span><span class="val" style="color: #2563EB;">${dateStr} at ${timeStr}</span></div>
      <div class="card-row"><span class="label">Status</span><span class="val">Confirmed</span></div>
    </div>
    <p style="font-size: 13px; color: #64748B;">If you need to make changes, please manage your booking via your patient dashboard.</p>
  `;

  return { subject, text, html: baseHtml(subject, bodyHtml) };
}

export function doctorReminderTemplate({
  doctorName,
  patientName,
  slotStart,
}: {
  doctorName: string;
  patientName: string;
  slotStart: Date | string;
}) {
  const { dateStr, timeStr } = formatDateTime(slotStart);
  const subject = `Reminder: Tomorrow's Appointment with ${patientName}`;
  const text = `
Dr. ${doctorName},

This is a reminder for your scheduled consultation tomorrow with ${patientName}.

Time: ${dateStr} at ${timeStr}
  `.trim();

  const bodyHtml = `
    <h2 style="margin: 0 0 12px; font-size: 18px; color: #0F172A;">Appointment Reminder</h2>
    <p style="margin: 0 0 16px; font-size: 14px; color: #475569;">Dr. ${doctorName}, you have an upcoming consultation scheduled for tomorrow.</p>
    
    <div class="card">
      <div class="card-row"><span class="label">Patient</span><span class="val">${patientName}</span></div>
      <div class="card-row"><span class="label">Date & Time</span><span class="val" style="color: #2563EB;">${dateStr} at ${timeStr}</span></div>
      <div class="card-row"><span class="label">Status</span><span class="val">Confirmed</span></div>
    </div>
  `;

  return { subject, text, html: baseHtml(subject, bodyHtml) };
}

// ─── 6. MEDICATION REMINDER ───────────────────────────────────────────────────

export function patientMedicationReminderTemplate({
  patientName,
  medicationName,
  dosage,
  instructions,
  frequency,
  scheduledTime,
  startDate,
  endDate,
}: {
  patientName: string;
  medicationName: string;
  dosage?: string;
  instructions?: string;
  frequency: string;
  scheduledTime: string;
  startDate?: Date | string;
  endDate?: Date | string;
}) {
  const subject = `MediFlow Medication Reminder: ${medicationName}`;
  const startFmt = startDate ? formatDateTime(startDate).dateStr : undefined;
  const endFmt = endDate ? formatDateTime(endDate).dateStr : undefined;
  const durationStr = startFmt && endFmt ? `${startFmt} – ${endFmt}` : undefined;

  const text = `
Hello ${patientName},

This is your scheduled medication reminder from MediFlow.

Medication: ${medicationName}
${dosage ? `Dosage: ${dosage}\n` : ''}Frequency: ${frequency}
Scheduled Time: ${scheduledTime}
${instructions ? `Doctor's Instructions: ${instructions}\n` : ''}${durationStr ? `Prescribed Course: ${durationStr}\n` : ''}
Important Notice:
This is an automated reminder based strictly on your doctor's prescription. Please follow the instructions provided by your physician. Do not alter your dosage or treatment without consulting your doctor.
  `.trim();

  const bodyHtml = `
    <h2 style="margin: 0 0 12px; font-size: 18px; color: #0F172A;">Medication Reminder</h2>
    <p style="margin: 0 0 16px; font-size: 14px; color: #475569;">Hello ${patientName}, it is time to take your prescribed medication.</p>
    
    <div class="card" style="border-left: 4px solid #3B5BD5;">
      <div class="card-row"><span class="label">Medication</span><span class="val" style="color: #1E40AF; font-size: 15px;">${medicationName}</span></div>
      ${dosage ? `<div class="card-row"><span class="label">Dosage</span><span class="val">${dosage}</span></div>` : ''}
      <div class="card-row"><span class="label">Frequency</span><span class="val">${frequency}</span></div>
      <div class="card-row"><span class="label">Reminder Time</span><span class="val" style="color: #2563EB;">${scheduledTime}</span></div>
      ${instructions ? `<div class="card-row"><span class="label">Instructions</span><span class="val" style="font-weight: 500; font-style: italic;">"${instructions}"</span></div>` : ''}
      ${durationStr ? `<div class="card-row"><span class="label">Course Duration</span><span class="val">${durationStr}</span></div>` : ''}
      <div class="card-row"><span class="label">Status</span><span class="val" style="color: #16A34A;">Active Course</span></div>
    </div>

    <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px; padding: 12px; margin-top: 16px;">
      <p style="font-size: 12px; color: #64748B; margin: 0; line-height: 1.4;">
        <strong>Clinical Disclaimer:</strong> This automated reminder is generated from your physician's clinical prescription records. Never modify, skip, or exceed your dosage without consulting your healthcare provider.
      </p>
    </div>
  `;

  return { subject, text, html: baseHtml(subject, bodyHtml) };
}

