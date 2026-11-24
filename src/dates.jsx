import React, { createContext, useContext } from 'react';

// Shared rules for showing dates. Dates are stored as "2026-11-28" (ISO) and only shown
// differently, using the organisation's date format: 'uk' (default) or 'us'.
// Use these everywhere a date is shown; don't use toLocaleDateString or show ISO dates.

export const DATE_FORMATS = {
  uk: { label: 'UK', example: '28/11/2026' },
  us: { label: 'US', example: '11/28/2026' }
};
export const DEFAULT_DATE_FORMAT = 'uk';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ISO = /^(\d{4})-(\d{2})-(\d{2})/;
const pad = (n) => String(n).padStart(2, '0');

// Styles:
//   'medium'  28 Nov 2026           (US: Nov 28, 2026)        lists, cards, invoices
//   'numeric' 28/11/2026            (US: 11/28/2026)          tight table columns
//   'weekday' Sat 28 Nov 2026       (US: Sat, Nov 28, 2026)
//   'long'    28 November 2026      (US: November 28, 2026)   PDF invoice details
export function formatDate(iso, style = 'medium', fmt = DEFAULT_DATE_FORMAT) {
  if (!iso) return '';
  const m = ISO.exec(String(iso));
  if (!m) return String(iso);
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  const date = new Date(y, mo - 1, d);
  if (Number.isNaN(date.getTime()) || date.getMonth() !== mo - 1) return String(iso);
  const us = fmt === 'us';
  const mon = MONTHS[mo - 1].slice(0, 3);
  switch (style) {
    case 'numeric': return us ? `${pad(mo)}/${pad(d)}/${y}` : `${pad(d)}/${pad(mo)}/${y}`;
    case 'weekday': return us ? `${DAYS[date.getDay()]}, ${mon} ${d}, ${y}` : `${DAYS[date.getDay()]} ${d} ${mon} ${y}`;
    case 'long': return us ? `${MONTHS[mo - 1]} ${d}, ${y}` : `${d} ${MONTHS[mo - 1]} ${y}`;
    default: return us ? `${mon} ${d}, ${y}` : `${d} ${mon} ${y}`;
  }
}

// Rewrites ISO dates inside text, e.g. the "Logged time: 3 h (2026-11-20)" lines the database writes.
export const formatDatesIn = (text, fmt = DEFAULT_DATE_FORMAT, style = 'numeric') =>
  text ? String(text).replace(/\b\d{4}-\d{2}-\d{2}\b/g, (iso) => formatDate(iso, style, fmt)) : text;

export const DateFormatContext = createContext(DEFAULT_DATE_FORMAT);

// In components: const { fmt, date, dates } = useDates(); date(iso) → "28 Nov 2026".
export function useDates() {
  const fmt = useContext(DateFormatContext);
  return {
    fmt,
    date: (iso, style) => formatDate(iso, style, fmt),
    dates: (text, style) => formatDatesIn(text, fmt, style)
  };
}

// The browser's own date picker (it follows the device's language), with the chosen date
// echoed underneath in the organisation's format, so it can't be misread.
export function DateInput({ value, onChange, className = '', echoClassName = '', wrapperClassName = 'flex flex-col min-w-0', ...rest }) {
  const { date } = useDates();
  return (
    <span className={wrapperClassName}>
      <input type="date" value={value} onChange={onChange} className={className} {...rest} />
      {value && <span className={`text-xs text-slate-500 mt-1 whitespace-nowrap ${echoClassName}`} aria-hidden="true">{date(value, 'weekday')}</span>}
    </span>
  );
}
