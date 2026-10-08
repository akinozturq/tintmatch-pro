import React from 'react';
import { ShieldCheck, AlertTriangle, AlertCircle, CheckCircle2, Scale, Info } from 'lucide-react';
import type { RecipeConfidence } from '../../types';

interface RecipeConfidenceCardProps {
  confidence?: RecipeConfidence;
  batchSizeG?: number;
  scaleResolutionG?: number;
  baseAmountG?: number;
  totalColorantG?: number;
  extrapolationWarning?: boolean;
  extrapolationNotes?: string[];
}

export const RecipeConfidenceCard: React.FC<RecipeConfidenceCardProps> = ({
  confidence,
  batchSizeG = 1000,
  scaleResolutionG = 0.01,
  baseAmountG,
  totalColorantG,
  extrapolationWarning,
  extrapolationNotes,
}) => {
  if (!confidence) return null;

  const colorClasses = {
    green: {
      badgeBg: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400',
      icon: <CheckCircle2 className="w-4 h-4 text-emerald-400" />,
      border: 'border-emerald-500/30',
    },
    yellow: {
      badgeBg: 'bg-amber-500/15 border-amber-500/40 text-amber-400',
      icon: <AlertTriangle className="w-4 h-4 text-amber-400" />,
      border: 'border-amber-500/30',
    },
    red: {
      badgeBg: 'bg-rose-500/15 border-rose-500/40 text-rose-400',
      icon: <AlertCircle className="w-4 h-4 text-rose-400" />,
      border: 'border-rose-500/30',
    },
  }[confidence.status_color] || {
    badgeBg: 'bg-gray-500/15 border-gray-500/40 text-gray-300',
    icon: <Info className="w-4 h-4 text-gray-400" />,
    border: 'border-[var(--border)]',
  };

  return (
    <div className={`bg-[var(--surface-3)] border ${colorClasses.border} rounded-[var(--radius-lg)] p-4 space-y-3.5 shadow-sm`}>
      {/* Header & Score Badge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[var(--brand-clay)]" />
          <span className="text-xs font-semibold text-[var(--text-primary)] font-mono uppercase tracking-wider">
            Reçete Güven Skoru
          </span>
        </div>
        <div className={`px-2.5 py-1 rounded-full border text-xs font-mono font-bold flex items-center gap-1.5 ${colorClasses.badgeBg}`}>
          {colorClasses.icon}
          <span>{confidence.summary}</span>
          <span className="opacity-75">({confidence.score}/100)</span>
        </div>
      </div>

      {/* Batch & Weighing Metric Bar */}
      <div className="bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] p-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs font-mono">
        <div>
          <span className="text-[10px] text-[var(--text-muted)] block uppercase">Parti Boyutu</span>
          <span className="font-bold text-[var(--text-primary)]">{batchSizeG} g</span>
        </div>
        <div>
          <span className="text-[10px] text-[var(--text-muted)] block uppercase">Terazi Hassasiyeti</span>
          <span className="font-bold text-[var(--text-primary)]">{scaleResolutionG} g</span>
        </div>
        <div>
          <span className="text-[10px] text-[var(--text-muted)] block uppercase">Baz Boya</span>
          <span className="font-bold text-[var(--brand-clay)]">
            {baseAmountG !== undefined ? `${baseAmountG.toFixed(2)} g` : '-'}
          </span>
        </div>
        <div>
          <span className="text-[10px] text-[var(--text-muted)] block uppercase">Toplam Pasta</span>
          <span className="font-bold text-[var(--text-primary)]">
            {totalColorantG !== undefined ? `${totalColorantG.toFixed(2)} g` : '-'}
          </span>
        </div>
      </div>

      {/* Extrapolation Warning Alert Banner */}
      {extrapolationWarning && (
        <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-[var(--radius)] text-xs text-amber-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
          <div>
            <div className="font-bold">⚠️ Model Ekstrapolasyon Uyarısı:</div>
            <ul className="list-disc list-inside mt-0.5 space-y-0.5 text-[11px] opacity-90">
              {extrapolationNotes?.map((note, idx) => (
                <li key={idx}>{note}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Checklist Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-[var(--border)]/60">
        {confidence.checks.map((chk, idx) => {
          const isPass = chk.status === 'PASS';
          const isWarn = chk.status === 'WARN';
          return (
            <div
              key={idx}
              className="p-2 rounded bg-[var(--surface-0)] border border-[var(--border)] text-xs flex items-start gap-2"
            >
              <div className="mt-0.5 shrink-0">
                {isPass ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                ) : isWarn ? (
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                )}
              </div>
              <div className="truncate">
                <div className="font-semibold text-[var(--text-primary)] text-[11px]">{chk.name}</div>
                <div className="text-[10px] text-[var(--text-muted)] truncate" title={chk.detail}>
                  {chk.detail}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Operator Guidance Checklist */}
      {confidence.operator_guidance && confidence.operator_guidance.length > 0 && (
        <div className="pt-2 border-t border-[var(--border)]/60">
          <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase block mb-1">
            Operatör Talimatı & Fabrika Doğrulaması:
          </span>
          <div className="space-y-1">
            {confidence.operator_guidance.map((guide, idx) => (
              <div key={idx} className="text-xs text-[var(--text-secondary)] flex items-center gap-1.5 font-mono">
                <span>{guide}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
