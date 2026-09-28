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
    <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-xl p-3.5 text-xs font-mono space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-[var(--brand-blue)]" />
          <span className="text-[var(--text-primary)] font-medium text-[11px]">SLSQP Çözücü Teşhisi</span>
        </div>
        <span
          className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
            diagnostics.success
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
              : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30'
          }`}
        >
          {diagnostics.success ? 'OPTIMAL_CONVERGED' : 'FEASIBLE_LOCAL_MIN'}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2 text-[10px] text-[var(--text-secondary)] pt-1 border-t border-[var(--border)]">
        <div>
          <span className="block text-[var(--text-muted)]">İterasyon:</span>
          <span className="text-[var(--text-primary)] font-semibold">{diagnostics.iterations}</span>
        </div>
        <div>
          <span className="block text-[var(--text-muted)]">Fonksiyon Çağrısı:</span>
          <span className="text-[var(--text-primary)] font-semibold">{diagnostics.function_evaluations}</span>
        </div>
        <div>
          <span className="block text-[var(--text-muted)]">Kütle Marjı:</span>
          <span className="text-[var(--text-primary)] font-semibold">
            {diagnostics.constraint_slack !== undefined
              ? `+${diagnostics.constraint_slack.toFixed(2)}%`
              : 'N/A'}
          </span>
        </div>
        <div>
          <span className="block text-[var(--text-muted)]">Son Kayıp:</span>
          <span className="text-[var(--text-primary)] font-semibold">
            {diagnostics.final_loss !== undefined
              ? diagnostics.final_loss.toFixed(4)
              : 'N/A'}
          </span>
        </div>
      </div>
    </div>
  );
};
