import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { AppShell } from '../components/AppShell.js';
import { MiniCalendar } from '../components/ui/MiniCalendar.js';
import { StatusBadge } from '../components/ui/StatusBadge.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import {
  CalendarDays,
  Clock,
  Brain,
  CheckCircle2,
  XCircle,
  FileText,
  Clipboard,
  ChevronRight,
  X,
  Sparkles,
  AlertTriangle,
  Calendar,
  User,
  Pill,
} from 'lucide-react';

// ─── CRITICAL: Safe date helpers ──────────────────────────────────────────────
// The list endpoint (raw SQL) returns slot_start as "2026-08-25 10:00:00"
// (space-separated, no T, no Z). new Date() treats that as *local* time in
// Chrome and produces Invalid Date in Safari. We normalise by replacing the
// space with T and appending Z so the string is always UTC ISO 8601.
// The detail endpoint (Drizzle ORM) may return camelCase slotStart.
// Both are handled via getSlotStart() + normaliseDate().
function getSlotStart(apt: any): string | undefined {
  return apt?.slot_start ?? apt?.slotStart;
}

/** Convert any date value from the API into a reliable Date object (UTC). */
function normaliseDate(v: any): Date | null {
  if (!v) return null;
  // If it's already a Date object, return as-is
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  let s = String(v).trim();
  // Postgres returns "2026-08-25 10:00:00" or "2026-08-25 10:00:00.000"
  // Convert to ISO 8601 UTC: "2026-08-25T10:00:00Z"
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) {
    s = s.replace(' ', 'T').replace(/(\.\d+)?$/, '') + 'Z';
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate(v: any): string {
  const d = normaliseDate(v);
  return d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

function fmtTime(v: any): string {
  const d = normaliseDate(v);
  return d ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '—';
}

/** Format a date-only field like startDate / endDate (e.g. "2026-08-25"). */
function fmtDateOnly(v: any): string {
  if (!v) return '—';
  // Date-only strings should not be treated as UTC midnight (would shift on local TZ);
  // interpret them as local calendar dates instead.
  const s = String(v).trim().substring(0, 10); // "YYYY-MM-DD"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return fmtDate(v);
  const [year, month, day] = s.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function getGreeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

// ─── Shared input styles ───────────────────────────────────────────────────────
const inputCls =
  'w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-700 bg-slate-50 focus:outline-none focus:border-blue-400 focus:bg-white transition-all placeholder:text-slate-400 resize-none';
const labelCls = 'block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5';

// ─── Booking Modal ─────────────────────────────────────────────────────────────
function BookingModal({
  symptoms, setSymptoms, onConfirm, onCancel,
}: {
  symptoms: string;
  setSymptoms: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-800">Describe Your Symptoms</h2>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-lg p-3">
            <Sparkles className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
            <p className="text-xs text-blue-700 leading-relaxed">
              An AI pre-visit summary will be generated for your doctor based on your description.
            </p>
          </div>
          <div>
            <label htmlFor="symptoms-input" className={labelCls}>Symptoms</label>
            <textarea
              id="symptoms-input"
              value={symptoms}
              onChange={e => setSymptoms(e.target.value)}
              placeholder="E.g. I have had a cough and sore throat for 3 days with mild fever…"
              rows={4}
              className={inputCls}
            />
          </div>
          <div className="flex gap-3 justify-end pt-1">
            <button
              id="cancel-booking-btn"
              onClick={onCancel}
              className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
            >
              Cancel
            </button>
            <button
              id="confirm-booking-btn"
              onClick={onConfirm}
              className="px-4 py-2 text-sm font-semibold text-white rounded-lg bg-blue-700 hover:bg-blue-800 transition-colors"
            >
              Confirm Booking
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Appointment Detail Modal ──────────────────────────────────────────────────
function AppointmentModal({
  apt, userRole, consultationForm, setConsultationForm, onComplete, onClose,
}: {
  apt: any;
  userRole: string;
  consultationForm: { clinicalNotes: string; prescriptionRaw: string; followUpInstructions: string };
  setConsultationForm: (f: any) => void;
  onComplete: () => void;
  onClose: () => void;
}) {
  const slotVal = getSlotStart(apt);
  const aiStatus = apt.symptomForm?.aiStatus;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white w-full max-w-2xl rounded-xl border border-slate-200 shadow-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Appointment Details</h2>
            <p className="text-xs text-slate-400 mt-0.5">{fmtDate(slotVal)} · {fmtTime(slotVal)}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors ml-4">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-4">

          {/* ── DOCTOR VIEW ── */}
          {userRole === 'doctor' && (
            <>
              {/* Patient info + symptoms */}
              <div>
                <div className={labelCls}>Patient</div>
                <div className="flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-lg p-3">
                  <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-600 shrink-0">
                    {apt.patient_name?.charAt(0) ?? '?'}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-800">{apt.patient_name ?? 'Unknown'}</div>
                    {apt.symptomForm?.rawSymptoms && (
                      <div className="text-xs text-slate-500 mt-0.5 italic">
                        "{apt.symptomForm.rawSymptoms}"
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* AI pre-visit summary */}
              {aiStatus === 'COMPLETED' ? (
                <div className="border border-blue-100 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-blue-50 border-b border-blue-100">
                    <div className="flex items-center gap-2">
                      <Brain className="w-3.5 h-3.5 text-blue-600" />
                      <span className="text-[10px] font-bold text-blue-800 uppercase tracking-wider">AI Pre-Visit Summary</span>
                    </div>
                    {apt.symptomForm?.urgency && <StatusBadge status={apt.symptomForm.urgency} type="urgency" />}
                  </div>
                  <div className="p-4 space-y-3">
                    {apt.symptomForm?.chiefComplaint && (
                      <p className="text-sm font-semibold text-slate-800">{apt.symptomForm.chiefComplaint}</p>
                    )}
                    {apt.symptomForm?.suggestedQuestions && (() => {
                      try {
                        const qs = JSON.parse(apt.symptomForm.suggestedQuestions);
                        return (
                          <div className="bg-slate-50 border border-slate-100 rounded-lg p-3">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Suggested questions</p>
                            <ol className="space-y-1.5">
                              {qs.map((q: string, i: number) => (
                                <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                                  <span className="w-4 h-4 bg-blue-100 text-blue-700 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5 leading-none">{i + 1}</span>
                                  {q}
                                </li>
                              ))}
                            </ol>
                          </div>
                        );
                      } catch { return null; }
                    })()}
                    <p className="text-[10px] text-slate-400 italic">AI-generated for clinician review. Not a diagnosis.</p>
                  </div>
                </div>
              ) : aiStatus === 'UNAVAILABLE' ? (
                <div className="flex items-center gap-2 bg-rose-50 border border-rose-100 rounded-lg p-3 text-sm text-rose-600">
                  <XCircle className="w-4 h-4 shrink-0" /> AI summary unavailable for this appointment.
                </div>
              ) : (
                <div className="flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-lg p-3 text-sm text-amber-600">
                  <div className="w-4 h-4 border-2 border-amber-300 border-t-amber-600 rounded-full animate-spin shrink-0" />
                  Generating AI summary…
                </div>
              )}

              {/* Consultation form or completed notice */}
              {apt.status === 'scheduled' ? (
                <div className="border border-slate-200 rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Clipboard className="w-4 h-4 text-slate-400" />
                    <span className="text-sm font-semibold text-slate-700">Consultation Notes</span>
                  </div>
                  <div>
                    <label htmlFor="clinical-notes" className={labelCls}>Clinical Notes *</label>
                    <textarea
                      id="clinical-notes"
                      rows={3}
                      placeholder="Record your clinical observations…"
                      value={consultationForm.clinicalNotes}
                      onChange={e => setConsultationForm({ ...consultationForm, clinicalNotes: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label htmlFor="prescription" className={labelCls}>Prescription</label>
                    <textarea
                      id="prescription"
                      rows={2}
                      placeholder="Medications, dosage, frequency…"
                      value={consultationForm.prescriptionRaw}
                      onChange={e => setConsultationForm({ ...consultationForm, prescriptionRaw: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label htmlFor="followup-instructions" className={labelCls}>Follow-up Instructions</label>
                    <textarea
                      id="followup-instructions"
                      rows={2}
                      placeholder="Rest, diet, next visit…"
                      value={consultationForm.followUpInstructions}
                      onChange={e => setConsultationForm({ ...consultationForm, followUpInstructions: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                  <button
                    id="complete-consultation-btn"
                    onClick={onComplete}
                    className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-white rounded-lg bg-emerald-600 hover:bg-emerald-700 transition-colors"
                  >
                    <CheckCircle2 className="w-4 h-4" /> Complete Consultation
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-lg p-3 text-sm text-emerald-700 font-semibold">
                    <CheckCircle2 className="w-4 h-4" /> Consultation completed.
                  </div>
                  {apt.medicationReminders && apt.medicationReminders.length > 0 && (
                    <div className="bg-blue-50/50 border border-blue-100 rounded-lg p-3.5 space-y-2">
                      <div className="flex items-center gap-2">
                        <Pill className="w-3.5 h-3.5 text-blue-600" />
                        <span className="text-xs font-bold text-blue-800 uppercase tracking-wider">Scheduled Medication Reminders ({apt.medicationReminders.length})</span>
                      </div>
                      <div className="space-y-1.5">
                        {apt.medicationReminders.map((mr: any) => {
                          let dispName = mr.medicationName || '';
                          if (mr.dosage) {
                            const esc = mr.dosage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                            dispName = dispName.replace(new RegExp(`\\s*${esc}\\s*$`, 'i'), '').trim() || mr.medicationName;
                          }
                          return (
                            <div key={mr.id} className="text-xs text-slate-700 flex items-center justify-between bg-white px-3 py-2 rounded border border-blue-100">
                              <div className="flex flex-wrap items-center gap-x-1 min-w-0">
                                <span className="font-semibold text-slate-800">{dispName}</span>
                                {mr.dosage && <><span className="text-slate-300">·</span><span className="text-slate-600">{mr.dosage}</span></>}
                                <span className="text-slate-300">·</span>
                                <span className="text-blue-700 font-medium">{mr.frequency}</span>
                                {mr.instructions && <span className="text-slate-500 italic truncate"> – {mr.instructions}</span>}
                              </div>
                              <span className="text-[10px] font-semibold text-emerald-600 uppercase bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 shrink-0 ml-2">{mr.status}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* ── PATIENT VIEW ── */}
          {userRole === 'patient' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className={labelCls}>Doctor</div>
                  <div className="bg-slate-50 border border-slate-100 rounded-lg p-3">
                    <div className="text-sm font-semibold text-slate-800">{apt.doctor_name ?? '—'}</div>
                    <div className="text-xs text-slate-400">{apt.specialisation ?? ''}</div>
                  </div>
                </div>
                <div>
                  <div className={labelCls}>Status</div>
                  <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 flex items-center">
                    <StatusBadge status={apt.status} />
                  </div>
                </div>
              </div>

              {apt.symptomForm?.rawSymptoms && (
                <div>
                  <div className={labelCls}>Your Symptoms</div>
                  <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 text-sm text-slate-600 italic leading-relaxed">
                    "{apt.symptomForm.rawSymptoms}"
                  </div>
                </div>
              )}

              {apt.status === 'completed' && (
                <div className="space-y-3">
                  <div>
                    <div className={labelCls}>Post-Visit Summary</div>
                    {apt.visitNote?.aiStatus === 'COMPLETED' && apt.visitNote?.patientSummary ? (
                      <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <FileText className="w-4 h-4 text-emerald-600" />
                          <span className="text-xs font-semibold text-emerald-700">Your Care Summary</span>
                        </div>
                        <div
                          className="text-sm text-slate-700 leading-relaxed whitespace-pre-line"
                          dangerouslySetInnerHTML={{ __html: apt.visitNote.patientSummary }}
                        />
                      </div>
                    ) : apt.visitNote?.aiStatus === 'UNAVAILABLE' ? (
                      <div className="flex items-center gap-2 bg-rose-50 border border-rose-100 rounded-lg p-3 text-sm text-rose-600">
                        <XCircle className="w-4 h-4 shrink-0" /> Summary unavailable. Please contact your doctor.
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-lg p-3 text-sm text-amber-600">
                        <div className="w-4 h-4 border-2 border-amber-300 border-t-amber-600 rounded-full animate-spin shrink-0" />
                        Generating your summary…
                      </div>
                    )}
                  </div>

                  {apt.medicationReminders && apt.medicationReminders.length > 0 && (
                    <div className="bg-blue-50/60 border border-blue-100 rounded-lg p-3.5 space-y-2">
                      <div className="flex items-center gap-2">
                        <Pill className="w-3.5 h-3.5 text-blue-600" />
                        <span className="text-xs font-bold text-blue-800 uppercase tracking-wider">Your Medication Reminders</span>
                      </div>
                      <div className="space-y-2">
                        {apt.medicationReminders.map((mr: any) => {
                          let dispName = mr.medicationName || '';
                          if (mr.dosage) {
                            const esc = mr.dosage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                            dispName = dispName.replace(new RegExp(`\\s*${esc}\\s*$`, 'i'), '').trim() || mr.medicationName;
                          }
                          return (
                            <div key={mr.id} className="bg-white p-3 rounded-lg border border-blue-100 flex items-start justify-between">
                              <div className="space-y-0.5">
                                <div className="text-sm font-semibold text-slate-800">{dispName}</div>
                                <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-1">
                                  {mr.dosage && <span className="font-medium text-slate-700">{mr.dosage}</span>}
                                  {mr.dosage && <span className="text-slate-300">·</span>}
                                  <span className="font-semibold text-blue-700">{mr.frequency}</span>
                                </div>
                                {mr.instructions && <div className="text-xs text-slate-500 italic">{mr.instructions}</div>}
                              </div>
                              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 uppercase shrink-0 ml-2">{mr.status}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {apt.status === 'scheduled' && (
                <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-lg p-3 text-blue-700 text-sm">
                  <CalendarDays className="w-4 h-4 shrink-0" />
                  Your appointment is upcoming. The doctor will see you soon.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Appointment List Row ──────────────────────────────────────────────────────
function ApptRow({ apt, onClick, role }: { key?: React.Key; apt: any; onClick: () => void; role: string }) {
  const slotVal = getSlotStart(apt);
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 bg-white border border-slate-100 rounded-lg px-4 py-3 hover:border-blue-200 hover:shadow-sm transition-all text-left group"
    >
      {/* Time block */}
      <div className="shrink-0 text-center w-[58px]">
        <div className="text-[13px] font-bold text-slate-800 leading-tight">{fmtTime(slotVal)}</div>
        <div className="text-[10px] text-slate-400 leading-tight mt-0.5">{fmtDate(slotVal)}</div>
      </div>

      {/* Separator */}
      <div className="w-px h-8 bg-slate-100 shrink-0" />

      {/* Name + secondary info */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-800 truncate leading-tight">
          {role === 'doctor' ? (apt.patient_name ?? '—') : (apt.doctor_name ?? '—')}
        </div>
        <div className="text-xs text-slate-400 truncate mt-0.5 leading-tight">
          {role === 'patient' && (apt.specialisation || '')}
          {role === 'doctor' && apt.symptomForm?.rawSymptoms
            ? <span className="italic">"{apt.symptomForm.rawSymptoms.slice(0, 70)}{apt.symptomForm.rawSymptoms.length > 70 ? '…' : ''}"</span>
            : role === 'doctor' ? 'No symptoms recorded' : null}
        </div>
      </div>

      {/* AI badge (doctor view only) */}
      {role === 'doctor' && apt.symptomForm?.aiStatus === 'COMPLETED' && (
        <div className="shrink-0 flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-50 border border-blue-100 text-blue-600 leading-none">
          <Brain className="w-3 h-3" /> AI
        </div>
      )}

      {/* Status badge */}
      <StatusBadge status={apt.status} />

      {/* Arrow */}
      <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-400 shrink-0 transition-colors" />
    </button>
  );
}

// ─── Doctor Row (patient booking) ─────────────────────────────────────────────
function DoctorRow({
  doc, availability, onBook,
}: {
  key?: React.Key;
  doc: any;
  availability: { slots: string[]; onLeave: boolean; loading: boolean; error: string | null } | undefined;
  onBook: (doctorId: number, slotStart: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const MAX_VISIBLE = 6;
  const slots = availability?.slots ?? [];
  const visible = showAll ? slots : slots.slice(0, MAX_VISIBLE);

  return (
    <div className="bg-white border border-slate-100 rounded-lg p-4">
      <div className="flex items-start gap-3 mb-3">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold text-white shrink-0"
          style={{ background: '#3B5BD5' }}
        >
          {doc.name.charAt(0)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-800">{doc.name}</div>
          <div className="text-xs text-slate-500">{doc.profile.specialisation}</div>
          <div className="flex items-center gap-1 text-[11px] text-slate-400 mt-0.5">
            <Clock className="w-3 h-3 shrink-0" />
            {doc.profile.workingHoursStart}–{doc.profile.workingHoursEnd}
            <span className="mx-1">·</span>
            {doc.profile.slotDurationMinutes} min slots
          </div>
        </div>
      </div>

      {availability?.loading ? (
        <div className="flex items-center gap-1.5 text-xs text-slate-400 py-0.5">
          <div className="w-3.5 h-3.5 border-2 border-slate-200 border-t-blue-400 rounded-full animate-spin" />
          Loading availability…
        </div>
      ) : availability?.error ? (
        <p className="text-xs text-rose-500">{availability.error}</p>
      ) : availability?.onLeave ? (
        <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> On leave on this date.
        </div>
      ) : slots.length > 0 ? (
        <div>
          <div className="flex flex-wrap gap-1.5">
            {visible.map(slot => {
              const t = new Date(slot);
              const label = isNaN(t.getTime()) ? slot : t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
              return (
                <button
                  key={slot}
                  onClick={() => onBook(doc.profile.id, slot)}
                  className="px-2.5 py-1 text-xs font-semibold rounded-md border border-blue-200 text-blue-700 bg-white hover:bg-blue-700 hover:text-white hover:border-blue-700 transition-all"
                >
                  {label}
                </button>
              );
            })}
          </div>
          {slots.length > MAX_VISIBLE && (
            <button
              onClick={() => setShowAll(s => !s)}
              className="mt-2 text-[11px] text-slate-400 hover:text-slate-600 transition-colors"
            >
              {showAll ? 'Show fewer slots' : `+${slots.length - MAX_VISIBLE} more slots`}
            </button>
          )}
        </div>
      ) : (
        <p className="text-xs text-slate-400 italic">No available slots for this date.</p>
      )}
    </div>
  );
}

// ─── Patient Right Panel ───────────────────────────────────────────────────────
function PatientRightPanel({
  selectedDate,
  onDateChange,
  appointments,
  calendarConnected,
  loadingCalendar,
  onConnectCalendar,
  onDisconnectCalendar,
}: {
  selectedDate: string;
  onDateChange: (d: string) => void;
  appointments: any[];
  calendarConnected: boolean;
  loadingCalendar: boolean;
  onConnectCalendar: () => void;
  onDisconnectCalendar: () => void;
}) {
  const today = new Date().toISOString().split('T')[0];
  const next = appointments
    .filter(a => a.status === 'scheduled')
    .sort((a, b) => new Date(getSlotStart(a) ?? 0).getTime() - new Date(getSlotStart(b) ?? 0).getTime())[0];

  return (
    <>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-3">Select Date</p>
        <MiniCalendar value={selectedDate} onChange={onDateChange} minDate={today} />
      </div>

      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Google Calendar</p>
        <div className="bg-slate-50 border border-slate-100 rounded-lg p-3">
          {calendarConnected ? (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                Google Calendar Connected
              </div>
              <button
                onClick={onDisconnectCalendar}
                className="w-full text-center py-1 px-2 text-[11px] font-semibold text-slate-500 hover:text-rose-600 bg-white hover:bg-rose-50 border border-slate-200 hover:border-rose-100 rounded transition-colors"
              >
                Disconnect Google Calendar
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">Sync appointments directly with your personal calendar.</p>
              <button
                onClick={onConnectCalendar}
                disabled={loadingCalendar}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors disabled:opacity-50"
              >
                <Calendar className="w-3.5 h-3.5" />
                Connect Google Calendar
              </button>
            </div>
          )}
        </div>
      </div>

      {next && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Next Appointment</p>
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 space-y-1.5">
            <div className="text-sm font-semibold text-slate-800">{next.doctor_name ?? '—'}</div>
            <div className="text-xs text-slate-500">{next.specialisation ?? ''}</div>
            <div className="flex items-center gap-1.5 text-xs text-slate-600 mt-1">
              <Calendar className="w-3.5 h-3.5 text-blue-500 shrink-0" />
              {fmtDate(getSlotStart(next))}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-600">
              <Clock className="w-3.5 h-3.5 text-blue-500 shrink-0" />
              {fmtTime(getSlotStart(next))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Doctor Right Panel ────────────────────────────────────────────────────────
function DoctorRightPanel({
  user,
  appointments,
  calendarConnected,
  loadingCalendar,
  onConnectCalendar,
  onDisconnectCalendar,
}: {
  user: any;
  appointments: any[];
  calendarConnected: boolean;
  loadingCalendar: boolean;
  onConnectCalendar: () => void;
  onDisconnectCalendar: () => void;
}) {
  const scheduled = appointments.filter(a => a.status === 'scheduled').length;
  const completed = appointments.filter(a => a.status === 'completed').length;

  return (
    <>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-3">Clinician</p>
        <div className="flex items-center gap-2.5">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold text-white shrink-0"
            style={{ background: '#1B2559' }}
          >
            {user?.name?.charAt(0) ?? 'D'}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-800 truncate">{user?.name}</div>
            <div className="text-xs text-slate-400 truncate">{user?.email}</div>
          </div>
        </div>
      </div>

      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Google Calendar</p>
        <div className="bg-slate-50 border border-slate-100 rounded-lg p-3">
          {calendarConnected ? (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                Google Calendar Connected
              </div>
              <button
                onClick={onDisconnectCalendar}
                className="w-full text-center py-1 px-2 text-[11px] font-semibold text-slate-500 hover:text-rose-600 bg-white hover:bg-rose-50 border border-slate-200 hover:border-rose-100 rounded transition-colors"
              >
                Disconnect Google Calendar
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">Sync patient consultations to your Google schedule.</p>
              <button
                onClick={onConnectCalendar}
                disabled={loadingCalendar}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors disabled:opacity-50"
              >
                <Calendar className="w-3.5 h-3.5" />
                Connect Google Calendar
              </button>
            </div>
          )}
        </div>
      </div>

      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Appointment Breakdown</p>
        <div className="border border-slate-100 rounded-lg overflow-hidden divide-y divide-slate-50">
          {[
            { label: 'Total', value: appointments.length, cls: 'text-slate-700' },
            { label: 'Upcoming', value: scheduled, cls: 'text-blue-600' },
            { label: 'Completed', value: completed, cls: 'text-emerald-600' },
          ].map(row => (
            <div key={row.label} className="flex items-center justify-between px-3 py-2 bg-white">
              <span className="text-xs text-slate-500">{row.label}</span>
              <span className={`text-sm font-bold ${row.cls}`}>{row.value}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── Main Dashboard Component ─────────────────────────────────────────────────
export default function Dashboard() {
  const { user, token } = useAuth();

  // ── State (all identical to original) ────────────────────────────────────────
  const [doctors, setDoctors] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  });
  const [slotsByDoctor, setSlotsByDoctor] = useState<{
    [docId: number]: { slots: string[]; onLeave: boolean; loading: boolean; error: string | null };
  }>({});
  const [bookingModal, setBookingModal] = useState<{ holdId: number } | null>(null);
  const [symptoms, setSymptoms] = useState('');
  const [selectedAppointment, setSelectedAppointment] = useState<any>(null);
  const [consultationForm, setConsultationForm] = useState({
    clinicalNotes: '',
    prescriptionRaw: '',
    followUpInstructions: '',
  });
  const [medicationReminders, setMedicationReminders] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState('dashboard');

  const [calendarConnected, setCalendarConnected] = useState(false);
  const [loadingCalendar, setLoadingCalendar] = useState(false);

  // ── Fetch helpers (identical to original) ────────────────────────────────────
  const fetchCalendarStatus = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/calendar/status', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setCalendarConnected(Boolean(data.connected));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleConnectCalendar = async () => {
    try {
      setLoadingCalendar(true);
      const res = await fetch('/api/calendar/connect', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || 'Google Calendar is not configured on the server');
      }
    } catch (e: any) {
      alert(e.message || 'Error connecting to Google Calendar');
    } finally {
      setLoadingCalendar(false);
    }
  };

  const handleDisconnectCalendar = async () => {
    if (!confirm('Are you sure you want to disconnect your Google Calendar?')) return;
    try {
      setLoadingCalendar(true);
      const res = await fetch('/api/calendar/disconnect', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setCalendarConnected(false);
      }
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoadingCalendar(false);
    }
  };

  const fetchAppointments = async () => {
    try {
      const res = await fetch('/api/appointments', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setAppointments(data);
    } catch (e) { console.error(e); }
  };

  const fetchMedicationReminders = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/medications/reminders', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setMedicationReminders(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.error('Error fetching medication reminders:', e);
    }
  };

  const fetchAvailability = async (date: string, docList: any[] = doctors) => {
    if (!date || !token || !docList || docList.length === 0) return;
    setSlotsByDoctor(prev => {
      const next = { ...prev };
      docList.forEach(d => {
        const id = d.profile?.id;
        if (id) next[id] = { slots: next[id]?.slots || [], onLeave: false, loading: true, error: null };
      });
      return next;
    });
    await Promise.all(docList.map(async doc => {
      const docId = doc.profile?.id;
      if (!docId) return;
      try {
        const res = await fetch(`/api/doctors/${docId}/available?date=${date}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          setSlotsByDoctor(prev => ({
            ...prev,
            [docId]: { slots: [], onLeave: false, loading: false, error: 'Unable to load slots. Please try again.' },
          }));
          return;
        }
        const isOnLeave = res.headers.get('x-doctor-on-leave') === 'true';
        const data = await res.json();
        const slots = Array.isArray(data) ? data : (data.slots || []);
        const onLeave = isOnLeave || Boolean(data.onLeave);
        setSlotsByDoctor(prev => ({
          ...prev,
          [docId]: { slots, onLeave, loading: false, error: null },
        }));
      } catch {
        setSlotsByDoctor(prev => ({
          ...prev,
          [docId]: { slots: [], onLeave: false, loading: false, error: 'Unable to load slots. Please try again.' },
        }));
      }
    }));
  };

  const openAppointment = async (id: number) => {
    try {
      const res = await fetch(`/api/appointments/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setSelectedAppointment(data);
      if (data.status !== 'completed') {
        setConsultationForm({ clinicalNotes: '', prescriptionRaw: '', followUpInstructions: '' });
      }
    } catch (e) { console.error(e); }
  };

  const completeConsultation = async () => {
    try {
      const res = await fetch(`/api/appointments/${selectedAppointment.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(consultationForm),
      });
      if (!res.ok) throw new Error(await res.text());
      alert('Consultation completed successfully!');
      setSelectedAppointment(null);
      fetchAppointments();
    } catch (e: any) { alert(e.message); }
  };

  const startBooking = async (doctorId: number, slotStart: string) => {
    try {
      const res = await fetch('/api/appointments/hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ doctorId, slotStart }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409) {
          alert('This slot was just taken. Please choose another.');
          fetchAvailability(selectedDate, doctors);
          return;
        }
        throw new Error(data.error);
      }
      setSymptoms('');
      setBookingModal({ holdId: data.hold.id });
    } catch (e: any) { alert(e.message); }
  };

  const confirmBooking = async () => {
    if (!bookingModal) return;
    try {
      const res = await fetch('/api/appointments/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ holdId: bookingModal.holdId, rawSymptoms: symptoms || 'None provided' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      alert('Appointment booked successfully!');
      setBookingModal(null);
      fetchAppointments();
      fetchAvailability(selectedDate, doctors);
    } catch (e: any) {
      alert(e.message);
      setBookingModal(null);
      fetchAvailability(selectedDate, doctors);
    }
  };

  useEffect(() => {
    // Check calendar callback query params
    const params = new URLSearchParams(window.location.search);
    if (params.get('calendar') === 'connected') {
      window.history.replaceState({}, document.title, window.location.pathname);
      fetchCalendarStatus();
    } else if (params.get('calendar_error')) {
      alert(`Google Calendar connection error: ${params.get('calendar_error')}`);
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    if (user?.role === 'patient') {
      fetch('/api/doctors', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(data => {
          setDoctors(data);
          if (Array.isArray(data) && data.length > 0) fetchAvailability(selectedDate, data);
        })
        .catch(console.error);
      fetchAppointments();
      fetchMedicationReminders();
      fetchCalendarStatus();
    } else if (user?.role === 'doctor') {
      fetchAppointments();
      fetchMedicationReminders();
      fetchCalendarStatus();
    }
  }, [user, token]);

  // ── Derived ───────────────────────────────────────────────────────────────────
  const upcoming = appointments.filter(a => a.status === 'scheduled').length;
  const completed = appointments.filter(a => a.status === 'completed').length;
  const showAppts = activeTab === 'dashboard' || activeTab === 'appointments';
  const showBook = activeTab === 'dashboard' || activeTab === 'book';
  const todayStr = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <>
      {/* Modals */}
      {bookingModal && (
        <BookingModal
          symptoms={symptoms}
          setSymptoms={setSymptoms}
          onConfirm={confirmBooking}
          onCancel={() => { setBookingModal(null); alert('Booking cancelled.'); }}
        />
      )}
      {selectedAppointment && (
        <AppointmentModal
          apt={selectedAppointment}
          userRole={user?.role ?? ''}
          consultationForm={consultationForm}
          setConsultationForm={setConsultationForm}
          onComplete={completeConsultation}
          onClose={() => setSelectedAppointment(null)}
        />
      )}

      <AppShell
        activeTab={activeTab}
        onTabChange={setActiveTab}
        rightPanel={
          user?.role === 'patient' ? (
            <PatientRightPanel
              selectedDate={selectedDate}
              onDateChange={date => { setSelectedDate(date); fetchAvailability(date, doctors); }}
              appointments={appointments}
              calendarConnected={calendarConnected}
              loadingCalendar={loadingCalendar}
              onConnectCalendar={handleConnectCalendar}
              onDisconnectCalendar={handleDisconnectCalendar}
            />
          ) : user?.role === 'doctor' ? (
            <DoctorRightPanel
              user={user}
              appointments={appointments}
              calendarConnected={calendarConnected}
              loadingCalendar={loadingCalendar}
              onConnectCalendar={handleConnectCalendar}
              onDisconnectCalendar={handleDisconnectCalendar}
            />
          ) : undefined
        }
      >
        {/* ── PATIENT ─────────────────────────────────────────────────────── */}
        {user?.role === 'patient' && (
          <div className="space-y-6 max-w-3xl">
            {/* Page header */}
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-lg font-semibold text-slate-800">{getGreeting()}, {user.name.split(' ')[0]}</h1>
                <p className="text-xs text-slate-400 mt-0.5">{todayStr}</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="bg-white border border-slate-100 rounded-lg px-3 py-2 text-center shadow-sm">
                  <div className="text-base font-bold text-blue-600 leading-none">{upcoming}</div>
                  <div className="text-[9px] text-slate-400 uppercase tracking-wide mt-0.5">Upcoming</div>
                </div>
                <div className="bg-white border border-slate-100 rounded-lg px-3 py-2 text-center shadow-sm">
                  <div className="text-base font-bold text-emerald-600 leading-none">{completed}</div>
                  <div className="text-[9px] text-slate-400 uppercase tracking-wide mt-0.5">Done</div>
                </div>
              </div>
            </div>

            {/* Medication Reminders Section */}
            {medicationReminders.length > 0 && (
              <section className="bg-white border border-slate-100 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Pill className="w-4 h-4 text-blue-600" />
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Medication Reminders</h2>
                  </div>
                  <span className="text-[11px] text-slate-400 font-medium">
                    {medicationReminders.filter(r => r.status === 'ACTIVE').length} Active
                  </span>
                </div>
                <div className="space-y-2">
                  {medicationReminders.map(rem => {
                    // Calculate duration in days from startDate/endDate for display
                    const startD = normaliseDate(rem.startDate);
                    const endD = normaliseDate(rem.endDate);
                    const durationDays = (startD && endD)
                      ? Math.round((endD.getTime() - startD.getTime()) / 86400000)
                      : null;
                    // Clean medication name: strip dosage suffix if parser appended it
                    let displayName = rem.medicationName || '';
                    if (rem.dosage) {
                      const doseEscaped = rem.dosage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                      displayName = displayName.replace(new RegExp(`\\s*${doseEscaped}\\s*$`, 'i'), '').trim();
                    }
                    if (!displayName) displayName = rem.medicationName;
                    return (
                      <div key={rem.id} className="flex items-start justify-between bg-slate-50 border border-slate-100 rounded-lg p-3">
                        <div className="space-y-0.5 min-w-0 flex-1">
                          {/* Pill: Name · Dosage · Frequency · Duration */}
                          <div className="text-sm font-semibold text-slate-800">
                            {displayName}
                          </div>
                          <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-1.5">
                            {rem.dosage && <span className="font-medium text-slate-700">{rem.dosage}</span>}
                            {rem.dosage && <span className="text-slate-300">·</span>}
                            <span className="font-semibold text-blue-700">{rem.frequency}</span>
                            {durationDays && durationDays > 0 && (
                              <><span className="text-slate-300">·</span><span className="text-slate-500">{durationDays} day{durationDays !== 1 ? 's' : ''}</span></>
                            )}
                          </div>
                          {rem.instructions && (
                            <div className="text-xs text-slate-500 italic">{rem.instructions}</div>
                          )}
                          <div className="text-[11px] text-slate-400">
                            {fmtDateOnly(rem.startDate)} – {fmtDateOnly(rem.endDate)}
                            {rem.doctorName && <span> · Dr. {rem.doctorName}</span>}
                          </div>
                        </div>
                        <div className="shrink-0 ml-3">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                            rem.status === 'ACTIVE'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : rem.status === 'COMPLETED'
                              ? 'bg-slate-100 text-slate-500 border border-slate-200'
                              : 'bg-rose-50 text-rose-700 border border-rose-200'
                          }`}>
                            {rem.status}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* My Appointments */}
            {showAppts && (
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">My Appointments</h2>
                  <button
                    onClick={() => setActiveTab('book')}
                    className="text-[11px] font-semibold text-blue-700 hover:underline"
                  >
                    + Book new
                  </button>
                </div>
                {appointments.length === 0 ? (
                  <EmptyState
                    icon={<CalendarDays className="w-7 h-7" />}
                    title="No appointments yet"
                    description="Use Find Doctors to book your first appointment."
                    action={
                      <button
                        onClick={() => setActiveTab('book')}
                        className="px-4 py-2 text-sm font-semibold text-white rounded-lg bg-blue-700 hover:bg-blue-800 transition-colors"
                      >
                        Find a Doctor
                      </button>
                    }
                  />
                ) : (
                  <div className="space-y-2">
                    {appointments.map(apt => (
                      <ApptRow key={apt.id} apt={apt} onClick={() => openAppointment(apt.id)} role="patient" />
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Find a Doctor */}
            {showBook && (
              <section>
                <div className="flex items-center gap-3 mb-3">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Find a Doctor</h2>
                  <span className="text-[11px] text-slate-400">Slots for {selectedDate}</span>
                </div>
                {doctors.length === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-slate-400 py-4">
                    <div className="w-4 h-4 border-2 border-slate-200 border-t-blue-400 rounded-full animate-spin" />
                    Loading doctors…
                  </div>
                ) : (
                  <div className="space-y-2">
                    {doctors.map(doc => (
                      <DoctorRow
                        key={doc.id}
                        doc={doc}
                        availability={slotsByDoctor[doc.profile.id]}
                        onBook={startBooking}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        )}

        {/* ── DOCTOR ──────────────────────────────────────────────────────── */}
        {user?.role === 'doctor' && (
          <div className="space-y-6 max-w-3xl">
            {/* Page header */}
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-lg font-semibold text-slate-800">{getGreeting()}, {user.name}</h1>
                <p className="text-xs text-slate-400 mt-0.5">{todayStr}</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="bg-white border border-slate-100 rounded-lg px-3 py-2 text-center shadow-sm">
                  <div className="text-base font-bold text-blue-600 leading-none">{upcoming}</div>
                  <div className="text-[9px] text-slate-400 uppercase tracking-wide mt-0.5">Upcoming</div>
                </div>
                <div className="bg-white border border-slate-100 rounded-lg px-3 py-2 text-center shadow-sm">
                  <div className="text-base font-bold text-emerald-600 leading-none">{completed}</div>
                  <div className="text-[9px] text-slate-400 uppercase tracking-wide mt-0.5">Done</div>
                </div>
              </div>
            </div>

            {/* Appointment list */}
            <section>
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                {activeTab === 'appointments' ? 'All Appointments' : 'Patient Schedule'}
              </h2>
              {appointments.length === 0 ? (
                <EmptyState
                  icon={<CalendarDays className="w-7 h-7" />}
                  title="No appointments"
                  description="No scheduled or completed appointments found."
                />
              ) : (
                <div className="space-y-2">
                  {appointments.map(apt => (
                    <ApptRow key={apt.id} apt={apt} onClick={() => openAppointment(apt.id)} role="doctor" />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </AppShell>
    </>
  );
}
