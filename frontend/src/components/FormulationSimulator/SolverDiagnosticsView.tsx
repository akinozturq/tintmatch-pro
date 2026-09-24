import React from 'react';
import { Activity } from 'lucide-react';

interface SolverDiagnosticsProps {
  diagnostics: {
    success: boolean;
    iterations: number;
    function_evaluations: number;
    constraint_slack?: number;
    final_loss?: number;
    message?: string;
  } | null;
}

export const SolverDiagnosticsView: React.FC<SolverDiagnosticsProps> = ({ diagnostics }) => {
  if (!diagnostics) return null;

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3.5 text-xs font-mono space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-sky-400" />
          <span className="text-zinc-300 font-medium text-[11px]">SLSQP Çözücü Teşhisi</span>
        </div>
        <span
          className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
            diagnostics.success
              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
              : 'bg-amber-950 text-amber-300 border border-amber-800'
          }`}
        >
          {diagnostics.success ? 'OPTIMAL_CONVERGED' : 'FEASIBLE_LOCAL_MIN'}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2 text-[10px] text-zinc-400 pt-1 border-t border-zinc-800/80">
        <div>
          <span className="block text-zinc-500">İterasyon:</span>
          <span className="text-zinc-200">{diagnostics.iterations}</span>
        </div>
        <div>
          <span className="block text-zinc-500">Fonksiyon Çağrısı:</span>
          <span className="text-zinc-200">{diagnostics.function_evaluations}</span>
        </div>
        <div>
          <span className="block text-zinc-500">Kütle Marjı:</span>
          <span className="text-zinc-200">
            {diagnostics.constraint_slack !== undefined
              ? `+${diagnostics.constraint_slack.toFixed(2)}%`
              : 'N/A'}
          </span>
        </div>
        <div>
          <span className="block text-zinc-500">Son Kayıp:</span>
          <span className="text-zinc-200">
            {diagnostics.final_loss !== undefined
              ? diagnostics.final_loss.toFixed(4)
              : 'N/A'}
          </span>
        </div>
      </div>
    </div>
  );
};
