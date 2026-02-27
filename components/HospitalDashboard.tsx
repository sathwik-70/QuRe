import React, { useState, useRef, useEffect } from 'react';
import jsQR from 'jsqr';
import { UserProfile, MedicalRecord } from '../types';
import { supabase } from '../services/supabase';
import { convertToPdf } from '../services/pdfUtils';
import RecordCard from './RecordCard';

const CATEGORIES = ['Lab Result', 'Imaging', 'Prescription', 'Clinical Note', 'Vaccination'];

const HospitalDashboard: React.FC<{ user: UserProfile }> = ({ user }) => {
  const [scanning, setScanning] = useState(false);
  const [patient, setPatient] = useState<UserProfile | null>(null);
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [manualId, setManualId] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadCategory, setUploadCategory] = useState(CATEGORIES[3]);
  const [isDragging, setIsDragging] = useState(false);
  const [sessionTime, setSessionTime] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let interval: any;
    if (patient) {
      setSessionTime(0);
      interval = setInterval(() => setSessionTime(prev => prev + 1), 1000);
    }
    return () => clearInterval(interval);
  }, [patient]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const playScanSound = () => {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;

      const audioCtx = new AudioContext();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // High pitch beep
      oscillator.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.1);

      gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.1);

      // Clean up context after sound plays
      setTimeout(() => {
        audioCtx.close();
      }, 150);
    } catch (e) { console.error("Audio play failed", e); }
  };

  useEffect(() => {
    let animationFrame: number;
    const tick = () => {
      if (videoRef.current && canvasRef.current && scanning) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        if (ctx && video.readyState === video.HAVE_ENOUGH_DATA) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height);
          if (code) {
            try {
              const data = JSON.parse(code.data);
              if (data.pid) {
                // Haptic Feedback
                if (navigator.vibrate) navigator.vibrate(200);
                // Audio Feedback
                playScanSound();

                resolvePatient(data.pid);
              }
            } catch (e) { console.log("Invalid QR"); }
          }
        }
      }
      if (scanning) animationFrame = requestAnimationFrame(tick);
    };

    if (scanning) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(stream => {
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            // CRITICAL: playsInline is required for iOS, and explicit play() call
            videoRef.current.setAttribute("playsinline", "true");
            videoRef.current.play().catch(e => console.error("Video play error:", e));
            requestAnimationFrame(tick);
          }
        })
        .catch(err => {
          console.error("Camera access denied", err);
          setScanning(false);
          alert("Camera access denied. Please use manual entry.");
        });
    } else {
      const stream = videoRef.current?.srcObject as MediaStream;
      stream?.getTracks().forEach(t => t.stop());
    }

    return () => cancelAnimationFrame(animationFrame);
  }, [scanning]);

  const resolvePatient = async (qrId: string) => {
    setScanning(false);
    setLoading(true);
    try {
      // Secure RPC: Now relies on RLS Role check instead of password
      const { data: p, error: rpcError } = await supabase.rpc('resolve_patient_qr', { p_qr_identifier: qrId });

      if (rpcError || !p) {
        console.error("Resolution Error", rpcError);
        alert("Patient not found or Access Denied.");
        return;
      }

      await supabase.from('access_logs').insert({ hospital_id: user.id, patient_id: p.id, hospital_name: user.full_name });

      const { data: recs, error } = await supabase.rpc('fetch_hospital_view_reports', { p_patient_id: p.id });
      if (error) throw error;

      setPatient(p as UserProfile);
      setRecords(recs as MedicalRecord[] || []);
    } catch (err) {
      console.error(err);
      alert("Handshake failed. Protocol error.");
    } finally {
      setLoading(false);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => { e.preventDefault(); if (manualId.trim()) resolvePatient(manualId.trim()); };
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files?.[0]) setPendingFile(e.dataTransfer.files[0]); };

  const handleUpload = async () => {
    if (!pendingFile || !patient) return;
    setUploading(true);
    try {
      setUploadStatus('Formatting...');
      const pdfFile = await convertToPdf(pendingFile);
      const fileName = `${patient.id}/${Date.now()}_${pdfFile.name}`;
      setUploadStatus('Uploading...');
      const { data, error: uploadError } = await supabase.storage.from('hospital_uploads').upload(fileName, pdfFile);
      if (uploadError) throw uploadError;
      setUploadStatus('Registering...');

      // Updated RPC: No auth hash needed, uses auth.uid() and RBAC
      const { data: record, error: dbError } = await supabase.rpc('create_clinical_report', {
        p_patient_id: patient.id,
        p_title: pendingFile.name.replace(/\.[^/.]+$/, ""), p_category: uploadCategory,
        p_drive_file_id: data.path, p_file_extension: 'pdf', p_mime_type: 'application/pdf'
      });
      if (dbError) throw dbError;
      setRecords(prev => [record as MedicalRecord, ...prev]);
      setPendingFile(null);
      alert("Record successfully uploaded.");
    } catch (err: any) { console.error("Upload Error:", err); alert("Upload failed: " + err.message); } finally { setUploading(false); setUploadStatus(''); }
  };

  if (!user.is_verified) return (
    <div className="text-center py-32 animate-enter">
      <div className="w-20 h-20 bg-yellow-500/10 rounded-full flex items-center justify-center mx-auto mb-6 border border-yellow-500/20 text-3xl">⚠️</div>
      <h1 className="text-3xl font-serif text-white">Hospital Pending Verification</h1>
      <p className="text-white/50 mt-4 max-w-md mx-auto">Your identity as a medical institution is being verified by governance. Access to patient records is restricted.</p>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto animate-enter px-4 pb-12">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end mb-8 md:mb-12 gap-6">
        <div>
          <h1 className="text-3xl md:text-5xl font-serif font-bold tracking-tight text-white drop-shadow-lg">Hospital Portal</h1>
          <p className="text-emerald-400 font-bold uppercase tracking-widest text-xs mt-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-lg shadow-emerald-500/50"></span>
            {user.full_name}
          </p>
        </div>

        {!patient && !scanning && (
          <div className="flex gap-4 w-full lg:w-auto">
            <form onSubmit={handleManualSubmit} className="flex-1 lg:w-72 relative">
              <input aria-label="Enter Patient ID Manually" placeholder="Enter Patient ID..." value={manualId} onChange={e => setManualId(e.target.value)} className="w-full h-full bg-black/20 border border-white/10 rounded-xl px-5 py-3 outline-none focus:border-emerald-500/50 transition text-sm text-white placeholder-white/30 backdrop-blur-md shadow-inner" />
            </form>
          </div>
        )}
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center py-32 animate-pulse space-y-6">
          <div className="relative w-24 h-24">
            <div className="absolute inset-0 border-4 border-emerald-500/30 rounded-full"></div>
            <div className="absolute inset-0 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
            <div className="absolute inset-0 flex items-center justify-center text-3xl">🤝</div>
          </div>
          <div className="text-emerald-400 font-bold uppercase tracking-[0.2em] text-sm">Handshake in Progress</div>
        </div>
      )}

      {scanning && (
        <div className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center animate-enter backdrop-blur-md p-4">
          <div className="relative w-full max-w-5xl h-[70vh] md:h-[80vh] min-h-[400px] bg-black rounded-[3rem] overflow-hidden border border-white/20 shadow-2xl">
            {/* Added playsInline, muted, autoPlay for mobile support */}
            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-cover"
              playsInline
              muted
              autoPlay
            />
            <canvas ref={canvasRef} className="hidden" />

            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
              <div className="w-72 h-72 md:w-96 md:h-96 rounded-3xl relative overflow-hidden scanner-frame">
                <div className="absolute top-0 left-0 w-10 h-10 border-t-4 border-l-4 border-emerald-400 rounded-tl-xl -mt-1 -ml-1"></div>
                <div className="absolute top-0 right-0 w-10 h-10 border-t-4 border-r-4 border-emerald-400 rounded-tr-xl -mt-1 -mr-1"></div>
                <div className="absolute bottom-0 left-0 w-10 h-10 border-b-4 border-l-4 border-emerald-400 rounded-bl-xl -mb-1 -ml-1"></div>
                <div className="absolute bottom-0 right-0 w-10 h-10 border-b-4 border-r-4 border-emerald-400 rounded-br-xl -mb-1 -mr-1"></div>
                <div className="scanner-line absolute top-0 w-full"></div>
              </div>
            </div>

            <div className="absolute bottom-10 left-0 right-0 flex justify-center z-20 pointer-events-auto">
              <button onClick={() => setScanning(false)} className="px-10 py-4 rounded-full bg-white/10 hover:bg-white/20 text-white border border-white/20 font-bold uppercase tracking-widest text-sm backdrop-blur-md transition shadow-lg">
                Close Scanner
              </button>
            </div>
          </div>
          <p className="text-white/60 mt-8 font-bold uppercase tracking-widest text-sm animate-pulse">Align QR Code within frame</p>
        </div>
      )}

      {!scanning && !patient && !loading && (
        <div className="grid place-items-center py-10 md:py-20">
          <button id="btn-scan-qr" onClick={() => setScanning(true)} aria-label="Start QR Scanner" className="group relative w-64 h-64 md:w-80 md:h-80 rounded-[3rem] glass-panel flex flex-col items-center justify-center hover:scale-105 transition-all duration-500 shadow-2xl hover:border-emerald-500/30 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-tr from-emerald-500/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition duration-700"></div>
            <div className="text-7xl mb-6 text-white/20 group-hover:text-emerald-400 group-hover:scale-110 transition duration-500">📷</div>
            <span className="text-white/60 group-hover:text-emerald-400 font-bold uppercase tracking-widest text-sm relative z-10 transition">Scan Patient Key</span>
          </button>
        </div>
      )}

      {patient && (
        <div className="animate-enter">
          <div className="glass-panel p-6 md:p-8 rounded-[2rem] mb-8 border-emerald-500/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative overflow-hidden bg-gradient-to-r from-emerald-900/20 to-transparent">
            <div className="flex items-center gap-4 md:gap-6 relative z-10 w-full md:w-auto">
              <div className="w-12 h-12 md:w-16 md:h-16 bg-gradient-to-br from-emerald-500/20 to-teal-500/20 text-emerald-100 rounded-2xl flex items-center justify-center text-2xl md:text-3xl font-serif font-bold shadow-lg border border-emerald-500/30 shrink-0">
                {patient.full_name.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-xl md:text-3xl font-serif font-bold text-white truncate">{patient.full_name}</h2>
                <div className="flex flex-wrap items-center gap-2 md:gap-3 mt-1">
                  <div className="flex items-center gap-1.5 px-2 md:px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 backdrop-blur-sm">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]"></div>
                    <p className="text-[9px] md:text-[10px] text-emerald-300 uppercase tracking-widest font-bold">Session Active</p>
                  </div>
                  <p className="text-[9px] md:text-[10px] text-white/40 font-mono tracking-widest">{formatTime(sessionTime)}</p>
                </div>
              </div>
            </div>
            <button id="btn-end-session" onClick={() => { setPatient(null); setManualId(''); }} className="w-full md:w-auto relative z-10 px-6 py-3 rounded-xl bg-white/5 hover:bg-red-500/10 text-white/60 hover:text-red-300 transition text-xs font-bold uppercase tracking-wider border border-white/5 hover:border-red-500/30">End Session</button>
          </div>

          <div className="grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2">
              <div className="flex justify-between items-end mb-4 px-2">
                <h3 className="text-white/50 text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                  <span>History</span>
                  <span className="bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded text-[9px] border border-emerald-500/20">{records.length}</span>
                </h3>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                {records.map(r => <RecordCard key={r.id} record={r} canDownload={true} />)}
                {records.length === 0 && (
                  <div className="col-span-full text-center py-24 glass-panel rounded-[2rem] opacity-50 uppercase tracking-widest text-xs border-dashed border-white/10">No Records Found</div>
                )}
              </div>
            </div>

            <div className="lg:col-span-1">
              <div className="glass-panel p-6 md:p-8 rounded-[2.5rem] sticky top-28 border-white/10 shadow-lg bg-white/5 backdrop-blur-xl">
                <h3 className="text-emerald-400 text-xs font-bold uppercase tracking-widest mb-6 flex items-center gap-2">
                  <span className="w-1 h-4 bg-emerald-500 rounded-full"></span>
                  Upload Record
                </h3>
                <div className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase font-bold text-white/50 pl-2">Category</label>
                    <div className="relative">
                      <select aria-label="Select Record Category" value={uploadCategory} onChange={e => setUploadCategory(e.target.value)} className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-emerald-500/50 transition text-sm text-white appearance-none cursor-pointer hover:bg-black/30 shadow-inner">
                        {CATEGORIES.map(c => <option key={c} value={c} className="bg-black text-white">{c}</option>)}
                      </select>
                    </div>
                  </div>

                  <label aria-label="Drop file here or click to upload" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} className={`block w-full text-center py-10 rounded-2xl border-2 border-dashed transition-all duration-300 cursor-pointer relative overflow-hidden group ${isDragging ? 'border-emerald-400 bg-emerald-500/10' : 'border-white/10 hover:border-emerald-500/30 hover:bg-white/5'}`}>
                    <input type="file" className="hidden" onChange={e => setPendingFile(e.target.files?.[0] || null)} disabled={uploading} />
                    <div className="relative z-10">
                      {pendingFile ? (
                        <div className="animate-enter">
                          <div className="w-10 h-10 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-3 text-emerald-400">✓</div>
                          <p className="text-emerald-400 font-bold text-sm mb-1">File Selected</p>
                          <p className="text-[10px] text-white/50 truncate max-w-[150px] mx-auto">{pendingFile.name}</p>
                        </div>
                      ) : (
                        <div>
                          <p className="text-2xl mb-2 text-white/40 group-hover:text-white transition">📤</p>
                          <span className="text-[10px] font-bold uppercase tracking-widest text-white/40 group-hover:text-white transition">Drop File</span>
                        </div>
                      )}
                    </div>
                  </label>

                  {pendingFile && (
                    <button id="btn-add-ledger" onClick={handleUpload} disabled={uploading} className="w-full py-4 btn-gradient text-white rounded-xl font-bold uppercase tracking-widest text-xs transition flex items-center justify-center gap-3">
                      {uploading ? 'Processing...' : 'Add to Ledger'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HospitalDashboard;