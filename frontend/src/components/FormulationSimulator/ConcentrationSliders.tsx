import React from 'react';
import type { ColorantPaste, RecipeSimulation } from '../../types';
import { RotateCcw } from 'lucide-react';
import { MAX_TOTAL_COLORANT_LOAD } from '../../constants/limits';

interface ConcentrationSlidersProps {
  pastes: ColorantPaste[];
  concentrations: Record<number, number>;
  simulation: RecipeSimulation | null;
  onConcChange: (pasteId: number, value: number) => void;
  onResetSliders: () => void;
}

export const ConcentrationSliders: React.FC<ConcentrationSlidersProps> = ({
  pastes,
  concentrations,
  simulation,
  onConcChange,
  onResetSliders,
}) => {
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
        <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
          Renklendirici Konsantrasyonları
        </span>
        <button
          onClick={onResetSliders}
          className="text-[10px] text-zinc-400 hover:text-zinc-200 font-mono flex items-center gap-1"
        >
          <RotateCcw className="h-3 w-3" />
          <span>Sıfırla</span>
        </button>
      </div>

      <div className="space-y-3.5 max-h-[380px] overflow-y-auto pr-1">
        {pastes.map((p) => {
          const conc = concentrations[p.id] || 0.0;
          return (
            <div key={p.id} className="space-y-1 p-2 bg-zinc-950/60 rounded-lg border border-zinc-800/80">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full border border-zinc-700"
                    style={{ backgroundColor: p.color_hex }}
                  />
                  <span className="font-medium text-zinc-200 text-xs">{p.name}</span>
                  <span className="text-[10px] text-zinc-400 font-mono">({p.code})</span>
                </div>
                <span className="font-mono font-medium text-zinc-100 text-xs">
                  %{conc.toFixed(2)}
                </span>
              </div>

              <div className="flex items-center gap-2 pt-0.5">
                <input
                  type="range"
                  min="0.00"
                  max={MAX_TOTAL_COLORANT_LOAD.toFixed(2)}
                  step="0.05"
                  value={conc}
                  onChange={(e) => onConcChange(p.id, parseFloat(e.target.value))}
                  className="flex-1 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
                />
                <input
                  type="number"
                  min="0.00"
                  max={MAX_TOTAL_COLORANT_LOAD.toFixed(2)}
                  step="0.05"
                  value={conc}
                  onChange={(e) => onConcChange(p.id, parseFloat(e.target.value) || 0)}
                  className="w-14 px-1 py-0.5 bg-zinc-900 border border-zinc-800 rounded text-center text-xs font-mono text-zinc-200 focus:outline-none"
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="pt-2 border-t border-zinc-800 flex items-center justify-between text-xs font-mono">
        <span className="text-zinc-400">Toplam Pasta Oranı:</span>
        <span className={`font-semibold ${
          (simulation?.total_colorant_load || 0) > MAX_TOTAL_COLORANT_LOAD
            ? 'text-red-400'
            : 'text-zinc-200'
        }`}>
          %{simulation?.total_colorant_load.toFixed(2) || '0.00'} / max %{MAX_TOTAL_COLORANT_LOAD.toFixed(1)}
        </span>
      </div>
    </div>
  );
};
