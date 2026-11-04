import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { MONEY_TYPING, parseMoney, CURRENCIES, formatMoney, sumMoney } from './money';

export const ITEM_STATUSES = ['Quoted', 'Booked', 'Invoiced', 'Paid'];
// An item counts as committed once it's booked; "Quoted" is only an estimate.
export const COMMITTED_STATUSES = ['Booked', 'Invoiced', 'Paid'];

const SUGGESTED_CATEGORIES = ['Venue', 'Catering', 'Flowers', 'Entertainment', 'Staffing', 'Décor', 'Photography', 'Transport', 'Stationery', 'Other'];

const STATUS_STYLES = {
  Quoted: 'bg-slate-100 text-slate-700',
  Booked: 'bg-blue-100 text-blue-800',
  Invoiced: 'bg-amber-100 text-amber-800',
  Paid: 'bg-green-100 text-green-800'
};

const inputClass = 'px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

// Totals for a set of items: committed (booked or later) and paid.
export const itemTotals = (items) => ({
  committed: sumMoney(items.filter(i => COMMITTED_STATUSES.includes(i.status)).map(i => i.total)),
  paid: sumMoney(items.filter(i => i.status === 'Paid').map(i => i.total))
});

const emptyItem = { description: '', supplier: '', quantity: '1', unitCost: '', status: 'Quoted', dueDate: '' };

