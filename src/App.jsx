import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Calendar, Plus, Trash2, Pencil, TrendingUp, Clock, CheckCircle, AlertCircle } from 'lucide-react';
import { SignedIn, SignedOut, SignInButton, UserButton, useUser, useSession, useOrganization, CreateOrganization, OrganizationSwitcher } from '@clerk/clerk-react';
import { createClient } from '@supabase/supabase-js';
import { MONEY_TYPING, parseMoney, CURRENCIES, DEFAULT_CURRENCY, formatMoney, sumMoney } from './money';
import CostsPanel, { itemTotals } from './CostsPanel';

function useSupabaseClient() {
  const { session } = useSession();
  return createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
    { accessToken: async () => session?.getToken() ?? null }
  );
}

const todayStr = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};


const emptyProject = {
  name: '',
  status: 'Planning',
  progress: '0',
  startDate: '',
  endDate: '',
  owner: '',
  budget: '',
  spent: '',
  hourlyRate: '',
  currency: DEFAULT_CURRENCY
};

const ProjectDashboard = () => {
  const { user } = useUser();
  const { organization, membership } = useOrganization();
  const isAdmin = membership?.role === 'org:admin';
  const supabase = useSupabaseClient();
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState([]);
  const [timeEntries, setTimeEntries] = useState([]);
  const [timeError, setTimeError] = useState('');
  const [newEntry, setNewEntry] = useState({
    projectId: '',
    date: todayStr(),
    hours: '',
    note: ''
  });

  const [categories, setCategories] = useState([]);
  const [costItems, setCostItems] = useState([]);
  const [unbilledTime, setUnbilledTime] = useState([]); // time entries not yet billed (admins only)
  const [openCostsFor, setOpenCostsFor] = useState(null);

  useEffect(() => {
    if (organization) {
      fetchProjects();
      fetchCosts();
      if (isAdmin) fetchTimeEntries();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization, isAdmin]);

  const fetchProjects = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('org_id', organization.id)
      .order('id', { ascending: true });
    if (!error) {
      setProjects(data.map(p => ({
        ...p,
        budget: Number(p.budget),
        spent: Number(p.spent),
        currency: CURRENCIES[p.currency] ? p.currency : DEFAULT_CURRENCY,
        startDate: p.start_date,
        endDate: p.end_date
      })));
    }
    setLoading(false);
  };

  // Cost categories and items for every project in the organisation.
  const fetchCosts = async () => {
    const [cats, its] = await Promise.all([
      supabase.from('project_categories').select('*').eq('org_id', organization.id).order('id', { ascending: true }),
      supabase.from('cost_items').select('*').eq('org_id', organization.id).order('id', { ascending: true })
    ]);
    if (!cats.error) setCategories(cats.data.map(c => ({ ...c, budget: Number(c.budget) })));
    if (!its.error) {
      setCostItems(its.data.map(i => ({
        ...i,
        quantity: Number(i.quantity),
        unit_cost: Number(i.unit_cost),
        total: Number(i.total)
      })));
    }
    if (isAdmin) fetchUnbilledTime();
  };

  // Every unbilled time entry (not limited like the Time Tracking list), so billing totals are complete.
  const fetchUnbilledTime = async () => {
    const { data, error } = await supabase
      .from('time_entries')
      .select('id, project_id, hours, hourly_rate, entry_date, note')
      .order('entry_date', { ascending: true })
      .eq('org_id', organization.id)
      .is('cost_item_id', null);
    if (!error) {
      setUnbilledTime(data.map(t => ({ ...t, hours: Number(t.hours), hourly_rate: Number(t.hourly_rate) || 0 })));
    }
  };

  // Turns chosen unbilled hours into a cost item (done by the database in one step).
  // With no category chosen, the database uses the project's Staffing category, creating it if needed.
  const billLoggedTime = async ({ projectId, entryIds, categoryId, status }) => {
    const { error } = await supabase.rpc('bill_logged_time', {
      p_project_id: projectId,
      p_entry_ids: entryIds,
      p_category_id: categoryId,
      p_status: status
    });
    await Promise.all([fetchCosts(), fetchTimeEntries()]);
    return error ? (error.message || 'Could not bill the logged time. Please try again.') : null;
  };

  // Cost changes can bill or unbill hours, so refresh the Time Tracking list too.
  const refreshCostsAndTime = async () => {
    await fetchCosts();
    if (isAdmin) fetchTimeEntries();
  };

  const fetchTimeEntries = async () => {
    const { data, error } = await supabase
      .from('time_entries')
      .select('*')
      .eq('org_id', organization.id)
      .order('entry_date', { ascending: false })
      .order('id', { ascending: false })
      .limit(50);
    if (!error) setTimeEntries(data);
  };

  const [showAddForm, setShowAddForm] = useState(false);
  const [newProject, setNewProject] = useState(emptyProject);
  const [projectError, setProjectError] = useState('');
  const [editingId, setEditingId] = useState(null); // null = adding a new project
  const [confirmDeleteId, setConfirmDeleteId] = useState(null); // project waiting for delete confirmation
  const [deleteError, setDeleteError] = useState('');
  const [chartCurrency, setChartCurrency] = useState(DEFAULT_CURRENCY);

  const calculateMetrics = () => {
    const total = projects.length;
    const completed = projects.filter(p => p.status === 'Completed').length;
    const inProgress = projects.filter(p => p.status === 'In Progress').length;
    const avgProgress = total === 0 ? 0 : projects.reduce((sum, p) => sum + p.progress, 0) / total;

    return { total, completed, inProgress, avgProgress };
  };

  const metrics = calculateMetrics();

  const closeProjectForm = () => {
    setShowAddForm(false);
    setEditingId(null);
    setNewProject(emptyProject);
    setProjectError('');
  };

  const openNewProjectForm = () => {
    if (showAddForm && editingId === null) return closeProjectForm();
    setEditingId(null);
    setNewProject(emptyProject);
    setProjectError('');
    setShowAddForm(true);
  };

  // Open the same form, filled in with an existing project's details.
  const startEditing = (project) => {
    setEditingId(project.id);
    setNewProject({
      name: project.name,
      status: project.status,
      progress: String(project.progress ?? 0),
      startDate: project.startDate || '',
      endDate: project.endDate || '',
      owner: project.owner || '',
      budget: String(project.budget),
      spent: String(project.spent),
      hourlyRate: Number(project.hourly_rate) ? String(Number(project.hourly_rate)) : '',
      currency: project.currency
    });
    setProjectError('');
    setShowAddForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // A project's currency is fixed once it has cost categories, so their amounts keep their meaning.
  const currencyLocked = editingId !== null && categories.some(c => c.project_id === editingId);

  const saveProject = async () => {
    if (!newProject.name.trim() || !newProject.startDate || !newProject.endDate) {
      setProjectError('Add a project name, start date and end date.');
      return;
    }
    if (newProject.endDate < newProject.startDate) {
      setProjectError('The end date can’t be before the start date.');
      return;
    }
    // Budget and Amount Spent: 0 or more, up to 2 decimal places; blank counts as 0.
    const budget = parseMoney(newProject.budget);
    if (budget === null) {
      setProjectError('Budget must be 0 or more, with up to 2 decimal places.');
      return;
    }
    const spent = parseMoney(newProject.spent);
    if (spent === null) {
      setProjectError('Amount Spent must be 0 or more, with up to 2 decimal places.');
      return;
    }
    const hourlyRate = parseMoney(newProject.hourlyRate);
    if (hourlyRate === null) {
      setProjectError('Hourly Rate must be 0 or more, with up to 2 decimal places.');
      return;
    }
    // Progress: a whole number from 0 to 100; blank counts as 0.
    const progress = newProject.progress === '' ? 0 : Number(newProject.progress);
    if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
      setProjectError('Progress must be a whole number from 0 to 100.');
      return;
    }
    const details = {
      name: newProject.name.trim(),
      status: newProject.status,
      progress,
      start_date: newProject.startDate,
      end_date: newProject.endDate,
      owner: newProject.owner,
      budget,
      spent,
      hourly_rate: hourlyRate,
      currency: newProject.currency
    };
    const { error } = editingId === null
      ? await supabase.from('projects').insert({ org_id: organization.id, ...details })
      : await supabase.from('projects').update(details).eq('id', editingId);
    if (error) {
      setProjectError('Could not save the project. Please try again.');
      return;
    }
    closeProjectForm();
    fetchProjects();
  };

  // Deleting a project also deletes its cost categories and items, so it's confirmed first.
  const deleteProject = async (id) => {
    const { error } = await supabase.from('projects').delete().eq('id', id);
    if (error) {
      setDeleteError('Could not delete the project. Please try again.');
      return;
    }
    setConfirmDeleteId(null);
    setDeleteError('');
    if (editingId === id) closeProjectForm();
    if (openCostsFor === id) setOpenCostsFor(null);
    fetchProjects();
    fetchCosts();
  };

  const addTimeEntry = async () => {
    const hours = Number(newEntry.hours);
    if (!newEntry.projectId || !newEntry.date || !(hours > 0) || hours > 24) {
      setTimeError('Choose a project, a date, and hours between 0 and 24.');
      return;
    }
    const { error } = await supabase.from('time_entries').insert({
      org_id: organization.id,
      project_id: Number(newEntry.projectId),
      user_id: user.id,
      entry_date: newEntry.date,
      hours,
      note: newEntry.note
    });
    if (error) {
      setTimeError('Could not log time. Please try again.');
      return;
    }
    setTimeError('');
    setNewEntry({ projectId: newEntry.projectId, date: todayStr(), hours: '', note: '' });
    fetchTimeEntries();
    fetchUnbilledTime();
  };

  const deleteTimeEntry = async (id) => {
    const { error } = await supabase.from('time_entries').delete().eq('id', id);
    if (!error) {
      fetchTimeEntries();
      fetchUnbilledTime();
    }
  };

  const projectName = (id) => projects.find(p => p.id === id)?.name || 'Unknown project';

  const getStatusColor = (status) => {
    switch(status) {
      case 'Completed': return 'bg-green-100 text-green-800';
      case 'In Progress': return 'bg-blue-100 text-blue-800';
      case 'Planning': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getDaysRemaining = (endDate) => {
    const end = new Date(endDate);
    const today = new Date();
    const diff = Math.ceil((end - today) / (1000 * 60 * 60 * 24));
    return diff;
  };

  const getGanttPosition = (startDate, endDate) => {
    const projectStart = new Date(startDate);
    const projectEnd = new Date(endDate);

    const allDates = projects.flatMap(p => [new Date(p.startDate), new Date(p.endDate)]);
    const minDate = new Date(Math.min(...allDates));
    const maxDate = new Date(Math.max(...allDates));

    const totalDays = (maxDate - minDate) / (1000 * 60 * 60 * 24);
    const startOffset = ((projectStart - minDate) / (1000 * 60 * 60 * 24)) / totalDays * 100;
    const duration = ((projectEnd - projectStart) / (1000 * 60 * 60 * 24)) / totalDays * 100;

    return { left: `${startOffset}%`, width: `${duration}%` };
  };

  // A project's Amount Spent = what was entered on the project + its cost items marked Paid.
  const itemsFor = (projectId) => costItems.filter(i => i.project_id === projectId);
  const spentFor = (project) => sumMoney([project.spent, itemTotals(itemsFor(project.id)).paid]);

  // The Budget Overview compares projects in one currency at a time, so amounts are never mixed.
  const budgetData = projects
    .filter(p => p.currency === chartCurrency)
    .map(p => ({ name: p.name, Budget: p.budget, Spent: spentFor(p) }));
  const projectCountFor = (code) => projects.filter(p => p.currency === code).length;
  const formSymbol = CURRENCIES[newProject.currency].symbol;

  const inputClass = "px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <>
      <SignedOut>
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-8">
          <div className="bg-white p-10 rounded-xl shadow-md border border-slate-200 text-center max-w-sm">
            <h1 className="text-2xl font-bold text-slate-800 mb-2">Project Dashboard</h1>
            <p className="text-slate-600 mb-6">Please sign in to view your projects</p>
            <SignInButton mode="modal">
              <button className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors shadow-lg">
                Sign In
              </button>
            </SignInButton>
          </div>
        </div>
      </SignedOut>
      <SignedIn>
      {!organization ? (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-8">
          <div className="bg-white p-10 rounded-xl shadow-md border border-slate-200 text-center">
            <h1 className="text-2xl font-bold text-slate-800 mb-2">Create Your Team</h1>
            <p className="text-slate-600 mb-6">Set up an organization to start adding projects</p>
            <CreateOrganization />
          </div>
        </div>
      ) : (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-4xl font-bold text-slate-800 mb-2">Project Dashboard</h1>
            <p className="text-slate-600">Track and manage your projects in real-time</p>
          </div>
          <div className="flex items-center gap-4">
            <OrganizationSwitcher />
            {isAdmin && (
              <button
                onClick={openNewProjectForm}
                className="flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors shadow-lg"
              >
                <Plus size={20} />
                Add Project
              </button>
            )}
            <UserButton />
          </div>
        </div>

        {/* Metrics Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white p-6 rounded-xl shadow-md border border-slate-200">
            <div className="flex items-center justify-between mb-2">
              <div className="text-slate-600 text-sm font-medium">Total Projects</div>
              <TrendingUp className="text-blue-500" size={20} />
            </div>
            <div className="text-3xl font-bold text-slate-800">{metrics.total}</div>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-md border border-slate-200">
            <div className="flex items-center justify-between mb-2">
              <div className="text-slate-600 text-sm font-medium">In Progress</div>
              <Clock className="text-yellow-500" size={20} />
            </div>
            <div className="text-3xl font-bold text-slate-800">{metrics.inProgress}</div>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-md border border-slate-200">
            <div className="flex items-center justify-between mb-2">
              <div className="text-slate-600 text-sm font-medium">Completed</div>
              <CheckCircle className="text-green-500" size={20} />
            </div>
            <div className="text-3xl font-bold text-slate-800">{metrics.completed}</div>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-md border border-slate-200">
            <div className="flex items-center justify-between mb-2">
              <div className="text-slate-600 text-sm font-medium">Avg Progress</div>
              <AlertCircle className="text-purple-500" size={20} />
            </div>
            <div className="text-3xl font-bold text-slate-800">{metrics.avgProgress.toFixed(0)}%</div>
          </div>
        </div>

        {/* Add Project Form */}
        {showAddForm && isAdmin && (
          <div className="bg-white p-6 rounded-xl shadow-md border border-slate-200 mb-8">
            <h2 className="text-xl font-bold text-slate-800 mb-4">
              {editingId === null ? 'Add New Project' : `Edit Project: ${projects.find(p => p.id === editingId)?.name ?? ''}`}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input
                type="text"
                placeholder="Project Name"
                value={newProject.name}
                onChange={(e) => setNewProject({...newProject, name: e.target.value})}
                className={inputClass}
              />
              <select
                value={newProject.status}
                onChange={(e) => setNewProject({...newProject, status: e.target.value})}
                className={inputClass}
              >
                <option>Planning</option>
                <option>In Progress</option>
                <option>Completed</option>
              </select>
              <input
                type="date"
                placeholder="Start Date"
                value={newProject.startDate}
                onChange={(e) => setNewProject({...newProject, startDate: e.target.value})}
                className={inputClass}
              />
              <input
                type="date"
                placeholder="End Date"
                value={newProject.endDate}
                onChange={(e) => setNewProject({...newProject, endDate: e.target.value})}
                className={inputClass}
              />
              <input
                type="text"
                placeholder="Project Owner"
                value={newProject.owner}
                onChange={(e) => setNewProject({...newProject, owner: e.target.value})}
                className={inputClass}
              />
              <select
                aria-label="Currency"
                value={newProject.currency}
                disabled={currencyLocked}
                title={currencyLocked ? 'Currency can’t change once the project has cost categories' : undefined}
                onChange={(e) => setNewProject({...newProject, currency: e.target.value})}
                className={`${inputClass} disabled:bg-slate-100 disabled:text-slate-500`}
              >
                {Object.entries(CURRENCIES).map(([code, c]) => (
                  <option key={code} value={code}>Currency: {c.label}</option>
                ))}
              </select>
              <input
                type="text"
                inputMode="decimal"
                placeholder={`Budget in ${formSymbol} (0 if free)`}
                value={newProject.budget}
                onChange={(e) => {
                  if (MONEY_TYPING.test(e.target.value)) setNewProject({...newProject, budget: e.target.value});
                }}
                className={inputClass}
              />
              <label className="flex items-center gap-2">
                <span className="text-sm text-slate-600 whitespace-nowrap">Progress %</span>
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label="Progress (0 to 100)"
                  placeholder="0 to 100"
                  value={newProject.progress}
                  onChange={(e) => {
                    // Whole numbers 0 to 100 only; a leading zero is dropped (so "05" becomes "5").
                    const v = e.target.value;
                    if (v === '') return setNewProject({...newProject, progress: ''});
                    if (/^\d{1,3}$/.test(v) && Number(v) <= 100) {
                      setNewProject({...newProject, progress: String(Number(v))});
                    }
                  }}
                  className={`${inputClass} flex-1 min-w-0`}
                />
              </label>
              <input
                type="text"
                inputMode="decimal"
                placeholder={`Spent so far, not itemised, in ${formSymbol} (0 if none)`}
                value={newProject.spent}
                onChange={(e) => {
                  if (MONEY_TYPING.test(e.target.value)) setNewProject({...newProject, spent: e.target.value});
                }}
                className={inputClass}
              />
              <input
                type="text"
                inputMode="decimal"
                placeholder={`Hourly Rate in ${formSymbol} (for time tracking)`}
                value={newProject.hourlyRate}
                onChange={(e) => {
                  if (MONEY_TYPING.test(e.target.value)) setNewProject({...newProject, hourlyRate: e.target.value});
                }}
                className={inputClass}
              />
            </div>
            <div className="flex gap-4 mt-4">
              <button
                onClick={saveProject}
                className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors"
              >
                {editingId === null ? 'Save Project' : 'Save Changes'}
              </button>
              <button
                onClick={closeProjectForm}
                className="bg-slate-200 text-slate-700 px-6 py-2 rounded-lg hover:bg-slate-300 transition-colors"
              >
                Cancel
              </button>
            </div>
            {currencyLocked && (
              <p className="text-slate-500 text-sm mt-3">The currency is fixed because this project already has cost categories.</p>
            )}
            {projectError && <p className="text-red-600 text-sm mt-3">{projectError}</p>}
          </div>
        )}

        {/* Gantt Chart */}
        <div className="bg-white p-6 rounded-xl shadow-md border border-slate-200 mb-8">
          <h2 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
            <Calendar size={24} />
            Project Timeline
          </h2>
          <div className="overflow-x-auto">
            <div className="min-w-full">
              {loading && <p className="text-slate-500 text-sm">Loading projects...</p>}
              {!loading && projects.length === 0 && (
                <p className="text-slate-500 text-sm">No projects yet — add your first one above.</p>
              )}
              {!loading && projects.map((project) => {
                const position = getGanttPosition(project.startDate, project.endDate);
                return (
                  <div key={project.id} className="mb-4">
                    <div className="flex items-center mb-1">
                      <div className="w-48 text-sm font-medium text-slate-700 truncate">
                        {project.name}
                      </div>
                      <div className="flex-1 relative h-10 bg-slate-100 rounded-lg">
                        <div
                          className="absolute h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg flex items-center justify-center text-white text-xs font-medium shadow-md"
                          style={position}
                        >
                          {project.progress}%
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center ml-48 text-xs text-slate-500">
                      {project.startDate} → {project.endDate}
                      <span className="ml-4 text-slate-600">
                        {getDaysRemaining(project.endDate) > 0
                          ? `${getDaysRemaining(project.endDate)} days remaining`
                          : 'Overdue'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Budget Chart */}
        <div className="bg-white p-6 rounded-xl shadow-md border border-slate-200 mb-8">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-xl font-bold text-slate-800">Budget Overview</h2>
            <div className="flex gap-2" role="group" aria-label="Show projects in currency">
              {Object.entries(CURRENCIES).map(([code, c]) => (
                <button
                  key={code}
                  onClick={() => setChartCurrency(code)}
                  aria-pressed={chartCurrency === code}
                  className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                    chartCurrency === code
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {c.label} · {projectCountFor(code)}
                </button>
              ))}
            </div>
          </div>
          {budgetData.length === 0 ? (
            <p className="text-slate-500 text-sm">No projects in {chartCurrency} yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={budgetData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis width={80} tickFormatter={(v) => formatMoney(v, chartCurrency)} />
                <Tooltip formatter={(v) => formatMoney(v, chartCurrency)} />
                <Legend />
                <Bar dataKey="Budget" fill="#3b82f6" />
                <Bar dataKey="Spent" fill="#10b981" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Time Tracking (admins only) */}
        {isAdmin && (
          <div className="bg-white p-6 rounded-xl shadow-md border border-slate-200 mb-8">
            <h2 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
              <Clock size={24} />
              Time Tracking
            </h2>

            {projects.length === 0 ? (
              <p className="text-slate-500 text-sm">Add a project first, then you can log time against it.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                <select
                  value={newEntry.projectId}
                  onChange={(e) => setNewEntry({...newEntry, projectId: e.target.value})}
                  className={inputClass}
                >
                  <option value="">Select project</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <input
                  type="date"
                  value={newEntry.date}
                  onChange={(e) => setNewEntry({...newEntry, date: e.target.value})}
                  className={inputClass}
                />
                <input
                  type="number"
                  min="0"
                  max="24"
                  step="0.25"
                  placeholder="Hours"
                  value={newEntry.hours}
                  onChange={(e) => setNewEntry({...newEntry, hours: e.target.value})}
                  className={inputClass}
                />
                <input
                  type="text"
                  placeholder="Note (optional)"
                  value={newEntry.note}
                  onChange={(e) => setNewEntry({...newEntry, note: e.target.value})}
                  className={inputClass}
                />
                <button
                  onClick={addTimeEntry}
                  className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Log Time
                </button>
              </div>
            )}

            {timeError && <p className="text-red-600 text-sm mt-3">{timeError}</p>}

            <div className="overflow-x-auto mt-6">
              {timeEntries.length === 0 ? (
                <p className="text-slate-500 text-sm">No time logged yet.</p>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Date</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Project</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Hours</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Note</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">By</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {timeEntries.map((entry) => (
                      <tr key={entry.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="py-3 px-4 text-sm text-slate-600">{entry.entry_date}</td>
                        <td className="py-3 px-4 text-sm text-slate-800 font-medium">{projectName(entry.project_id)}</td>
                        <td className="py-3 px-4 text-sm text-slate-600">{Number(entry.hours)}h</td>
                        <td className="py-3 px-4 text-sm text-slate-600">{entry.note}</td>
                        <td className="py-3 px-4 text-sm text-slate-600">
                          {entry.user_id === user.id ? 'You' : 'Teammate'}
                        </td>
                        <td className="py-3 px-4">
                          {entry.cost_item_id ? (
                            <span
                              className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800"
                              title="These hours are on a cost item. Delete that cost item to unbill them."
                            >
                              Billed
                            </span>
                          ) : entry.user_id === user.id && (
                            <button
                              onClick={() => deleteTimeEntry(entry.id)}
                              aria-label="Delete time entry"
                              className="text-red-600 hover:text-red-800 transition-colors"
                            >
                              <Trash2 size={18} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* Project List */}
        <div className="bg-white p-6 rounded-xl shadow-md border border-slate-200">
          <h2 className="text-xl font-bold text-slate-800 mb-4">Project Details</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Project</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Owner</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Status</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Progress</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Spent / Budget</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Costs</th>
                  {isAdmin && <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <React.Fragment key={project.id}>
                  <tr className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-3 px-4 text-sm text-slate-800 font-medium">{project.name}</td>
                    <td className="py-3 px-4 text-sm text-slate-600">{project.owner}</td>
                    <td className="py-3 px-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(project.status)}`}>
                        {project.status}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-slate-200 rounded-full h-2">
                          <div
                            className="bg-blue-600 h-2 rounded-full"
                            style={{ width: `${project.progress}%` }}
                          />
                        </div>
                        <span className="text-sm text-slate-600 w-12">{project.progress}%</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-600">
                      {formatMoney(spentFor(project), project.currency)} / {formatMoney(project.budget, project.currency)}
                    </td>
                    <td className="py-3 px-4">
                      <button
                        onClick={() => setOpenCostsFor(openCostsFor === project.id ? null : project.id)}
                        aria-expanded={openCostsFor === project.id}
                        className="text-sm text-blue-700 hover:text-blue-900 whitespace-nowrap"
                      >
                        {openCostsFor === project.id ? 'Hide costs' : `Costs (${itemsFor(project.id).length})`}
                      </button>
                    </td>
                    {isAdmin && (
                      <td className="py-3 px-4">
                        {confirmDeleteId === project.id ? (
                          <div className="text-sm min-w-[12rem]" role="alert">
                            <p className="text-slate-700 mb-1">
                              Delete <strong>{project.name}</strong>
                              {itemsFor(project.id).length > 0 || categories.some(c => c.project_id === project.id)
                                ? ' and all its costs' : ''}? This can’t be undone.
                            </p>
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => deleteProject(project.id)}
                                className="text-red-700 font-semibold hover:underline"
                              >
                                Delete
                              </button>
                              <button
                                onClick={() => { setConfirmDeleteId(null); setDeleteError(''); }}
                                className="text-slate-600 hover:underline"
                              >
                                Keep
                              </button>
                            </div>
                            {deleteError && <p className="text-red-600 text-xs mt-1">{deleteError}</p>}
                          </div>
                        ) : (
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => startEditing(project)}
                              aria-label={`Edit ${project.name}`}
                              title="Edit project"
                              className="text-blue-600 hover:text-blue-800 transition-colors"
                            >
                              <Pencil size={18} />
                            </button>
                            <button
                              onClick={() => { setConfirmDeleteId(project.id); setDeleteError(''); }}
                              aria-label={`Delete ${project.name}`}
                              title="Delete project"
                              className="text-red-600 hover:text-red-800 transition-colors"
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                  {openCostsFor === project.id && (
                    <tr className="border-b border-slate-100">
                      <td colSpan={isAdmin ? 7 : 6} className="p-4">
                        <CostsPanel
                          project={project}
                          categories={categories.filter(c => c.project_id === project.id)}
                          items={itemsFor(project.id)}
                          isAdmin={isAdmin}
                          supabase={supabase}
                          orgId={organization.id}
                          onChanged={refreshCostsAndTime}
                          unbilledTime={unbilledTime.filter(t => t.project_id === project.id)}
                          onBillTime={billLoggedTime}
                        />
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
      )}
      </SignedIn>
    </>
  );
};

export default ProjectDashboard;
