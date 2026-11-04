import React, { useEffect, useState } from 'react';
import { X, FileDown } from 'lucide-react';
import { formatMoney } from './money';
import { buildInvoicePdf, invoiceFileName, invoiceTotals } from './invoicePdf';

const inputClass = 'px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-full';
const labelClass = 'block text-xs font-medium text-slate-600 mb-1';

const isoDate = (d) => {
  const copy = new Date(d);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 10);
};
const addDays = (days) => isoDate(new Date(Date.now() + days * 86400000));
const formatNumber = (n) => `INV-${String(n).padStart(4, '0')}`;

const emptySeller = { business_name: '', address: '', email: '', payment_details: '', default_vat_rate: 20, next_invoice_number: 1 };

// Creates a PDF invoice from a project's cost items.
// Your business details are saved once for the organisation and reused on every invoice.
export default function InvoiceDialog({ project, categories, items, supabase, orgId, onClose }) {
  const money = (n) => formatMoney(n, project.currency);
  const [loading, setLoading] = useState(true);
  const [seller, setSeller] = useState(emptySeller);
  const [editingSeller, setEditingSeller] = useState(false);
  const [client, setClient] = useState({ name: '', details: '' });
  const [invoice, setInvoice] = useState({ number: '', issueDate: isoDate(new Date()), dueDate: addDays(14), notes: '' });
  const [suggestedNumber, setSuggestedNumber] = useState('');
  const [excluded, setExcluded] = useState([]); // item ids left off the invoice
  const [vatOn, setVatOn] = useState(false);
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
      setVatRate(String(Number(s.default_vat_rate)));
      const next = formatNumber(s.next_invoice_number);
      setSuggestedNumber(next);
      setInvoice(inv => ({ ...inv, number: next }));
      setLoading(false);
    })();
  }, [supabase, orgId]);

  // Close with Escape.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const categoryName = (id) => categories.find(c => c.id === id)?.name || '';
  const lines = items
    .filter(i => !excluded.includes(i.id))
    .map(i => ({ ...i, category: categoryName(i.category_id) }));
  const rate = Number(vatRate);
  const vatRateValid = /^\d{1,2}(\.\d{1,2})?$|^100$/.test(vatRate) && rate >= 0 && rate <= 100;
  const totals = invoiceTotals(lines, vatOn && vatRateValid, rate);

  const toggleItem = (id) => setExcluded(excluded.includes(id) ? excluded.filter(x => x !== id) : [...excluded, id]);
  const setAll = (on) => setExcluded(on ? [] : items.map(i => i.id));

  const download = async () => {
    if (!seller.business_name.trim()) { setEditingSeller(true); return setError('Add your business name (it goes at the top of the invoice).'); }
    if (!client.name.trim()) return setError('Add who the invoice is for (the client’s name).');
    if (lines.length === 0) return setError('Tick at least one item to invoice.');
    if (vatOn && !vatRateValid) return setError('VAT rate must be between 0 and 100, with up to 2 decimal places.');
    if (!invoice.number.trim()) return setError('Add an invoice number.');
    if (invoice.dueDate && invoice.issueDate && invoice.dueDate < invoice.issueDate) return setError('The due date can’t be before the issue date.');
    setError('');
    setBusy(true);
    try {
      // Save your details for next time.
      const saved = await supabase.from('org_invoice_settings').upsert({
        org_id: orgId,
        business_name: seller.business_name.trim(),
        address: seller.address.trim(),
        email: seller.email.trim(),
        payment_details: seller.payment_details.trim(),
        default_vat_rate: vatRateValid ? rate : Number(seller.default_vat_rate),
        updated_at: new Date().toISOString()
      }, { onConflict: 'org_id' });
      if (saved.error) throw new Error('Could not save your business details. Please try again.');

      // Use the next number in the sequence unless you typed your own.
      let number = invoice.number.trim();
      const usedSequence = number === suggestedNumber;
      if (usedSequence) {
        const claimed = await supabase.rpc('claim_invoice_number');
        if (claimed.error) throw new Error('Could not get an invoice number. Please try again.');
        number = claimed.data;
      }

      const finalInvoice = { ...invoice, number };
      const doc = await buildInvoicePdf({
        seller: { ...seller, business_name: seller.business_name.trim() },
        client: { name: client.name.trim(), details: client.details },
        invoice: finalInvoice,
        project,
        lines,
        vatOn: vatOn && vatRateValid,
        vatRate: rate
      });
      doc.save(invoiceFileName(finalInvoice, project));
      setDone(`Downloaded invoice ${number} (${money(totals.total)}).`);
      setEditingSeller(false);
      // Ready for another invoice: suggest the following number in the sequence.
      const claimedDigits = /^INV-(\d+)$/.exec(number);
      if (usedSequence && claimedDigits) {
        const next = formatNumber(Number(claimedDigits[1]) + 1);
        setSuggestedNumber(next);
        setInvoice(inv => ({ ...inv, number: next }));
      }
    } catch (e) {
      setError(e.message || 'Could not create the invoice. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-start justify-center overflow-y-auto p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="invoice-title"
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 id="invoice-title" className="text-lg font-bold text-slate-800">Create invoice: {project.name}</h2>
          <button onClick={onClose} aria-label="Close invoice" className="text-slate-500 hover:text-slate-800"><X size={20} /></button>
        </div>

        {loading ? (
          <p className="px-6 py-8 text-sm text-slate-500">Loading…</p>
        ) : (
          <div className="px-6 py-5 space-y-6">
            {/* Your details */}
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
            </section>

            {/* Client and invoice details */}
            <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelClass} htmlFor="client-name">Bill to</label>
                <input id="client-name" className={inputClass} placeholder="Client’s name" value={client.name}
                  onChange={(e) => setClient({ ...client, name: e.target.value })} />
                <textarea aria-label="Client address or email" rows={3} className={`${inputClass} mt-2`} placeholder="Address or email (optional)"
                  value={client.details} onChange={(e) => setClient({ ...client, details: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3 content-start">
                <div className="col-span-2">
                  <label className={labelClass} htmlFor="invoice-number">Invoice number</label>
                  <input id="invoice-number" className={inputClass} value={invoice.number}
                    onChange={(e) => setInvoice({ ...invoice, number: e.target.value })} />
                </div>
                <div>
                  <label className={labelClass} htmlFor="issue-date">Issue date</label>
                  <input id="issue-date" type="date" className={inputClass} value={invoice.issueDate}
                    onChange={(e) => setInvoice({ ...invoice, issueDate: e.target.value })} />
                </div>
                <div>
                  <label className={labelClass} htmlFor="due-date">Due date</label>
                  <input id="due-date" type="date" className={inputClass} value={invoice.dueDate}
                    onChange={(e) => setInvoice({ ...invoice, dueDate: e.target.value })} />
                </div>
              </div>
            </section>

            {/* Items */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-slate-800">Items</h3>
                <span className="text-sm space-x-3">
                  <button onClick={() => setAll(true)} className="text-blue-700 hover:text-blue-900">Tick all</button>
                  <button onClick={() => setAll(false)} className="text-blue-700 hover:text-blue-900">Untick all</button>
                </span>
              </div>
              {items.length === 0 ? (
                <p className="text-sm text-slate-500">This project has no cost items yet. Add some in its Costs first.</p>
              ) : (
                <ul className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-72 overflow-y-auto">
                  {items.map(item => (
                    <li key={item.id}>
                      <label className="flex items-center gap-3 px-4 py-2 text-sm cursor-pointer hover:bg-slate-50">
                        <input type="checkbox" checked={!excluded.includes(item.id)} onChange={() => toggleItem(item.id)}
                          aria-label={`Include ${item.description}`} className="h-4 w-4 accent-blue-600" />
                        <span className="flex-1">
                          <span className="text-slate-800">{item.description}</span>
                          <span className="text-slate-500 text-xs"> · {categoryName(item.category_id)} · {item.status}</span>
                        </span>
                        <span className="text-slate-500 whitespace-nowrap">{item.quantity} × {money(item.unit_cost)}</span>
                        <span className="text-slate-800 font-medium whitespace-nowrap w-24 text-right">{money(item.total)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
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
                  <textarea id="invoice-notes" rows={3} className={inputClass} placeholder="e.g. Thank you for your business"
                    value={invoice.notes} onChange={(e) => setInvoice({ ...invoice, notes: e.target.value })} />
                </div>
              </div>
              <dl className="bg-slate-50 rounded-lg px-4 py-3 text-sm self-start space-y-1">
                <div className="flex justify-between"><dt className="text-slate-600">{lines.length} of {items.length} items</dt><dd /></div>
                <div className="flex justify-between"><dt className="text-slate-600">Subtotal</dt><dd>{money(totals.subtotal)}</dd></div>
                {vatOn && <div className="flex justify-between"><dt className="text-slate-600">VAT ({vatRateValid ? rate : '?'}%)</dt><dd>{money(totals.vat)}</dd></div>}
                <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold text-slate-800"><dt>Total due</dt><dd>{money(totals.total)}</dd></div>
              </dl>
            </section>

            {error && <p className="text-red-600 text-sm" role="alert">{error}</p>}
            {done && <p className="text-green-700 text-sm" role="status">{done}</p>}
          </div>
        )}

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200">
          <button onClick={onClose} className="bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm hover:bg-slate-300">Close</button>
          <button onClick={download} disabled={busy || loading || items.length === 0}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-60">
            <FileDown size={16} /> {busy ? 'Creating…' : 'Download PDF'}
          </button>
        </div>
      </div>
    </div>
  );
}
