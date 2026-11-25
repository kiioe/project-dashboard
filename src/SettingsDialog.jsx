import React, { useEffect, useState } from 'react';
import { X, ArrowLeft, Settings } from 'lucide-react';
import { DATE_FORMATS, DEFAULT_DATE_FORMAT } from './dates';

// Organisation settings (agreed 25 Nov 2026). Admins only: members don't see the gear at all.
// One place for the date format and the business details used on invoices; a home for future settings.
// Desktop: a panel over the dashboard. Phone: a full-screen page with a back arrow.
// Saved with one Save button; closing with unsaved changes asks first.
// The next invoice number is shown, not editable (a number can still be typed on a single invoice).

const inputClass = 'px-3 py-2 border border-slate-300 rounded-lg text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-full';
const labelClass = 'block text-xs font-medium text-slate-600 mb-1';
const formatNumber = (n) => `INV-${String(n).padStart(4, '0')}`;
const VAT_TYPING = /^\d{0,3}(\.\d{0,2})?$/;

const emptyForm = { date_format: DEFAULT_DATE_FORMAT, business_name: '', address: '', email: '', payment_details: '', vat: '20' };
const LIMITS = { business_name: 120, address: 500, email: 200, payment_details: 500 };

// The header button that opens Settings. Render it only for admins.
export function SettingsLink({ phone = false, onClick }) {
  return phone ? (
    <button onClick={onClick} aria-label="Settings"
      className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-slate-600 active:bg-slate-100">
      <Settings size={20} aria-hidden="true" />
    </button>
  ) : (
    <button onClick={onClick}
      className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 px-3 py-2 rounded-lg hover:bg-white/70">
      <Settings size={18} aria-hidden="true" />
      Settings
    </button>
  );
}

