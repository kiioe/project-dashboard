import React, { useEffect, useRef, useState } from 'react';
import { LayoutGrid, CheckSquare, PoundSterling, Clock, Plus, X, RefreshCw, ChevronDown, Check } from 'lucide-react';

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
// Drag down from the top of any tab to refresh (onRefresh is awaited while the spinner shows).
export function PhoneShell({ header, tab, onTab, onRefresh, children }) {
  const [pull, setPull] = useState(0); // px dragged
  const [refreshing, setRefreshing] = useState(false);
  const start = useRef(null);
  const pullRef = useRef(0);
  const THRESHOLD = 70;

  useEffect(() => {
    const onStart = (e) => {
      if (window.scrollY > 0 || refreshing || document.body.dataset.sheetOpen) { start.current = null; return; }
      start.current = e.touches[0].clientY;
    };
    const onMove = (e) => {
      if (start.current === null) return;
      const dy = e.touches[0].clientY - start.current;
      if (dy <= 0 || window.scrollY > 0) { pullRef.current = 0; setPull(0); return; }
      pullRef.current = Math.min(dy * 0.5, 110);
      setPull(pullRef.current);
      if (e.cancelable) e.preventDefault();
    };
    const onEnd = async () => {
      if (start.current === null) return;
      start.current = null;
      const reached = pullRef.current >= THRESHOLD;
      pullRef.current = 0;
      setPull(0);
      if (!reached || !onRefresh) return;
      setRefreshing(true);
      try { await Promise.all([onRefresh(), new Promise(r => setTimeout(r, 500))]); } finally { setRefreshing(false); }
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, [onRefresh, refreshing]);

  const shown = refreshing ? 56 : pull;
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header
        className="sticky top-0 z-30 flex items-center justify-between gap-2 bg-white border-b border-slate-200 px-4"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 8px)', paddingBottom: 8 }}
      >
        {header}
      </header>
      <div aria-live="polite" className="flex justify-center overflow-hidden"
        style={{ height: shown, transition: pull ? 'none' : 'height 200ms ease-out' }}>
        {(shown > 0) && (
          <span className="self-end mb-3 w-9 h-9 rounded-full bg-white border border-slate-200 flex items-center justify-center text-blue-700">
            <RefreshCw size={18} aria-hidden="true" className={refreshing ? 'animate-spin' : ''}
              style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)`, opacity: Math.min(1, pull / THRESHOLD) }} />
            <span className="sr-only">{refreshing ? 'Refreshing' : pull >= THRESHOLD ? 'Release to refresh' : 'Pull to refresh'}</span>
          </span>
        )}
      </div>
      <main className="px-4 pt-4 space-y-4" style={{ paddingBottom: 'calc(160px + env(safe-area-inset-bottom))' }}>
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

// Round "+" button, bottom right above the tabs.
export function AddButton({ label, onClick }) {
  return (
    <button onClick={onClick} aria-label={label}
      className="fixed z-30 right-4 w-14 h-14 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-lg active:bg-blue-700"
      style={{ bottom: 'calc(76px + env(safe-area-inset-bottom))' }}>
      <Plus size={28} aria-hidden="true" />
    </button>
  );
}

// Panel that slides up from the bottom. Tap outside, ✕ or Escape to close.
export function BottomSheet({ open, title, onClose, children }) {
  useEffect(() => {
    if (!open) return undefined;
    document.body.dataset.sheetOpen = '1';
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => {
      delete document.body.dataset.sheetOpen;
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-slate-900/40 cursor-default" tabIndex={-1} />
      <div className="relative bg-white rounded-t-2xl max-h-[85vh] overflow-y-auto px-4 pt-2"
        style={{ paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }}>
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-300" aria-hidden="true" />
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="w-11 h-11 -mr-2 flex items-center justify-center text-slate-500">
            <X size={22} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// The page title is the project's name; tap it to switch project (design a1, 22 Nov 2026).
export function ProjectTitle({ label, projects, value, onChange }) {
  const [open, setOpen] = useState(false);
  const current = projects.find(p => p.id === value);
  return (
    <>
      <div>
        <div className="text-xs text-slate-500">{label}</div>
        <button onClick={() => setOpen(true)} aria-haspopup="dialog"
          className="flex items-center gap-1 text-left text-xl font-bold text-slate-900 border-b-2 border-dashed border-blue-300 pb-0.5 min-h-[44px]">
          <span>{current?.name}</span>
          <ChevronDown size={20} className="text-blue-700 shrink-0" aria-hidden="true" />
          <span className="sr-only">(change project)</span>
        </button>
      </div>
      <BottomSheet open={open} title="Choose a project" onClose={() => setOpen(false)}>
        <ul className="divide-y divide-slate-100">
          {projects.map(p => (
            <li key={p.id}>
              <button onClick={() => { onChange(p.id); setOpen(false); }}
                className="w-full flex items-center justify-between gap-3 min-h-[52px] text-left">
                <span className={p.id === value ? 'font-semibold text-blue-700' : 'text-slate-800'}>{p.name}</span>
                {p.id === value && <Check size={20} className="text-blue-700" aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      </BottomSheet>
    </>
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
