import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { Activity } from 'lucide-react';

const ROLES = [
  { value: 'patient', label: 'Patient' },
  { value: 'doctor', label: 'Doctor' },
  { value: 'admin', label: 'Admin' },
] as const;

export default function Register() {
  const { login } = useAuth();
  const [role, setRole] = useState<'patient' | 'doctor' | 'admin'>('patient');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, name, email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');
      login(data.user, data.token);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const inputCls =
    'w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 bg-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-100 transition-all placeholder:text-slate-400';
  const labelCls = 'block text-xs font-semibold text-slate-600 mb-1.5';

  return (
    <div className="min-h-screen flex" style={{ background: '#F0F2F7' }}>
      {/* Left branding panel */}
      <div
        className="hidden lg:flex flex-col justify-between p-10 w-[380px] shrink-0"
        style={{ background: '#1B2559' }}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-blue-600">
            <Activity className="w-4 h-4 text-white" strokeWidth={2.5} />
          </div>
          <span className="text-white font-bold text-lg tracking-tight">MediFlow</span>
        </div>

        <div>
          <p className="text-white/50 text-xs uppercase tracking-widest font-semibold mb-4">Get started</p>
          <h2 className="text-white text-2xl font-bold leading-snug mb-3">
            Create your<br />clinical account.
          </h2>
          <p className="text-white/50 text-sm leading-relaxed">
            Access MediFlow as a patient, clinician, or administrator. Your account will be ready immediately.
          </p>
        </div>

        <div className="text-white/30 text-xs">
          Already have an account?{' '}
          <a href="/login" className="text-white/60 font-semibold hover:text-white transition-colors">Sign in</a>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="flex items-center gap-2 mb-8 lg:hidden">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-blue-700">
              <Activity className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
            </div>
            <span className="font-bold text-slate-800">MediFlow</span>
          </div>

          <h1 className="text-xl font-bold text-slate-800 mb-1">Create account</h1>
          <p className="text-sm text-slate-500 mb-6">Fill in your details to register</p>

          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm px-4 py-3 rounded-lg mb-5">
              {error}
            </div>
          )}

          <form id="register-form" onSubmit={handleSubmit} className="space-y-4">
            {/* Role selector */}
            <div>
              <label className={labelCls}>Account type</label>
              <div className="flex rounded-lg border border-slate-200 overflow-hidden bg-white">
                {ROLES.map(r => (
                  <button
                    key={r.value}
                    type="button"
                    id={`role-${r.value}`}
                    onClick={() => setRole(r.value)}
                    className={[
                      'flex-1 py-2 text-xs font-semibold transition-colors',
                      role === r.value
                        ? 'bg-blue-700 text-white'
                        : 'text-slate-500 hover:bg-slate-50',
                    ].join(' ')}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="name" className={labelCls}>Full name</label>
              <input
                id="name"
                type="text"
                required
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Dr. Jane Smith"
                className={inputCls}
              />
            </div>

            <div>
              <label htmlFor="email" className={labelCls}>Email address</label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                className={inputCls}
              />
            </div>

            <div>
              <label htmlFor="password" className={labelCls}>Password</label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Min 8 characters"
                className={inputCls}
              />
            </div>

            <button
              id="register-btn"
              type="submit"
              disabled={loading}
              className="w-full py-2.5 text-sm font-semibold text-white rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors mt-2"
            >
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>

          <p className="text-sm text-slate-500 text-center mt-6">
            Already have an account?{' '}
            <a href="/login" className="text-blue-700 font-semibold hover:underline">
              Sign in
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
