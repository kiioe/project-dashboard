import React, { useState } from 'react';
import { X, FileDown, Trash2 } from 'lucide-react';
import { formatMoney, sumMoney, MONEY_TYPING, parseMoney } from './money';
import { downloadIssuedInvoice, downloadCreditNote } from './invoicePdf';
import { useDates, DateInput } from './dates';

// Payments, credit notes and refunds on an issued invoice (agreed 25 Nov 2026; rules in supabase/credit-notes.sql).
// An issued invoice is never edited: it's reduced or cancelled by a credit note, and money paid back is a refund
// recorded against a credit note. Only admins record; everyone in the organisation can view.

export const PAY_METHODS = ['Bank transfer', 'Card', 'Cash', 'Other'];

const inputClass = 'px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-full';
const labelClass = 'block text-xs font-medium text-slate-600 mb-1';
const btn = 'min-h-[40px] px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-60';
const primary = `${btn} bg-blue-600 text-white hover:bg-blue-700`;
const secondary = `${btn} bg-slate-200 text-slate-700 hover:bg-slate-300`;

const today = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};
const moneyText = (n) => (Math.round(n * 100) / 100).toFixed(2);

// Everything the app needs to know about an invoice's money. Balance = total − credits − payments + refunds.
export function invoiceMoney(invoice, { payments = [], creditNotes = [], refunds = [] }) {
  const total = Number(invoice.total);
  const credited = sumMoney(creditNotes.filter(c => c.invoice_id === invoice.id).map(c => c.total));
  const paid = sumMoney(payments.filter(p => p.invoice_id === invoice.id).map(p => p.amount));
  const refunded = sumMoney(refunds.filter(r => r.invoice_id === invoice.id).map(r => r.amount));
  const balance = sumMoney([total, -credited, -paid, refunded]);
  const refundable = Math.max(sumMoney([paid, -refunded, -(sumMoney([total, -credited]))]), 0);
  const status = credited >= total ? 'Credited' : balance <= 0 ? 'Paid' : paid - refunded > 0 ? 'Part paid' : 'Unpaid';
  return { total, credited, paid, refunded, balance, refundable, status };
}

const STATUS_STYLE = {
  Unpaid: 'bg-amber-100 text-amber-800',
  'Part paid': 'bg-blue-100 text-blue-800',
  Paid: 'bg-green-100 text-green-800',
  Credited: 'bg-slate-200 text-slate-700'
};

