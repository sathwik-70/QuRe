import React, { useState } from 'react';
import { MedicalRecord } from '../types';
import { supabase } from '../services/supabase';
import { downloadFile } from '../services/driveService';

interface Props { record: MedicalRecord; canDownload?: boolean; }

const RecordCard: React.FC<Props> = ({ record, canDownload = true }) => {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      let blob: Blob;
      if (record.storage_provider === 'SUPABASE') {
        const { data, error } = await supabase.storage.from('hospital_uploads').download(record.drive_file_id);
        if (error) throw error; blob = data as Blob;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `${record.title}.${record.file_extension}`; a.click(); URL.revokeObjectURL(url);
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.provider_token) {
          // Hospital user: provider_token is missing. Open the Google Drive file directly.
          window.open(`https://drive.google.com/file/d/${record.drive_file_id}/view`, '_blank');
          setDownloading(false);
          return;
        }
        // Patient user: Use raw download API.
        blob = await downloadFile(session.provider_token, record.drive_file_id);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `${record.title}.${record.file_extension}`; a.click(); URL.revokeObjectURL(url);
      }
    } catch (err) { console.error(err); alert("Download failed."); } finally { setDownloading(false); }
  };

  const getIcon = (cat: string) => {
    switch (cat) { case 'Imaging': return '🩻'; case 'Prescription': return '💊'; case 'Lab Result': return '🩸'; case 'Vaccination': return '💉'; default: return '📄'; }
  };

  const dateStr = new Date(record.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="glass-btn p-4 md:p-5 rounded-2xl flex items-center justify-between gap-4 group cursor-default border border-white/5 hover:border-emerald-500/30 hover:bg-gradient-to-r hover:from-white/5 hover:to-emerald-900/10">
      <div className="flex items-center gap-4 min-w-0">
        <div className="w-10 h-10 md:w-12 md:h-12 shrink-0 bg-gradient-to-br from-emerald-500/20 to-teal-500/10 rounded-xl md:rounded-2xl flex items-center justify-center text-lg md:text-xl border border-emerald-500/20 text-emerald-100 shadow-inner group-hover:scale-110 transition duration-300">
          {getIcon(record.category)}
        </div>
        <div className="min-w-0">
          <h5 className="font-bold text-sm text-white tracking-wide truncate">{record.title}</h5>
          <div className="flex flex-wrap items-center gap-2 md:gap-3 mt-1">
            <span className="text-[9px] md:text-[10px] text-emerald-300 uppercase tracking-widest font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/10 truncate max-w-full">{record.category}</span>
            <span className="text-[9px] md:text-[10px] text-white/30 font-mono shrink-0">{dateStr}</span>
          </div>
        </div>
      </div>
      {canDownload && (
        <button onClick={handleDownload} disabled={downloading} className="w-8 h-8 md:w-10 md:h-10 shrink-0 rounded-lg md:rounded-xl flex items-center justify-center text-white/30 hover:bg-white/10 hover:text-emerald-400 transition border border-transparent hover:border-emerald-500/20 group-hover:bg-black/20">
          {downloading ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div> : <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>}
        </button>
      )}
    </div>
  );
};

export default RecordCard;