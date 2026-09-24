import React from 'react';
import type { RecipeSimulation } from '../../types';
import { CheckCircle2 } from 'lucide-react';
import { QualityGateView } from './QualityGateView';

interface ColorMetricsProps {
  simulation: RecipeSimulation | null;
}

export const ColorMetrics: React.FC<ColorMetricsProps> = ({ simulation }) => {
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-5 grid grid-cols-1 sm:grid-cols-2 gap-5">
      {/* Color Swatch & Coordinates */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
            Renk Swatch Eşleniği
          </span>
          <span className="text-xs font-mono font-medium text-zinc-300">
            {simulation?.hex || '#ffffff'}
          </span>
        </div>

        {simulation?.comparison ? (
          <div className="h-28 rounded-lg overflow-hidden border border-zinc-800 grid grid-cols-2">
            <div
              className="h-full flex items-end p-2 transition-colors duration-200"
              style={{ backgroundColor: simulation.comparison.target_hex }}
            >
              <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-zinc-950/80 text-zinc-200">
                Hedef: {simulation.comparison.target_hex}
              </span>
            </div>
            <div
              className="h-full flex items-end p-2 transition-colors duration-200 border-l border-zinc-800/80"
              style={{ backgroundColor: simulation.hex }}
            >
              <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-zinc-950/80 text-zinc-200">
                Reçete: {simulation.hex}
              </span>
            </div>
          </div>
        ) : (
          <div
            className="h-28 rounded-lg border border-zinc-800 flex items-end p-2.5 transition-colors duration-200"
            style={{ backgroundColor: simulation?.hex || '#ffffff' }}
          >
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-950/80 text-zinc-200">
              {simulation?.hex || '#ffffff'}
            </span>
          </div>
        )}

        {/* Lab coordinates */}
        <div className="grid grid-cols-3 gap-1.5 text-center text-xs font-mono">
          <div className="p-1.5 bg-zinc-950 rounded border border-zinc-800">
            <span className="block text-[9px] text-zinc-400">L*</span>
            <span className="text-zinc-200">{simulation?.lab.L.toFixed(1) || '0.0'}</span>
          </div>
          <div className="p-1.5 bg-zinc-950 rounded border border-zinc-800">
            <span className="block text-[9px] text-zinc-400">a*</span>
            <span className="text-zinc-200">{simulation?.lab.a.toFixed(1) || '0.0'}</span>
          </div>
          <div className="p-1.5 bg-zinc-950 rounded border border-zinc-800">
            <span className="block text-[9px] text-zinc-400">b*</span>
            <span className="text-zinc-200">{simulation?.lab.b.toFixed(1) || '0.0'}</span>
          </div>
        </div>
      </div>

      {/* Quality Gate, Metamerism & Opacity */}
      <div className="space-y-2.5">
        <QualityGateView comparison={simulation?.comparison || null} />

        {/* Metamerism DIN 6172 */}
        <div className="p-2.5 bg-zinc-950 rounded-lg border border-zinc-800 space-y-1.5 font-mono text-xs">
          <div className="flex justify-between items-center">
            <span className="text-zinc-400">Metamerizm İndeksi (DIN 6172)</span>
            <span className="text-[10px] text-emerald-400 font-medium">
              {simulation?.comparison?.metamerism?.rating || 'Uyumlu'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 text-[10px] text-zinc-400">
            <div className="p-1 bg-zinc-900 rounded flex justify-between">
              <span>MI(Akkor A):</span>
              <span className="text-zinc-200 font-semibold">
                {simulation?.comparison?.metamerism?.MI_A?.toFixed(2) || '0.00'}
              </span>
            </div>
            <div className="p-1 bg-zinc-900 rounded flex justify-between">
              <span>MI(TL84 F11):</span>
              <span className="text-zinc-200 font-semibold">
                {simulation?.comparison?.metamerism?.MI_F11?.toFixed(2) || '0.00'}
              </span>
            </div>
          </div>
        </div>

        {/* Contrast Ratio */}
        <div className="p-2.5 bg-zinc-950 rounded-lg border border-zinc-800 flex items-center justify-between text-xs font-mono">
          <span className="text-zinc-400">Kontrast / Örtücülük:</span>
          <span className="text-emerald-400 font-medium flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            %{simulation?.contrast_ratio.toFixed(1) || '98.5'} (Opak)
          </span>
        </div>
      </div>
    </div>
  );
};
