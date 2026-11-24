import React, { useEffect, useState } from 'react';
import { X, FileDown } from 'lucide-react';
import { formatMoney, sumMoney } from './money';
import { invoiceTotals, preloadPdfLibrary, downloadIssuedInvoice } from './invoicePdf';
import { useDates, DateInput, DATE_FORMATS } from './dates';

const inputClass = 'px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-full';
const labelClass = 'block text-xs font-medium text-slate-600 mb-1';

const isoDate = (d) => {
  const copy = new Date(d);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 10);
};
const addDays = (days) => isoDate(new Date(Date.now() + days * 86400000));
const formatNumber = (n) => `INV-${String(n).padStart(4, '0')}`;
const hoursText = (h) => String(Math.round(h * 100) / 100);

const emptySeller = { business_name: '', address: '', email: '', payment_details: '', default_vat_rate: 20, next_invoice_number: 1 };

// Logged time is billed the way the database bills it: one line per hourly rate, hours added up first.
export const timeLines = (entries, projectRate) => {
  const byRate = new Map();
  entries.forEach(t => {
    const rate = t.hourly_rate || projectRate;
    byRate.set(rate, [...(byRate.get(rate) || []), t]);
  });
  return [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate, list]) => {
    const hours = sumMoney(list.map(t => t.hours));
    return { rate, hours, total: Math.round(hours * rate * 100) / 100 };
  });
};

