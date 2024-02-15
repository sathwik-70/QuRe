import React, { useState, useEffect } from 'react';
import { UserProfile, UserRole, AccessLog, HospitalRegistryEntry } from '../types';
import { supabase } from '../services/supabase';

const AdminDashboard: React.FC<{ user: UserProfile }> = ({ user }) => {
  const [view, setView] = useState<'OVERVIEW' | 'HOSPITALS' | 'PATIENTS' | 'LOGS'>('OVERVIEW');
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [allowlist, setAllowlist] = useState<HospitalRegistryEntry[]>([]);
  const [logs, setLogs] = useState<AccessLog[]>([]);
  const [loading, setLoading] = useState(false);
  
  // New Hospital Form
  const [newHospital, setNewHospital] = useState({ name: '', email: '' });
  
  // Edit State
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [editForm, setEditForm] = useState({ full_name: '', is_verified: false });

  // Delete State
  const [deleteTarget, setDeleteTarget] = useState<UserProfile | null>(null);

  useEffect(() => { fetchUsers(); fetchAllowlist(); fetchLogs(); }, []);

  const fetchUsers = async () => {
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
    if (data) setUsers(data as UserProfile[]);
  };

  const fetchAllowlist = async () => {
    const { data } = await supabase.from('hospital_allowlist').select('*').order('created_at', { ascending: false });
    if (data) setAllowlist(data as HospitalRegistryEntry[]);
  };

  const fetchLogs = async () => {
    const { data } = await supabase.from('access_logs').select('*').order('accessed_at', { ascending: false }).limit(100);
    if (data) setLogs(data as AccessLog[]);
  };

  const registerNode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHospital.email || !newHospital.name) return;
    setLoading(true);
    try {
        // 1. Add to Allowlist (Registry)
        const { error: regError } = await supabase.from('hospital_allowlist').upsert({
            email: newHospital.email.toLowerCase().trim(),
            hospital_name: newHospital.name.trim(),
            created_by: user.id
        });
        if (regError) throw regError;

        // 2. Check if user exists in profiles (e.g. they signed up already) and verify them
        const existingUser = users.find(u => u.email === newHospital.email.toLowerCase().trim());
        if (existingUser) {
            await supabase.from('profiles').update({ 
                is_verified: true, 
                role: UserRole.HOSPITAL, 
                full_name: newHospital.name.trim() 
            }).eq('id', existingUser.id);
            alert("Hospital added to registry AND existing account verified!");
        } else {
            alert("Hospital added to registry. They will be auto-verified upon sign-up.");
        }

        setNewHospital({ name: '', email: '' });
        await fetchUsers();
        await fetchAllowlist();
    } catch (err: any) {
        alert("Registration Failed: " + err.message);
    } finally {
        setLoading(false);
    }
  };

  const verifyHospital = async (u: UserProfile) => {
    try {
      setLoading(true);
      // 1. Update Profile
      const { error } = await supabase.from('profiles').update({ is_verified: true }).eq('id', u.id);
      if (error) throw error;

      // 2. Sync to Allowlist (Ensure permanence)
      await supabase.from('hospital_allowlist').upsert({
          email: u.email,
          hospital_name: u.full_name,
          created_by: user.id
      });

      await fetchUsers();
      await fetchAllowlist();
    } catch (err: any) {
      alert("Verification Failed: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const deleteRegistryEntry = async (email: string) => {
      if(!confirm(`Remove ${email} from registry? This will prevent auto-verification.`)) return;
      setLoading(true);
      try {
          const { error } = await supabase.from('hospital_allowlist').delete().eq('email', email);
          if (error) throw error;
          await fetchAllowlist();
      } catch(e: any) {
          alert("Error: " + e.message);
      } finally {
          setLoading(false);
      }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setLoading(true);
    try {
      // Try to use the new RPC to completely delete the user
      const { error: rpcError } = await supabase.rpc('admin_delete_user', { target_user_id: deleteTarget.id });
      
      if (rpcError) {
        // Fallback to just revoking access if RPC doesn't exist yet
        console.warn("RPC failed, falling back to revoke:", rpcError);
        const { error } = await supabase.from('profiles').update({ is_verified: false }).eq('id', deleteTarget.id);
        if (error) throw error;
      }
      
      // If deleting a hospital, optionally remove from allowlist too
      if (deleteTarget.role === UserRole.HOSPITAL) {
         await supabase.from('hospital_allowlist').delete().eq('email', deleteTarget.email);
      }

      await fetchUsers();
      await fetchAllowlist();
      setDeleteTarget(null);
    } catch (err: any) {
      alert("Action Failed: " + (err.message || "Unknown Error"));
    } finally {
      setLoading(false);
    }
  };
  
  const openEdit = (u: UserProfile) => {
    setEditingUser(u);
    setEditForm({ full_name: u.full_name, is_verified: u.is_verified || false });
  };
  
  const saveEdit = async () => {
    if (!editingUser) return;
    setLoading(true);
    try {
        const { error } = await supabase.from('profiles').update({
            full_name: editForm.full_name,
            is_verified: editForm.is_verified
        }).eq('id', editingUser.id);
        
        if (error) throw error;
        
        // If hospital, ensure allowlist matches
        if (editingUser.role === UserRole.HOSPITAL) {
             const { error: allowError } = await supabase.from('hospital_allowlist')
                .upsert({ 
                    email: editingUser.email,
                    hospital_name: editForm.full_name,
                    created_by: user.id 
                 });
             
             if (allowError) console.warn("Could not sync allowlist name:", allowError.message);
        }

        await fetchUsers();
        await fetchAllowlist();
        setEditingUser(null);
    } catch (err: any) {
        alert("Update failed: " + err.message);
    } finally {
        setLoading(false);
    }
  };

  // Derived Lists
  const pendingHospitals = users.filter(u => u.role === UserRole.HOSPITAL && !u.is_verified);
  const activeHospitals = users.filter(u => u.role === UserRole.HOSPITAL && u.is_verified);
  const patients = users.filter(u => u.role === UserRole.PATIENT);
  
  // Find entries in Allowlist that do NOT correspond to a registered user
  const unclaimedNodes = allowlist.filter(entry => !users.some(u => u.email === entry.email));

  const stats = {
    active_hospitals: activeHospitals.length,
    patients: patients.length,
    pending: pendingHospitals.length,
    unclaimed: unclaimedNodes.length,
    logs: logs.length
  };

  return (
    <div className="max-w-7xl mx-auto animate-enter min-h-screen">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-12 gap-6">
        <div>
          <h1 className="text-4xl md:text-5xl font-serif font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-200 via-teal-400 to-cyan-500 mb-2">Governance Console</h1>
          <p className="text-emerald-400/80 text-xs font-bold uppercase tracking-[0.2em] flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]"></span>
            Network Infrastructure
          </p>
        </div>
        <div className="flex bg-black/20 p-1 rounded-2xl border border-white/10 backdrop-blur-md shadow-lg w-full md:w-auto relative overflow-hidden">
          <div className={`absolute top-1 bottom-1 w-[25%] bg-white/10 rounded-xl transition-all duration-300 ease-out border border-white/10 ${view === 'HOSPITALS' ? 'left-[25%]' : view === 'PATIENTS' ? 'left-[50%]' : view === 'LOGS' ? 'left-[75%]' : 'left-0'}`}></div>
          <button id="tab-admin-overview" onClick={() => setView('OVERVIEW')} className={`relative z-10 flex-1 md:flex-none px-2 sm:px-4 md:px-6 py-2.5 rounded-xl text-[9px] sm:text-[10px] md:text-xs font-bold uppercase tracking-wider transition-all ${view === 'OVERVIEW' ? 'text-white' : 'text-white/40 hover:text-white'}`}>Overview</button>
          <button id="tab-admin-nodes" onClick={() => setView('HOSPITALS')} className={`relative z-10 flex-1 md:flex-none px-2 sm:px-4 md:px-6 py-2.5 rounded-xl text-[9px] sm:text-[10px] md:text-xs font-bold uppercase tracking-wider transition-all ${view === 'HOSPITALS' ? 'text-white' : 'text-white/40 hover:text-white'}`}>Nodes</button>
          <button id="tab-admin-users" onClick={() => setView('PATIENTS')} className={`relative z-10 flex-1 md:flex-none px-2 sm:px-4 md:px-6 py-2.5 rounded-xl text-[9px] sm:text-[10px] md:text-xs font-bold uppercase tracking-wider transition-all ${view === 'PATIENTS' ? 'text-white' : 'text-white/40 hover:text-white'}`}>Users</button>
          <button id="tab-admin-logs" onClick={() => setView('LOGS')} className={`relative z-10 flex-1 md:flex-none px-2 sm:px-4 md:px-6 py-2.5 rounded-xl text-[9px] sm:text-[10px] md:text-xs font-bold uppercase tracking-wider transition-all ${view === 'LOGS' ? 'text-white' : 'text-white/40 hover:text-white'}`}>Logs</button>
        </div>
      </div>

      {view === 'OVERVIEW' && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 animate-enter">
          <div className="glass-panel p-8 rounded-[2rem] bg-gradient-to-br from-emerald-900/40 via-emerald-800/10 to-transparent border-emerald-500/20 hover:border-emerald-500/40 transition duration-500 group">
            <div className="text-4xl mb-4 grayscale group-hover:grayscale-0 transition duration-500">🏥</div>
            <h3 className="text-3xl font-bold text-white mb-1">{stats.active_hospitals}</h3>
            <p className="text-emerald-500/50 text-xs font-bold uppercase tracking-widest">Active Nodes</p>
          </div>
          <div className="glass-panel p-8 rounded-[2rem] bg-gradient-to-br from-blue-900/40 via-blue-800/10 to-transparent border-blue-500/20 hover:border-blue-500/40 transition duration-500 group">
             <div className="text-4xl mb-4 grayscale group-hover:grayscale-0 transition duration-500">👥</div>
             <h3 className="text-3xl font-bold text-white mb-1">{stats.patients}</h3>
             <p className="text-blue-500/50 text-xs font-bold uppercase tracking-widest">Patients</p>
          </div>
          <div className="glass-panel p-8 rounded-[2rem] bg-gradient-to-br from-yellow-900/40 via-yellow-800/10 to-transparent border-yellow-500/20 hover:border-yellow-500/40 transition duration-500 group">
             <div className="text-4xl mb-4 grayscale group-hover:grayscale-0 transition duration-500">⏳</div>
             <h3 className="text-3xl font-bold text-white mb-1">{stats.pending + stats.unclaimed}</h3>
             <p className="text-yellow-500/50 text-xs font-bold uppercase tracking-widest">Requests / Unclaimed</p>
          </div>
          <div className="glass-panel p-8 rounded-[2rem] bg-gradient-to-br from-purple-900/40 via-purple-800/10 to-transparent border-purple-500/20 hover:border-purple-500/40 transition duration-500 group">
             <div className="text-4xl mb-4 grayscale group-hover:grayscale-0 transition duration-500">📜</div>
             <h3 className="text-3xl font-bold text-white mb-1">{stats.logs}</h3>
             <p className="text-purple-500/50 text-xs font-bold uppercase tracking-widest">Audit Events</p>
          </div>
        </div>
      )}

      {view === 'HOSPITALS' && (
        <div className="grid lg:grid-cols-3 gap-8 animate-enter">
          {/* Register New Node Form */}
          <div className="lg:col-span-1">
             <div className="glass-panel p-8 rounded-[2.5rem] bg-white/5 border-white/10 sticky top-28">
               <div className="flex items-center gap-3 mb-6">
                 <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold text-lg">+</div>
                 <h3 className="text-xl font-serif font-bold text-white">Register Node</h3>
               </div>
               <form onSubmit={registerNode} className="space-y-4">
                 <div className="space-y-1">
                   <label className="text-[10px] uppercase font-bold text-white/40 pl-2">Institution Name</label>
                   <input required value={newHospital.name} onChange={e => setNewHospital({...newHospital, name: e.target.value})} className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-emerald-500/50 transition text-sm text-white" placeholder="e.g. St. Mary's General" />
                 </div>
                 <div className="space-y-1">
                   <label className="text-[10px] uppercase font-bold text-white/40 pl-2">Official Email</label>
                   <input required type="email" value={newHospital.email} onChange={e => setNewHospital({...newHospital, email: e.target.value})} className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-emerald-500/50 transition text-sm text-white" placeholder="admin@stmarys.com" />
                 </div>
                 <button disabled={loading} className="w-full py-4 btn-gradient text-white rounded-xl font-bold uppercase tracking-widest text-xs transition flex items-center justify-center gap-2 mt-4">
                   {loading ? 'Processing...' : 'Add to Registry'}
                 </button>
               </form>
               <p className="mt-6 text-[10px] text-white/30 leading-relaxed border-t border-white/5 pt-4">
                 <strong>Dynamic Registration:</strong> Adding a hospital here instantly authorizes them. If they have a pending request, it will be approved immediately.
               </p>
             </div>
          </div>

          {/* List Section */}
          <div className="lg:col-span-2 space-y-12">
            
            {/* Unclaimed / Pre-authorized Nodes */}
            {unclaimedNodes.length > 0 && (
                <div className="space-y-4">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-2 h-8 bg-blue-400 rounded-full"></div>
                        <h3 className="text-xl font-serif font-bold text-white">Pre-Authorized (Waiting for Sign Up)</h3>
                        <span className="bg-blue-500/20 text-blue-300 px-3 py-1 rounded-full text-xs font-bold">{unclaimedNodes.length}</span>
                    </div>
                    <div className="grid gap-4">
                        {unclaimedNodes.map(node => (
                            <div key={node.email} className="glass-panel p-6 rounded-3xl flex justify-between items-center gap-6 border-l-4 border-l-blue-400 bg-white/5">
                                <div className="flex items-center gap-5">
                                    <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center font-bold text-xl text-blue-400">⏳</div>
                                    <div>
                                        <h4 className="font-bold text-white text-lg">{node.hospital_name}</h4>
                                        <p className="text-xs font-mono text-white/40">{node.email}</p>
                                        <div className="mt-1 inline-flex items-center gap-2 bg-blue-500/10 px-2 py-0.5 rounded text-[10px] text-blue-400 font-bold uppercase tracking-wider">
                                            <span>Registry Only</span>
                                        </div>
                                    </div>
                                </div>
                                <button onClick={() => deleteRegistryEntry(node.email)} disabled={loading} className="p-3 rounded-xl bg-red-500/10 text-red-300 hover:bg-red-500/20 transition border border-red-500/10">
                                   <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Pending Requests */}
            {pendingHospitals.length > 0 && (
                <div className="space-y-4">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-2 h-8 bg-yellow-500 rounded-full"></div>
                        <h3 className="text-xl font-serif font-bold text-white">Pending Requests</h3>
                        <span className="bg-yellow-500/20 text-yellow-300 px-3 py-1 rounded-full text-xs font-bold">{pendingHospitals.length}</span>
                    </div>
                    
                    <div className="grid gap-4">
                        {pendingHospitals.map(u => (
                            <div key={u.id} className="glass-panel p-4 md:p-6 rounded-3xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 md:gap-6 border-l-4 border-l-yellow-500 bg-white/5">
                                <div className="flex items-center gap-4 md:gap-5 w-full md:w-auto">
                                    <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-yellow-500/10 flex items-center justify-center font-bold text-lg md:text-xl text-yellow-500 shrink-0">?</div>
                                    <div className="min-w-0 flex-1">
                                        <h4 className="font-bold text-white text-base md:text-lg truncate">{u.full_name}</h4>
                                        <p className="text-[10px] md:text-xs font-mono text-white/40 truncate">{u.email}</p>
                                        <div className="mt-1 inline-flex items-center gap-2 bg-yellow-500/10 px-2 py-0.5 rounded text-[9px] md:text-[10px] text-yellow-500 font-bold uppercase tracking-wider">
                                            <span>Awaiting Authorization</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex flex-wrap items-center justify-center gap-2 md:gap-3 w-full md:w-auto">
                                    <button onClick={() => openEdit(u)} disabled={loading} className="flex-1 md:flex-none px-4 md:px-6 py-2 md:py-3 rounded-xl bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 text-[10px] md:text-xs font-bold uppercase tracking-wider transition border border-blue-500/10">Edit</button>
                                    <button onClick={() => verifyHospital(u)} disabled={loading} className="flex-1 md:flex-none px-4 md:px-6 py-2 md:py-3 rounded-xl bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 text-[10px] md:text-xs font-bold uppercase tracking-wider transition border border-emerald-500/10">Authorize</button>
                                    <button onClick={() => setDeleteTarget(u)} disabled={loading} className="flex-1 md:flex-none px-4 md:px-6 py-2 md:py-3 rounded-xl bg-red-500/10 text-red-300 hover:bg-red-500/20 text-[10px] md:text-xs font-bold uppercase tracking-wider transition border border-red-500/10">Reject</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Active Section */}
            <div className="space-y-4">
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-2 h-8 bg-emerald-500 rounded-full"></div>
                    <h3 className="text-xl font-serif font-bold text-white">Active Clinical Nodes</h3>
                </div>
                {activeHospitals.length === 0 ? (
                    <div className="p-8 border border-dashed border-white/10 rounded-3xl text-center text-white/30 text-sm">No active hospitals</div>
                ) : (
                    <div className="grid gap-4">
                        {activeHospitals.map(u => (
                            <div key={u.id} className="glass-panel p-4 md:p-5 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 group hover:bg-white/5 transition">
                                <div className="flex items-center gap-4 w-full sm:w-auto min-w-0">
                                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-400 shrink-0">🏥</div>
                                    <div className="min-w-0 flex-1">
                                    <h4 className="font-bold text-white truncate">{u.full_name}</h4>
                                    <p className="text-[10px] md:text-xs font-mono text-emerald-400/60 truncate">{u.email}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 w-full sm:w-auto">
                                    <button onClick={() => openEdit(u)} disabled={loading} className="flex-1 sm:flex-none px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition text-[10px] md:text-xs font-bold uppercase tracking-wider">Edit</button>
                                    <button onClick={() => setDeleteTarget(u)} disabled={loading} className="flex-1 sm:flex-none opacity-80 sm:opacity-50 hover:opacity-100 text-red-400 text-[10px] md:text-xs font-bold uppercase tracking-wider px-4 py-2 hover:bg-red-500/10 rounded-lg transition">Revoke</button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
          </div>
        </div>
      )}

      {view === 'PATIENTS' && (
        <div className="animate-enter space-y-6">
           <div className="flex items-center gap-3 mb-6">
              <div className="w-2 h-8 bg-blue-500 rounded-full"></div>
              <h3 className="text-xl font-serif font-bold text-white">Registered Patients</h3>
           </div>
           <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
             {patients.map(u => (
                <div key={u.id} className="glass-panel p-4 md:p-6 rounded-3xl flex items-center justify-between gap-4 group hover:bg-white/5 transition">
                   <div className="flex items-center gap-3 md:gap-4 overflow-hidden min-w-0">
                       <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-300 text-base md:text-lg font-serif font-bold shrink-0">
                          {u.full_name.charAt(0)}
                       </div>
                       <div className="overflow-hidden min-w-0">
                          <h4 className="font-bold text-white truncate text-sm md:text-base">{u.full_name}</h4>
                          <p className="text-[10px] md:text-xs font-mono text-white/30 truncate">{u.email}</p>
                       </div>
                   </div>
                   <div className="flex gap-1 md:gap-2 shrink-0">
                       <button onClick={() => openEdit(u)} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/40 hover:text-white transition"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg></button>
                       <button onClick={() => setDeleteTarget(u)} className="p-2 rounded-lg bg-red-500/5 hover:bg-red-500/10 text-red-400 hover:text-red-300 transition"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                   </div>
                </div>
             ))}
           </div>
        </div>
      )}

      {view === 'LOGS' && (
        <div className="animate-enter space-y-6">
           <div className="flex items-center justify-between mb-6">
             <div className="flex items-center gap-3">
                <div className="w-2 h-8 bg-purple-500 rounded-full"></div>
                <h3 className="text-xl font-serif font-bold text-white">Security Audit Trail</h3>
             </div>
             <button onClick={fetchLogs} className="text-[10px] uppercase font-bold tracking-widest text-white/40 hover:text-white transition bg-white/5 hover:bg-white/10 px-4 py-2 rounded-lg">Refresh Logs</button>
           </div>
           
           <div className="glass-panel p-6 rounded-[2.5rem] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                   <thead>
                     <tr className="border-b border-white/10">
                       <th className="p-4 text-[10px] uppercase font-bold text-white/40 tracking-widest">Timestamp</th>
                       <th className="p-4 text-[10px] uppercase font-bold text-white/40 tracking-widest">Clinical Node</th>
                       <th className="p-4 text-[10px] uppercase font-bold text-white/40 tracking-widest">Patient ID</th>
                       <th className="p-4 text-[10px] uppercase font-bold text-white/40 tracking-widest">Action</th>
                     </tr>
                   </thead>
                   <tbody className="divide-y divide-white/5">
                     {logs.map((log) => (
                       <tr key={log.id} className="hover:bg-white/5 transition">
                         <td className="p-4 text-xs font-mono text-white/60">{new Date(log.accessed_at).toLocaleString()}</td>
                         <td className="p-4">
                           <div className="flex items-center gap-2">
                             <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                             <span className="text-sm font-bold text-white">{log.hospital_name || 'Unknown Node'}</span>
                           </div>
                         </td>
                         <td className="p-4 text-xs font-mono text-emerald-400">{log.patient_id.substring(0, 8)}...</td>
                         <td className="p-4">
                            <span className="bg-purple-500/10 text-purple-300 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider border border-purple-500/20">Record Access</span>
                         </td>
                       </tr>
                     ))}
                     {logs.length === 0 && (
                       <tr>
                         <td colSpan={4} className="p-8 text-center text-white/30 text-sm">No audit logs available.</td>
                       </tr>
                     )}
                   </tbody>
                </table>
              </div>
           </div>
        </div>
      )}

      {/* EDIT MODAL */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-enter">
            <div className="glass-panel w-full max-w-md p-8 rounded-[2.5rem] border-white/20 shadow-2xl bg-black/40">
                <div className="flex justify-between items-start mb-6">
                    <div>
                        <h3 className="font-serif text-2xl font-bold text-white">Edit User</h3>
                        <p className="text-white/40 text-xs font-mono mt-1">{editingUser.email}</p>
                    </div>
                    <button onClick={() => setEditingUser(null)} className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition">✕</button>
                </div>
                
                <div className="space-y-4">
                    <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-white/50 pl-2">Full Name</label>
                        <input 
                            value={editForm.full_name} 
                            onChange={e => setEditForm({...editForm, full_name: e.target.value})} 
                            className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-emerald-500/50" 
                        />
                    </div>
                    
                    <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-white/50 pl-2">Verification Status</label>
                        <div className="flex items-center gap-3 bg-black/30 p-3 rounded-xl border border-white/10">
                            <button 
                                onClick={() => setEditForm({...editForm, is_verified: !editForm.is_verified})}
                                className={`w-12 h-6 rounded-full relative transition-colors duration-300 ${editForm.is_verified ? 'bg-emerald-500' : 'bg-white/10'}`}
                            >
                                <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-all duration-300 ${editForm.is_verified ? 'left-7' : 'left-1'}`}></div>
                            </button>
                            <span className={`text-sm font-bold ${editForm.is_verified ? 'text-emerald-400' : 'text-white/40'}`}>
                                {editForm.is_verified ? 'Verified' : 'Unverified'}
                            </span>
                        </div>
                    </div>

                    <div className="pt-4 flex gap-3">
                        <button onClick={() => setEditingUser(null)} className="flex-1 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-white/60 font-bold uppercase tracking-widest text-xs transition">Cancel</button>
                        <button onClick={saveEdit} disabled={loading} className="flex-1 py-3 rounded-xl btn-gradient text-white font-bold uppercase tracking-widest text-xs transition shadow-lg">Save Changes</button>
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-enter">
            <div className="glass-panel w-full max-w-sm p-8 rounded-[2.5rem] border-red-500/20 shadow-2xl bg-black/40 text-center">
                <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-6 text-3xl">⚠️</div>
                <h3 className="font-serif text-2xl font-bold text-white mb-2">Revoke Access?</h3>
                <p className="text-white/60 text-sm mb-6 leading-relaxed">
                   Are you sure you want to permanently delete <strong className="text-white">{deleteTarget.full_name}</strong>? This action cannot be undone.
                </p>
                <div className="flex gap-3">
                    <button onClick={() => setDeleteTarget(null)} className="flex-1 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-white/60 font-bold uppercase tracking-widest text-xs transition">Cancel</button>
                    <button onClick={confirmDelete} disabled={loading} className="flex-1 py-3 rounded-xl bg-red-500 hover:bg-red-400 text-white font-bold uppercase tracking-widest text-xs transition shadow-lg flex items-center justify-center gap-2">
                        {loading ? 'Processing...' : 'Delete'}
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;