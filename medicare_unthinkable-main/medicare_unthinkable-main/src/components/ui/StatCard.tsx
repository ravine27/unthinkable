import React from 'react';

interface StatCardProps {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  accent?: 'blue' | 'pink' | 'purple' | 'mint' | 'amber';
  sublabel?: string;
  className?: string;
}

const accentMap = {
  blue:   { bg: 'bg-blue-50',   icon: 'bg-blue-100 text-blue-600',   value: 'text-blue-700' },
  pink:   { bg: 'bg-pink-50',   icon: 'bg-pink-100 text-pink-600',   value: 'text-pink-700' },
  purple: { bg: 'bg-purple-50', icon: 'bg-purple-100 text-purple-600', value: 'text-purple-700' },
  mint:   { bg: 'bg-emerald-50',icon: 'bg-emerald-100 text-emerald-600', value: 'text-emerald-700' },
  amber:  { bg: 'bg-amber-50',  icon: 'bg-amber-100 text-amber-600', value: 'text-amber-700' },
};

export function StatCard({ label, value, icon, accent = 'blue', sublabel, className = '' }: StatCardProps) {
  const colors = accentMap[accent];

  return (
    <div className={`${colors.bg} rounded-2xl p-5 flex items-center gap-4 border border-white/60 shadow-sm ${className}`}>
      <div className={`${colors.icon} w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0`}>
        {icon}
      </div>
      <div>
        <div className={`text-2xl font-bold ${colors.value}`}>{value}</div>
        <div className="text-sm font-medium text-slate-600">{label}</div>
        {sublabel && <div className="text-xs text-slate-400 mt-0.5">{sublabel}</div>}
      </div>
    </div>
  );
}
