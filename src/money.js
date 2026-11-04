// Money amounts: 0 or more, up to 2 decimal places (pounds and pence).
// What a money field accepts while typing (allows a trailing "." mid-entry).
export const MONEY_TYPING = /^\d*(\.\d{0,2})?$/;

// Turn a money field's text into a number; blank counts as 0. Returns null if invalid.
export const parseMoney = (text) => {
  const t = String(text).replace(/\.$/, '');
  if (!/^\d*(\.\d{1,2})?$/.test(t)) return null;
  return t === '' ? 0 : Number(t);
};

// Currencies a project can use. Each project's money fields are in its own currency.
export const CURRENCIES = {
  GBP: { symbol: '£', label: 'GBP (£)' },
  EUR: { symbol: '€', label: 'EUR (€)' },
  USD: { symbol: '$', label: 'USD ($)' }
};
export const DEFAULT_CURRENCY = 'GBP';

// Shows the currency symbol; whole amounts without decimals, amounts with pence always with 2.
export const formatMoney = (n, currency = DEFAULT_CURRENCY) =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2
  }).format(n);

// Always shows pence (e.g. £3,420.00), as invoices usually do.
export const formatMoneyFixed = (n, currency = DEFAULT_CURRENCY) =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(n);

// Adds up amounts without floating-point drift (works in pence).
export const sumMoney = (values) => values.reduce((sum, v) => sum + Math.round(Number(v) * 100), 0) / 100;

// Logged hours: more than 0 and at most 24, up to 2 decimal places (e.g. 1.5, 0.25, 7.75).
// What an hours field accepts while typing (allows a trailing "." mid-entry).
export const HOURS_TYPING = /^\d{0,2}(\.\d{0,2})?$/;

// Turn an hours field's text into a number. Returns null if blank, 0, over 24 or badly formed.
export const parseHours = (text) => {
  const t = String(text).replace(/\.$/, '');
  if (!/^(\d{1,2}(\.\d{1,2})?|\.\d{1,2})$/.test(t)) return null;
  const hours = Number(t);
  return hours > 0 && hours <= 24 ? hours : null;
};
