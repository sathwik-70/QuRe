import React, { useEffect, useState, useRef } from 'react';
import { UserProfile, MedicalRecord } from '../types';
import { supabase } from '../services/supabase';
import { ensureQuReFolder, uploadFile } from '../services/driveService';
import { chatWithConcierge } from '../services/geminiService';
import { convertToPdf } from '../services/pdfUtils';
import RecordCard from './RecordCard';
import QRIdentity from './QRIdentity';

const CATEGORIES = ['Lab Result', 'Imaging', 'Prescription', 'Clinical Note', 'Vaccination'];

const PatientDashboard: React.FC<{ user: UserProfile }> = ({ user }) => {
  const [view, setView] = useState<'VAULT' | 'CONCIERGE'>('VAULT');
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [folderId, setFolderId] = useState<string | null>(user.drive_folder_id || null);
  
  const [uploading, setUploading] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [selectedCategory, setSelectedCategory] = useState(CATEGORIES[0]);
  const [authError, setAuthError] = useState(false);

  const [syncing, setSyncing] = useState(false);
  const [syncCount, setSyncCount] = useState(0);

  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadRecordsAndSync();
    const channel = supabase.channel('realtime:reports')
      .on(
        'postgres_changes', 
        { event: 'INSERT', schema: 'public', table: 'reports', filter: `patient_id=eq.${user.id}` }, 
        (payload) => {
           const newRecord = payload.new as MedicalRecord;
           setRecords(prev => [newRecord, ...prev]);
           if (newRecord.storage_provider === 'SUPABASE') {
              syncClinicalUploads([newRecord]);
           }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user.id]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const loadRecordsAndSync = async () => {
    try {
      const { data: dbRecs } = await supabase.from('reports').select('*').eq('patient_id', user.id).order('created_at', { ascending: false });
      const currentRecords = (dbRecs as MedicalRecord[]) || [];
      setRecords(currentRecords);
      const pendingSync = currentRecords.filter(r => r.storage_provider === 'SUPABASE');
      if (pendingSync.length > 0) syncClinicalUploads(pendingSync);
    } catch (e) { console.error("Load Failed", e); }
  };

  const syncClinicalUploads = async (pendingRecords: MedicalRecord[]) => {
    setSyncing(true);
    setSyncCount(prev => prev + pendingRecords.length);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.provider_token) return; 
      let targetFolderId = folderId;
      if (!targetFolderId) {
        targetFolderId = await ensureQuReFolder(session.provider_token);
        setFolderId(targetFolderId);
        await supabase.from('profiles').update({ drive_folder_id: targetFolderId }).eq('id', user.id);
      }
      for (const record of pendingRecords) {
        try {
          const { data: blob, error: downloadError } = await supabase.storage.from('hospital_uploads').download(record.drive_file_id);
          if (downloadError || !blob) throw downloadError;
          const file = new File([blob], `${record.title}.${record.file_extension}`, { type: record.mime_type });
          const newDriveId = await uploadFile(session.provider_token, targetFolderId!, file);
          await supabase.from('reports').update({ drive_file_id: newDriveId, storage_provider: 'GOOGLE_DRIVE' }).eq('id', record.id);
          await supabase.storage.from('hospital_uploads').remove([record.drive_file_id]);
          setRecords(prev => prev.map(r => r.id === record.id ? { ...r, storage_provider: 'GOOGLE_DRIVE', drive_file_id: newDriveId } : r));
          setSyncCount(prev => Math.max(0, prev - 1));
        } catch (err) { console.error(`Failed to sync record ${record.id}`, err); }
      }
    } catch (err) { console.error("Sync Process Error", err); } finally { setSyncing(false); }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) { setPendingFile(e.target.files[0]); setAuthError(false); }
  };

  const cancelUpload = () => {
    setPendingFile(null); setSelectedCategory(CATEGORIES[0]); setProcessingStatus(''); setAuthError(false);
  };

  const refreshSession = async () => {
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin, scopes: 'https://www.googleapis.com/auth/drive.file' } });
  };

  const confirmUpload = async () => {
    if (!pendingFile) return; 
    setUploading(true);
    setAuthError(false);
    try {
      setProcessingStatus('Securing Document...');
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.provider_token) { setAuthError(true); throw new Error("Secure Session Expired. Please Re-Connect."); }
      setProcessingStatus('Standardizing Format (PDF)...');
      const pdfFile = await convertToPdf(pendingFile);
      setProcessingStatus('Encrypting & Uploading to Vault...');
      let fileId = '';
      let activeFolderId = folderId;
      try {
        fileId = await uploadFile(session.provider_token, activeFolderId || '', pdfFile);
      } catch (err) {
        console.warn("Retrying with folder recovery...", err);
        setProcessingStatus('Re-establishing Vault Connection...');
        activeFolderId = await ensureQuReFolder(session.provider_token);
        setFolderId(activeFolderId);
        await supabase.from('profiles').update({ drive_folder_id: activeFolderId }).eq('id', user.id);
        fileId = await uploadFile(session.provider_token, activeFolderId, pdfFile);
      }
      setProcessingStatus('Finalizing Ledger Entry...');
      await supabase.from('reports').insert({
        patient_id: user.id, title: pendingFile.name.replace(/\.[^/.]+$/, ""), category: selectedCategory,
        drive_file_id: fileId, file_extension: 'pdf', mime_type: 'application/pdf', storage_provider: 'GOOGLE_DRIVE'
      });
      setPendingFile(null);
    } catch (err: any) {
      console.error(err);
      if (!authError && !err.message.includes("Session Expired")) alert("Upload failed: " + (err.message || "Connection Error"));
    } finally { setUploading(false); setProcessingStatus(''); }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || thinking) return;
    const msg = input;
    setInput('');
    setThinking(true);
    setMessages(prev => [...prev, { role: 'user', parts: [{ text: msg }] }]);
    const recordTitles = records.map(r => `${r.title} (${r.category})`);
    const res = await chatWithConcierge(msg, recordTitles, messages);
    setMessages(prev => [...prev, { role: 'model', parts: [{ text: res.text }], sources: res.sources }]);
    setThinking(false);
  };

  return (
    <div className="max-w-6xl mx-auto animate-enter relative px-4 py-6 md:py-8">
      <header className="mb-8 md:mb-12 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <h1 className="text-3xl md:text-5xl font-serif font-bold text-white mb-2 tracking-tight drop-shadow-lg">Patient Portal</h1>
          <p className="text-emerald-400 uppercase tracking-widest text-xs font-bold flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse box-shadow-[0_0_10px_#10b981]"></span>
            <span className="text-gradient">Encrypted Vault</span>
          </p>
        </div>
        <div className="flex bg-black/20 p-1 rounded-2xl border border-white/10 backdrop-blur-md shadow-lg relative w-full md:w-auto">
            <div className={`absolute top-1 bottom-1 w-[calc(50%-4px)] bg-gradient-to-r from-emerald-600/80 to-teal-600/80 rounded-xl transition-all duration-300 ease-out shadow-lg ${view === 'CONCIERGE' ? 'left-[calc(50%+2px)]' : 'left-1'}`}></div>
            <button id="tab-vault" aria-label="View Medical Records Vault" onClick={() => setView('VAULT')} className={`relative z-10 flex-1 md:flex-none px-6 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 ${view === 'VAULT' ? 'text-white' : 'text-white/40 hover:text-white'}`}>Vault</button>
            <button id="tab-concierge" aria-label="Open AI Concierge" onClick={() => setView('CONCIERGE')} className={`relative z-10 flex-1 md:flex-none px-6 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 ${view === 'CONCIERGE' ? 'text-white' : 'text-white/40 hover:text-white'}`}>Concierge</button>
        </div>
      </header>

      {syncing && (
        <div className="mb-8 p-4 bg-gradient-to-r from-blue-900/20 to-blue-500/10 border border-blue-500/20 rounded-xl flex items-center justify-between animate-enter glass-panel">
           <div className="flex items-center gap-3">
             <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
             <span className="text-blue-200 text-xs font-bold uppercase tracking-wide">Syncing Records...</span>
           </div>
           <span className="text-blue-300 font-mono text-xs px-3 py-1 bg-blue-500/10 rounded-lg border border-blue-500/20">{syncCount}</span>
        </div>
      )}

      {view === 'VAULT' && (
        <div className="grid lg:grid-cols-12 gap-8 md:gap-12">
          <div className="lg:col-span-4 space-y-6 md:space-y-8">
            <QRIdentity uuid={user.qr_identifier} name={user.full_name} />
            <div className="glass-panel p-6 rounded-[2rem] border-white/5">
              <h3 className="text-white/50 text-[10px] uppercase font-bold tracking-widest mb-4">Quick Actions</h3>
              <label className={`block w-full text-center py-8 rounded-2xl border border-dashed border-white/20 hover:border-emerald-500/50 hover:bg-emerald-500/5 transition cursor-pointer group ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                <input id="file-upload" type="file" className="hidden" onChange={handleFileSelect} disabled={uploading} aria-label="Upload Medical Record" />
                <div className="flex flex-col items-center transform group-hover:scale-105 transition duration-300">
                   <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-3 group-hover:bg-emerald-500/20 transition shadow-inner border border-white/5">
                     <svg className="w-6 h-6 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                   </div>
                   <span className="text-xs font-bold text-emerald-400 uppercase tracking-wide">{uploading ? (processingStatus || 'Processing...') : 'Upload Record'}</span>
                </div>
              </label>
            </div>
          </div>
          <div className="lg:col-span-8">
             <div className="glass-panel p-6 md:p-8 rounded-[2.5rem] min-h-[500px] bg-gradient-to-br from-white/5 to-transparent">
                <div className="flex justify-between items-center mb-8">
                  <h3 className="font-serif text-2xl text-white">Medical Ledger</h3>
                  <div className="text-[10px] uppercase tracking-widest text-emerald-200/60 font-bold">{records.length} Records</div>
                </div>
                <div className="space-y-4">
                  {records.length === 0 ? (
                    <div className="text-center py-32 opacity-30 flex flex-col items-center">
                      <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-4 text-4xl">📂</div>
                      <p className="text-xs uppercase font-bold tracking-widest">Vault Empty</p>
                    </div>
                  ) : (
                    records.map(r => <RecordCard key={r.id} record={r} />)
                  )}
                </div>
             </div>
          </div>
        </div>
      )}

      {view === 'CONCIERGE' && (
        <div className="glass-panel p-0 rounded-[2.5rem] overflow-hidden flex flex-col h-[75vh] md:h-[calc(100dvh-200px)] max-w-4xl mx-auto border-white/10">
          <div className="bg-gradient-to-r from-emerald-900/30 via-white/5 to-transparent p-6 border-b border-white/5 flex justify-between items-center backdrop-blur-md">
             <div>
               <h3 className="font-serif text-xl">Health Concierge</h3>
               <p className="text-[10px] text-emerald-400 opacity-80 uppercase font-bold tracking-widest">Gemini 3.0</p>
             </div>
             <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center animate-pulse border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
               <span className="text-emerald-400 text-lg">✨</span>
             </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 custom-scrollbar">
            {messages.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center opacity-30 space-y-4">
                <span className="text-6xl text-gradient">✨</span>
                <p className="text-sm font-medium tracking-wide">Ask about your bridged records...</p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-enter`}>
                <div className={`max-w-[85%] p-5 rounded-3xl text-sm leading-relaxed shadow-lg backdrop-blur-md ${m.role === 'user' ? 'bg-gradient-to-br from-emerald-600 to-teal-700 text-white rounded-tr-none border border-emerald-500/30' : 'bg-black/30 border border-white/5 rounded-tl-none'}`}>
                  {m.parts[0].text}
                  {m.sources && m.sources.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-white/10 flex flex-wrap gap-2">
                       {m.sources.map((s: any, idx: number) => (
                         <a key={idx} href={s.uri} target="_blank" className="flex items-center gap-1 text-[9px] bg-black/20 px-3 py-1.5 rounded-full hover:text-emerald-300 hover:bg-black/40 transition truncate max-w-xs border border-white/5">
                           <span>🔗</span> {s.title}
                         </a>
                       ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {thinking && (
              <div className="flex justify-start animate-enter">
                <div className="bg-black/30 border border-white/5 px-6 py-4 rounded-3xl rounded-tl-none flex gap-2 items-center">
                   <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce"></div>
                   <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                   <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                </div>
              </div>
            )}
            <div ref={chatEndRef}></div>
          </div>
          <form onSubmit={sendMessage} className="p-4 bg-black/20 backdrop-blur-xl border-t border-white/5">
            <div className="relative">
              <input 
                value={input} 
                onChange={e => setInput(e.target.value)} 
                placeholder="Type your health query..." 
                className="w-full bg-white/5 border border-white/10 rounded-full pl-6 pr-14 py-4 outline-none focus:border-emerald-500/50 focus:bg-white/10 transition text-sm shadow-inner placeholder-white/30"
                aria-label="Chat input"
              />
              <button id="btn-send-message" type="submit" disabled={!input.trim() || thinking} aria-label="Send message" className="absolute right-2 top-2 bottom-2 w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-full flex items-center justify-center text-white hover:from-emerald-400 hover:to-teal-500 disabled:opacity-50 transition shadow-lg">
                <svg className="w-4 h-4 transform rotate-90" fill="currentColor" viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
              </button>
            </div>
          </form>
        </div>
      )}

      {pendingFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xl animate-enter px-4">
          <div className="glass-panel p-8 rounded-[2rem] max-w-sm w-full shadow-2xl border-white/10 bg-black/40">
            <h3 className="font-serif text-2xl font-bold mb-1 text-gradient">Classify Record</h3>
            <p className="text-white/50 text-xs mb-6 truncate">{pendingFile.name}</p>
            {authError ? (
              <div className="py-4 space-y-4">
                 <div className="bg-yellow-500/10 p-4 rounded-xl border border-yellow-500/20 flex gap-3 items-start">
                    <span className="text-2xl">🔐</span>
                    <div>
                      <h4 className="font-bold text-yellow-500 text-sm">Token Expired</h4>
                      <p className="text-[10px] text-yellow-200/60 leading-relaxed mt-1">Please refresh your session to upload.</p>
                    </div>
                 </div>
                 <div className="flex gap-3 pt-2">
                   <button onClick={cancelUpload} className="flex-1 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-bold uppercase tracking-widest transition">Cancel</button>
                   <button onClick={refreshSession} className="flex-[2] py-3 rounded-xl bg-yellow-500 hover:bg-yellow-400 text-black text-xs font-bold uppercase tracking-widest transition shadow-lg">Refresh</button>
                 </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Record Type</label>
                  <div className="grid grid-cols-1 gap-2">
                    {CATEGORIES.map(cat => (
                      <button key={cat} onClick={() => setSelectedCategory(cat)} className={`text-left px-4 py-3 rounded-xl text-sm font-medium transition border ${selectedCategory === cat ? 'bg-emerald-600/20 border-emerald-500 text-white shadow-sm' : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'}`}>{cat}</button>
                    ))}
                  </div>
                </div>
                <div className="pt-4 flex gap-3">
                  <button onClick={cancelUpload} disabled={uploading} className="flex-1 py-3 rounded-xl bg-white/5 border border-white/10 text-xs font-bold uppercase tracking-widest hover:bg-white/10 transition">Cancel</button>
                  <button onClick={confirmUpload} disabled={uploading} className="flex-1 py-3 rounded-xl btn-gradient text-white text-xs font-bold uppercase tracking-widest transition flex items-center justify-center gap-2">
                    {uploading ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"/> : 'Upload'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default PatientDashboard;