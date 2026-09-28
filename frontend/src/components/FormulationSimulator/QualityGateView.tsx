import React from 'react';
import type { RecipeComparison } from '../../types';
import { DEFAULT_TOLERANCE_DE00 } from '../../constants/limits';

interface QualityGateViewProps {
  comparison: RecipeComparison | null;
}

export const QualityGateView: React.FC<QualityGateViewProps> = ({ comparison }) => {
  return (
    <div className="space-y-1">
      <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-secondary)] block">
        Kalite Gate & Tolerans Denetimi
      </span>

      {comparison && (
        <div className="p-2.5 bg-[var(--surface-0)] rounded-[var(--radius)] border border-[var(--border)] space-y-1 font-mono text-xs">
          <div className="flex justify-between items-center">
            <span className="text-[var(--text-secondary)]">CIEDE2000 (ΔE00):</span>
            <span
              className={`font-semibold px-1.5 py-0.5 rounded-[var(--radius-xs)] text-[11px] ${
                comparison.delta_e00 <= DEFAULT_TOLERANCE_DE00
                  ? 'bg-[var(--success-subtle)] text-[var(--success-text)] border border-[var(--success-border)]'
                  : 'bg-[var(--warning-subtle)] text-[var(--warning-text)] border border-[var(--warning-border)]'
              }`}
            >
              {comparison.delta_e00.toFixed(3)}
            </span>
          </div>
          <div className="flex justify-between text-[10px] text-[var(--text-secondary)] pt-1 border-t border-[var(--border)]">
            <span>
              ΔL: {comparison.delta_L > 0 ? `+${comparison.delta_L.toFixed(2)}` : comparison.delta_L.toFixed(2)}
            </span>
            <span>
              Δa: {comparison.delta_a > 0 ? `+${comparison.delta_a.toFixed(2)}` : comparison.delta_a.toFixed(2)}
            </span>
            <span>
              Δb: {comparison.delta_b > 0 ? `+${comparison.delta_b.toFixed(2)}` : comparison.delta_b.toFixed(2)}
            </span>
            <span>
              ΔC: {comparison.delta_C > 0 ? `+${comparison.delta_C.toFixed(2)}` : comparison.delta_C.toFixed(2)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
