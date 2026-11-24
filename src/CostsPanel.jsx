import React, { useState } from 'react';
import { Plus, Trash2, Pencil, Clock, FileDown, X } from 'lucide-react';
import { MONEY_TYPING, parseMoney, CURRENCIES, formatMoney, sumMoney } from './money';
import { AddButton, BottomSheet } from './PhoneLayout';
import { useDates, DateInput } from './dates';

export const ITEM_STATUSES = ['Quoted', 'Booked', 'Invoiced', 'Paid'];
// An item counts as committed once it's booked; "Quoted" is only an estimate.
export const COMMITTED_STATUSES = ['Booked', 'Invoiced', 'Paid'];

const SUGGESTED_CATEGORIES = ['Venue', 'Catering', 'Flowers', 'Entertainment', 'Staffing', 'Décor', 'Photography', 'Transport', 'Stationery', 'Other'];
// Logged time goes to a Staffing-type category by default; one called "Staffing" is created if there isn't one.
const TIME_CATEGORY_PATTERN = /staff|labou?r|time/i;
const NEW_TIME_CATEGORY = 'Staffing';

const STATUS_STYLES = {
  Quoted: 'bg-slate-100 text-slate-700',
  Booked: 'bg-blue-100 text-blue-800',
  Invoiced: 'bg-amber-100 text-amber-800',
  Paid: 'bg-green-100 text-green-800'
};

const inputClass = 'px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const primaryButton = 'bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-60';
const secondaryButton = 'bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm hover:bg-slate-300';

// Totals for a set of items: committed (booked or later) and paid.
export const itemTotals = (items) => ({
  committed: sumMoney(items.filter(i => COMMITTED_STATUSES.includes(i.status)).map(i => i.total)),
  paid: sumMoney(items.filter(i => i.status === 'Paid').map(i => i.total))
});

const emptyItem = { description: '', supplier: '', quantity: '1', unitCost: '', status: 'Quoted', dueDate: '' };
const itemToDraft = (item) => ({
  description: item.description,
  supplier: item.supplier || '',
  quantity: String(item.quantity),
  unitCost: String(item.unit_cost),
  status: item.status,
  dueDate: item.due_date || ''
});

// Checks a draft item; returns [error, row-to-save].
const validateItem = (d) => {
  const description = d.description.trim();
  const quantity = parseMoney(d.quantity);
  const unitCost = parseMoney(d.unitCost);
  if (!description) return ['Describe the item, e.g. "Marquee hire".'];
  if (quantity === null || quantity <= 0) return ['Quantity must be more than 0, with up to 2 decimal places.'];
  if (unitCost === null) return ['Unit cost must be 0 or more, with up to 2 decimal places.'];
  return [null, { description, supplier: d.supplier.trim(), quantity, unit_cost: unitCost, status: d.status, due_date: d.dueDate || null }];
};

