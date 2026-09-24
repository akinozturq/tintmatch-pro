import React from 'react';
import type { SensitivityItem } from '../../types';
import { Scale } from 'lucide-react';

interface SensitivityMatrixViewProps {
  sensitivityMatrix: SensitivityItem[];
}

export const SensitivityMatrixView: React.FC<SensitivityMatrixViewProps> = ({
  sensitivityMatrix,
}) => {
  if (!sensitivityMatrix || sensitivityMatrix.length === 0) return null;

  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Scale className="h-4 w-4 text-amber-400" />
          <span className="text-xs font-semibold text-zinc-200">
            Sonlu Farklar Duyarlılığı (Finite-Difference Sensitivity, Δc = +0.05%)
          </span>
        </div>
        <span className="text-[10px] font-mono text-zinc-400">Δc = +0.05% simülasyonu</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs font-mono">
          <thead>
            <tr className="border-b border-zinc-800 text-[10px] text-zinc-400">
              <th className="pb-1.5 font-medium">Pasta</th>
              <th className="pb-1.5 font-medium text-right">Oran</th>
              <th className="pb-1.5 font-medium text-right">∂ΔE00/∂c</th>
              <th className="pb-1.5 font-medium text-right">∂L*/∂c</th>
              <th className="pb-1.5 font-medium text-right">∂a*/∂c</th>
              <th className="pb-1.5 font-medium text-right">∂b*/∂c</th>
              <th className="pb-1.5 font-medium text-right">Öneri & Etki</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60 text-[11px]">
            {sensitivityMatrix.map((item, idx) => (
              <tr key={idx} className="hover:bg-zinc-800/30">
                <td className="py-1.5 text-zinc-200 font-medium">{item.name}</td>
                <td className="py-1.5 text-right text-zinc-300">%{item.concentration.toFixed(2)}</td>
                <td className="py-1.5 text-right font-semibold text-sky-400">
                  {item.d_de00_dc > 0 ? `+${item.d_de00_dc.toFixed(2)}` : item.d_de00_dc.toFixed(2)}
                </td>
                <td className={`py-1.5 text-right ${item.d_L_dc < 0 ? 'text-zinc-400' : 'text-zinc-300'}`}>
                  {item.d_L_dc > 0 ? `+${item.d_L_dc.toFixed(2)}` : item.d_L_dc.toFixed(2)}
                </td>
                <td className={`py-1.5 text-right ${item.d_a_dc > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  {item.d_a_dc > 0 ? `+${item.d_a_dc.toFixed(2)}` : item.d_a_dc.toFixed(2)}
                </td>
                <td className={`py-1.5 text-right ${item.d_b_dc > 0 ? 'text-amber-400' : 'text-blue-400'}`}>
                  {item.d_b_dc > 0 ? `+${item.d_b_dc.toFixed(2)}` : item.d_b_dc.toFixed(2)}
                </td>
                <td className="py-1.5 text-right text-[10px] text-zinc-400">
                  <span className="px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-800">
                    {item.interpretation}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
