import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

interface Props { uuid: string; name: string; }

const QRIdentity: React.FC<Props> = ({ uuid, name }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [timestamp, setTimestamp] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setTimestamp(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (canvasRef.current && uuid) {
      QRCode.toCanvas(canvasRef.current, JSON.stringify({ pid: uuid, ts: timestamp, v: '2.0' }), {
        width: 240, margin: 2, color: { dark: '#ffffff', light: '#00000000' }, errorCorrectionLevel: 'H'
      });
    }
  }, [uuid, timestamp]);

  return (
    <div className="glass-panel p-8 rounded-[2rem] flex flex-col items-center text-center max-w-sm mx-auto transform transition hover:scale-[1.02] duration-500 group border-emerald-500/10 hover:border-emerald-500/30 bg-gradient-to-b from-white/5 to-transparent">
      <div className="flex items-center gap-2 mb-6">
        <h3 className="text-emerald-400 font-bold uppercase tracking-[0.2em] text-xs">Identity Key</h3>
        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_10px_#10b981]"></div>
      </div>
      <div className="bg-black/40 p-4 rounded-3xl border border-white/10 relative overflow-hidden shadow-2xl">
        <canvas ref={canvasRef} className="opacity-90 relative z-10 mix-blend-screen" />
        <div className="absolute inset-0 bg-gradient-to-tr from-emerald-500/20 via-transparent to-cyan-500/20 opacity-0 group-hover:opacity-100 transition duration-700 pointer-events-none z-20"></div>
        <div className="absolute inset-0 border-[3px] border-emerald-500/30 rounded-3xl opacity-0 group-hover:opacity-100 transition duration-500 scale-95 group-hover:scale-100 z-30"></div>
        <div className="absolute -inset-[100%] bg-gradient-to-r from-transparent via-white/10 to-transparent rotate-45 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000 z-20 pointer-events-none"></div>
      </div>
      <div className="mt-8 space-y-2">
        <h4 className="font-serif text-2xl font-bold text-white tracking-tight">{name}</h4>
        <div className="inline-block px-3 py-1 rounded-full bg-white/5 border border-white/10">
          <p className="text-[10px] font-mono text-emerald-400/80 uppercase tracking-widest">{uuid}</p>
        </div>
        <p className="text-[9px] text-white/30 pt-2 uppercase tracking-wide font-bold">Auto-refreshes every 30s</p>
      </div>
    </div>
  );
};

export default QRIdentity;