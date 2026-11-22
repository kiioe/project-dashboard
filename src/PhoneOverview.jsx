import React, { useState } from 'react';
import { CURRENCIES, formatMoney, sumMoney } from './money';
import { itemTotals } from './CostsPanel';
import { phoneCard, shortDate } from './PhoneLayout';

// Phone "Overview" (design b1, 22 Nov 2026): what's coming up, and where each budget stands.
// Stands in for the desktop timeline and budget chart.

const DAY = 86400000;
const dateOnly = (iso) => new Date(`${iso}T00:00:00`);
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

function countdown(endIso) {
  const days = Math.round((dateOnly(endIso) - today()) / DAY);
  if (days === 0) return { text: 'today', late: false };
  if (days > 0) return { text: days === 1 ? 'tomorrow' : `in ${days} days`, late: false };
  return { text: `overdue by ${-days} ${days === -1 ? 'day' : 'days'}`, late: true };
}

export default function PhoneOverview({ projects, itemsFor, spentFor }) {
  const currencies = Object.keys(CURRENCIES).filter(c => projects.some(p => p.currency === c));
  const [currency, setCurrency] = useState(currencies[0]);
  const cur = currencies.includes(currency) ? currency : currencies[0];

  // Coming up: projects not marked Completed, soonest event date first (overdue ones come first).
  const upcoming = projects
    .filter(p => p.status !== 'Completed' && p.endDate)
    .sort((a, b) => (a.endDate < b.endDate ? -1 : a.endDate > b.endDate ? 1 : 0));

  // Budget: paid (Amount Spent) and committed-but-not-yet-paid items, against each budget.
  const rows = projects.filter(p => p.currency === cur).map(p => {
    const t = itemTotals(itemsFor(p.id));
    const paid = spentFor(p);
    const committed = Math.max(0, sumMoney([t.committed, -t.paid]));
    return { p, paid, committed, used: sumMoney([paid, committed]), budget: p.budget };
  });
  const total = (k) => sumMoney(rows.map(r => r[k]));
  const tot = { budget: total('budget'), paid: total('paid'), committed: total('committed') };
  const left = sumMoney([tot.budget, -tot.paid, -tot.committed]);
  const pct = (x, of) => (of > 0 ? Math.min(100, (100 * x) / of) : 0);

  if (projects.length === 0) return <p className="text-slate-500 text-sm">Add a project to see its overview.</p>;

  return (
    <>
      <section className={phoneCard} aria-labelledby="ov-coming">
        <h2 id="ov-coming" className="font-semibold mb-1">Coming up</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing coming up: every project is marked Completed.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {upcoming.map(p => {
              const c = countdown(p.endDate);
              const start = p.startDate ? dateOnly(p.startDate) : null;
              const end = dateOnly(p.endDate);
              const span = start ? end - start : 0;
              const through = span > 0 ? Math.max(0, Math.min(100, (100 * (today() - start)) / span)) : (c.late ? 100 : 0);
              return (
                <li key={p.id} className="py-2.5">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium text-slate-800 truncate">{p.name}</span>
                    <span className={`shrink-0 ${c.late ? 'text-red-700 font-medium' : 'text-slate-600'}`}>{c.text}</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {start ? `${shortDate(p.startDate)} to ${shortDate(p.endDate)}` : shortDate(p.endDate)}
                  </div>
                  <div className="relative h-1.5 rounded bg-slate-200 mt-1.5" aria-hidden="true">
                    <div className={`h-1.5 rounded ${c.late ? 'bg-red-500' : 'bg-blue-600'}`} style={{ width: `${through}%` }} />
                    {!c.late && <div className="absolute -top-1 w-0.5 h-3.5 bg-slate-900" style={{ left: `calc(${through}% - 1px)` }} />}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className={phoneCard} aria-labelledby="ov-budget">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h2 id="ov-budget" className="font-semibold">Budget</h2>
          {currencies.length > 1 && (
            <div className="flex gap-1" role="group" aria-label="Currency">
              {currencies.map(c => (
                <button key={c} onClick={() => setCurrency(c)} aria-pressed={c === cur}
                  className={`min-h-[36px] px-3 rounded-lg text-sm ${c === cur ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'}`}>
                  {CURRENCIES[c].symbol}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 mb-3 text-sm">
          {[['Budget', tot.budget], ['Paid', tot.paid], ['Committed, not paid', tot.committed], ['Left', left]].map(([label, v]) => (
            <div key={label} className="bg-slate-50 rounded-lg px-3 py-2">
              <div className="text-xs text-slate-600">{label}</div>
              <div className={`font-semibold ${label === 'Left' && v < 0 ? 'text-red-700' : 'text-slate-900'}`}>{formatMoney(v, cur)}</div>
            </div>
          ))}
        </div>
        <div className="flex gap-4 text-xs text-slate-600 mb-1" aria-hidden="true">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-green-600" />Paid</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-blue-600" />Committed</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-slate-200" />Left</span>
        </div>
        <ul className="space-y-3">
          {rows.map(({ p, paid, committed, used, budget }) => {
            const over = used > budget;
            const scale = Math.max(budget, used);
            return (
              <li key={p.id}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-slate-800 truncate">{p.name}</span>
                  <span className={`shrink-0 ${over ? 'text-red-700 font-medium' : 'text-slate-600'}`}>
                    {formatMoney(used, cur)} of {formatMoney(budget, cur)}
                  </span>
                </div>
                <div className="flex h-2.5 rounded-full overflow-hidden bg-slate-200 mt-1" role="img"
                  aria-label={`${p.name}: ${formatMoney(paid, cur)} paid, ${formatMoney(committed, cur)} committed, budget ${formatMoney(budget, cur)}`}>
                  <span className="bg-green-600" style={{ width: `${pct(paid, scale)}%` }} />
                  <span className="bg-blue-600" style={{ width: `${pct(committed, scale)}%` }} />
                </div>
                {over && <div className="text-xs text-red-700 mt-0.5">Over budget by {formatMoney(sumMoney([used, -budget]), cur)}</div>}
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