export default function SettingsDialog({ supabase, orgId, phone = false, onDateFormatChange, onClose }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saved, setSaved] = useState(emptyForm); // what's in the database
  const [form, setForm] = useState(emptyForm);
  const [nextNumber, setNextNumber] = useState(1);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    (async () => {
      const [general, invoice] = await Promise.all([
        supabase.from('org_settings').select('date_format').eq('org_id', orgId).maybeSingle(),
        supabase.from('org_invoice_settings').select('*').eq('org_id', orgId).maybeSingle()
      ]);
      if (general.error || invoice.error) {
        setLoadError('Could not load your settings. Please close and try again.');
        setLoading(false);
        return;
      }
      const s = invoice.data || {};
      const values = {
        date_format: DATE_FORMATS[general.data?.date_format] ? general.data.date_format : DEFAULT_DATE_FORMAT,
        business_name: s.business_name || '',
        address: s.address || '',
        email: s.email || '',
        payment_details: s.payment_details || '',
        vat: String(Number(s.default_vat_rate) > 0 ? Number(s.default_vat_rate) : 20)
      };
      setSaved(values);
      setForm(values);
      setNextNumber(s.next_invoice_number || 1);
      setLoading(false);
    })();
  }, [supabase, orgId]);

  const dirty = Object.keys(emptyForm).some(k => form[k] !== saved[k]);
  const set = (key, value) => { setForm(f => ({ ...f, [key]: value })); setStatus(''); setError(''); };

  const requestClose = () => {
    if (dirty && !busy) setConfirmClose(true);
    else onClose();
  };

  // Close with Escape (asks first if there are unsaved changes).
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // The page behind doesn't scroll while Settings is open.
  useEffect(() => {
    document.body.dataset.sheetOpen = '1';
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { delete document.body.dataset.sheetOpen; document.body.style.overflow = prev; };
  }, []);

  const vatRate = Number(form.vat);
  const vatValid = /^\d{1,3}(\.\d{1,2})?$/.test(form.vat) && vatRate > 0 && vatRate <= 100;

  const save = async () => {
    if (!vatValid) return setError('Default VAT rate must be more than 0 and up to 100, with up to 2 decimal places.');
    const tooLong = Object.entries(LIMITS).find(([k, max]) => form[k].trim().length > max);
    if (tooLong) return setError('One of the business details is too long.');
    setError('');
    setBusy(true);
    try {
      const now = new Date().toISOString();
      if (form.date_format !== saved.date_format) {
        const r = await supabase.from('org_settings')
          .upsert({ org_id: orgId, date_format: form.date_format, updated_at: now }, { onConflict: 'org_id' });
        if (r.error) throw new Error('Could not save the date format. Please try again.');
        onDateFormatChange?.(form.date_format);
      }
      const invoiceChanged = ['business_name', 'address', 'email', 'payment_details', 'vat'].some(k => form[k] !== saved[k]);
      if (invoiceChanged) {
        // Leaves next_invoice_number alone (a new row starts at INV-0001).
        const r = await supabase.from('org_invoice_settings').upsert({
          org_id: orgId,
          business_name: form.business_name.trim(),
          address: form.address.trim(),
          email: form.email.trim(),
          payment_details: form.payment_details.trim(),
          default_vat_rate: Math.round(vatRate * 100) / 100,
          updated_at: now
        }, { onConflict: 'org_id' });
        if (r.error) throw new Error('Could not save your business details. Please try again.');
      }
      const clean = {
        ...form,
        business_name: form.business_name.trim(), address: form.address.trim(),
        email: form.email.trim(), payment_details: form.payment_details.trim(),
        vat: String(Math.round(vatRate * 100) / 100)
      };
      setSaved(clean);
      setForm(clean);
      setStatus('Saved');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const body = loading ? (
    <p className="py-8 text-sm text-slate-500">Loading…</p>
  ) : loadError ? (
    <p className="py-8 text-sm text-red-600" role="alert">{loadError}</p>
  ) : (
    <div className="space-y-6">
      <section>
        <h3 className="font-semibold text-slate-800 mb-2">General</h3>
        <label className={labelClass} htmlFor="settings-date-format">Date format</label>
        <select id="settings-date-format" value={form.date_format} onChange={(e) => set('date_format', e.target.value)}
          className={inputClass.replace('w-full', 'w-full sm:w-auto')}>
          {Object.entries(DATE_FORMATS).map(([code, f]) => <option key={code} value={code}>{f.label} ({f.example})</option>)}
        </select>
        <p className="text-xs text-slate-500 mt-1">For everyone in your organisation, in the app and on invoices.</p>
      </section>

      <section>
        <h3 className="font-semibold text-slate-800 mb-1">Invoice details</h3>
        <p className="text-xs text-slate-500 mb-3">Shown on every invoice. You can also change them in the invoice preview.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelClass} htmlFor="settings-name">Business name</label>
            <input id="settings-name" className={inputClass} maxLength={LIMITS.business_name} value={form.business_name}
              onChange={(e) => set('business_name', e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="settings-email">Email (optional)</label>
            <input id="settings-email" type="email" className={inputClass} maxLength={LIMITS.email} value={form.email}
              onChange={(e) => set('email', e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="settings-address">Address (optional)</label>
            <textarea id="settings-address" rows={3} className={inputClass} maxLength={LIMITS.address} value={form.address}
              onChange={(e) => set('address', e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="settings-payment">Payment details (optional)</label>
            <textarea id="settings-payment" rows={3} className={inputClass} maxLength={LIMITS.payment_details}
              placeholder="How the client should pay you" value={form.payment_details}
              onChange={(e) => set('payment_details', e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="settings-vat">Default VAT rate</label>
            <span className="flex items-center gap-2">
              <input id="settings-vat" inputMode="decimal" className={inputClass.replace('w-full', 'w-24')} value={form.vat}
                onChange={(e) => VAT_TYPING.test(e.target.value) && set('vat', e.target.value)} />
              <span className="text-sm text-slate-600">%</span>
            </span>
            <p className="text-xs text-slate-500 mt-1">Ticked on every new invoice. You can untick it for one invoice.</p>
          </div>
          <div>
            <span className={labelClass}>Next invoice number</span>
            <p className="text-sm font-medium text-slate-800 py-2">{formatNumber(nextNumber)}</p>
            <p className="text-xs text-slate-500">Set automatically when an invoice is issued. Numbers already used are skipped.</p>
          </div>
        </div>
      </section>

      {error && <p className="text-red-600 text-sm" role="alert">{error}</p>}
    </div>
  );

  const unsavedBar = confirmClose && (
    <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm" role="alert">
      <span className="text-amber-900">You have unsaved changes.</span>
      <span className="flex gap-2">
        <button onClick={() => setConfirmClose(false)} className="px-3 min-h-[40px] rounded-lg bg-white border border-slate-300 text-slate-700">Keep editing</button>
        <button onClick={onClose} className="px-3 min-h-[40px] rounded-lg bg-amber-600 text-white">Discard</button>
      </span>
    </div>
  );

  const saveButton = !loading && !loadError && (
    <button onClick={save} disabled={busy}
      className="bg-blue-600 text-white px-4 min-h-[40px] rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60">
      {busy ? 'Saving…' : 'Save'}
    </button>
  );
  const statusText = status && <span className="text-sm text-green-700" role="status">{status}</span>;

  if (phone) {
    return (
      <div className="fixed inset-0 z-50 bg-white flex flex-col" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="flex items-center justify-between gap-2 px-2 border-b border-slate-200 bg-white"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <button onClick={requestClose} aria-label="Back" className="w-11 h-11 flex items-center justify-center text-slate-700">
            <ArrowLeft size={22} aria-hidden="true" />
          </button>
          <h2 id="settings-title" className="flex-1 text-lg font-semibold text-slate-900">Settings</h2>
          <div className="flex items-center gap-2 pr-2">{statusText}{saveButton}</div>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4" style={{ paddingBottom: 'calc(24px + env(safe-area-inset-bottom))' }}>
          {unsavedBar && <div className="mb-4">{unsavedBar}</div>}
          {body}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-start justify-center overflow-y-auto p-4" onClick={requestClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="settings-title"
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 id="settings-title" className="text-lg font-bold text-slate-800">Settings</h2>
          <button onClick={requestClose} aria-label="Close settings" className="text-slate-500 hover:text-slate-800"><X size={20} /></button>
        </div>
        <div className="px-6 py-5">{body}</div>
        <div className="px-6 py-4 border-t border-slate-200 space-y-3">
          {unsavedBar}
          <div className="flex justify-end items-center gap-3">
            {statusText}
            <button onClick={requestClose} className="bg-slate-200 text-slate-700 px-4 min-h-[40px] rounded-lg text-sm hover:bg-slate-300">Close</button>
            {saveButton}
          </div>
        </div>
      </div>
    </div>
  );
}