// The fields for adding or editing an item. Kept outside the panel so typing doesn't lose focus.
function ItemFields({ draft, onChange, symbol, onSave, onCancel, saveLabel }) {
  const quantity = parseMoney(draft.quantity);
  const unitCost = parseMoney(draft.unitCost);
  const preview = quantity !== null && unitCost !== null ? Math.round(quantity * unitCost * 100) / 100 : null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      <input aria-label="Item description" placeholder="Item, e.g. Marquee hire" value={draft.description}
        onChange={(e) => onChange({ description: e.target.value })} className={`${inputClass} sm:col-span-2`} />
      <input aria-label="Supplier" placeholder="Supplier (optional)" value={draft.supplier}
        onChange={(e) => onChange({ supplier: e.target.value })} className={inputClass} />
      <input aria-label="Quantity" inputMode="decimal" placeholder="Quantity (or hours)" value={draft.quantity}
        onChange={(e) => MONEY_TYPING.test(e.target.value) && onChange({ quantity: e.target.value })} className={inputClass} />
      <input aria-label="Unit cost" inputMode="decimal" placeholder={`Unit cost (or hourly rate) in ${symbol}`} value={draft.unitCost}
        onChange={(e) => MONEY_TYPING.test(e.target.value) && onChange({ unitCost: e.target.value })} className={inputClass} />
      <select aria-label="Item status" value={draft.status}
        onChange={(e) => onChange({ status: e.target.value })} className={inputClass}>
        {ITEM_STATUSES.map(s => <option key={s}>{s}</option>)}
      </select>
      <label className="flex items-center gap-2 text-sm text-slate-600">
        Due
        <DateInput aria-label="Due date" value={draft.dueDate} wrapperClassName="flex flex-col flex-1 min-w-0"
          onChange={(e) => onChange({ dueDate: e.target.value })} className={`${inputClass} w-full`} />
      </label>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <button onClick={onSave} className={primaryButton}>{saveLabel}</button>
        <button onClick={onCancel} className={secondaryButton}>Cancel</button>
        {preview !== null && <span className="text-sm text-slate-600">Total: <strong>{formatMoney(preview, draft.currency)}</strong></span>}
      </div>
    </div>
  );
}

