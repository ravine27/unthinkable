import React from 'react';
import { Sidebar } from './Sidebar.js';

interface AppShellProps {
  children: React.ReactNode;
  activeTab?: string;
  onTabChange?: (tab: string) => void;
  rightPanel?: React.ReactNode;
}

export function AppShell({ children, activeTab, onTabChange, rightPanel }: AppShellProps) {
  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#F0F2F7' }}>
      <Sidebar activeTab={activeTab} onTabChange={onTabChange} />

      <div className="flex flex-1 min-w-0 overflow-hidden">
        {/* Scrollable main content */}
        <main className="flex-1 overflow-y-auto min-w-0">
          <div className="p-5 lg:p-6">
            {children}
          </div>
        </main>

        {/* Right panel — desktop only */}
        {rightPanel && (
          <aside className="hidden lg:flex flex-col shrink-0 overflow-y-auto border-l border-slate-200 bg-white gap-5 p-4" style={{ width: 252 }}>
            {rightPanel}
          </aside>
        )}
      </div>
    </div>
  );
}