// Shows one project's cost categories and the items inside them.
// Everyone in the organisation can view; only admins can add, change or delete.
export default function CostsPanel({ project, categories, items, isAdmin, supabase, orgId, onChanged }) {
  const money = (n) => formatMoney(n, project.currency);
  const symbol = CURRENCIES[project.currency].symbol;
  const [error, setError] = useState('');
  const [newCategory, setNewCategory] = useState({ name: '', budget: '' });
  const [newItems, setNewItems] = useState({}); // draft item per category id
  const [addingItemTo, setAddingItemTo] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null); // e.g. 'category-3' or 'item-12'

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

  const addCategory = async () => {
    const name = newCategory.name.trim();
    const budget = parseMoney(newCategory.budget);
    if (!name) return setError('Give the category a name.');
    if (categories.some(c => c.name.toLowerCase() === name.toLowerCase())) return setError('This project already has a category with that name.');
    if (budget === null) return setError('Category budget must be 0 or more, with up to 2 decimal places.');
    const ok = await run(supabase.from('project_categories').insert({ org_id: orgId, project_id: project.id, name, budget }));
    if (ok) setNewCategory({ name: '', budget: '' });
  };

  const draftFor = (categoryId) => newItems[categoryId] || emptyItem;
  const setDraft = (categoryId, changes) =>
    setNewItems({ ...newItems, [categoryId]: { ...draftFor(categoryId), ...changes } });

  const addItem = async (categoryId) => {
    const d = draftFor(categoryId);
    const description = d.description.trim();
    const quantity = parseMoney(d.quantity);
    const unitCost = parseMoney(d.unitCost);
    if (!description) return setError('Describe the item, e.g. "Marquee hire".');
    if (quantity === null || quantity <= 0) return setError('Quantity must be more than 0, with up to 2 decimal places.');
    if (unitCost === null) return setError('Unit cost must be 0 or more, with up to 2 decimal places.');
    const ok = await run(supabase.from('cost_items').insert({
      org_id: orgId,
      project_id: project.id,
      category_id: categoryId,
      description,
      supplier: d.supplier.trim(),
      quantity,
      unit_cost: unitCost,
      status: d.status,
      due_date: d.dueDate || null
    }));
    if (ok) {
      setNewItems({ ...newItems, [categoryId]: emptyItem });
      setAddingItemTo(null);
    }
  };

  const changeStatus = (item, status) => run(supabase.from('cost_items').update({ status }).eq('id', item.id));

  const remove = async (table, id) => {
    setConfirmDelete(null);
    await run(supabase.from(table).delete().eq('id', id));
  };

  const DeleteButton = ({ kind, id, table, label }) =>
    confirmDelete === `${kind}-${id}` ? (
      <span className="flex items-center gap-2 text-xs">
        <button onClick={() => remove(table, id)} className="text-red-700 font-semibold hover:underline">Delete</button>
        <button onClick={() => setConfirmDelete(null)} className="text-slate-600 hover:underline">Keep</button>
      </span>
    ) : (
      <button onClick={() => setConfirmDelete(`${kind}-${id}`)} aria-label={label} className="text-red-600 hover:text-red-800">
        <Trash2 size={16} />
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
      {/* Project-level summary */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <Stat label="Project budget" value={money(project.budget)} />
        <Stat label="Given to categories" value={money(allocated)} tone={allocated > project.budget ? 'text-amber-700' : 'text-slate-800'} />
        <Stat label="Committed (booked or later)" value={money(projectTotals.committed)} />
        <Stat label="Paid" value={money(projectTotals.paid)} />
        <Stat label="Left in budget" value={money(remaining)} tone={remaining < 0 ? 'text-red-700' : 'text-green-700'} />
      </div>
      {allocated > project.budget && (
        <p className="text-amber-700 text-sm">The category budgets add up to more than the project budget.</p>
      )}
      {project.spent > 0 && (
        <p className="text-slate-500 text-xs">
          Also counted in this project's Amount Spent: {money(project.spent)} entered on the project (not itemised).
        </p>
      )}

      {categories.length === 0 && (
        <p className="text-slate-500 text-sm">
          No cost categories yet.{isAdmin ? ' Add one below, e.g. Venue or Catering, then add items to it.' : ''}
        </p>
      )}

      {/* Categories, each with its items */}
      {categories.map((category) => {
        const catItems = items.filter(i => i.category_id === category.id);
        const t = itemTotals(catItems);
        const catLeft = sumMoney([category.budget, -t.committed]);
        const draft = draftFor(category.id);
        return (
          <div key={category.id} className="bg-white border border-slate-200 rounded-lg">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100">
              <h4 className="font-semibold text-slate-800">{category.name}</h4>
              <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
                <span>Budget <strong className="text-slate-800">{money(category.budget)}</strong></span>
                <span>Committed <strong className="text-slate-800">{money(t.committed)}</strong></span>
                <span>Paid <strong className="text-slate-800">{money(t.paid)}</strong></span>
                <span>Left <strong className={catLeft < 0 ? 'text-red-700' : 'text-green-700'}>{money(catLeft)}</strong></span>
                {isAdmin && <DeleteButton kind="category" id={category.id} table="project_categories" label={`Delete category ${category.name} and its items`} />}
              </div>
            </div>

            {catItems.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
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
                  <tbody>
                    {catItems.map((item) => (
                      <tr key={item.id} className="border-t border-slate-100">
                        <td className="py-2 px-4 text-slate-800">{item.description}</td>
                        <td className="py-2 px-4 text-slate-600">{item.supplier || '—'}</td>
                        <td className="py-2 px-4 text-slate-600 whitespace-nowrap">{item.quantity} × {money(item.unit_cost)}</td>
                        <td className="py-2 px-4 text-slate-800 font-medium whitespace-nowrap">{money(item.total)}</td>
                        <td className="py-2 px-4">
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
                        <td className="py-2 px-4 text-slate-600 whitespace-nowrap">{item.due_date || '—'}</td>
                        {isAdmin && (
                          <td className="py-2 px-4 text-right">
                            <DeleteButton kind="item" id={item.id} table="cost_items" label={`Delete item ${item.description}`} />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {isAdmin && (addingItemTo === category.id ? (
              <div className="px-4 py-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input aria-label="Item description" placeholder="Item, e.g. Marquee hire" value={draft.description}
                  onChange={(e) => setDraft(category.id, { description: e.target.value })} className={`${inputClass} sm:col-span-2`} />
                <input aria-label="Supplier" placeholder="Supplier (optional)" value={draft.supplier}
                  onChange={(e) => setDraft(category.id, { supplier: e.target.value })} className={inputClass} />
                <input aria-label="Quantity" inputMode="decimal" placeholder="Quantity" value={draft.quantity}
                  onChange={(e) => MONEY_TYPING.test(e.target.value) && setDraft(category.id, { quantity: e.target.value })} className={inputClass} />
                <input aria-label="Unit cost" inputMode="decimal" placeholder={`Unit cost in ${symbol}`} value={draft.unitCost}
                  onChange={(e) => MONEY_TYPING.test(e.target.value) && setDraft(category.id, { unitCost: e.target.value })} className={inputClass} />
                <select aria-label="Item status" value={draft.status}
                  onChange={(e) => setDraft(category.id, { status: e.target.value })} className={inputClass}>
                  {ITEM_STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  Due
                  <input type="date" aria-label="Due date" value={draft.dueDate}
                    onChange={(e) => setDraft(category.id, { dueDate: e.target.value })} className={`${inputClass} flex-1`} />
                </label>
                <div className="flex gap-2 sm:col-span-2">
                  <button onClick={() => addItem(category.id)} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700">Save item</button>
                  <button onClick={() => setAddingItemTo(null)} className="bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm hover:bg-slate-300">Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => { setError(''); setAddingItemTo(category.id); }}
                className="flex items-center gap-1 px-4 py-2 text-sm text-blue-700 hover:text-blue-900">
                <Plus size={16} /> Add item to {category.name}
              </button>
            ))}
          </div>
        );
      })}

      {/* New category */}
      {isAdmin && (
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

      {error && <p className="text-red-600 text-sm">{error}</p>}
    </div>
  );
}
