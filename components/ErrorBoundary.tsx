import * as React from "react";

interface Props {
  children?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-black p-4 text-center">
            <div className="glass-panel p-10 rounded-3xl border-red-500/30 max-w-lg w-full relative overflow-hidden">
                <div className="ambient-light"></div>
                <div className="relative z-10">
                  <div className="text-5xl mb-6">💥</div>
                  <h1 className="text-3xl font-serif font-bold text-white mb-2">System Malfunction</h1>
                  <p className="text-white/60 text-sm mb-8 leading-relaxed">
                      The clinical node encountered a critical runtime error. 
                      <br/>Please reboot the interface to restore connectivity.
                  </p>
                  <div className="bg-black/40 p-4 rounded-xl text-red-300/80 text-[10px] font-mono mb-8 text-left overflow-auto max-h-32 border border-red-500/10 shadow-inner">
                      {this.state.error?.message}
                  </div>
                  <button onClick={() => window.location.reload()} className="w-full py-4 bg-white/5 hover:bg-white/10 rounded-xl text-xs font-bold uppercase tracking-[0.2em] text-white transition border border-white/5 hover:border-white/20 shadow-lg">
                      Reboot System
                  </button>
                </div>
            </div>
        </div>
      );
    }

    return this.props.children;
  }
}
