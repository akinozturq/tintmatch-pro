import React, { useState } from 'react';
import { Scale, CheckCircle2, AlertTriangle, FlaskConical, Copy, Check, Printer } from 'lucide-react';
import type { RecipeMatch, BasePaint } from '../../types';
import { BatchTicketModal } from './BatchTicketModal';

interface ManufacturableRecipeTableProps {
  activeRecipe: RecipeMatch | null;
  activeBase: BasePaint;
  batchSizeG: number;
  scaleResolutionG: number;
  onChangeBatchSize: (size: number) => void;
  onOpenDrawdownModal: () => void;
}

export const ManufacturableRecipeTable: React.FC<ManufacturableRecipeTableProps> = ({
  activeRecipe,
  activeBase,
  batchSizeG,
  scaleResolutionG,
  onChangeBatchSize,
  onOpenDrawdownModal,
}) => {
  const [copied, setCopied] = useState(false);
  const [isTicketOpen, setIsTicketOpen] = useState(false);

  const presets = [
    { label: '100 g (Lab Deneme)', value: 100 },
    { label: '500 g (Numune)', value: 500 },
    { label: '1000 g (Standart 1 kg)', value: 1000 },
    { label: '3000 g (Galon)', value: 3000 },
    { label: '5000 g (5 kg Kova)', value: 5000 },
  ];

  if (!activeRecipe) return null;

  const pastes = activeRecipe.matched_pastes;
  const totalColorantConc = pastes.reduce((acc, p) => acc + (p.concentration || 0), 0);
  const baseConcentration = Math.max(0, 100 - totalColorantConc);

  // Dynamically calculate grams for the current batchSizeG
  const isRecipeBatchSizeMatch = activeRecipe.batch_size_g === batchSizeG;
  const pastesWithAmounts = pastes.map((p) => {
    const amountG = (isRecipeBatchSizeMatch && p.amount_g !== undefined)
      ? p.amount_g
      : parseFloat(((p.concentration / 100) * batchSizeG).toFixed(2));
    return {
      ...p,
      amountG,
    };
  });

  const totalPasteG = parseFloat(pastesWithAmounts.reduce((acc, p) => acc + p.amountG, 0).toFixed(2));
  const baseG = (isRecipeBatchSizeMatch && activeRecipe.base_amount_g !== undefined)
    ? activeRecipe.base_amount_g
    : Math.max(0, parseFloat((batchSizeG - totalPasteG).toFixed(2)));

  // Running cumulative scale weight targets
  let runningScaleTotal = baseG;
  const pastesWithCumulative = pastesWithAmounts.map((p) => {
    runningScaleTotal = parseFloat((runningScaleTotal + p.amountG).toFixed(2));
    return {
      ...p,
      cumulativeG: runningScaleTotal,
    };
  });

  const formatConcentration = (conc: number) => {
    if (conc < 0.01) return conc.toFixed(3);
    if (conc < 0.1) return conc.toFixed(3);
    return conc.toFixed(2);
  };

  const handleCopy = () => {
    let text = `TINTMATCH PRO - ÜRETİM REÇETESİ\n`;
    text += `Parti Boyutu: ${batchSizeG} g (Terazi Hassasiyeti: ${scaleResolutionG} g)\n`;
    text += `Baz: ${activeBase.name} (${activeBase.code}) -> ${baseG.toFixed(2)} g (%${baseConcentration.toFixed(2)})\n`;
    pastesWithCumulative.forEach((p) => {
      text += `Pasta: ${p.name} (%${formatConcentration(p.concentration)}) -> Net: ${p.amountG.toFixed(2)} g | Kümülatif: ${p.cumulativeG.toFixed(2)} g\n`;
    });
    text += `Toplam: ${batchSizeG.toFixed(2)} g (%100.00)\n`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-5 space-y-4 shadow-[var(--shadow-sm)]">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-[var(--radius)] bg-[var(--brand-clay)]/10 text-[var(--brand-clay)]">
              <Scale className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wider font-mono">
                  Üretilebilir Tartım Reçetesi (0.01 g Hassasiyet)
                </h3>
                <span className="px-1.5 py-0.5 rounded-[var(--radius-xs)] text-[10px] font-mono bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-bold">
                  ✓ Fiziksel Dozaj
                </span>
              </div>
              <p className="text-[11px] text-[var(--text-secondary)]">
                Manuel teraziye göre 0.01 g basamağına yuvarlanmış net tartım ve kümülatif terazi tablosu
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="px-2.5 py-1.5 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] border border-[var(--border)] text-[var(--text-secondary)] rounded text-xs font-mono flex items-center gap-1.5 cursor-pointer"
              title="Reçeteyi Panoya Kopyala"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copied ? 'Kopyalandı' : 'Kopyala'}</span>
            </button>
            <button
              type="button"
              onClick={() => setIsTicketOpen(true)}
              className="px-2.5 py-1.5 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] border border-[var(--border)] text-[var(--text-primary)] rounded text-xs font-semibold font-mono flex items-center gap-1.5 cursor-pointer shadow-2xs"
              title="A4 Üretim Fişi / İş Emri Yazdır"
            >
              <Printer className="h-3.5 w-3.5 text-[var(--brand-clay)]" />
              <span>İş Emri Yazdır</span>
            </button>
            <button
              type="button"
              onClick={onOpenDrawdownModal}
              className="px-3 py-1.5 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white rounded text-xs font-bold font-mono flex items-center gap-1.5 shadow-sm cursor-pointer"
            >
              <FlaskConical className="h-3.5 w-3.5" />
              <span>Drawdown Doğrula</span>
            </button>
          </div>
        </div>

      {/* Batch Size Selection Bar */}
      <div className="bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] p-3 space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <span className="text-xs font-mono font-semibold text-[var(--text-secondary)] uppercase">
            Parti Boyutu Seçimi:
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-[var(--text-muted)]">Özel Gram:</span>
            <input
              type="number"
              min="1"
              max="5000000"
              step="10"
              value={batchSizeG}
              onChange={(e) => onChangeBatchSize(Math.max(1, parseFloat(e.target.value) || 1000))}
              className="w-28 px-2 py-1 bg-[var(--surface-1)] border border-[var(--border)] rounded text-xs font-mono font-bold text-[var(--text-primary)] text-right focus:outline-none focus:border-[var(--brand-clay)]"
            />
            <span className="text-xs font-mono text-[var(--text-muted)]">g</span>
          </div>
        </div>

        {/* Preset Buttons */}
        <div className="flex flex-wrap gap-1.5 pt-1 border-t border-[var(--border)]/60">
          {presets.map((ps) => (
            <button
              key={ps.value}
              type="button"
              onClick={() => onChangeBatchSize(ps.value)}
              className={`px-2.5 py-1 rounded text-[11px] font-mono cursor-pointer transition-all ${
                batchSizeG === ps.value
                  ? 'bg-[var(--brand-clay)] text-white font-bold shadow-xs'
                  : 'bg-[var(--surface-1)] border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
              }`}
            >
              {ps.label}
            </button>
          ))}
        </div>
      </div>

      {/* Physical Weighing Table */}
      <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]">
        <table className="w-full text-left text-xs font-mono">
          <thead className="bg-[var(--surface-1)] text-[var(--text-secondary)] text-[10px] uppercase border-b border-[var(--border)]">
            <tr>
              <th className="p-2.5">Bileşen Adı</th>
              <th className="p-2.5">Bileşen Rolü</th>
              <th className="p-2.5 text-center">Formül %</th>
              <th className="p-2.5 text-right">Net Miktar (g)</th>
              <th className="p-2.5 text-right bg-blue-500/10 text-blue-600 dark:text-blue-400 font-bold">Kümülatif Terazi (g)</th>
              <th className="p-2.5 text-center">Tartılabilirlik Durumu</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {/* Carrier Base Row */}
            <tr className="bg-[var(--surface-0)] text-[var(--text-primary)] font-medium">
              <td className="p-2.5 flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full border border-[var(--border-strong)] shrink-0"
                  style={{ backgroundColor: activeBase.hex }}
                />
                <span className="font-bold">{activeBase.name}</span>
                <span className="text-[10px] text-[var(--text-muted)] font-mono">({activeBase.code})</span>
              </td>
              <td className="p-2.5 text-[var(--text-secondary)]">Taşıyıcı Baz Boya</td>
              <td className="p-2.5 text-center text-[var(--text-muted)] font-mono font-semibold">
                %{baseConcentration.toFixed(2)}
              </td>
              <td className="p-2.5 text-right font-black text-sm text-[var(--brand-clay)] font-mono">
                {baseG.toFixed(2)} g
              </td>
              <td className="p-2.5 text-right font-black text-sm text-blue-600 dark:text-blue-400 bg-blue-500/5 font-mono">
                {baseG.toFixed(2)} g
              </td>
              <td className="p-2.5 text-center">
                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>Uygun</span>
                </span>
              </td>
            </tr>

            {/* Colorant Pastes */}
            {pastesWithCumulative.map((p) => {
              const isWeighable = p.amountG >= scaleResolutionG;

              return (
                <tr key={p.id} className="hover:bg-[var(--surface-1)] text-[var(--text-primary)]">
                  <td className="p-2.5 flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full border border-[var(--border-strong)] shrink-0"
                      style={{ backgroundColor: p.color_hex || p.hex }}
                    />
                    <span className="font-bold">{p.name}</span>
                    <span className="text-[10px] text-[var(--text-muted)] font-mono">({p.code})</span>
                  </td>
                  <td className="p-2.5 text-[var(--text-secondary)]">Renklendirici Pasta</td>
                  <td className="p-2.5 text-center font-semibold text-[var(--accent-text)] font-mono">
                    %{formatConcentration(p.concentration)}
                  </td>
                  <td className="p-2.5 text-right font-black text-sm text-[var(--text-primary)] font-mono">
                    {p.amountG.toFixed(2)} g
                  </td>
                  <td className="p-2.5 text-right font-black text-sm text-blue-600 dark:text-blue-400 bg-blue-500/5 font-mono">
                    {p.cumulativeG.toFixed(2)} g
                  </td>
                  <td className="p-2.5 text-center">
                    {isWeighable ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Tartılabilir</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] text-rose-600 dark:text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
                        <AlertTriangle className="w-3 h-3" />
                        <span>&lt;{scaleResolutionG}g Tartılamaz!</span>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}

            {/* Total Row */}
            <tr className="bg-[var(--surface-1)] font-bold text-xs border-t-2 border-[var(--border)]">
              <td className="p-2.5" colSpan={2}>
                TOPLAM KARIŞIM AĞIRLIĞI
              </td>
              <td className="p-2.5 text-center font-mono">%100.00</td>
              <td className="p-2.5 text-right text-emerald-600 dark:text-emerald-400 font-mono text-sm">
                {(baseG + totalPasteG).toFixed(2)} g
              </td>
              <td className="p-2.5 text-right text-blue-600 dark:text-blue-400 font-black font-mono text-sm bg-blue-500/10">
                {batchSizeG.toFixed(2)} g
              </td>
              <td className="p-2.5 text-center text-[10px] text-[var(--text-muted)] font-mono">
                Hedef: {batchSizeG.toFixed(2)} g
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    {/* Batch Ticket Modal */}
    <BatchTicketModal
      isOpen={isTicketOpen}
      onClose={() => setIsTicketOpen(false)}
      recipe={activeRecipe}
      base={activeBase}
      batchSizeG={batchSizeG}
      scaleResolutionG={scaleResolutionG}
    />
  </>
);
};