// The one-click invoice: a pre-filled preview of everything not yet invoiced on the project.
// Downloading records the invoice (and bills any ticked logged time), so the next one picks up only new items.
// Your business details are asked for only the first time, then saved for the organisation.
export default function InvoiceDialog({ project, categories, items, unbilledTime, supabase, orgId, onIssued, onClose, onDateFormatChange }) {
  const { fmt, date, dates } = useDates();
  const [formatError, setFormatError] = useState('');
  const money = (n) => formatMoney(n, project.currency);
  const projectRate = Number(project.hourly_rate) || 0;
  const [loading, setLoading] = useState(true);
  const [seller, setSeller] = useState(emptySeller);
  const [editingSeller, setEditingSeller] = useState(false);
  const [client, setClient] = useState({ name: project.client_name || '', address: project.client_address || '' });
  const [invoice, setInvoice] = useState({ number: '', issueDate: isoDate(new Date()), dueDate: addDays(14), notes: '' });
  const [suggestedNumber, setSuggestedNumber] = useState('');
  const [excluded, setExcluded] = useState([]); // cost item ids left off
  const [excludedTime, setExcludedTime] = useState([]); // time entry ids left off
  const [vatOn, setVatOn] = useState(true);
  const [vatRate, setVatRate] = useState('20');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('org_invoice_settings').select('*').eq('org_id', orgId).maybeSingle();
      const s = data ? { ...emptySeller, ...data } : emptySeller;
      setSeller(s);
      setEditingSeller(!s.business_name);
      // VAT is added by default, at the saved rate (20% unless changed).
      const defaultRate = Number(s.default_vat_rate) > 0 ? Number(s.default_vat_rate) : 20;
      setVatRate(String(defaultRate));
      setVatOn(true);
      const next = formatNumber(s.next_invoice_number);
      setSuggestedNumber(next);
      setInvoice(inv => ({ ...inv, number: next }));
      setLoading(false);
    })();
  }, [supabase, orgId]);

  // Admins choose the organisation's date format (UK or US). It applies at once, for everyone.
  const changeDateFormat = async (code) => {
    if (!DATE_FORMATS[code] || code === fmt) return;
    setFormatError('');
    const { error: saveError } = await supabase.from('org_settings')
      .upsert({ org_id: orgId, date_format: code, updated_at: new Date().toISOString() }, { onConflict: 'org_id' });
    if (saveError) return setFormatError('Could not save the date format. Please try again.');
    onDateFormatChange?.(code);
  };

  // Close with Escape.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const categoryName = (id) => categories.find(c => c.id === id)?.name || '';
  const chosenItems = items.filter(i => !excluded.includes(i.id));
  const chosenTime = unbilledTime.filter(t => !excludedTime.includes(t.id));
  const chosenTimeLines = timeLines(chosenTime, projectRate);
  const missingRate = chosenTime.some(t => !(t.hourly_rate || projectRate));
  const lineCount = items.length + unbilledTime.length;
  const chosenCount = chosenItems.length + chosenTime.length;

  const rate = Number(vatRate);
  const vatRateValid = /^\d{1,2}(\.\d{1,2})?$|^100$/.test(vatRate) && rate >= 0 && rate <= 100;
  const totals = invoiceTotals([...chosenItems, ...chosenTimeLines], vatOn && vatRateValid, rate);

  const toggle = (list, setList, id) => setList(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  const setAll = (on) => {
    setExcluded(on ? [] : items.map(i => i.id));
    setExcludedTime(on ? [] : unbilledTime.map(t => t.id));
  };

  const download = async () => {
    if (!seller.business_name.trim()) { setEditingSeller(true); return setError('Add your business name (it goes at the top of the invoice).'); }
    if (!client.name.trim()) return setError('Add who the invoice is for (the client’s name).');
    if (chosenCount === 0) return setError('Tick at least one item to invoice.');
    if (missingRate) return setError('Some ticked hours have no hourly rate. Set one on the project, or untick them.');
    if (vatOn && !vatRateValid) return setError('VAT rate must be between 0 and 100, with up to 2 decimal places.');
    if (!invoice.number.trim()) return setError('Add an invoice number.');
    if (!invoice.issueDate) return setError('Add an issue date.');
    if (invoice.dueDate && invoice.dueDate < invoice.issueDate) return setError('The due date can’t be before the issue date.');
    setError('');
    setBusy(true);
    try {
      // Save your details for next time. A VAT rate you use becomes the default; leaving VAT off
      // for one invoice doesn't change it.
      const saved = await supabase.from('org_invoice_settings').upsert({
        org_id: orgId,
        business_name: seller.business_name.trim(),
        address: seller.address.trim(),
        email: seller.email.trim(),
        payment_details: seller.payment_details.trim(),
        default_vat_rate: vatOn && vatRateValid && rate > 0 ? rate : (Number(seller.default_vat_rate) > 0 ? Number(seller.default_vat_rate) : 20),
        updated_at: new Date().toISOString()
      }, { onConflict: 'org_id' });
      if (saved.error) throw new Error('Could not save your business details. Please try again.');

      await preloadPdfLibrary();

      // Record the invoice. Leaving the suggested number means "the next in the sequence".
      const typed = invoice.number.trim();
      const issued = await supabase.rpc('issue_invoice', {
        p_project_id: project.id,
        p_item_ids: chosenItems.map(i => i.id),
        p_entry_ids: chosenTime.map(t => t.id),
        p_number: typed === suggestedNumber ? null : typed,
        p_issue_date: invoice.issueDate,
        p_due_date: invoice.dueDate || null,
        p_vat_rate: vatOn && vatRateValid ? rate : null,
        p_notes: invoice.notes,
        p_client_name: client.name.trim(),
        p_client_address: client.address.trim()
      });
      if (issued.error) throw new Error(issued.error.message || 'Could not create the invoice. Please try again.');

      // Download exactly what was recorded.
      const [inv, lines] = await Promise.all([
        supabase.from('invoices').select('*').eq('id', issued.data).single(),
        supabase.from('invoice_items').select('*').eq('invoice_id', issued.data)
      ]);
      if (inv.error || lines.error) {
        setDone('The invoice was recorded, but the PDF couldn’t be made. Download it from the project’s Invoices list.');
      } else {
        try {
          await downloadIssuedInvoice(inv.data, lines.data, project.name, fmt);
          setDone(`Downloaded invoice ${inv.data.number} (${money(Number(inv.data.total))}).`);
        } catch {
          setDone(`Invoice ${inv.data.number} was recorded, but the PDF couldn’t be made. Download it from the project’s Invoices list.`);
        }
      }
      onIssued();
    } catch (e) {
      setError(e.message || 'Could not create the invoice. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const itemRow = (key, checked, onToggle, label, detail, qty, amount) => (
    <li key={key}>
      <label className="flex items-center gap-3 px-4 py-2 text-sm cursor-pointer hover:bg-slate-50">
        <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Include ${label}`} className="h-4 w-4 accent-blue-600" />
        <span className="flex-1">
          <span className="text-slate-800">{label}</span>
          <span className="text-slate-500 text-xs"> · {detail}</span>
        </span>
        <span className="text-slate-500 whitespace-nowrap">{qty}</span>
        <span className="text-slate-800 font-medium whitespace-nowrap w-24 text-right">{amount}</span>
      </label>
    </li>
  );

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-start justify-center overflow-y-auto p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="invoice-title"
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 id="invoice-title" className="text-lg font-bold text-slate-800">Generate invoice: {project.name}</h2>
          <button onClick={onClose} aria-label="Close invoice" className="text-slate-500 hover:text-slate-800"><X size={20} /></button>
        </div>

        {loading ? (
          <p className="px-6 py-8 text-sm text-slate-500">Loading…</p>
        ) : done ? (
          <p className="px-6 py-8 text-sm text-green-700" role="status">{done}</p>
        ) : (
          <div className="px-6 py-5 space-y-6">
            {/* Your details: asked for the first time only */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-slate-800">Your details</h3>
                {!editingSeller && (
                  <button onClick={() => setEditingSeller(true)} className="text-sm text-blue-700 hover:text-blue-900">Edit</button>
                )}
              </div>
              {editingSeller ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass} htmlFor="seller-name">Business name</label>
                    <input id="seller-name" className={inputClass} value={seller.business_name}
                      onChange={(e) => setSeller({ ...seller, business_name: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="seller-email">Email (optional)</label>
                    <input id="seller-email" className={inputClass} value={seller.email}
                      onChange={(e) => setSeller({ ...seller, email: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="seller-address">Address (optional)</label>
                    <textarea id="seller-address" rows={3} className={inputClass} value={seller.address}
                      onChange={(e) => setSeller({ ...seller, address: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="seller-payment">Payment details (optional)</label>
                    <textarea id="seller-payment" rows={3} className={inputClass} placeholder="How the client should pay you"
                      value={seller.payment_details} onChange={(e) => setSeller({ ...seller, payment_details: e.target.value })} />
                  </div>
                  <p className="text-xs text-slate-500 sm:col-span-2">Saved for your organisation when you download, and reused on every invoice.</p>
                </div>
              ) : (
                <div className="text-sm text-slate-700 bg-slate-50 rounded-lg px-4 py-3">
                  <strong>{seller.business_name}</strong>
                  {seller.address && <span className="text-slate-500"> · {seller.address.split('\n').filter(Boolean).join(', ')}</span>}
                  {seller.email && <span className="text-slate-500"> · {seller.email}</span>}
                  {seller.payment_details && <div className="text-slate-500 text-xs mt-1">Payment details saved</div>}
                </div>
              )}
              {/* The organisation's date format: used everywhere in the app and on invoices. Saved straight away. */}
              <div className="flex flex-wrap items-center gap-2 mt-3 text-sm text-slate-600">
                <label htmlFor="date-format">Date format</label>
                <select id="date-format" value={fmt} onChange={(e) => changeDateFormat(e.target.value)}
                  className="px-2 py-1 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {Object.entries(DATE_FORMATS).map(([code, f]) => <option key={code} value={code}>{f.label} ({f.example})</option>)}
                </select>
                <span className="text-xs text-slate-500">For everyone in your organisation, in the app and on invoices.</span>
                {formatError && <span className="text-xs text-red-600" role="alert">{formatError}</span>}
              </div>
            </section>

            {/* Client (from the project) and invoice details */}
            <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelClass} htmlFor="client-name">Bill to</label>
                <input id="client-name" className={inputClass} placeholder="Client’s name" value={client.name}
                  onChange={(e) => setClient({ ...client, name: e.target.value })} />
                <textarea aria-label="Client address" rows={3} className={`${inputClass} mt-2`} placeholder="Client’s address (optional)"
                  value={client.address} onChange={(e) => setClient({ ...client, address: e.target.value })} />
                <p className="text-xs text-slate-500 mt-1">Saved on the project for next time.</p>
              </div>
              <div className="grid grid-cols-2 gap-3 content-start">
                <div className="col-span-2">
                  <label className={labelClass} htmlFor="invoice-number">Invoice number</label>
                  <input id="invoice-number" className={inputClass} value={invoice.number}
                    onChange={(e) => setInvoice({ ...invoice, number: e.target.value })} />
                </div>
                <div>
                  <label className={labelClass} htmlFor="issue-date">Issue date</label>
                  <DateInput id="issue-date" className={inputClass} value={invoice.issueDate}
                    onChange={(e) => setInvoice({ ...invoice, issueDate: e.target.value })} />
                </div>
                <div>
                  <label className={labelClass} htmlFor="due-date">Due date</label>
                  <DateInput id="due-date" className={inputClass} value={invoice.dueDate}
                    onChange={(e) => setInvoice({ ...invoice, dueDate: e.target.value })} />
                </div>
              </div>
            </section>

            {/* Everything not yet invoiced */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-slate-800">Not yet invoiced</h3>
                <span className="text-sm space-x-3">
                  <button onClick={() => setAll(true)} className="text-blue-700 hover:text-blue-900">Tick all</button>
                  <button onClick={() => setAll(false)} className="text-blue-700 hover:text-blue-900">Untick all</button>
                </span>
              </div>
              {lineCount === 0 ? (
                <p className="text-sm text-slate-500">Nothing new to invoice: every cost item and all logged time is already on an invoice.</p>
              ) : (
                <ul className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-80 overflow-y-auto">
                  {items.map(item => itemRow(`item-${item.id}`, !excluded.includes(item.id), () => toggle(excluded, setExcluded, item.id),
                    dates(item.description), `${categoryName(item.category_id)} · ${item.status}`,
                    `${item.quantity} × ${money(item.unit_cost)}`, money(item.total)))}
                  {unbilledTime.map(t => {
                    const r = t.hourly_rate || projectRate;
                    return itemRow(`time-${t.id}`, !excludedTime.includes(t.id), () => toggle(excludedTime, setExcludedTime, t.id),
                      `Logged time ${date(t.entry_date)}`, t.note ? `${t.note} · billed when you download` : 'billed when you download',
                      r ? `${hoursText(t.hours)} h × ${money(r)}` : `${hoursText(t.hours)} h · no rate`, r ? money(Math.round(t.hours * r * 100) / 100) : '—');
                  })}
                </ul>
              )}
              {chosenTime.length > 0 && (
                <p className="text-xs text-slate-500 mt-2">
                  Ticked hours become {chosenTimeLines.length === 1 ? 'one line' : `${chosenTimeLines.length} lines (one per rate)`} on the invoice, in the project’s Staffing category.
                </p>
              )}
            </section>

            {/* VAT, notes and totals */}
            <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={vatOn} onChange={(e) => setVatOn(e.target.checked)} className="h-4 w-4 accent-blue-600" />
                  Add VAT at
                  <input aria-label="VAT rate" inputMode="decimal" value={vatRate} disabled={!vatOn}
                    onChange={(e) => /^\d{0,3}(\.\d{0,2})?$/.test(e.target.value) && setVatRate(e.target.value)}
                    className="w-16 px-2 py-1 border border-slate-300 rounded text-sm disabled:bg-slate-100" />
                  %
                </label>
                <div>
                  <label className={labelClass} htmlFor="invoice-notes">Notes (optional)</label>
                  <textarea id="invoice-notes" rows={3} maxLength={1000} className={inputClass} placeholder="e.g. Thank you for your business"
                    value={invoice.notes} onChange={(e) => setInvoice({ ...invoice, notes: e.target.value })} />
                </div>
              </div>
              <dl className="bg-slate-50 rounded-lg px-4 py-3 text-sm self-start space-y-1">
                <div className="flex justify-between"><dt className="text-slate-600">{chosenCount} of {lineCount} ticked</dt><dd /></div>
                <div className="flex justify-between"><dt className="text-slate-600">Subtotal</dt><dd>{money(totals.subtotal)}</dd></div>
                {vatOn && <div className="flex justify-between"><dt className="text-slate-600">VAT ({vatRateValid ? rate : '?'}%)</dt><dd>{money(totals.vat)}</dd></div>}
                <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold text-slate-800"><dt>Total due</dt><dd>{money(totals.total)}</dd></div>
              </dl>
            </section>

            {error && <p className="text-red-600 text-sm" role="alert">{error}</p>}
          </div>
        )}

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200">
          <button onClick={onClose} className="bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm hover:bg-slate-300">Close</button>
          {!done && (
            <button onClick={download} disabled={busy || loading || lineCount === 0}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-60">
              <FileDown size={16} /> {busy ? 'Creating…' : 'Download PDF'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
