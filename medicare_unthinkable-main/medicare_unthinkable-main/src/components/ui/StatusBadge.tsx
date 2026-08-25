import React from 'react';

type AppointmentStatus = 'scheduled' | 'completed' | 'cancelled';
type UrgencyLevel = 'High' | 'Medium' | 'Low';

interface StatusBadgeProps {
  status: AppointmentStatus | UrgencyLevel | string;
  type?: 'appointment' | 'urgency' | 'doctor';
  className?: string;
}

const appointmentStyles: Record<string, string> = {
  scheduled: 'bg-blue-50 text-blue-700 border-blue-200',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelled: 'bg-rose-50 text-rose-700 border-rose-200',
};

const urgencyStyles: Record<string, string> = {
  High: 'bg-rose-50 text-rose-700 border-rose-200',
  Medium: 'bg-amber-50 text-amber-700 border-amber-200',
  Low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

const doctorStyles: Record<string, string> = {
  true: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  false: 'bg-slate-100 text-slate-500 border-slate-200',
};

export function StatusBadge({ status, type = 'appointment', className = '' }: StatusBadgeProps) {
  let styleClass = '';

  if (type === 'urgency') {
    styleClass = urgencyStyles[status] ?? 'bg-slate-100 text-slate-600 border-slate-200';
  } else if (type === 'doctor') {
    styleClass = doctorStyles[status] ?? 'bg-slate-100 text-slate-600 border-slate-200';
  } else {
    styleClass = appointmentStyles[status.toLowerCase()] ?? 'bg-slate-100 text-slate-600 border-slate-200';
  }

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${styleClass} ${className}`}
    >
      {status}
    </span>
  );
}