export function InvoiceStatus({ money, currency }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_STYLE[money.status]}`}>{money.status}</span>
      {money.refundable > 0 && (
        <span className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap bg-pink-100 text-pink-800">Refund due {formatMoney(money.refundable, currency)}</span>
      )}
    </span>
  );
}

// The money side of one invoice: summary, payments, credit notes and refunds, and the forms to add them.
export default function InvoiceMoneyDialog({ invoice, money: m, lines, payments, creditNotes, creditNoteItems, refunds, projectName,
  isAdmin, supabase, dateFormat, onChanged, onClose }) {
  const { date } = useDates();
  const cur = (n) => formatMoney(n, invoice.currency);
  const [mode, setMode] = useState(null); // 'payment' | 'credit' | { refund: creditNote }
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // { kind, id }
  const [pdfError, setPdfError] = useState('');

  const invPayments = payments.filter(p => p.invoice_id === invoice.id);
  const invCredits = creditNotes.filter(c => c.invoice_id === invoice.id);
  const invRefunds = refunds.filter(r => r.invoice_id === invoice.id);
  const invLines = lines.filter(l => l.invoice_id === invoice.id).sort((a, b) => a.position - b.position);
  const creditedOn = (lineId) => sumMoney(creditNoteItems.filter(ci => ci.invoice_item_id === lineId).map(ci => ci.amount));
  const leftOn = (line) => sumMoney([line.total, -creditedOn(line.id)]);
  const creditableLines = invLines.filter(l => leftOn(l) > 0);
  const refundedOn = (cnId) => sumMoney(invRefunds.filter(r => r.credit_note_id === cnId).map(r => r.amount));
  const refundMax = (cn) => Math.min(m.refundable, sumMoney([cn.total, -refundedOn(cn.id)]));

  const run = async (call) => {
    setBusy(true); setError('');
    const { error: e } = await call();
    setBusy(false);
    if (e) { setError(e.message || 'Could not save. Please try again.'); return false; }
    setMode(null); setConfirmDelete(null);
    await onChanged();
    return true;
  };

  const pdf = (promise) => { setPdfError(''); promise.catch(() => setPdfError('Could not make the PDF. Please try again.')); };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-start justify-center overflow-y-auto p-0 sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="invoice-money-title"
        className="bg-white sm:rounded-xl shadow-xl w-full max-w-2xl min-h-full sm:min-h-0 sm:my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200">
          <div className="min-w-0">
            <h2 id="invoice-money-title" className="text-lg font-bold text-slate-800">Invoice {invoice.number}</h2>
            <p className="text-xs text-slate-500 truncate">{date(invoice.issue_date)} · {invoice.client_name} · {projectName}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-800 shrink-0"><X size={20} /></button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Summary */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <dl className="text-sm space-y-1 min-w-[220px]">
              <Row label="Invoice total" value={cur(m.total)} />
              {m.credited > 0 && <Row label="Credited" value={`− ${cur(m.credited)}`} />}
              {m.paid > 0 && <Row label="Paid" value={`− ${cur(m.paid)}`} />}
              {m.refunded > 0 && <Row label="Refunded" value={`+ ${cur(m.refunded)}`} />}
              <div className="flex justify-between gap-6 border-t border-slate-200 pt-1 font-semibold text-slate-800">
                <dt>{m.refundable > 0 ? 'Refund due' : 'Still owed'}</dt>
                <dd>{cur(m.refundable > 0 ? m.refundable : Math.max(m.balance, 0))}</dd>
              </div>
            </dl>
            <div className="flex flex-col items-end gap-2">
              <InvoiceStatus money={m} currency={invoice.currency} />
              <button onClick={() => pdf(downloadIssuedInvoice(invoice, lines, projectName, dateFormat))}
                className="flex items-center gap-1 text-sm text-blue-700 hover:text-blue-900"><FileDown size={16} /> Invoice PDF</button>
            </div>
          </div>
          {pdfError && <p className="text-red-600 text-sm" role="alert">{pdfError}</p>}

          {isAdmin && !mode && (
            <div className="flex flex-wrap gap-2">
              {m.balance > 0 && <button onClick={() => { setError(''); setMode('payment'); }} className={primary}>Record payment</button>}
              {creditableLines.length > 0 && <button onClick={() => { setError(''); setMode('credit'); }} className={secondary}>Issue credit note</button>}
            </div>
          )}

          {mode === 'payment' && (
            <MoneyForm title="Record payment" max={m.balance} maxNote={`Still owed: ${cur(m.balance)}`} minDate={invoice.issue_date}
              busy={busy} error={error} onCancel={() => setMode(null)}
              onSave={(f) => run(() => supabase.rpc('record_payment', { p_invoice_id: invoice.id, p_amount: f.amount, p_paid_on: f.date, p_method: f.method, p_note: f.note }))} />
          )}
          {mode?.refund && (
            <MoneyForm title={`Record refund against ${mode.refund.number}`} max={refundMax(mode.refund)}
              maxNote={`You can refund up to ${cur(refundMax(mode.refund))}: what the client paid beyond what they now owe.`}
              minDate={mode.refund.issue_date} busy={busy} error={error} onCancel={() => setMode(null)}
              onSave={(f) => run(() => supabase.rpc('record_refund', { p_credit_note_id: mode.refund.id, p_amount: f.amount, p_refunded_on: f.date, p_method: f.method, p_note: f.note }))} />
          )}
          {mode === 'credit' && (
            <CreditForm invoice={invoice} lines={creditableLines} leftOn={leftOn} cur={cur} busy={busy} error={error}
              priorCredits={invCredits} onCancel={() => setMode(null)}
              onSave={(f) => run(() => supabase.rpc('issue_credit_note', { p_invoice_id: invoice.id, p_lines: f.lines, p_issue_date: f.date, p_reason: f.reason }))} />
          )}

          {/* Payments */}
          <section>
            <h3 className="font-semibold text-slate-800 text-sm mb-1">Payments</h3>
            {invPayments.length === 0 ? <p className="text-sm text-slate-500">None recorded yet.</p> : (
              <ul className="divide-y divide-slate-100 text-sm">
                {invPayments.map(p => (
                  <MoneyRow key={p.id} when={date(p.paid_on)} what={`${p.method}${p.note ? ` · ${p.note}` : ''}`} amount={cur(Number(p.amount))}
                    canDelete={isAdmin && invRefunds.length === 0} deleteLabel="payment"
                    confirming={confirmDelete?.kind === 'payment' && confirmDelete.id === p.id} busy={busy}
                    onAsk={() => setConfirmDelete({ kind: 'payment', id: p.id })} onNo={() => setConfirmDelete(null)}
                    onYes={() => run(() => supabase.rpc('delete_payment', { p_payment_id: p.id }))} />
                ))}
              </ul>
            )}
          </section>

          {/* Credit notes and their refunds */}
          <section>
            <h3 className="font-semibold text-slate-800 text-sm mb-1">Credit notes</h3>
            {invCredits.length === 0 ? <p className="text-sm text-slate-500">None issued.</p> : (
              <ul className="space-y-3 text-sm">
                {invCredits.map(cn => (
                  <li key={cn.id} className="border border-slate-200 rounded-lg px-3 py-2">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-medium text-slate-800">{cn.number}</span>
                      <span className="text-slate-500">{date(cn.issue_date)}</span>
                      <span className="ml-auto font-medium text-slate-800">{cur(Number(cn.total))}</span>
                      <button onClick={() => pdf(downloadCreditNote(cn, invoice, creditNoteItems, projectName, dateFormat))}
                        aria-label={`Download credit note ${cn.number}`} title="Download PDF" className="text-blue-600 hover:text-blue-800"><FileDown size={16} /></button>
                    </div>
                    <p className="text-slate-600 text-xs mt-1">{cn.reason}</p>
                    {invRefunds.filter(r => r.credit_note_id === cn.id).map(r => (
                      <div key={r.id} className="mt-1 pl-3 border-l-2 border-pink-200">
                        <MoneyRow when={date(r.refunded_on)} what={`Refund · ${r.method}${r.note ? ` · ${r.note}` : ''}`} amount={cur(Number(r.amount))}
                          canDelete={isAdmin} deleteLabel="refund"
                          confirming={confirmDelete?.kind === 'refund' && confirmDelete.id === r.id} busy={busy}
                          onAsk={() => setConfirmDelete({ kind: 'refund', id: r.id })} onNo={() => setConfirmDelete(null)}
                          onYes={() => run(() => supabase.rpc('delete_refund', { p_refund_id: r.id }))} />
                      </div>
                    ))}
                    {isAdmin && !mode && refundMax(cn) > 0 && (
                      <button onClick={() => { setError(''); setMode({ refund: cn }); }} className="mt-2 text-sm text-blue-700 hover:text-blue-900">Record refund</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {error && !mode && <p className="text-red-600 text-sm" role="alert">{error}</p>}
          <p className="text-xs text-slate-500">An issued invoice is never changed. To reduce or cancel it, issue a credit note; money paid back is recorded as a refund against a credit note.</p>
        </div>
      </div>
    </div>
  );
}

const Row = ({ label, value }) => (
  <div className="flex justify-between gap-6"><dt className="text-slate-600">{label}</dt><dd className="text-slate-800">{value}</dd></div>
);

function MoneyRow({ when, what, amount, canDelete, deleteLabel, confirming, busy, onAsk, onNo, onYes }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
      <span className="text-slate-600 whitespace-nowrap">{when}</span>
      <span className="text-slate-500 min-w-0 truncate">{what}</span>
      <span className="ml-auto font-medium text-slate-800">{amount}</span>
      {canDelete && (confirming ? (
        <span className="flex items-center gap-2 text-xs">
          Delete this {deleteLabel}?
          <button onClick={onYes} disabled={busy} className="text-red-700 font-medium">Delete</button>
          <button onClick={onNo} className="text-slate-600">Keep</button>
        </span>
      ) : (
        <button onClick={onAsk} aria-label={`Delete ${deleteLabel}`} title={`Delete ${deleteLabel} (entered by mistake)`} className="text-slate-400 hover:text-red-600"><Trash2 size={15} /></button>
      ))}
    </div>
  );
}

// Payment or refund: amount (up to `max`), date, method, note.
function MoneyForm({ title, max, maxNote, minDate, busy, error, onCancel, onSave }) {
  const [f, setF] = useState({ amount: moneyText(max), date: today(), method: 'Bank transfer', note: '' });
  const amount = parseMoney(f.amount);
  const problem = !amount ? 'Enter an amount more than 0.' : amount > max ? 'That’s more than allowed.' : !f.date ? 'Add a date.' : (minDate && f.date < minDate) ? 'That date is too early.' : '';
  return (
    <section className="bg-slate-50 rounded-lg px-4 py-3 space-y-3">
      <h3 className="font-semibold text-slate-800 text-sm">{title}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className={labelClass} htmlFor="money-amount">Amount</label>
          <input id="money-amount" inputMode="decimal" className={inputClass} value={f.amount}
            onChange={(e) => MONEY_TYPING.test(e.target.value) && setF({ ...f, amount: e.target.value })} />
        </div>
        <div>
          <label className={labelClass} htmlFor="money-date">Date</label>
          <DateInput id="money-date" className={inputClass} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </div>
        <div>
          <label className={labelClass} htmlFor="money-method">Method</label>
          <select id="money-method" className={inputClass} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
            {PAY_METHODS.map(x => <option key={x}>{x}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className={labelClass} htmlFor="money-note">Note (optional)</label>
        <input id="money-note" maxLength={500} className={inputClass} placeholder="e.g. bank reference" value={f.note}
          onChange={(e) => setF({ ...f, note: e.target.value })} />
      </div>
      <p className="text-xs text-slate-500">{maxNote}</p>
      {(error || (problem && f.amount !== '')) && <p className="text-red-600 text-sm" role="alert">{error || problem}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className={secondary}>Cancel</button>
        <button onClick={() => onSave({ ...f, amount })} disabled={busy || !!problem} className={primary}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </section>
  );
}

// Credit note: pick lines (full or part amounts), date and reason. VAT follows the invoice.
function CreditForm({ invoice, lines, leftOn, cur, busy, error, priorCredits, onCancel, onSave }) {
  const [picked, setPicked] = useState({}); // invoice_item_id → amount text
  const [f, setF] = useState({ date: today(), reason: '' });
  const vatRate = invoice.vat_rate === null || invoice.vat_rate === undefined ? null : Number(invoice.vat_rate);
  const chosen = Object.entries(picked).map(([id, text]) => ({ id: Number(id), text, amount: parseMoney(text) }));
  const subtotal = sumMoney(chosen.map(c => c.amount || 0));
  // Same as the database: the credit that uses up the invoice takes exactly the VAT that's left.
  const prevSub = sumMoney(priorCredits.map(c => c.subtotal));
  const prevVat = sumMoney(priorCredits.map(c => c.vat));
  const vatLeft = sumMoney([invoice.vat, -prevVat]);
  const vat = vatRate === null ? 0 : sumMoney([prevSub, subtotal]) === Number(invoice.subtotal) ? vatLeft
    : Math.min(Math.round(subtotal * vatRate) / 100, vatLeft);
  const total = sumMoney([subtotal, vat]);
  const lineById = Object.fromEntries(lines.map(l => [l.id, l]));
  const problem = chosen.length === 0 ? 'Tick at least one line.'
    : chosen.some(c => !c.amount) ? 'Each ticked line needs an amount more than 0.'
    : chosen.some(c => c.amount > leftOn(lineById[c.id])) ? 'An amount is more than is left on its line.'
    : !f.reason.trim() ? 'Add a reason.' : !f.date || f.date < invoice.issue_date ? 'Check the date.' : '';
  const toggle = (l) => setPicked(p => { const n = { ...p }; if (n[l.id] !== undefined) delete n[l.id]; else n[l.id] = moneyText(leftOn(l)); return n; });
  const wholeInvoice = () => setPicked(Object.fromEntries(lines.map(l => [l.id, moneyText(leftOn(l))])));
  const fullLines = chosen.filter(c => c.amount === leftOn(lineById[c.id])).length;

  return (
    <section className="bg-slate-50 rounded-lg px-4 py-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-800 text-sm">Issue credit note</h3>
        <button onClick={wholeInvoice} className="text-sm text-blue-700 hover:text-blue-900">Credit everything left</button>
      </div>
      <ul className="border border-slate-200 bg-white rounded-lg divide-y divide-slate-100 max-h-72 overflow-y-auto">
        {lines.map(l => {
          const on = picked[l.id] !== undefined;
          return (
            <li key={l.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <input type="checkbox" checked={on} onChange={() => toggle(l)} aria-label={`Credit ${l.description}`} className="h-4 w-4 accent-blue-600 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-slate-800 truncate">{l.description}</span>
                <span className="block text-xs text-slate-500">Left to credit {cur(leftOn(l))}{leftOn(l) < Number(l.total) ? ` of ${cur(Number(l.total))}` : ''}</span>
              </span>
              <input aria-label={`Amount to credit for ${l.description}`} inputMode="decimal" disabled={!on}
                value={on ? picked[l.id] : ''} placeholder="0.00"
                onChange={(e) => MONEY_TYPING.test(e.target.value) && setPicked({ ...picked, [l.id]: e.target.value })}
                className="w-24 px-2 py-1 border border-slate-300 rounded text-sm text-right disabled:bg-slate-100" />
            </li>
          );
        })}
      </ul>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-3">
          <div>
            <label className={labelClass} htmlFor="credit-date">Issue date</label>
            <DateInput id="credit-date" className={inputClass} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </div>
          <div>
            <label className={labelClass} htmlFor="credit-reason">Reason (shown on the credit note)</label>
            <textarea id="credit-reason" rows={2} maxLength={1000} className={inputClass} placeholder="e.g. Venue hire cancelled"
              value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
          </div>
        </div>
        <dl className="bg-white rounded-lg px-4 py-3 text-sm self-start space-y-1 border border-slate-200">
          <Row label="Subtotal" value={cur(subtotal)} />
          {vatRate !== null && <Row label={`VAT (${vatRate}%)`} value={cur(vat)} />}
          <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold text-slate-800"><dt>Total credited</dt><dd>{cur(total)}</dd></div>
        </dl>
      </div>
      <p className="text-xs text-slate-500">
        Credit notes can’t be changed once issued. {fullLines > 0
          ? `${fullLines === 1 ? 'The line' : `${fullLines} lines`} credited in full will go back to “not yet invoiced”, so ${fullLines === 1 ? 'it' : 'they'} can be billed again.`
          : 'Lines credited in full go back to “not yet invoiced”; part-credited lines stay invoiced.'}
      </p>
      {(error || (problem && chosen.length > 0)) && <p className="text-red-600 text-sm" role="alert">{error || problem}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className={secondary}>Cancel</button>
        <button onClick={() => onSave({ date: f.date, reason: f.reason.trim(), lines: chosen.map(c => ({ invoice_item_id: c.id, amount: c.amount })) })}
          disabled={busy || !!problem} className={primary}>{busy ? 'Issuing…' : `Issue credit note${total > 0 ? ` for ${cur(total)}` : ''}`}</button>
      </div>
    </section>
  );
}
