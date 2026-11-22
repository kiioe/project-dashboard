import React, { useEffect, useState } from 'react';
import { LayoutGrid, CheckSquare, PoundSterling, Clock } from 'lucide-react';

// Phone layout pieces (agreed 21 Nov 2026; mock-ups linked in the roadmap).
// App.jsx decides what goes in each tab; this file holds the shell and small shared bits.

const PHONE_QUERY = '(max-width: 767px)';

// True on phone-sized screens (below Tailwind's md breakpoint).
export function useIsPhone() {
  const get = () => typeof window !== 'undefined' && window.matchMedia(PHONE_QUERY).matches;
  const [isPhone, setIsPhone] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const onChange = () => setIsPhone(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isPhone;
}

export const PHONE_TABS = [
  { id: 'projects', label: 'Projects', Icon: LayoutGrid },
  { id: 'tasks', label: 'Tasks', Icon: CheckSquare },
  { id: 'costs', label: 'Costs', Icon: PoundSterling },
  { id: 'time', label: 'Time', Icon: Clock },
];

// Compact header, scrolling content, bottom tabs. Leaves room for the iPhone notch and home bar.
export function PhoneShell({ header, tab, onTab, children }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header
        className="sticky top-0 z-30 flex items-center justify-between gap-2 bg-white border-b border-slate-200 px-4"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 8px)', paddingBottom: 8 }}
      >
        {header}
      </header>
      <main className="px-4 pt-4 space-y-4" style={{ paddingBottom: 'calc(88px + env(safe-area-inset-bottom))' }}>
        {children}
      </main>
      <nav
        aria-label="Sections"
        className="fixed bottom-0 inset-x-0 z-30 grid grid-cols-4 bg-white border-t border-slate-200 px-1 pt-1"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 6px)' }}
      >
        {PHONE_TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => { onTab(id); window.scrollTo(0, 0); }}
            aria-current={tab === id ? 'page' : undefined}
            className={`flex flex-col items-center justify-center gap-0.5 min-h-[48px] text-xs ${tab === id ? 'text-blue-700 font-semibold' : 'text-slate-600 font-medium'}`}
          >
            <Icon size={24} aria-hidden="true" />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

// "Project" picker used by the Tasks and Costs tabs.
export function ProjectPicker({ projects, value, onChange }) {
  return (
    <label className="flex flex-col gap-1 text-sm text-slate-600">
      Project
      <select
        value={value ?? ''}
        onChange={(e) => onChange(Number(e.target.value) || e.target.value)}
        className="min-h-[44px] px-3 border border-slate-300 rounded-lg bg-white text-base text-slate-900"
      >
        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>
  );
}

export const phoneCard = 'bg-white border border-slate-200 rounded-2xl p-4';

// "Sat 14 Jun 2027" from "2027-06-14".
export function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