// Shows one project's cost categories and the items inside them.
// Everyone in the organisation can view; only admins can add, change or delete.
export default function CostsPanel({ project, categories, items, isAdmin, supabase, orgId, onChanged, unbilledTime = [], onBillTime, invoiceButton = null, invoices = [], itemInvoice = new Map(), onDownloadInvoice, phone = false }) {
  const { date, dates } = useDates();
  // phone: adding happens in a panel opened by the round + button ('choose' | 'item' | 'category').
  const [sheet, setSheet] = useState(null);
  const [sheetCategoryId, setSheetCategoryId] = useState(null);
  const money = (n) => formatMoney(n, project.currency);
  const symbol = CURRENCIES[project.currency].symbol;
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [newCategory, setNewCategory] = useState({ name: '', budget: '' });
  const [newItems, setNewItems] = useState({}); // draft item per category id
  const [addingItemTo, setAddingItemTo] = useState(null);
  const [editingItem, setEditingItem] = useState(null); // { id, draft }
  const [editingCategory, setEditingCategory] = useState(null); // { id, name, budget }
  const [confirmDelete, setConfirmDelete] = useState(null); // e.g. 'category-3' or 'item-12'
  const [blocked, setBlocked] = useState(null); // { title, rows: [{ item, invoice }] } for the "can't delete" pop-up

  // ---- Logged time ready to bill ----
  const [showBillOptions, setShowBillOptions] = useState(false);
  const [excludedEntries, setExcludedEntries] = useState([]); // entry ids the user unticked
  const [billCategoryId, setBillCategoryId] = useState(''); // '' = automatic
  const [billStatus, setBillStatus] = useState('Booked');
  const [billing, setBilling] = useState(false);

  const projectRate = Number(project.hourly_rate) || 0;
  const rateFor = (entry) => entry.hourly_rate || projectRate; // rate when logged, else the project's rate
  const selectedEntries = unbilledTime.filter(t => !excludedEntries.includes(t.id));
  const selectedHours = sumMoney(selectedEntries.map(t => t.hours));
  const selectedValue = sumMoney(selectedEntries.map(t => t.hours * rateFor(t)));
  const missingRate = unbilledTime.some(t => !rateFor(t));
  const autoCategory = categories.find(c => TIME_CATEGORY_PATTERN.test(c.name));
  const billCategory = billCategoryId ? categories.find(c => String(c.id) === billCategoryId) : autoCategory;
  const billTargetName = billCategory ? billCategory.name : `a new "${NEW_TIME_CATEGORY}" category`;

  const toggleEntry = (id) =>
    setExcludedEntries(excludedEntries.includes(id) ? excludedEntries.filter(x => x !== id) : [...excludedEntries, id]);

  const billTime = async () => {
    if (selectedEntries.length === 0) return setError('Tick at least one time entry to bill.');
    setBilling(true);
    const err = await onBillTime({
      projectId: project.id,
      entryIds: selectedEntries.map(t => t.id),
      categoryId: billCategory ? billCategory.id : null,
      status: billStatus
    });
    setBilling(false);
    if (err) return setError(err);
    setError('');
    setNotice(`Billed ${selectedHours} h to ${billCategory ? billCategory.name : NEW_TIME_CATEGORY}. Use the pencil on the new item to change the hours, rate or wording.`);
    setExcludedEntries([]);
    setShowBillOptions(false);
  };

  // ---- Totals ----
  const projectTotals = itemTotals(items);
  const allocated = sumMoney(categories.map(c => c.budget));
  const remaining = sumMoney([project.budget, -projectTotals.committed]);

  const run = async (request) => {
    const { error: err } = await request;
    if (err) {
      setError('Could not save that change. Please try again.');
      return false;
    }
    setError('');
    await onChanged();
    return true;
  };

  // ---- Categories ----
  const nameTaken = (name, exceptId) =>
    categories.some(c => c.id !== exceptId && c.name.toLowerCase() === name.toLowerCase());

  const addCategory = async () => {
    const name = newCategory.name.trim();
    const budget = parseMoney(newCategory.budget);
    if (!name) return setError('Give the category a name.');
    if (nameTaken(name)) return setError('This project already has a category with that name.');
    if (budget === null) return setError('Category budget must be 0 or more, with up to 2 decimal places.');
    const ok = await run(supabase.from('project_categories').insert({ org_id: orgId, project_id: project.id, name, budget }));
    if (ok) setNewCategory({ name: '', budget: '' });
    return ok;
  };

  const saveCategory = async () => {
    const name = editingCategory.name.trim();
    const budget = parseMoney(editingCategory.budget);
    if (!name) return setError('Give the category a name.');
    if (nameTaken(name, editingCategory.id)) return setError('This project already has a category with that name.');
    if (budget === null) return setError('Category budget must be 0 or more, with up to 2 decimal places.');
    const ok = await run(supabase.from('project_categories').update({ name, budget }).eq('id', editingCategory.id));
    if (ok) setEditingCategory(null);
  };

  // ---- Items ----
  const draftFor = (categoryId) => newItems[categoryId] || emptyItem;
  const setDraft = (categoryId, changes) =>
    setNewItems({ ...newItems, [categoryId]: { ...draftFor(categoryId), ...changes } });

  const addItem = async (categoryId) => {
    const [err, row] = validateItem(draftFor(categoryId));
    if (err) return setError(err);
    const ok = await run(supabase.from('cost_items').insert({ org_id: orgId, project_id: project.id, category_id: categoryId, ...row }));
    if (ok) {
      setNewItems({ ...newItems, [categoryId]: emptyItem });
      setAddingItemTo(null);
    }
    return ok;
  };

  const saveItem = async () => {
    const [err, row] = validateItem(editingItem.draft);
    if (err) return setError(err);
    const ok = await run(supabase.from('cost_items').update(row).eq('id', editingItem.id));
    if (ok) setEditingItem(null);
  };

  const changeStatus = (item, status) => run(supabase.from('cost_items').update({ status }).eq('id', item.id));

  const remove = async (table, id) => {
    setConfirmDelete(null);
    await run(supabase.from(table).delete().eq('id', id));
  };

  // Items on an issued invoice can't be deleted (nor their category): say why, and which invoice.
  const invoicedIn = (list) => list.filter(i => itemInvoice.has(i.id)).map(i => ({ item: i, invoice: itemInvoice.get(i.id) }));
  const DeleteButton = ({ kind, id, table, label, blockedRows = [], blockedTitle = '' }) =>
    blockedRows.length > 0 ? (
      <button onClick={() => setBlocked({ title: blockedTitle, rows: blockedRows })} aria-label={label}
        title="On an issued invoice" className="text-slate-400 hover:text-slate-600">
        <Trash2 size={16} />
      </button>
    ) : confirmDelete === `${kind}-${id}` ? (
      <span className="flex items-center gap-2 text-xs">
        <button onClick={() => remove(table, id)} className="text-red-700 font-semibold hover:underline">Delete</button>
        <button onClick={() => setConfirmDelete(null)} className="text-slate-600 hover:underline">Keep</button>
      </span>
    ) : (
      <button onClick={() => setConfirmDelete(`${kind}-${id}`)} aria-label={label} className="text-red-600 hover:text-red-800">
        <Trash2 size={16} />
      </button>
    );

  const EditButton = ({ label, onClick }) => (
    <button onClick={() => { setError(''); setNotice(''); onClick(); }} aria-label={label} className="text-blue-600 hover:text-blue-800">
      <Pencil size={16} />
    </button>
  );

  const Stat = ({ label, value, tone = 'text-slate-800' }) => (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-base font-semibold ${tone}`}>{value}</div>
    </div>
  );

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-4">
      {blocked && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" onClick={() => setBlocked(null)}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="blocked-title"
            className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
              <h3 id="blocked-title" className="font-semibold text-slate-800">{blocked.title}</h3>
              <button onClick={() => setBlocked(null)} aria-label="Close" className="text-slate-500 hover:text-slate-800"><X size={18} /></button>
            </div>
            <div className="px-5 py-4 text-sm text-slate-700 space-y-3">
              <p>{blocked.rows.length === 1 ? 'This item is' : 'These items are'} on an issued invoice. Invoiced items are kept so the invoice stays accurate and nothing is billed twice.</p>
              <ul className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                {blocked.rows.map(({ item, invoice }) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-x-3 px-3 py-2">
                    <span className="text-slate-800">{dates(item.description)}</span>
                    <span className="ml-auto text-slate-600">
                      <strong>{invoice.number}</strong> · {date(invoice.issue_date)}{invoice.client_name ? ` · ${invoice.client_name}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-slate-500 text-xs">You can still edit the item or change its status. The invoice keeps its own copy.</p>
            </div>
            <div className="flex justify-end px-5 py-3 border-t border-slate-200">
              <button onClick={() => setBlocked(null)} className={secondaryButton}>OK</button>
            </div>
          </div>
        </div>
      )}
      {/* Project-level summary */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <Stat label="Project budget" value={money(project.budget)} />
        <Stat label="Given to categories" value={money(allocated)} tone={allocated > project.budget ? 'text-amber-700' : 'text-slate-800'} />
        <Stat label="Committed (booked or later)" value={money(projectTotals.committed)} />
        <Stat label="Paid" value={money(projectTotals.paid)} />
        <Stat label="Left in budget" value={money(remaining)} tone={remaining < 0 ? 'text-red-700' : 'text-green-700'} />
      </div>
      {invoiceButton && <div className="flex justify-end">{invoiceButton}</div>}

      {/* Issued invoices for this project */}
      {invoices.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg px-4 py-3">
          <h4 className="text-sm font-semibold text-slate-700 mb-2">Invoices</h4>
          <ul className="divide-y divide-slate-100 text-sm">
            {invoices.map(inv => (
              <li key={inv.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
                <span className="font-medium text-slate-800">{inv.number}</span>
                <span className="text-slate-500">{date(inv.issue_date)}</span>
                <span className="text-slate-500">{inv.client_name}</span>
                <span className="ml-auto font-medium text-slate-800">{formatMoney(Number(inv.total), inv.currency)}</span>
                <button onClick={() => onDownloadInvoice(inv).catch(() => setError('Could not make the PDF. Please try again.'))}
                  aria-label={`Download invoice ${inv.number}`} title="Download PDF" className="text-blue-600 hover:text-blue-800">
                  <FileDown size={16} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {allocated > project.budget && (
        <p className="text-amber-700 text-sm">The category budgets add up to more than the project budget.</p>
      )}
      {project.spent > 0 && (
        <p className="text-slate-500 text-xs">
          Also counted in this project's Amount Spent: {money(project.spent)} entered on the project (not itemised).
        </p>
      )}

      {/* Logged time from Time Tracking that hasn't been billed yet (admins only) */}
      {isAdmin && unbilledTime.length > 0 && (
        <div className="bg-white border border-blue-200 rounded-lg px-4 py-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Clock size={18} className="text-blue-600" />
              <div>
                <h4 className="font-semibold text-slate-800">Logged time ready to bill</h4>
                <p className="text-sm text-slate-600">
                  <strong className="text-slate-800">{selectedHours} h</strong>
                  {!missingRate && <> · <strong className="text-slate-800">{money(selectedValue)}</strong></>}
                  {selectedEntries.length !== unbilledTime.length && <> · {selectedEntries.length} of {unbilledTime.length} entries</>}
                </p>
              </div>
            </div>
            {!missingRate && (
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={billTime} disabled={billing || selectedEntries.length === 0} className={primaryButton}>
                  {billing ? 'Billing…' : `Bill ${selectedHours} h to ${billCategory ? billCategory.name : NEW_TIME_CATEGORY}`}
                </button>
                <button onClick={() => setShowBillOptions(!showBillOptions)} aria-expanded={showBillOptions}
                  className="text-sm text-blue-700 hover:text-blue-900">
                  {showBillOptions ? 'Hide options' : 'Change what’s billed'}
                </button>
              </div>
            )}
          </div>

          {missingRate ? (
            <p className="text-amber-700 text-sm">
              Some of these hours have no hourly rate. Set an hourly rate on the project (pencil button next to the project) to bill them.
            </p>
          ) : (
            <p className="text-slate-500 text-xs">
              Adds the hours to {billTargetName} as a {billStatus} cost item (one per hourly rate). You can edit it afterwards like any other item.
            </p>
          )}

          {showBillOptions && !missingRate && (
            <div className="border-t border-slate-100 pt-3 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-sm text-slate-600 flex items-center gap-2">
                  Category
                  <select aria-label="Category to bill hours to" value={billCategoryId}
                    onChange={(e) => setBillCategoryId(e.target.value)} className={inputClass}>
                    <option value="">{autoCategory ? `${autoCategory.name} (suggested)` : `New "${NEW_TIME_CATEGORY}" category`}</option>
                    {categories.filter(c => c !== autoCategory).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
                <label className="text-sm text-slate-600 flex items-center gap-2">
                  Status
                  <select aria-label="Status for billed hours" value={billStatus}
                    onChange={(e) => setBillStatus(e.target.value)} className={inputClass}>
                    {ITEM_STATUSES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </label>
              </div>
              <fieldset>
                <legend className="text-sm text-slate-600 mb-1">Time entries to include</legend>
                <ul className="space-y-1">
                  {unbilledTime.map(t => (
                    <li key={t.id}>
                      <label className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
                        <input type="checkbox" checked={!excludedEntries.includes(t.id)} onChange={() => toggleEntry(t.id)}
                          aria-label={`Include ${date(t.entry_date)}, ${t.hours} h`} />
                        <span className="whitespace-nowrap">{date(t.entry_date)}</span>
                        <span className="font-medium">{t.hours} h</span>
                        <span className="text-slate-500">× {money(rateFor(t))}</span>
                        {t.note && <span className="text-slate-500 truncate max-w-xs">· {t.note}</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
            </div>
          )}
        </div>
      )}

      {notice && <p className="text-green-700 text-sm" role="status">{notice}</p>}

      {categories.length === 0 && (
        <p className="text-slate-500 text-sm">
          No cost categories yet.{isAdmin ? (phone ? ' Tap + to add one, e.g. Venue or Catering, then add items to it.' : ' Add one below, e.g. Venue or Catering, then add items to it.') : ''}
        </p>
      )}

      {/* Categories, each with its items */}
      {categories.map((category) => {
        const catItems = items.filter(i => i.category_id === category.id);
        const t = itemTotals(catItems);
        const catLeft = sumMoney([category.budget, -t.committed]);
        const isEditingCategory = editingCategory?.id === category.id;
        return (
          <div key={category.id} className="bg-white border border-slate-200 rounded-lg">
            {isEditingCategory ? (
              <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-100">
                <input aria-label="Category name" value={editingCategory.name}
                  onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })} className={inputClass} />
                <input aria-label="Category budget" inputMode="decimal" placeholder={`Budget in ${symbol}`} value={editingCategory.budget}
                  onChange={(e) => MONEY_TYPING.test(e.target.value) && setEditingCategory({ ...editingCategory, budget: e.target.value })}
                  className={inputClass} />
                <button onClick={saveCategory} className={primaryButton}>Save category</button>
                <button onClick={() => setEditingCategory(null)} className={secondaryButton}>Cancel</button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100">
                <h4 className="font-semibold text-slate-800">{category.name}</h4>
                <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
                  {category.budget > 0 ? (
                    <span>Budget <strong className="text-slate-800">{money(category.budget)}</strong></span>
                  ) : (
                    // A £0 budget (e.g. a Staffing category created by billing) means "not set yet", not "overspent".
                    <span className="flex items-center gap-2">
                      Budget <strong className="text-slate-500 font-medium">No budget set</strong>
                      {isAdmin && (
                        <button
                          onClick={() => { setError(''); setNotice(''); setEditingCategory({ id: category.id, name: category.name, budget: '' }); }}
                          className="text-blue-700 hover:text-blue-900 underline"
                        >
                          Set budget
                        </button>
                      )}
                    </span>
                  )}
                  <span>Committed <strong className="text-slate-800">{money(t.committed)}</strong></span>
                  <span>Paid <strong className="text-slate-800">{money(t.paid)}</strong></span>
                  {category.budget > 0 && (
                    <span>Left <strong className={catLeft < 0 ? 'text-red-700' : 'text-green-700'}>{money(catLeft)}</strong></span>
                  )}
                  {isAdmin && (
                    <span className="flex items-center gap-3">
                      <EditButton label={`Edit category ${category.name}`}
                        onClick={() => setEditingCategory({ id: category.id, name: category.name, budget: String(category.budget) })} />
                      <DeleteButton kind="category" id={category.id} table="project_categories" label={`Delete category ${category.name} and its items`}
                        blockedRows={invoicedIn(catItems)} blockedTitle={`The category “${category.name}” can’t be deleted`} />
                    </span>
                  )}
                </div>
              </div>
            )}

            {catItems.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm block sm:table">
                  <thead className="hidden sm:table-header-group">
                    <tr className="text-left text-slate-500 text-xs">
                      <th className="py-2 px-4 font-medium">Item</th>
                      <th className="py-2 px-4 font-medium">Supplier</th>
                      <th className="py-2 px-4 font-medium">Qty × unit</th>
                      <th className="py-2 px-4 font-medium">Total</th>
                      <th className="py-2 px-4 font-medium">Status</th>
                      <th className="py-2 px-4 font-medium">Due</th>
                      {isAdmin && <th className="py-2 px-4" />}
                    </tr>
                  </thead>
                  <tbody className="block sm:table-row-group">
                    {catItems.map((item) => editingItem?.id === item.id ? (
                      <tr key={item.id} className="block sm:table-row border-t border-slate-100 bg-blue-50/40">
                        <td colSpan={isAdmin ? 7 : 6} className="block sm:table-cell py-3 px-4">
                          <ItemFields
                            draft={{ ...editingItem.draft, currency: project.currency }}
                            onChange={(changes) => setEditingItem({ ...editingItem, draft: { ...editingItem.draft, ...changes } })}
                            symbol={symbol}
                            onSave={saveItem}
                            onCancel={() => setEditingItem(null)}
                            saveLabel="Save changes"
                          />
                        </td>
                      </tr>
                    ) : (
                      <tr key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 sm:p-0 sm:table-row border-t border-slate-100">
                        <td className="basis-full sm:basis-auto sm:table-cell sm:py-2 sm:px-4 text-slate-800 font-medium sm:font-normal">{dates(item.description)}</td>
                        <td className={`${item.supplier ? '' : 'hidden'} sm:table-cell sm:py-2 sm:px-4 text-slate-600`}>{item.supplier || '—'}</td>
                        <td className="sm:table-cell sm:py-2 sm:px-4 text-slate-600 whitespace-nowrap">{item.quantity} × {money(item.unit_cost)}</td>
                        <td className="sm:table-cell sm:py-2 sm:px-4 text-slate-800 font-medium whitespace-nowrap"><span className="sm:hidden">= </span>{money(item.total)}</td>
                        <td className="sm:table-cell sm:py-2 sm:px-4">
                          {isAdmin ? (
                            <select
                              aria-label={`Status of ${item.description}`}
                              value={item.status}
                              onChange={(e) => changeStatus(item, e.target.value)}
                              className={`px-2 py-1 rounded-full text-xs font-medium border-0 ${STATUS_STYLES[item.status]}`}
                            >
                              {ITEM_STATUSES.map(s => <option key={s}>{s}</option>)}
                            </select>
                          ) : (
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[item.status]}`}>{item.status}</span>
                          )}
                        </td>
                        <td className={`${item.due_date ? '' : 'hidden'} sm:table-cell sm:py-2 sm:px-4 text-slate-600 whitespace-nowrap`}><span className="sm:hidden">Due </span>{item.due_date ? date(item.due_date) : '—'}</td>
                        {isAdmin && (
                          <td className="ml-auto sm:ml-0 sm:table-cell sm:py-2 sm:px-4">
                            <span className="flex items-center justify-end gap-3">
                              <EditButton label={`Edit item ${item.description}`}
                                onClick={() => setEditingItem({ id: item.id, draft: itemToDraft(item) })} />
                              {itemInvoice.has(item.id) && (
                                <span className="text-xs text-slate-500">On {itemInvoice.get(item.id).number}</span>
                              )}
                              <DeleteButton kind="item" id={item.id} table="cost_items" label={`Delete item ${item.description}`}
                                blockedRows={invoicedIn([item])} blockedTitle={`“${item.description}” can’t be deleted`} />
                            </span>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {isAdmin && !phone && (addingItemTo === category.id ? (
              <div className="px-4 py-3 border-t border-slate-100">
                <ItemFields
                  draft={{ ...draftFor(category.id), currency: project.currency }}
                  onChange={(changes) => setDraft(category.id, changes)}
                  symbol={symbol}
                  onSave={() => addItem(category.id)}
                  onCancel={() => setAddingItemTo(null)}
                  saveLabel="Save item"
                />
              </div>
            ) : (
              <button onClick={() => { setError(''); setNotice(''); setAddingItemTo(category.id); }}
                className="flex items-center gap-1 px-4 py-2 text-sm text-blue-700 hover:text-blue-900">
                <Plus size={16} /> Add item to {category.name}
              </button>
            ))}
          </div>
        );
      })}

      {/* New category */}
      {isAdmin && !phone && (
        <div className="flex flex-wrap items-center gap-2">
          <input aria-label="New category name" list={`category-suggestions-${project.id}`} placeholder="New category, e.g. Catering"
            value={newCategory.name} onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })} className={inputClass} />
          <datalist id={`category-suggestions-${project.id}`}>
            {SUGGESTED_CATEGORIES.filter(n => !categories.some(c => c.name === n)).map(n => <option key={n} value={n} />)}
          </datalist>
          <input aria-label="New category budget" inputMode="decimal" placeholder={`Category budget in ${symbol}`}
            value={newCategory.budget}
            onChange={(e) => MONEY_TYPING.test(e.target.value) && setNewCategory({ ...newCategory, budget: e.target.value })}
            className={inputClass} />
          <button onClick={addCategory} className="flex items-center gap-1 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700">
            <Plus size={16} /> Add category
          </button>
        </div>
      )}

      {error && <p className="text-red-600 text-sm" role="alert">{error}</p>}

      {isAdmin && phone && (() => {
        const catId = categories.some(c => c.id === sheetCategoryId) ? sheetCategoryId : categories[0]?.id;
        const close = () => { setSheet(null); setError(''); };
        const big = 'min-h-[52px] w-full rounded-xl border border-slate-200 px-4 text-left text-base font-medium text-slate-800';
        return (
          <>
            <AddButton label="Add to costs" onClick={() => { setError(''); setNotice(''); setSheet(categories.length ? 'choose' : 'category'); }} />
            <BottomSheet open={sheet === 'choose'} title="Add to costs" onClose={close}>
              <div className="space-y-2">
                <button onClick={() => setSheet('item')} className={big}>Add cost item</button>
                <button onClick={() => setSheet('category')} className={big}>Add category</button>
              </div>
            </BottomSheet>
            <BottomSheet open={sheet === 'item'} title="New cost item" onClose={close}>
              <div className="space-y-3">
                <label className="flex flex-col gap-1 text-sm text-slate-600">
                  Category
                  <select value={catId ?? ''} onChange={(e) => setSheetCategoryId(Number(e.target.value) || e.target.value)}
                    className={`${inputClass} min-h-[44px] text-slate-900`}>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
                {catId != null && (
                  <ItemFields
                    draft={{ ...draftFor(catId), currency: project.currency }}
                    onChange={(changes) => setDraft(catId, changes)}
                    symbol={symbol}
                    onSave={async () => { if (await addItem(catId)) close(); }}
                    onCancel={close}
                    saveLabel="Save item"
                  />
                )}
                {error && <p className="text-red-600 text-sm" role="alert">{error}</p>}
              </div>
            </BottomSheet>
            <BottomSheet open={sheet === 'category'} title="New category" onClose={close}>
              <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); if (await addCategory()) close(); }}>
                {categories.length === 0 && <p className="text-sm text-slate-600">Start with a category, e.g. Venue, then add items to it.</p>}
                <label className="flex flex-col gap-1 text-sm text-slate-600">
                  Name
                  <input list={`category-suggestions-phone-${project.id}`} placeholder="Catering" value={newCategory.name}
                    onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })} className={`${inputClass} min-h-[44px] text-slate-900`} />
                  <datalist id={`category-suggestions-phone-${project.id}`}>
                    {SUGGESTED_CATEGORIES.filter(n => !categories.some(c => c.name === n)).map(n => <option key={n} value={n} />)}
                  </datalist>
                </label>
                <label className="flex flex-col gap-1 text-sm text-slate-600">
                  Budget in {symbol}
                  <input inputMode="decimal" placeholder="0.00" value={newCategory.budget}
                    onChange={(e) => MONEY_TYPING.test(e.target.value) && setNewCategory({ ...newCategory, budget: e.target.value })}
                    className={`${inputClass} min-h-[44px] text-slate-900`} />
                </label>
                {error && <p className="text-red-600 text-sm" role="alert">{error}</p>}
                <div className="flex gap-2">
                  <button type="submit" className={`flex-1 min-h-[44px] ${primaryButton}`}>Add category</button>
                  <button type="button" onClick={close} className={`min-h-[44px] ${secondaryButton}`}>Cancel</button>
                </div>
              </form>
            </BottomSheet>
          </>
        );
      })()}
    </div>
  );
}
