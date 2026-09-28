import React, { useState } from 'react';
import type { SensitivityItem } from '../../types';
import { Scale, ChevronDown, ChevronRight, PlusCircle, MinusCircle } from 'lucide-react';

interface SensitivityMatrixViewProps {
  sensitivityMatrix: SensitivityItem[];
}

export const SensitivityMatrixView: React.FC<SensitivityMatrixViewProps> = ({
  sensitivityMatrix,
}) => {
  const [showWhatIfSteps, setShowWhatIfSteps] = useState<boolean>(true);

  if (!sensitivityMatrix || sensitivityMatrix.length === 0) return null;

  return (
    <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-4 space-y-3 shadow-[var(--shadow-sm)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Scale className="h-4 w-4 text-[var(--brand-clay)]" />
          <span className="text-xs font-semibold text-[var(--text-primary)]">
            Sonlu Farklar Duyarlılığı & What-If Analizi (∂/∂c & ±0.10%)
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowWhatIfSteps(!showWhatIfSteps)}
          className="text-[10px] font-mono text-[var(--accent-text)] hover:text-[var(--brand-clay)] flex items-center gap-1 transition-colors"
        >
          {showWhatIfSteps ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <span>{showWhatIfSteps ? 'Adım Detaylarını Gizle' : '±0.10% Adımlarını Göster'}</span>
        </button>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]">
        <table className="w-full text-left text-xs font-mono">
          <thead>
            <tr className="border-b border-[var(--border)] text-[10px] text-[var(--text-secondary)] bg-[var(--surface-1)]">
              <th className="py-2 px-2.5 font-medium">Pasta</th>
              <th className="py-2 px-2.5 font-medium text-right">Mevcut Oran</th>
              <th className="py-2 px-2.5 font-medium text-right">∂ΔE00/∂c</th>
              <th className="py-2 px-2.5 font-medium text-right">∂L*/∂c</th>
              <th className="py-2 px-2.5 font-medium text-right">∂a*/∂c</th>
              <th className="py-2 px-2.5 font-medium text-right">∂b*/∂c</th>
              <th className="py-2 px-2.5 font-medium text-right">Tavsiye & Etki</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)] text-[11px] bg-[var(--surface-0)]">
            {sensitivityMatrix.map((item, idx) => (
              <React.Fragment key={idx}>
                <tr className="hover:bg-[var(--surface-1)]">
                  <td className="py-2 px-2.5 text-[var(--text-primary)] font-medium">{item.name}</td>
                  <td className="py-2 px-2.5 text-right text-[var(--text-secondary)]">%{item.concentration.toFixed(2)}</td>
                  <td className="py-2 px-2.5 text-right font-semibold text-[var(--brand-clay)]">
                    {item.d_de00_dc > 0 ? `+${item.d_de00_dc.toFixed(2)}` : item.d_de00_dc.toFixed(2)}
                  </td>
                  <td className={`py-2 px-2.5 text-right ${item.d_L_dc < 0 ? 'text-[var(--text-muted)]' : 'text-[var(--text-secondary)]'}`}>
                    {item.d_L_dc > 0 ? `+${item.d_L_dc.toFixed(2)}` : item.d_L_dc.toFixed(2)}
                  </td>
                  <td className={`py-2 px-2.5 text-right ${item.d_a_dc > 0 ? 'text-[var(--danger-text)]' : 'text-[var(--success-text)]'}`}>
                    {item.d_a_dc > 0 ? `+${item.d_a_dc.toFixed(2)}` : item.d_a_dc.toFixed(2)}
                  </td>
                  <td className={`py-2 px-2.5 text-right ${item.d_b_dc > 0 ? 'text-[var(--warning-text)]' : 'text-[var(--accent-text)]'}`}>
                    {item.d_b_dc > 0 ? `+${item.d_b_dc.toFixed(2)}` : item.d_b_dc.toFixed(2)}
                  </td>
                  <td className="py-2 px-2.5 text-right text-[10px]">
                    <span className="px-1.5 py-0.5 rounded-[var(--radius-xs)] bg-[var(--surface-1)] border border-[var(--border)] text-[var(--text-secondary)]">
                      {item.interpretation}
                    </span>
                  </td>
                </tr>

                {/* Concrete What-If Discrete Steps Row */}
                {showWhatIfSteps && (item.step_plus_010 || item.step_minus_010) && (
                  <tr className="bg-[var(--surface-1)] text-[10px]">
                    <td colSpan={7} className="py-1.5 px-3">
                      <div className="flex flex-wrap items-center gap-4 text-[var(--text-secondary)]">
                        {item.step_plus_010 && (
                          <div className="flex items-center gap-1.5">
                            <PlusCircle className="h-3 w-3 text-[var(--success-text)]" />
                            <span className="text-[var(--text-primary)] font-semibold">+0.10% İlave:</span>
                            <span>ΔE00: <strong className="text-[var(--brand-clay)]">{item.step_plus_010.delta_e00.toFixed(2)}</strong></span>
                            <span>ΔL*: {item.step_plus_010.delta_L > 0 ? `+${item.step_plus_010.delta_L.toFixed(2)}` : item.step_plus_010.delta_L.toFixed(2)}</span>
                            <span>Δa*: {item.step_plus_010.delta_a > 0 ? `+${item.step_plus_010.delta_a.toFixed(2)}` : item.step_plus_010.delta_a.toFixed(2)}</span>
                            <span>Δb*: {item.step_plus_010.delta_b > 0 ? `+${item.step_plus_010.delta_b.toFixed(2)}` : item.step_plus_010.delta_b.toFixed(2)}</span>
                          </div>
                        )}

                        {item.step_minus_010 && item.concentration > 0 && (
                          <div className="flex items-center gap-1.5">
                            <MinusCircle className="h-3 w-3 text-[var(--warning-text)]" />
                            <span className="text-[var(--text-primary)] font-semibold">-0.10% Azaltım:</span>
                            <span>ΔE00: <strong className="text-[var(--brand-clay)]">{item.step_minus_010.delta_e00.toFixed(2)}</strong></span>
                            <span>ΔL*: {item.step_minus_010.delta_L > 0 ? `+${item.step_minus_010.delta_L.toFixed(2)}` : item.step_minus_010.delta_L.toFixed(2)}</span>
                            <span>Δa*: {item.step_minus_010.delta_a > 0 ? `+${item.step_minus_010.delta_a.toFixed(2)}` : item.step_minus_010.delta_a.toFixed(2)}</span>
                            <span>Δb*: {item.step_minus_010.delta_b > 0 ? `+${item.step_minus_010.delta_b.toFixed(2)}` : item.step_minus_010.delta_b.toFixed(2)}</span>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
