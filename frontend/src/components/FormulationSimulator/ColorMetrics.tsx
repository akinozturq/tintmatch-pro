import React from 'react';
import type { RecipeSimulation } from '../../types';
import { CheckCircle2 } from 'lucide-react';
import { QualityGateView } from './QualityGateView';

interface ColorMetricsProps {
  simulation: RecipeSimulation | null;
}

export const ColorMetrics: React.FC<ColorMetricsProps> = ({ simulation }) => {
  return (
    <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-5 grid grid-cols-1 sm:grid-cols-2 gap-5 shadow-[var(--shadow-sm)]">
      {/* Color Swatch & Coordinates */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-secondary)]">
            Renk Swatch Eşleniği
          </span>
          <span className="text-xs font-mono font-medium text-[var(--text-primary)]">
            {simulation?.hex || '#ffffff'}
          </span>
        </div>

        {simulation?.comparison ? (
          <div className="h-28 rounded-[var(--radius)] overflow-hidden border border-[var(--border-strong)] grid grid-cols-2 shadow-inner">
            <div
              className="h-full flex items-end p-2 transition-colors duration-200"
              style={{ backgroundColor: simulation.comparison.target_hex }}
            >
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-[var(--radius-xs)] bg-black/70 text-white shadow-sm">
                Hedef: {simulation.comparison.target_hex}
              </span>
            </div>
            <div
              className="h-full flex items-end p-2 transition-colors duration-200 border-l border-black/20"
              style={{ backgroundColor: simulation.hex }}
            >
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-[var(--radius-xs)] bg-black/70 text-white shadow-sm">
                Reçete: {simulation.hex}
              </span>
            </div>
          </div>
        ) : (
          <div
            className="h-28 rounded-[var(--radius)] border border-[var(--border-strong)] flex items-end p-2.5 transition-colors duration-200 shadow-inner"
            style={{ backgroundColor: simulation?.hex || '#ffffff' }}
          >
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-[var(--radius-xs)] bg-black/70 text-white shadow-sm">
              {simulation?.hex || '#ffffff'}
            </span>
          </div>
        )}

        {/* Lab coordinates */}
        <div className="grid grid-cols-3 gap-1.5 text-center text-xs font-mono">
          <div className="p-1.5 bg-[var(--surface-0)] rounded-[var(--radius-xs)] border border-[var(--border)]">
            <span className="block text-[9px] text-[var(--text-secondary)]">L*</span>
            <span className="text-[var(--text-primary)] font-semibold">{simulation?.lab.L.toFixed(1) || '0.0'}</span>
          </div>
          <div className="p-1.5 bg-[var(--surface-0)] rounded-[var(--radius-xs)] border border-[var(--border)]">
            <span className="block text-[9px] text-[var(--text-secondary)]">a*</span>
            <span className="text-[var(--text-primary)] font-semibold">{simulation?.lab.a.toFixed(1) || '0.0'}</span>
          </div>
          <div className="p-1.5 bg-[var(--surface-0)] rounded-[var(--radius-xs)] border border-[var(--border)]">
            <span className="block text-[9px] text-[var(--text-secondary)]">b*</span>
            <span className="text-[var(--text-primary)] font-semibold">{simulation?.lab.b.toFixed(1) || '0.0'}</span>
          </div>
        </div>
      </div>

      {/* Quality Gate, Metamerism & Opacity */}
      <div className="space-y-2.5">
        <QualityGateView comparison={simulation?.comparison || null} />

        {/* Metamerism DIN 6172 */}
        <div className="p-2.5 bg-[var(--surface-0)] rounded-[var(--radius)] border border-[var(--border)] space-y-1.5 font-mono text-xs">
          <div className="flex justify-between items-center">
            <span className="text-[var(--text-secondary)]">Metamerizm İndeksi (DIN 6172)</span>
            <span className="text-[10px] text-[var(--success-text)] font-semibold">
              {simulation?.comparison?.metamerism?.rating || 'Uyumlu'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 text-[10px] text-[var(--text-secondary)]">
            <div className="p-1 bg-[var(--surface-1)] border border-[var(--border)] rounded-[var(--radius-xs)] flex justify-between">
              <span>MI(Akkor A):</span>
              <span className="text-[var(--text-primary)] font-semibold">
                {simulation?.comparison?.metamerism?.MI_A?.toFixed(2) || '0.00'}
              </span>
            </div>
            <div className="p-1 bg-[var(--surface-1)] border border-[var(--border)] rounded-[var(--radius-xs)] flex justify-between">
              <span>MI(TL84 F11):</span>
              <span className="text-[var(--text-primary)] font-semibold">
                {simulation?.comparison?.metamerism?.MI_F11?.toFixed(2) || '0.00'}
              </span>
            </div>
          </div>
        </div>

        {/* Contrast Ratio */}
        <div className="p-2.5 bg-[var(--surface-0)] rounded-[var(--radius)] border border-[var(--border)] flex items-center justify-between text-xs font-mono">
          <span className="text-[var(--text-secondary)]">Kontrast / Örtücülük:</span>
          <span className="text-[var(--success-text)] font-semibold flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            %{simulation?.contrast_ratio.toFixed(1) || '98.5'} (Opak)
          </span>
        </div>
      </div>
    </div>
  );
};
