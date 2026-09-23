import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Calendar, Plus, Trash2, TrendingUp, Clock, CheckCircle, AlertCircle } from 'lucide-react';
import { SignedIn, SignedOut, SignInButton, UserButton, useUser, useSession, useOrganization, CreateOrganization, OrganizationSwitcher } from '@clerk/clerk-react';
import { createClient } from '@supabase/supabase-js';

function useSupabaseClient() {
  const { session } = useSession();
  return createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
    { accessToken: async () => session?.getToken() ?? null }
  );
}

const ProjectDashboard = () => {
  const { user } = useUser();
  const { organization, membership } = useOrganization();
  const isAdmin = membership?.role === 'org:admin';
  const supabase = useSupabaseClient();
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState([]);

  useEffect(() => {
    if (organization) fetchProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization]);

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
        startDate: p.start_date,
        endDate: p.end_date
      })));
    }
    setLoading(false);
  };

  const [showAddForm, setShowAddForm] = useState(false);
  const [newProject, setNewProject] = useState({
    name: '',
    status: 'Planning',
    progress: 0,
    startDate: '',
    endDate: '',
    owner: '',
    budget: 0,
    spent: 0
  });

  const calculateMetrics = () => {
    const total = projects.length;
    const completed = projects.filter(p => p.status === 'Completed').length;
    const inProgress = projects.filter(p => p.status === 'In Progress').length;
    const totalBudget = projects.reduce((sum, p) => sum + p.budget, 0);
    const totalSpent = projects.reduce((sum, p) => sum + p.spent, 0);
    const avgProgress = total === 0 ? 0 : projects.reduce((sum, p) => sum + p.progress, 0) / total;

    return { total, completed, inProgress, totalBudget, totalSpent, avgProgress };
  };

  const metrics = calculateMetrics();

  const addProject = async () => {
    if (newProject.name && newProject.startDate && newProject.endDate) {
      const { error } = await supabase.from('projects').insert({
        org_id: organization.id,
        name: newProject.name,
        status: newProject.status,
        progress: newProject.progress,
        start_date: newProject.startDate,
        end_date: newProject.endDate,
        owner: newProject.owner,
        budget: newProject.budget,
        spent: newProject.spent
      });
      if (!error) {
        fetchProjects();
        setNewProject({
          name: '',
          status: 'Planning',
          progress: 0,
          startDate: '',
          endDate: '',
          owner: '',
          budget: 0,
          spent: 0
        });
        setShowAddForm(false);
      }
    }
  };

  const deleteProject = async (id) => {
    const { error } = await supabase.from('projects').delete().eq('id', id);
    if (!error) fetchProjects();
  };

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

  const budgetData = projects.map(p => ({
    name: p.name,
    Budget: p.budget,
    Spent: p.spent
  }));

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
                onClick={() => setShowAddForm(!showAddForm)}
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
            <h2 className="text-xl font-bold text-slate-800 mb-4">Add New Project</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input
                type="text"
                placeholder="Project Name"
                value={newProject.name}
                onChange={(e) => setNewProject({...newProject, name: e.target.value})}
                className="px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <select
                value={newProject.status}
                onChange={(e) => setNewProject({...newProject, status: e.target.value})}
                className="px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                className="px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="date"
                placeholder="End Date"
                value={newProject.endDate}
                onChange={(e) => setNewProject({...newProject, endDate: e.target.value})}
                className="px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="text"
                placeholder="Project Owner"
                value={newProject.owner}
                onChange={(e) => setNewProject({...newProject, owner: e.target.value})}
                className="px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="number"
                placeholder="Budget"
                value={newProject.budget || ''}
                onChange={(e) => setNewProject({...newProject, budget: Number(e.target.value)})}
                className="px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="number"
                placeholder="Progress (0-100)"
                value={newProject.progress || ''}
                onChange={(e) => setNewProject({...newProject, progress: Math.min(100, Number(e.target.value))})}
                className="px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="number"
                placeholder="Amount Spent"
                value={newProject.spent || ''}
                onChange={(e) => setNewProject({...newProject, spent: Number(e.target.value)})}
                className="px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex gap-4 mt-4">
              <button
                onClick={addProject}
                className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Save Project
              </button>
              <button
                onClick={() => setShowAddForm(false)}
                className="bg-slate-200 text-slate-700 px-6 py-2 rounded-lg hover:bg-slate-300 transition-colors"
              >
                Cancel
              </button>
            </div>
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
          <h2 className="text-xl font-bold text-slate-800 mb-4">Budget Overview</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={budgetData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="Budget" fill="#3b82f6" />
              <Bar dataKey="Spent" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </div>

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
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Budget</th>
                  {isAdmin && <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.id} className="border-b border-slate-100 hover:bg-slate-50">
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
                      ${project.spent.toLocaleString()} / ${project.budget.toLocaleString()}
                    </td>
                    {isAdmin && (
                      <td className="py-3 px-4">
                        <button
                          onClick={() => deleteProject(project.id)}
                          className="text-red-600 hover:text-red-800 transition-colors"
                        >
                          <Trash2 size={18} />
                        </button>
                      </td>
                    )}
                  </tr>
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
