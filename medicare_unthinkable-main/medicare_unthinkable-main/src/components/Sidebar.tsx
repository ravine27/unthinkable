import React from 'react';
import {
  Activity,
  LayoutDashboard,
  CalendarDays,
  UserCheck,
  Users,
  CalendarOff,
  ClipboardList,
  LogOut,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';

interface SidebarProps {
  activeTab?: string;
  onTabChange?: (tab: string) => void;
}

interface NavItem {
  icon: React.ReactNode;
  label: string;
  tab: string;
}

function NavBtn({
  icon, label, active, onClick,
}: {
  key?: React.Key;
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={[
        'relative w-10 h-10 rounded-lg flex items-center justify-center transition-all duration-150',
        active
          ? 'bg-blue-600 text-white shadow-sm'
          : 'text-white/50 hover:text-white/90 hover:bg-white/10',
      ].join(' ')}
    >
      {icon}
    </button>
  );
}

export function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  const { user, logout } = useAuth();

  const patientNav: NavItem[] = [
    { icon: <LayoutDashboard className="w-[18px] h-[18px]" />, label: 'Dashboard', tab: 'dashboard' },
    { icon: <CalendarDays className="w-[18px] h-[18px]" />, label: 'My Appointments', tab: 'appointments' },
    { icon: <UserCheck className="w-[18px] h-[18px]" />, label: 'Find Doctors', tab: 'book' },
  ];

  const doctorNav: NavItem[] = [
    { icon: <LayoutDashboard className="w-[18px] h-[18px]" />, label: 'Dashboard', tab: 'dashboard' },
    { icon: <CalendarDays className="w-[18px] h-[18px]" />, label: 'Appointments', tab: 'appointments' },
  ];

  const adminNav: NavItem[] = [
    { icon: <Users className="w-[18px] h-[18px]" />, label: 'Doctors', tab: 'doctors' },
    { icon: <CalendarOff className="w-[18px] h-[18px]" />, label: 'Leaves', tab: 'leaves' },
    { icon: <ClipboardList className="w-[18px] h-[18px]" />, label: 'Appointments', tab: 'appointments' },
  ];

  const nav =
    user?.role === 'admin' ? adminNav :
    user?.role === 'doctor' ? doctorNav :
    patientNav;

  return (
    <aside
      className="shrink-0 flex flex-col items-center py-4 gap-1 z-40"
      style={{ width: 64, background: '#1B2559', minHeight: '100vh' }}
    >
      {/* Logo mark */}
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center mb-5 shrink-0"
        style={{ background: '#3B5BD5' }}
      >
        <Activity className="w-4 h-4 text-white" strokeWidth={2.5} />
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-1 items-center flex-1 w-full px-2.5">
        {nav.map(item => (
          <NavBtn
            key={item.tab}
            icon={item.icon}
            label={item.label}
            active={activeTab === item.tab}
            onClick={() => onTabChange?.(item.tab)}
          />
        ))}
      </nav>

      {/* Logout */}
      <button
        onClick={logout}
        title="Sign out"
        aria-label="Sign out"
        className="w-10 h-10 rounded-lg flex items-center justify-center text-white/35 hover:text-white/75 hover:bg-white/10 transition-all duration-150"
      >
        <LogOut className="w-[17px] h-[17px]" />
      </button>
    </aside>
  );
}
