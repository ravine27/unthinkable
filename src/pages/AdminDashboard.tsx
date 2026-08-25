import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { AppShell } from '../components/AppShell.js';
import { StatusBadge } from '../components/ui/StatusBadge.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import {
  Users,
  UserCheck,
  CalendarDays,
  CalendarOff,
  Plus,
  X,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ClipboardList,
  Filter,
} from 'lucide-react';

function getSlotStart(apt: any): string | undefined {
  return apt?.slot_start ?? apt?.slotStart;
}

/** Normalise Postgres timestamp strings ("2026-08-25 10:00:00", no T/Z) to UTC Date. */
function normaliseDate(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  let s = String(v).trim();
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

export default function AdminDashboard() {
  const { token } = useAuth();
  const [activeTab, setActiveTab] = useState<'doctors' | 'leaves' | 'appointments'>('doctors');

  const [doctors, setDoctors] = useState<any[]>([]);
  const [leaves, setLeaves] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);

  // Doctor form state
  const [showDocForm, setShowDocForm] = useState(false);
  const [docForm, setDocForm] = useState({
    name: '',
    email: '',
    password: '',
    specialisation: '',
    workingHoursStart: '09:00',
    workingHoursEnd: '17:00',
    slotDurationMinutes: 30,
  });
  const [error, setError] = useState('');

  // Leave form state
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [leaveForm, setLeaveForm] = useState({ doctorId: '', date: '', reason: '' });
  const [leaveConflict, setLeaveConflict] = useState<any>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    if (activeTab === 'doctors') loadDoctors();
    if (activeTab === 'leaves') {
      loadLeaves();
      loadDoctors();
    }
    if (activeTab === 'appointments') loadAppointments();
  }, [activeTab]);

  const loadDoctors = async () => {
    try {
      const res = await fetch('/api/admin/doctors', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setDoctors(data);
    } catch (e) {
      console.error(e);
    }
  };

  const loadLeaves = async () => {
    try {
      const res = await fetch('/api/admin/leaves', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setLeaves(data);
    } catch (e) {
      console.error(e);
    }
  };

  const loadAppointments = async () => {
    try {
      const res = await fetch('/api/admin/appointments', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setAppointments(data);
    } catch (e) {
      console.error(e);
    }
  };

  const handleCreateDoctor = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch('/api/admin/doctors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(docForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setShowDocForm(false);
      setDocForm({
        name: '',
        email: '',
        password: '',
        specialisation: '',
        workingHoursStart: '09:00',
        workingHoursEnd: '17:00',
        slotDurationMinutes: 30,
      });
      loadDoctors();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const toggleDoctorActive = async (doc: any) => {
    try {
      const res = await fetch(`/api/admin/doctors/${doc.profile.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...doc.profile, isActive: !doc.profile.isActive }),
      });
      if (res.ok) loadDoctors();
    } catch (e) {
      console.error(e);
    }
  };

  const handleCreateLeave = async (e: React.FormEvent, confirm: boolean = false) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch('/api/admin/leaves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...leaveForm, confirm }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409) {
          setLeaveConflict(data);
          return;
        }
        throw new Error(data.error);
      }
      setShowLeaveForm(false);
      setLeaveConflict(null);
      setLeaveForm({ doctorId: '', date: '', reason: '' });
      loadLeaves();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const filteredAppointments = appointments.filter(a => {
    if (statusFilter && a.status !== statusFilter) return false;
    return true;
  });

  const activeDoctors = doctors.filter(d => d.profile?.isActive).length;
  const scheduledApts = appointments.filter(a => a.status === 'scheduled').length;
  const completedApts = appointments.filter(a => a.status === 'completed').length;

  const inputCls =
    'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 bg-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-100 transition-all placeholder:text-slate-400';
  const labelCls = 'block text-xs font-semibold text-slate-600 mb-1';

  return (
    <AppShell
      activeTab={activeTab}
      onTabChange={t => setActiveTab(t as any)}
      rightPanel={
        <div className="space-y-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-3">Admin Overview</p>
            <div className="border border-slate-100 rounded-lg overflow-hidden divide-y divide-slate-50">
              <div className="flex items-center justify-between px-3 py-2 bg-white">
                <span className="text-xs text-slate-500">Total Doctors</span>
                <span className="text-sm font-bold text-slate-800">{doctors.length}</span>
              </div>
              <div className="flex items-center justify-between px-3 py-2 bg-white">
                <span className="text-xs text-slate-500">Active Doctors</span>
                <span className="text-sm font-bold text-emerald-600">{activeDoctors}</span>
              </div>
              <div className="flex items-center justify-between px-3 py-2 bg-white">
                <span className="text-xs text-slate-500">Leave Days</span>
                <span className="text-sm font-bold text-amber-600">{leaves.length}</span>
              </div>
              <div className="flex items-center justify-between px-3 py-2 bg-white">
                <span className="text-xs text-slate-500">Appointments</span>
                <span className="text-sm font-bold text-blue-600">{appointments.length}</span>
              </div>
            </div>
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Appointment Stats</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-2.5 text-center">
                <div className="text-base font-bold text-blue-700">{scheduledApts}</div>
                <div className="text-[10px] text-blue-600 uppercase font-semibold">Scheduled</div>
              </div>
              <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-2.5 text-center">
                <div className="text-base font-bold text-emerald-700">{completedApts}</div>
                <div className="text-[10px] text-emerald-600 uppercase font-semibold">Completed</div>
              </div>
            </div>
          </div>
        </div>
      }
    >
      <div className="max-w-4xl space-y-5">
        {/* ── DOCTORS TAB ─────────────────────────────────────────────────── */}
        {activeTab === 'doctors' && (
          <>
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-lg font-semibold text-slate-800">Doctor Directory</h1>
                <p className="text-xs text-slate-400 mt-0.5">Manage physician profiles and practice hours</p>
              </div>
              <button
                id="add-doctor-btn"
                onClick={() => setShowDocForm(!showDocForm)}
                className="flex items-center gap-1.5 bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors shadow-sm"
              >
                {showDocForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                {showDocForm ? 'Cancel' : 'Add Doctor'}
              </button>
            </div>

            {showDocForm && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                <h2 className="text-sm font-semibold text-slate-800 mb-4">Register New Doctor</h2>
                {error && (
                  <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs px-3 py-2 rounded-lg mb-4">
                    {error}
                  </div>
                )}
                <form id="create-doctor-form" onSubmit={handleCreateDoctor} className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className={labelCls}>Name</label>
                    <input required className={inputCls} value={docForm.name} onChange={e => setDocForm({ ...docForm, name: e.target.value })} placeholder="Dr. Jane Smith" />
                  </div>
                  <div>
                    <label className={labelCls}>Email</label>
                    <input required type="email" className={inputCls} value={docForm.email} onChange={e => setDocForm({ ...docForm, email: e.target.value })} placeholder="doctor@mediflow.com" />
                  </div>
                  <div>
                    <label className={labelCls}>Temporary Password</label>
                    <input required type="password" className={inputCls} value={docForm.password} onChange={e => setDocForm({ ...docForm, password: e.target.value })} placeholder="••••••••" />
                  </div>
                  <div>
                    <label className={labelCls}>Specialisation</label>
                    <input required className={inputCls} value={docForm.specialisation} onChange={e => setDocForm({ ...docForm, specialisation: e.target.value })} placeholder="Cardiology, Dermatology..." />
                  </div>
                  <div>
                    <label className={labelCls}>Working Hours Start</label>
                    <input required type="time" className={inputCls} value={docForm.workingHoursStart} onChange={e => setDocForm({ ...docForm, workingHoursStart: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelCls}>Working Hours End</label>
                    <input required type="time" className={inputCls} value={docForm.workingHoursEnd} onChange={e => setDocForm({ ...docForm, workingHoursEnd: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelCls}>Slot Duration (minutes)</label>
                    <input required type="number" className={inputCls} value={docForm.slotDurationMinutes} onChange={e => setDocForm({ ...docForm, slotDurationMinutes: parseInt(e.target.value) || 30 })} />
                  </div>
                  <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowDocForm(false)}
                      className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      id="submit-doctor-btn"
                      type="submit"
                      className="bg-blue-700 hover:bg-blue-800 text-white font-semibold px-4 py-1.5 rounded-lg text-xs transition-colors flex items-center gap-1.5"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> Save Doctor
                    </button>
                  </div>
                </form>
              </div>
            )}

            {doctors.length === 0 ? (
              <EmptyState
                icon={<Users className="w-7 h-7" />}
                title="No doctors found"
                description="Register physician accounts using the Add Doctor button."
              />
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                      <th className="px-4 py-3">Doctor</th>
                      <th className="px-4 py-3">Specialisation</th>
                      <th className="px-4 py-3">Hours & Slots</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {doctors.map(doc => (
                      <tr key={doc.id} className="hover:bg-slate-50/75 transition-colors">
                        <td className="px-4 py-3 font-medium text-slate-800">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-700 font-bold flex items-center justify-center text-xs shrink-0">
                              {doc.name?.charAt(0) ?? 'D'}
                            </div>
                            <div>
                              <div className="text-xs font-semibold text-slate-800">{doc.name}</div>
                              <div className="text-[11px] text-slate-400">{doc.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-600 font-medium">
                          {doc.profile?.specialisation ?? 'General'}
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3 text-slate-400" />
                            {doc.profile?.workingHoursStart} – {doc.profile?.workingHoursEnd}
                            <span className="text-slate-300">|</span>
                            {doc.profile?.slotDurationMinutes}m
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={String(doc.profile?.isActive)} type="doctor" />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => toggleDoctorActive(doc)}
                            className={`text-xs font-semibold px-2.5 py-1 rounded transition-colors ${
                              doc.profile?.isActive
                                ? 'text-rose-600 hover:bg-rose-50'
                                : 'text-emerald-600 hover:bg-emerald-50'
                            }`}
                          >
                            {doc.profile?.isActive ? 'Deactivate' : 'Activate'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* ── LEAVES TAB ─────────────────────────────────────────────────── */}
        {activeTab === 'leaves' && (
          <>
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-lg font-semibold text-slate-800">Leave Management</h1>
                <p className="text-xs text-slate-400 mt-0.5">Schedule and review physician leave days</p>
              </div>
              <button
                id="add-leave-btn"
                onClick={() => setShowLeaveForm(!showLeaveForm)}
                className="flex items-center gap-1.5 bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors shadow-sm"
              >
                {showLeaveForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                {showLeaveForm ? 'Cancel' : 'Record Leave'}
              </button>
            </div>

            {showLeaveForm && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                <h2 className="text-sm font-semibold text-slate-800 mb-4">Record Doctor Leave</h2>
                {error && (
                  <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs px-3 py-2 rounded-lg mb-4">
                    {error}
                  </div>
                )}

                {leaveConflict ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-3">
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <h3 className="text-xs font-bold text-amber-800">{leaveConflict.error}</h3>
                        <p className="text-xs text-amber-700 leading-relaxed">{leaveConflict.message}</p>
                      </div>
                    </div>
                    <div className="flex gap-2 justify-end mt-3">
                      <button
                        type="button"
                        onClick={() => setLeaveConflict(null)}
                        className="px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        id="confirm-leave-btn"
                        onClick={e => handleCreateLeave(e, true)}
                        className="bg-amber-600 hover:bg-amber-700 text-white font-semibold px-3 py-1 rounded text-xs transition-colors"
                      >
                        Confirm & Cancel Conflicts
                      </button>
                    </div>
                  </div>
                ) : (
                  <form id="create-leave-form" onSubmit={handleCreateLeave} className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className={labelCls}>Doctor</label>
                      <select
                        required
                        className={inputCls}
                        value={leaveForm.doctorId}
                        onChange={e => setLeaveForm({ ...leaveForm, doctorId: e.target.value })}
                      >
                        <option value="">Select doctor...</option>
                        {doctors.map(d => (
                          <option key={d.profile?.id} value={d.profile?.id}>
                            {d.name} ({d.profile?.specialisation})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Leave Date</label>
                      <input
                        required
                        type="date"
                        className={inputCls}
                        value={leaveForm.date}
                        onChange={e => setLeaveForm({ ...leaveForm, date: e.target.value })}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className={labelCls}>Reason / Notes (Optional)</label>
                      <input
                        className={inputCls}
                        value={leaveForm.reason}
                        onChange={e => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                        placeholder="E.g. Medical conference, Annual leave..."
                      />
                    </div>
                    <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setShowLeaveForm(false)}
                        className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        id="submit-leave-btn"
                        type="submit"
                        className="bg-blue-700 hover:bg-blue-800 text-white font-semibold px-4 py-1.5 rounded-lg text-xs transition-colors flex items-center gap-1.5"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Check & Submit
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {leaves.length === 0 ? (
              <EmptyState
                icon={<CalendarOff className="w-7 h-7" />}
                title="No leave days on record"
                description="Recorded doctor leave days will appear here."
              />
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Doctor</th>
                      <th className="px-4 py-3">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {leaves.map(l => (
                      <tr key={l.id} className="hover:bg-slate-50/75 transition-colors">
                        <td className="px-4 py-3 font-semibold text-slate-800">{fmtDate(l.date)}</td>
                        <td className="px-4 py-3 text-slate-700 font-medium">{l.doctorName}</td>
                        <td className="px-4 py-3 text-slate-500">{l.reason || <span className="italic text-slate-400">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* ── APPOINTMENTS TAB ──────────────────────────────────────────── */}
        {activeTab === 'appointments' && (
          <>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h1 className="text-lg font-semibold text-slate-800">All Appointments</h1>
                <p className="text-xs text-slate-400 mt-0.5">Comprehensive audit log of system bookings</p>
              </div>
              <div className="flex items-center gap-2">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <select
                  id="status-filter"
                  className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 focus:outline-none focus:border-blue-500"
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                >
                  <option value="">All Statuses</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>

            {filteredAppointments.length === 0 ? (
              <EmptyState
                icon={<ClipboardList className="w-7 h-7" />}
                title="No appointments found"
                description={statusFilter ? `No ${statusFilter} appointments found.` : 'No appointments recorded.'}
              />
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                      <th className="px-4 py-3">Date & Time</th>
                      <th className="px-4 py-3">Patient</th>
                      <th className="px-4 py-3">Doctor</th>
                      <th className="px-4 py-3">Specialisation</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredAppointments.map(a => {
                      const slotVal = getSlotStart(a);
                      return (
                        <tr key={a.id} className="hover:bg-slate-50/75 transition-colors">
                          <td className="px-4 py-3 text-slate-800 font-medium">
                            <div>{fmtDate(slotVal)}</div>
                            <div className="text-[11px] text-slate-400 font-normal">{fmtTime(slotVal)}</div>
                          </td>
                          <td className="px-4 py-3 font-semibold text-slate-800">{a.patientName}</td>
                          <td className="px-4 py-3 text-slate-700">{a.doctorName}</td>
                          <td className="px-4 py-3 text-slate-500">{a.doctorSpecialisation}</td>
                          <td className="px-4 py-3">
                            <StatusBadge status={a.status} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
