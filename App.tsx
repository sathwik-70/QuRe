import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { supabase } from './services/supabase';
import { UserProfile, UserRole } from './types';
import { ErrorBoundary } from './components/ErrorBoundary';

// Lazy Load Dashboards for Performance
const PatientDashboard = React.lazy(() => import('./components/PatientDashboard'));
const HospitalDashboard = React.lazy(() => import('./components/HospitalDashboard'));
const AdminDashboard = React.lazy(() => import('./components/AdminDashboard'));

const TIMEOUT_MS = 30 * 60 * 1000; // 30 Minutes
const WARNING_MS = 60 * 1000; // 60 Seconds warning

const App: React.FC = () => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // LOGIN STATE
  const [board, setBoard] = useState<'PATIENT' | 'PROVIDER'>('PATIENT');
  const [providerMode, setProviderMode] = useState<'LOGIN' | 'REGISTER'>('LOGIN');
  const [creds, setCreds] = useState({ email: '', password: '', hospitalName: '' });
  const [error, setError] = useState('');

  // SESSION TIMEOUT STATE
  const [lastActive, setLastActive] = useState(Date.now());
  const [showIdleWarning, setShowIdleWarning] = useState(false);
  const [countdown, setCountdown] = useState(60);

  const [showLanding, setShowLanding] = useState(true);
  const [isFadingOut, setIsFadingOut] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setIsFadingOut(true), 2000);
    const removeTimer = setTimeout(() => setShowLanding(false), 2500);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
    };
  }, []);

  const logout = useCallback(async (reason?: string) => {
    setLoading(true);
    await supabase.auth.signOut();
    setUser(null);
    setLoading(false);
    setCreds({ email: '', password: '', hospitalName: '' });
    setShowIdleWarning(false);
    if (reason) setError(reason);
  }, []);

  useEffect(() => {
    // Check initial session manually to avoid race conditions
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        console.warn("Session error (e.g., invalid refresh token):", error.message);
        supabase.auth.signOut();
        setLoading(false);
        return;
      }
      if (session?.user) {
        syncUser(session.user);
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        setLoading(true);
        await syncUser(session.user);
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        setLoading(false);
      } else if (event === 'TOKEN_REFRESHED') {
        console.log('Token refreshed successfully');
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // ACTIVITY TRACKER
  useEffect(() => {
    const handleActivity = () => {
      if (!showIdleWarning && user?.role === UserRole.HOSPITAL) {
        setLastActive(Date.now());
      }
    };

    // Throttle listeners slightly for performance if needed, but native events are usually fine
    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('click', handleActivity);
    window.addEventListener('scroll', handleActivity);

    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('click', handleActivity);
      window.removeEventListener('scroll', handleActivity);
    };
  }, [showIdleWarning, user]);

  // IDLE TIMER INTERVAL
  useEffect(() => {
    if (!user || user.role !== UserRole.HOSPITAL) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const timeIdle = now - lastActive;

      if (timeIdle > TIMEOUT_MS) {
        logout("Session expired due to inactivity.");
      } else if (timeIdle > (TIMEOUT_MS - WARNING_MS)) {
        setShowIdleWarning(true);
        setCountdown(Math.ceil((TIMEOUT_MS - timeIdle) / 1000));
      } else {
        setShowIdleWarning(false);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [user, lastActive, logout]);

  const extendSession = () => {
    setLastActive(Date.now());
    setShowIdleWarning(false);
  };

  const syncUser = async (authUser: any) => {
    if (user?.id === authUser.id) {
      setLoading(false);
      return;
    }

    let profile: UserProfile | null = null;
    for (let i = 0; i < 5; i++) {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', authUser.id).maybeSingle();
      if (error) {
        console.error("Error fetching profile:", error);
      }
      if (data) {
        profile = data as UserProfile;
        break;
      }
      if (i < 4) await new Promise(r => setTimeout(r, 1000));
    }

    if (profile) {
      setUser(profile);
    } else {
      console.warn("Profile not found. Attempting to recover...");
      const { error: rpcError } = await supabase.rpc('sync_my_profile');

      let recoveredProfile = null;
      if (!rpcError) {
        const { data } = await supabase.from('profiles').select('*').eq('id', authUser.id).maybeSingle();
        recoveredProfile = data;
      }

      if (recoveredProfile) {
        setUser(recoveredProfile as UserProfile);
      } else {
        await supabase.auth.signOut();
        setError("Profile synchronization failed. Please ask the admin to recreate your account, or sign up with a different email.");
      }
    }
    setLoading(false);
  };

  const handlePatientLogin = async () => {
    setLoading(true);
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        scopes: 'https://www.googleapis.com/auth/drive.file'
      }
    });
  };

  const handleProviderAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (providerMode === 'REGISTER') {
        if (!creds.hospitalName) throw new Error("Hospital Name is required.");

        const { data, error } = await supabase.auth.signUp({
          email: creds.email,
          password: creds.password,
          options: {
            data: {
              full_name: creds.hospitalName,
              role_request: 'HOSPITAL' // Signals trigger to create unverified Hospital role
            }
          }
        });
        if (error) throw error;

        // If auto-login happened (e.g., email confirmation disabled), sign them out so they can't bypass verification
        if (data.session) {
          await supabase.auth.signOut();
        }

        alert("Registration Submitted! Your account is pending Admin authorization.");
        setLoading(false);
        setProviderMode('LOGIN');
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: creds.email,
          password: creds.password
        });
        if (error) throw error;
      }
    } catch (err: any) {
      setError(err.message || "Authentication Failed");
      setLoading(false);
    }
  };

  const LandingAnimation = () => (
    <div className={`min-h-screen flex flex-col items-center justify-center relative overflow-hidden bg-black z-50 ${isFadingOut ? 'animate-fade-out' : 'animate-enter'}`}>
      <div className="ambient-light"><div className="ambient-orb-3"></div></div>
      <div className="relative z-10 flex items-center justify-center">
        <h1 className="text-7xl md:text-9xl font-serif font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 animate-pulse tracking-tighter drop-shadow-[0_0_30px_rgba(16,185,129,0.5)]">
          QuRe
        </h1>
      </div>
      <div className="absolute bottom-20 text-emerald-500/50 font-bold tracking-[0.5em] uppercase text-xs animate-bounce">
        Sovereign Health Node
      </div>
    </div>
  );

  const Loader = () => (
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden bg-black">
      <div className="ambient-light"><div className="ambient-orb-3"></div></div>
      <div className="relative z-10 glass-panel w-32 h-32 rounded-3xl flex items-center justify-center animate-pulse border-emerald-500/20">
        <img src="/logo.png" alt="QuRe Logo" className="w-16 h-16 object-contain" />
      </div>
      <div className="mt-8 text-emerald-400 font-bold tracking-[0.3em] uppercase text-xs relative z-10 bg-emerald-500/10 px-4 py-2 rounded-full border border-emerald-500/20">Establishing Link</div>
    </div>
  );

  if (showLanding) return <LandingAnimation />;
  if (loading) return <Loader />;

  // LOGGED IN VIEW
  if (user) {
    if (user.role === UserRole.PATIENT && board === 'PROVIDER') {
      return (
        <div className="min-h-screen flex items-center justify-center bg-black p-4">
          <div className="glass-panel p-10 rounded-[2rem] max-w-md text-center border-red-500/30">
            <div className="text-4xl mb-4">⛔</div>
            <h1 className="text-2xl font-serif font-bold text-white mb-2">Access Restricted</h1>
            <p className="text-white/60 text-sm mb-6">
              You have logged in with a Patient account on the Clinical Node.
            </p>
            <button onClick={() => setBoard('PATIENT')} className="px-6 py-3 bg-white/10 hover:bg-white/20 rounded-xl text-xs font-bold uppercase tracking-widest text-white transition">Switch to Patient View</button>
          </div>
        </div>
      );
    }

    return (
      <ErrorBoundary>
        <div className="min-h-screen transition-opacity duration-700 ease-in-out relative">
          <div className="ambient-light"><div className="ambient-orb-3"></div></div>

          <nav className="fixed top-0 w-full z-40 glass-panel border-x-0 border-t-0 rounded-none px-4 md:px-6 py-4 flex justify-between items-center backdrop-blur-xl bg-black/20">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center font-serif font-bold text-lg text-white shadow-inner relative overflow-hidden group border border-white/10">
                <img src="/logo.png" alt="QuRe Logo" className="w-6 h-6 object-contain relative z-10" />
              </div>
              <span className="font-serif font-bold text-xl hidden sm:block tracking-tight text-white drop-shadow-md">QuRe</span>
            </div>
            <div className="flex items-center gap-6">
              <div className="text-right hidden sm:block">
                <p className="font-bold text-sm text-white">{user.full_name}</p>
                <p className="text-[10px] text-emerald-300 font-bold uppercase tracking-widest">{user.role} ACCESS</p>
              </div>
              <button onClick={() => logout()} className="glass-btn w-10 h-10 rounded-xl flex items-center justify-center text-red-300 hover:bg-red-500/10 hover:text-red-200 hover:border-red-500/30 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
              </button>
            </div>
          </nav>

          <main className="pt-28 pb-20 relative z-10 px-4">
            <Suspense fallback={<div className="flex justify-center py-20"><div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div></div>}>
              {user.role === UserRole.PATIENT && <PatientDashboard user={user} />}
              {user.role === UserRole.HOSPITAL && <HospitalDashboard user={user} />}
              {user.role === UserRole.ADMIN && <AdminDashboard user={user} />}
            </Suspense>
          </main>

          {/* IDLE TIMEOUT MODAL */}
          {showIdleWarning && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-enter">
              <div className="glass-panel p-8 rounded-[2.5rem] max-w-sm w-full text-center border-yellow-500/30 shadow-[0_0_50px_rgba(234,179,8,0.1)]">
                <div className="w-16 h-16 rounded-full bg-yellow-500/10 flex items-center justify-center mx-auto mb-6 relative">
                  <svg className="w-8 h-8 text-yellow-500 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <div className="absolute inset-0 border-2 border-yellow-500/30 rounded-full animate-ping opacity-20"></div>
                </div>
                <h3 className="text-2xl font-serif font-bold text-white mb-2">Session Expiring</h3>
                <p className="text-white/60 text-sm mb-6">For security, your clinical session will automatically close in:</p>

                <div className="text-5xl font-mono font-bold text-yellow-400 mb-8 tabular-nums">
                  00:{countdown.toString().padStart(2, '0')}
                </div>

                <button onClick={extendSession} className="w-full py-4 bg-yellow-500 text-black rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-yellow-400 transition shadow-lg transform hover:-translate-y-1">
                  Stay Logged In
                </button>
                <button onClick={() => logout("User initiated logout")} className="mt-4 text-white/40 text-[10px] font-bold uppercase tracking-widest hover:text-white transition">
                  Log Out Now
                </button>
              </div>
            </div>
          )}
        </div>
      </ErrorBoundary>
    );
  }

  // LOGIN SCREEN (SPLIT BOARDS)
  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative z-10">
      <div className="ambient-light"><div className="ambient-orb-3"></div></div>

      <div className="max-w-5xl w-full grid grid-cols-1 md:grid-cols-2 gap-8 items-center">

        {/* Patient Board */}
        <div id="patient-board" onClick={() => { setBoard('PATIENT'); setError(''); }} className={`glass-panel p-6 md:p-8 rounded-[2rem] md:rounded-[2.5rem] cursor-pointer transition-all duration-500 transform ${board === 'PATIENT' ? 'md:scale-105 border-emerald-500/30 shadow-2xl bg-white/5' : 'md:scale-95 opacity-60 hover:opacity-80'}`}>
          <div className="mb-6 md:mb-8">
            <div className="w-12 h-12 md:w-16 md:h-16 bg-gradient-to-br from-emerald-400/30 via-teal-500/20 to-cyan-500/20 rounded-2xl flex items-center justify-center text-emerald-200 mb-4 border border-emerald-500/20 shadow-inner">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 md:w-8 md:h-8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
              </svg>
            </div>
            <h2 className="text-2xl md:text-3xl font-serif font-bold text-white mb-2">Patient Access</h2>
            <p className="text-emerald-200/60 text-xs md:text-sm leading-relaxed">Secure, sovereign health vault. Manage your records and identity keys.</p>
          </div>

          {board === 'PATIENT' && (
            <div className="animate-enter space-y-4">
              <button id="btn-patient-login" onClick={handlePatientLogin} className="w-full py-3 md:py-4 bg-white text-black rounded-xl font-bold flex items-center justify-center gap-3 transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-xl hover:shadow-white/20 text-sm">
                <svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="currentColor" d="M12.48 10.92v3.28h7.84c-.24 1.84-.908 3.152-1.896 4.136-1.248 1.248-3.224 2.632-7.344 2.632-6.616 0-11.744-5.352-11.744-11.968S4.584 2.36 11.2 2.36c3.576 0 6.16 1.416 8.136 3.296l2.32-2.32C19.216 1.136 15.656 0 11.2 0 5.016 0 0 5.016 0 11.2s5.016 11.2 11.2 11.2c3.336 0 5.88-1.104 7.84-3.152 2.016-2.016 2.648-4.84 2.648-7.12 0-.68-.048-1.32-.144-1.92h-9.064z" /></svg>
                Continue with Google
              </button>
              <div className="text-center">
                <p className="text-[10px] text-white/30 uppercase tracking-widest font-bold">Encrypted via Google Drive</p>
              </div>
            </div>
          )}
        </div>

        {/* Provider Board */}
        <div id="provider-board" onClick={() => { setBoard('PROVIDER'); setError(''); }} className={`glass-panel p-6 md:p-8 rounded-[2rem] md:rounded-[2.5rem] cursor-pointer transition-all duration-500 transform ${board === 'PROVIDER' ? 'md:scale-105 border-blue-500/30 shadow-2xl bg-white/5' : 'md:scale-95 opacity-60 hover:opacity-80'}`}>
          <div className="mb-6 md:mb-8">
            <div className="w-12 h-12 md:w-16 md:h-16 bg-gradient-to-br from-blue-400/30 via-indigo-500/20 to-purple-500/20 rounded-2xl flex items-center justify-center text-blue-200 mb-4 border border-blue-500/20 shadow-inner">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 md:w-8 md:h-8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Z" />
              </svg>
            </div>
            <h2 className="text-2xl md:text-3xl font-serif font-bold text-white mb-2">Clinical Node</h2>
            <p className="text-blue-200/60 text-xs md:text-sm leading-relaxed">Authorized medical personnel only. Request access for new facilities.</p>
          </div>

          {board === 'PROVIDER' && (
            <div className="animate-enter">
              {error && (
                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-2">
                  <span className="text-red-400">⚠️</span>
                  <span className="text-red-300 text-xs font-bold">{error}</span>
                </div>
              )}

              <form onSubmit={handleProviderAuth} className="space-y-4">
                {providerMode === 'REGISTER' && (
                  <div className="space-y-1 animate-enter">
                    <label className="text-[10px] uppercase font-bold text-white/40 pl-2">Hospital Name</label>
                    <input required type="text" placeholder="e.g. City General Hospital" className="w-full bg-black/20 border border-white/10 rounded-xl px-5 py-4 outline-none focus:border-blue-500/50 focus:bg-black/40 transition text-sm text-white placeholder-white/30" value={creds.hospitalName} onChange={e => setCreds({ ...creds, hospitalName: e.target.value })} />
                  </div>
                )}
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-white/40 pl-2">Node Email</label>
                  <input required type="email" className="w-full bg-black/20 border border-white/10 rounded-xl px-5 py-4 outline-none focus:border-blue-500/50 focus:bg-black/40 transition text-sm text-white placeholder-white/30" value={creds.email} onChange={e => setCreds({ ...creds, email: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-white/40 pl-2">Password</label>
                  <input required type="password" id="provider-password" className="w-full bg-black/20 border border-white/10 rounded-xl px-5 py-4 outline-none focus:border-blue-500/50 focus:bg-black/40 transition text-sm text-white placeholder-white/30" value={creds.password} onChange={e => setCreds({ ...creds, password: e.target.value })} />
                </div>
                <button id="btn-provider-submit" className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl font-bold uppercase tracking-widest text-xs transform hover:translate-y-[-2px] transition shadow-lg shadow-blue-900/20">
                  {providerMode === 'LOGIN' ? 'Access Portal' : 'Submit Access Request'}
                </button>
              </form>

              <div className="mt-6 text-center border-t border-white/5 pt-4">
                <button onClick={() => { setProviderMode(providerMode === 'LOGIN' ? 'REGISTER' : 'LOGIN'); setError(''); }} className="text-white/40 text-[10px] font-bold hover:text-white transition uppercase tracking-wider">
                  {providerMode === 'LOGIN' ? 'New Facility? Request Access' : 'Back to Login'}
                </button>
              </div>
            </div>
          )}
        </div>

      </div>

      <div className="fixed bottom-6 text-white/20 text-[10px] uppercase tracking-[0.3em] font-bold">
        QuRe Health Governance V3.2
      </div>
    </div>
  );
};

export default App;