import React, { useState } from 'react';
import { Plus, Trash2, Pencil } from 'lucide-react';

const inputClass = 'px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const primaryButton = 'bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-60';
const secondaryButton = 'bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm hover:bg-slate-300';

// Progress shown for a list of tasks: tasks done ÷ total tasks, as a whole percentage (0 with no tasks).
// The database works it out the same way and stores it on the project.
export const taskProgress = (tasks) =>
  tasks.length === 0 ? 0 : Math.round((100 * tasks.filter(t => t.done).length) / tasks.length);

const todayStr = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

// One project's task list. A project's progress comes only from these tasks.
// Everyone in the organisation can view; only admins can add, tick, change or delete.
export default function TasksPanel({ project, tasks, isAdmin, supabase, orgId, onChanged }) {
  const [error, setError] = useState('');
  const [newTask, setNewTask] = useState({ title: '', dueDate: '' });
  const [editing, setEditing] = useState(null); // { id, title, dueDate }
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [busy, setBusy] = useState(false);

  const done = tasks.filter(t => t.done).length;
  const progress = taskProgress(tasks);
  const today = todayStr();
  // Not done first (soonest due first), then done.
  const sorted = [...tasks].sort((a, b) =>
    (a.done - b.done) || ((a.due_date || '9999') < (b.due_date || '9999') ? -1 : (a.due_date || '9999') > (b.due_date || '9999') ? 1 : a.id - b.id));

  const run = async (request) => {
    setBusy(true);
    const { error: err } = await request;
    setBusy(false);
    if (err) {
      setError('Could not save that change. Please try again.');
      return false;
    }
    setError('');
    await onChanged();
    return true;
  };

  const addTask = async () => {
    const title = newTask.title.trim();
    if (!title) return setError('Give the task a name, e.g. "Book venue".');
    const ok = await run(supabase.from('project_tasks').insert({
      org_id: orgId, project_id: project.id, title, due_date: newTask.dueDate || null
    }));
    if (ok) setNewTask({ title: '', dueDate: '' });
  };

  const saveTask = async () => {
    const title = editing.title.trim();
    if (!title) return setError('Give the task a name.');
    const ok = await run(supabase.from('project_tasks').update({ title, due_date: editing.dueDate || null }).eq('id', editing.id));
    if (ok) setEditing(null);
  };

  const toggleDone = (task) => run(supabase.from('project_tasks').update({ done: !task.done }).eq('id', task.id));

  const remove = async (id) => {
    setConfirmDelete(null);
    await run(supabase.from('project_tasks').delete().eq('id', id));
  };

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-4">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
          <span className="text-sm text-slate-600">
            <strong className="text-slate-800">{done} of {tasks.length}</strong> tasks done
          </span>
          <span className="text-sm font-semibold text-slate-800">{progress}% progress</span>
        </div>
        <div className="bg-slate-200 rounded-full h-2" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Project progress">
          <div className="bg-blue-600 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
        </div>
        <p className="text-slate-500 text-xs mt-2">
          Progress comes from this list: each task counts equally.
          {tasks.length === 0 && (isAdmin ? ' Add the first task below.' : ' No tasks yet.')}
        </p>
      </div>

      {sorted.length > 0 && (
        <ul className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
          {sorted.map((task) => editing?.id === task.id ? (
            <li key={task.id} className="flex flex-wrap items-center gap-2 px-4 py-3 bg-blue-50/40">
              <input aria-label="Task name" value={editing.title}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })} className={`${inputClass} flex-1 min-w-[12rem]`} />
              <label className="flex items-center gap-2 text-sm text-slate-600">
                Due
                <input type="date" aria-label="Task due date" value={editing.dueDate}
                  onChange={(e) => setEditing({ ...editing, dueDate: e.target.value })} className={inputClass} />
              </label>
              <button onClick={saveTask} disabled={busy} className={primaryButton}>Save</button>
              <button onClick={() => { setEditing(null); setError(''); }} className={secondaryButton}>Cancel</button>
            </li>
          ) : (
            <li key={task.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <input
                type="checkbox"
                checked={task.done}
                disabled={!isAdmin || busy}
                onChange={() => toggleDone(task)}
                aria-label={`${task.done ? 'Mark not done' : 'Mark done'}: ${task.title}`}
                className="h-4 w-4 accent-blue-600"
              />
              <span className={`flex-1 text-sm ${task.done ? 'line-through text-slate-400' : 'text-slate-800'}`}>{task.title}</span>
              {task.due_date && (
                <span className={`text-xs whitespace-nowrap ${!task.done && task.due_date < today ? 'text-red-700 font-medium' : 'text-slate-500'}`}>
                  {!task.done && task.due_date < today ? 'Overdue · ' : 'Due '}{task.due_date}
                </span>
              )}
              {isAdmin && (confirmDelete === task.id ? (
                <span className="flex items-center gap-2 text-xs">
                  <button onClick={() => remove(task.id)} className="text-red-700 font-semibold hover:underline">Delete</button>
                  <button onClick={() => setConfirmDelete(null)} className="text-slate-600 hover:underline">Keep</button>
                </span>
              ) : (
                <span className="flex items-center gap-3">
                  <button onClick={() => { setError(''); setEditing({ id: task.id, title: task.title, dueDate: task.due_date || '' }); }}
                    aria-label={`Edit task ${task.title}`} className="text-blue-600 hover:text-blue-800">
                    <Pencil size={16} />
                  </button>
                  <button onClick={() => setConfirmDelete(task.id)} aria-label={`Delete task ${task.title}`} className="text-red-600 hover:text-red-800">
                    <Trash2 size={16} />
                  </button>
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}

      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2">
          <input aria-label="New task name" placeholder="New task, e.g. Book venue" value={newTask.title}
            onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') addTask(); }}
            className={`${inputClass} flex-1 min-w-[12rem]`} />
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Due
            <input type="date" aria-label="New task due date" value={newTask.dueDate}
              onChange={(e) => setNewTask({ ...newTask, dueDate: e.target.value })} className={inputClass} />
          </label>
          <button onClick={addTask} disabled={busy} className={`flex items-center gap-1 ${primaryButton}`}>
            <Plus size={16} /> Add task
          </button>
        </div>
      )}

      {error && <p className="text-red-600 text-sm" role="alert">{error}</p>}
    </div>
  );
}
