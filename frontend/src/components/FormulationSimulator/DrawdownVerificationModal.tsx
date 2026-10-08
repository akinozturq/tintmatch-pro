import React, { useState } from 'react';
import {
  X,
  Zap,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  PlusCircle,
  FlaskConical,
  Scale
} from 'lucide-react';
import type { RecipeMatch, BasePaint } from '../../types';
import { measureChnspec, recordDrawdownMeasurement, saveRecipe } from '../../services/api';

interface DrawdownVerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeRecipe: RecipeMatch | null;
  activeRecipeKey: 'recipe_a' | 'recipe_b' | 'recipe_c';
  activeBase: BasePaint;
  targetReflectance: number[] | null;
  targetHex: string;
  targetName: string;
  batchSizeG: number;
  scaleResolutionG: number;
}

export const DrawdownVerificationModal: React.FC<DrawdownVerificationModalProps> = ({
  isOpen,
  onClose,
  activeRecipe,
  activeRecipeKey,
  activeBase,
  targetReflectance,
  targetHex,
  targetName,
  batchSizeG,
  scaleResolutionG,
}) => {
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [measuredReflectance, setMeasuredReflectance] = useState<number[] | null>(null);
  const [measuredHex, setMeasuredHex] = useState<string | null>(null);
  const [operatorNotes, setOperatorNotes] = useState<string>('');
  const [actualDispensed, setActualDispensed] = useState<Record<string | number, number>>({});
  const [verificationResult, setVerificationResult] = useState<{
    de00: number;
    outcome: 'ACCEPTED' | 'ADDBACK_REQUIRED' | 'REJECTED';
    outcomeMessage: string;
    addbackSuggestion?: any;
    measuredLab?: { L: number; a: number; b: number };
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Initialize actual dispensed grams whenever modal opens or recipe changes
  React.useEffect(() => {
    if (activeRecipe && isOpen) {
      const initial: Record<string | number, number> = {};
      activeRecipe.matched_pastes.forEach((p) => {
        const grams = p.amount_g ?? parseFloat(((p.concentration / 100) * batchSizeG).toFixed(2));
        initial[p.id] = grams;
      });
      setActualDispensed(initial);
      setMeasuredReflectance(null);
      setVerificationResult(null);
      setErrorMsg(null);
    }
  }, [activeRecipe, isOpen, batchSizeG]);

  if (!isOpen || !activeRecipe) return null;

  // 1-Click measure directly from CHNSpec DS-36D
  const handleMeasureFromDevice = async () => {
    setIsMeasuring(true);
    setErrorMsg(null);
    try {
      const res = await measureChnspec('SCI', `Drawdown_${targetName}`);
      if (!res || !res.reflectance || res.reflectance.length !== 31) {
        throw new Error('CHNSpec DS-36D spektrofotometresinden spektrum okunamadı.');
      }
      setMeasuredReflectance(res.reflectance);
      if (res.hex) setMeasuredHex(res.hex);
    } catch (err: any) {
      setErrorMsg(err.message || 'Cihazdan ölçüm alınırken hata oluştu.');
    } finally {
      setIsMeasuring(false);
    }
  };

  // Mock / Simulation test reading for demonstration / lab trial without connected hardware
  const handleSimulateDrawdown = (scenario: 'match' | 'slight_off' | 'poor') => {
    const baseRefl = activeRecipe.prediction.reflectance;
    let factor = 0.0;
    if (scenario === 'match') factor = 0.003;
    else if (scenario === 'slight_off') factor = 0.022;
    else factor = 0.065;

    const simRefl = baseRefl.map((r, i) =>
      Math.max(0.01, Math.min(0.98, r + (i % 2 === 0 ? factor : -factor * 0.8)))
    );
    setMeasuredReflectance(simRefl);
    setMeasuredHex(activeRecipe.prediction.hex);
  };

  const handleVerify = async () => {
    if (!measuredReflectance) {
      setErrorMsg('Lütfen önce fiziksel boya filminin (drawdown) spektrumunu ölçün.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      let recipeId = activeRecipe.recipe_id;

      // If recipe is not yet saved to database, save it now to establish its attempt history
      if (!recipeId) {
        const saveRes = await saveRecipe({
          name: `${targetName} (${activeRecipeKey.toUpperCase()})`,
          base_id: activeBase.id,
          pastes: activeRecipe.matched_pastes.map((p) => ({
            paste_id: Number(p.id),
            id: Number(p.id),
            concentration: p.concentration,
            amount_g: actualDispensed[p.id] ?? p.amount_g,
          })),
          predicted_reflectance: activeRecipe.prediction.reflectance,
          lab: activeRecipe.prediction.lab,
          hex_color: activeRecipe.prediction.hex,
          delta_e00: activeRecipe.delta_e00,
          contrast_ratio: activeRecipe.prediction.contrast_ratio,
          profile_id: activeRecipeKey,
          batch_size_g: batchSizeG,
          scale_resolution_g: scaleResolutionG,
          recipe_confidence: activeRecipe.recipe_confidence,
          operator_notes: operatorNotes || 'Fiziksel drawdown doğrulaması',
        });
        recipeId = saveRes.id;
      }

      const dispensedList = Object.entries(actualDispensed).map(([id, grams]) => ({
        id: Number(id),
        amount_g: grams,
      }));

      const result = await recordDrawdownMeasurement(recipeId, 1, {
        measured_reflectance: measuredReflectance,
        sample_name: `Drawdown_${targetName}`,
        actual_dispensed: dispensedList,
        batch_size_g: batchSizeG,
        operator_notes: operatorNotes,
      });

      setVerificationResult({
        de00: result.de00_predicted_vs_measured,
        outcome: result.outcome,
        outcomeMessage: result.outcome_message,
        addbackSuggestion: result.addback_suggestion,
        measuredLab: result.measured_lab,
      });
    } catch (err: any) {
      setErrorMsg(err.message || 'Drawdown kaydı sırasında hata oluştu.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[var(--surface-3)] border border-[var(--border)] text-[var(--text-primary)] rounded-[var(--radius-lg)] max-w-2xl w-full p-5 space-y-4 shadow-2xl my-8">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-[var(--radius)] bg-[var(--brand-clay)]/10 text-[var(--brand-clay)]">
              <FlaskConical className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)] font-mono">
                Fiziksel Drawdown Doğrulaması (Golden Batch Testi)
              </h3>
              <p className="text-xs text-[var(--text-secondary)]">
                Laboratuvar numunesini çekin, spektrofotometre ile okutun ve model sapmasını doğrulayın
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-[var(--surface-1)] rounded-[var(--radius)] text-[var(--text-muted)] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 bg-[var(--danger-subtle)] border border-[var(--danger-border)] rounded-[var(--radius)] text-xs text-[var(--danger-text)] font-mono">
            {errorMsg}
          </div>
        )}

        {/* Recipe Summary Bar */}
        <div className="bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
          <div>
            <span className="text-[10px] text-[var(--text-muted)] uppercase block">Hedef Numune</span>
            <span className="font-bold text-[var(--text-primary)] truncate block">{targetName}</span>
          </div>
          <div>
            <span className="text-[10px] text-[var(--text-muted)] uppercase block">Reçete / Profil</span>
            <span className="font-bold text-[var(--brand-clay)] uppercase">{activeRecipeKey}</span>
          </div>
          <div>
            <span className="text-[10px] text-[var(--text-muted)] uppercase block">Parti Boyutu</span>
            <span className="font-bold text-[var(--text-primary)]">{batchSizeG.toLocaleString('tr-TR')} g</span>
          </div>
          <div>
            <span className="text-[10px] text-[var(--text-muted)] uppercase block">Tahmini ΔE00</span>
            <span className="font-bold text-emerald-400">
              {activeRecipe.delta_e00 ? activeRecipe.delta_e00.toFixed(2) : '0.00'}
            </span>
          </div>
        </div>

        {/* Step 1: Dispensed Pastes (Tartılan Miktarlar) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="font-semibold text-[var(--text-secondary)] uppercase">
              1. Tartılan Fiziksel Miktarlar ({scaleResolutionG} g Hassasiyet)
            </span>
            <span className="text-[11px] text-[var(--text-muted)]">
              Baz: {activeRecipe.base_amount_g ? `${activeRecipe.base_amount_g.toFixed(2)} g` : '-'}
            </span>
          </div>
          <div className="border border-[var(--border)] rounded-[var(--radius)] overflow-hidden">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-[var(--surface-1)] text-[var(--text-muted)] text-[10px] uppercase border-b border-[var(--border)]">
                <tr>
                  <th className="p-2">Pasta</th>
                  <th className="p-2 text-center">Kons. %</th>
                  <th className="p-2 text-right">Hedef Gram</th>
                  <th className="p-2 text-right">Gerçek Tartılan (g)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)] bg-[var(--surface-0)]">
                {activeRecipe.matched_pastes.map((p) => {
                  const targetGrams = p.amount_g ?? parseFloat(((p.concentration / 100) * batchSizeG).toFixed(2));
                  return (
                    <tr key={p.id}>
                      <td className="p-2 flex items-center gap-1.5 font-medium">
                        <span
                          className="w-2.5 h-2.5 rounded-full border border-[var(--border-strong)] shrink-0"
                          style={{ backgroundColor: p.color_hex || p.hex }}
                        />
                        <span>{p.name}</span>
                      </td>
                      <td className="p-2 text-center font-mono">%{p.concentration.toFixed(2)}</td>
                      <td className="p-2 text-right font-mono text-[var(--text-secondary)]">
                        {targetGrams.toFixed(2)} g
                      </td>
                      <td className="p-2 text-right">
                        <input
                          type="number"
                          step={scaleResolutionG}
                          value={actualDispensed[p.id] ?? targetGrams}
                          onChange={(e) =>
                            setActualDispensed((prev) => ({
                              ...prev,
                              [p.id]: parseFloat(e.target.value) || 0,
                            }))
                          }
                          className="w-24 px-2 py-0.5 text-right font-mono bg-[var(--surface-1)] border border-[var(--border)] rounded text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand-clay)]"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Step 2: Drawdown Ölçümü (CHNSpec DS-36D) */}
        <div className="space-y-2">
          <span className="text-xs font-semibold font-mono text-[var(--text-secondary)] uppercase block">
            2. Fiziksel Numune Spektrumu Ölçümü
          </span>

          <div className="flex flex-col sm:flex-row items-center gap-2">
            <button
              type="button"
              onClick={handleMeasureFromDevice}
              disabled={isMeasuring}
              className="w-full sm:flex-1 py-2 px-3 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white rounded-[var(--radius)] text-xs font-bold font-mono flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
            >
              {isMeasuring ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin text-white" />
                  <span>DS-36D ile Ölçülüyor...</span>
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4 fill-current text-white" />
                  <span>📷 CHNSpec DS-36D ile Drawdown Oku</span>
                </>
              )}
            </button>

            {/* Simulated options for offline / lab testing */}
            <div className="flex items-center gap-1 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => handleSimulateDrawdown('match')}
                className="px-2 py-1.5 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] border border-[var(--border)] rounded text-[11px] font-mono text-[var(--text-secondary)] cursor-pointer"
                title="Başarılı çekim simülasyonu (ΔE < 0.50)"
              >
                Simüle: Başarılı
              </button>
              <button
                type="button"
                onClick={() => handleSimulateDrawdown('slight_off')}
                className="px-2 py-1.5 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] border border-[var(--border)] rounded text-[11px] font-mono text-[var(--text-secondary)] cursor-pointer"
                title="Hafif sapma simülasyonu (Add-back gerektirir)"
              >
                Simüle: Sapma (Add-back)
              </button>
            </div>
          </div>

          {measuredReflectance && (
            <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded text-xs font-mono text-emerald-400 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                <span>31 Dalga Boyu Spektral Veri Başarıyla Alındı</span>
              </div>
              {measuredHex && (
                <span
                  className="w-4 h-4 rounded-full border border-white/20 shrink-0"
                  style={{ backgroundColor: measuredHex }}
                />
              )}
            </div>
          )}
        </div>

        {/* Step 3: Operator Notes & Verify Action */}
        <div className="space-y-2 pt-2 border-t border-[var(--border)]">
          <input
            type="text"
            placeholder="Operatör Notları (ör: Kuruma süresi: 30dk, 120µm aplikatör)"
            value={operatorNotes}
            onChange={(e) => setOperatorNotes(e.target.value)}
            className="w-full px-3 py-1.5 bg-[var(--surface-0)] border border-[var(--border)] rounded text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand-clay)]"
          />

          <button
            type="button"
            onClick={handleVerify}
            disabled={isSubmitting || !measuredReflectance}
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-[var(--radius)] text-xs font-bold font-mono flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 shadow-md"
          >
            {isSubmitting ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Scale className="h-4 w-4" />
            )}
            <span>Fiziksel Sapmayı Hesapla & Doğrula</span>
          </button>
        </div>

        {/* Verification Result Display */}
        {verificationResult && (
          <div className="pt-3 border-t border-[var(--border)] space-y-3">
            <div
              className={`p-3.5 rounded-[var(--radius)] border flex items-start gap-3 ${
                verificationResult.outcome === 'ACCEPTED'
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                  : verificationResult.outcome === 'ADDBACK_REQUIRED'
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                  : 'bg-rose-500/15 border-rose-500/40 text-rose-300'
              }`}
            >
              <div className="mt-0.5 shrink-0">
                {verificationResult.outcome === 'ACCEPTED' ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                ) : verificationResult.outcome === 'ADDBACK_REQUIRED' ? (
                  <AlertTriangle className="h-5 w-5 text-amber-400" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-rose-400" />
                )}
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 font-mono text-xs font-bold">
                  <span>
                    {verificationResult.outcome === 'ACCEPTED'
                      ? '✓ KABUL EDİLDİ (ACCEPTED)'
                      : verificationResult.outcome === 'ADDBACK_REQUIRED'
                      ? '⚠️ İLAVE PASTA GEREKİYOR (ADDBACK REQUIRED)'
                      : '✗ REDDEDİLDİ (REJECTED)'}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-black/30 text-white font-mono text-[11px]">
                    Ölçülen ΔE00 = {verificationResult.de00.toFixed(2)}
                  </span>
                </div>
                <p className="text-xs opacity-90">{verificationResult.outcomeMessage}</p>
              </div>
            </div>

            {/* Add-back suggestion details if required */}
            {verificationResult.outcome === 'ADDBACK_REQUIRED' &&
              verificationResult.addbackSuggestion &&
              verificationResult.addbackSuggestion.additional_pastes && (
                <div className="p-3 bg-[var(--surface-0)] border border-amber-500/30 rounded-[var(--radius)] space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amber-400 font-mono">
                    <PlusCircle className="h-4 w-4" />
                    <span>Önerilen Tanka İlave Pasta Miktarları:</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="text-[10px] uppercase text-[var(--text-muted)] border-b border-[var(--border)]">
                        <tr>
                          <th className="p-1.5">Renklendirici</th>
                          <th className="p-1.5 text-right">Eklenecek Miktar (g)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {verificationResult.addbackSuggestion.additional_pastes.map(
                          (ap: any, idx: number) => (
                            <tr key={idx}>
                              <td className="p-1.5 font-medium">{ap.name}</td>
                              <td className="p-1.5 text-right font-bold text-amber-400">
                                +{ap.add_g ? ap.add_g.toFixed(2) : ap.amount_g?.toFixed(2)} g
                              </td>
                            </tr>
                          )
                        )}
                      </tbody>
                    </table>
                  </div>
                  {verificationResult.addbackSuggestion.predicted_delta_e00_after !== undefined && (
                    <div className="text-[11px] font-mono text-[var(--text-secondary)] text-right">
                      İlave Sonrası Tahmini ΔE00:{' '}
                      <strong className="text-emerald-400">
                        {verificationResult.addbackSuggestion.predicted_delta_e00_after.toFixed(2)}
                      </strong>
                    </div>
                  )}
                </div>
              )}
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end pt-2 border-t border-[var(--border)]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] border border-[var(--border)] text-[var(--text-secondary)] rounded text-xs font-mono cursor-pointer"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
};
