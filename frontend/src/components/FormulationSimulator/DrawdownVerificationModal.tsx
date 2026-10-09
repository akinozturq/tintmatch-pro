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
  Scale,
  Award,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  Info
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
  const [isSimulation, setIsSimulation] = useState(false);
  const [showSimPanel, setShowSimPanel] = useState(false);
  const [verificationResult, setVerificationResult] = useState<{
    de00_target_vs_measured: number;
    de00_target_vs_predicted: number;
    de00_predicted_vs_measured: number;
    outcome: 'ACCEPTED' | 'ADDBACK_REQUIRED' | 'REJECTED';
    outcomeMessage: string;
    is_golden_batch: boolean;
    is_simulation: boolean;
    model_divergence_warning?: boolean;
    model_divergence_note?: string;
    tolerance_profile?: any;
    addbackSuggestion?: any;
    measuredLab?: { L: number; a: number; b: number };
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Initialize actual dispensed grams whenever modal opens or recipe changes
  React.useEffect(() => {
    if (activeRecipe && isOpen) {
      const initial: Record<string | number, number> = {};
      const isRecipeBatchSizeMatch = activeRecipe.batch_size_g === batchSizeG;
      activeRecipe.matched_pastes.forEach((p) => {
        const grams = (isRecipeBatchSizeMatch && p.amount_g !== undefined)
          ? p.amount_g
          : parseFloat(((p.concentration / 100) * batchSizeG).toFixed(2));
        initial[p.id] = grams;
      });
      setActualDispensed(initial);
      setMeasuredReflectance(null);
      setVerificationResult(null);
      setErrorMsg(null);
      setIsSimulation(false);
      setShowSimPanel(false);
    }
  }, [activeRecipe, isOpen, batchSizeG]);

  if (!isOpen || !activeRecipe) return null;

  // 1-Click measure directly from CHNSpec DS-36D
  const handleMeasureFromDevice = async () => {
    setIsMeasuring(true);
    setIsSimulation(false);
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

  // Mock / Simulation test reading for demonstration / offline trial without connected hardware
  const handleSimulateDrawdown = (scenario: 'match' | 'slight_off' | 'poor') => {
    setIsSimulation(true);
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
          target_reflectance: targetReflectance || undefined,
          tolerance_profile_id: 'industrial',
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
        target_reflectance: targetReflectance || undefined,
        is_simulation: isSimulation,
        tolerance_profile_id: 'industrial',
        operator_notes: operatorNotes,
      });

      setVerificationResult({
        de00_target_vs_measured: result.de00_target_vs_measured,
        de00_target_vs_predicted: result.de00_target_vs_predicted,
        de00_predicted_vs_measured: result.de00_predicted_vs_measured,
        outcome: result.outcome,
        outcomeMessage: result.outcome_message,
        is_golden_batch: result.is_golden_batch,
        is_simulation: result.is_simulation,
        model_divergence_warning: result.model_divergence_warning,
        model_divergence_note: result.model_divergence_note,
        tolerance_profile: result.tolerance_profile,
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
          {(() => {
            const isMatch = activeRecipe.batch_size_g === batchSizeG;
            const totalPasteG = activeRecipe.matched_pastes.reduce((acc, p) => {
              const g = (isMatch && p.amount_g !== undefined)
                ? p.amount_g
                : parseFloat(((p.concentration / 100) * batchSizeG).toFixed(2));
              return acc + g;
            }, 0);
            const scaledBaseG = (isMatch && activeRecipe.base_amount_g !== undefined)
              ? activeRecipe.base_amount_g
              : Math.max(0, parseFloat((batchSizeG - totalPasteG).toFixed(2)));

            return (
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="font-semibold text-[var(--text-secondary)] uppercase">
                  1. Tartılan Fiziksel Miktarlar ({scaleResolutionG} g Hassasiyet)
                </span>
                <span className="text-[11px] text-[var(--text-muted)]">
                  Baz: {scaledBaseG.toFixed(2)} g ({batchSizeG} g Parti)
                </span>
              </div>
            );
          })()}
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
                  const isMatch = activeRecipe.batch_size_g === batchSizeG;
                  const targetGrams = (isMatch && p.amount_g !== undefined)
                    ? p.amount_g
                    : parseFloat(((p.concentration / 100) * batchSizeG).toFixed(2));
                  const formatConc = p.concentration < 0.1 ? p.concentration.toFixed(3) : p.concentration.toFixed(2);
                  return (
                    <tr key={p.id}>
                      <td className="p-2 flex items-center gap-1.5 font-medium">
                        <span
                          className="w-2.5 h-2.5 rounded-full border border-[var(--border-strong)] shrink-0"
                          style={{ backgroundColor: p.color_hex || p.hex }}
                        />
                        <span>{p.name}</span>
                      </td>
                      <td className="p-2 text-center font-mono">%{formatConc}</td>
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

        {/* Step 2: Drawdown Ölçümü (CHNSpec DS-36D & Simülasyon İzolasyonu) */}
        <div className="space-y-2">
          <span className="text-xs font-semibold font-mono text-[var(--text-secondary)] uppercase block">
            2. Fiziksel Numune Spektrumu Ölçümü
          </span>

          <div className="space-y-2">
            {/* Primary Action: Real Spectrophotometer Measurement */}
            <button
              type="button"
              onClick={handleMeasureFromDevice}
              disabled={isMeasuring}
              className="w-full py-2.5 px-4 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white rounded-[var(--radius)] text-xs font-bold font-mono flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 shadow-sm"
            >
              {isMeasuring ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin text-white" />
                  <span>CHNSpec DS-36D ile Ölçülüyor...</span>
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4 fill-current text-white" />
                  <span>📷 CHNSpec DS-36D ile Fiziksel Drawdown Oku</span>
                </>
              )}
            </button>

            {/* Simulation / Demo Section (Strictly segregated from physical Golden Batch) */}
            <div className="border border-[var(--border)] rounded-[var(--radius)] bg-[var(--surface-0)] overflow-hidden">
              <button
                type="button"
                onClick={() => setShowSimPanel(!showSimPanel)}
                className="w-full px-3 py-1.5 flex items-center justify-between text-[11px] font-mono text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-1.5">
                  <FlaskConical className="h-3.5 w-3.5" />
                  <span>Laboratuvar Test / Demo Simülasyon Paneli</span>
                </span>
                <span className="flex items-center gap-1.5 text-[10px]">
                  {isSimulation ? (
                    <span className="text-amber-400 font-semibold">[Simülasyon Modu Aktif]</span>
                  ) : (
                    <span>[Geliştirici Seçenekleri]</span>
                  )}
                  {showSimPanel ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </span>
              </button>

              {showSimPanel && (
                <div className="p-3 border-t border-[var(--border)] bg-[var(--surface-1)] space-y-2">
                  <div className="flex items-start gap-2 text-[11px] text-amber-400 font-mono">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>
                      <strong>Uyarı (P0 Güvenlik):</strong> Simülasyon ölçümleri fiziksel donanım ölçümü yerine geçmez ve <strong>Golden Batch</strong> olarak onaylanamaz.
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleSimulateDrawdown('match')}
                      className="px-2.5 py-1 bg-[var(--surface-0)] hover:bg-[var(--surface-2)] border border-[var(--border)] rounded text-[11px] font-mono text-[var(--text-secondary)] cursor-pointer"
                    >
                      🧪 Simüle Et: Başarılı (ΔE &lt; 0.50)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSimulateDrawdown('slight_off')}
                      className="px-2.5 py-1 bg-[var(--surface-0)] hover:bg-[var(--surface-2)] border border-[var(--border)] rounded text-[11px] font-mono text-[var(--text-secondary)] cursor-pointer"
                    >
                      🧪 Simüle Et: Hafif Sapma (Add-back Gerekir)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSimulateDrawdown('poor')}
                      className="px-2.5 py-1 bg-[var(--surface-0)] hover:bg-[var(--surface-2)] border border-[var(--border)] rounded text-[11px] font-mono text-[var(--text-secondary)] cursor-pointer"
                    >
                      🧪 Simüle Et: Yüksek Sapma (Red)
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {measuredReflectance && (
            <div
              className={`p-2.5 rounded text-xs font-mono flex items-center justify-between border ${
                isSimulation
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                  : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              }`}
            >
              <div className="flex items-center gap-2">
                {isSimulation ? (
                  <>
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                    <span>🧪 Simüle Edilmiş Spektrum Yüklendi (Sanal - Golden Batch Verilemez)</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                    <span>📷 CHNSpec DS-36D: 31 Dalga Boyu Spektrumu Başarıyla Alındı (Gerçek Ölçüm)</span>
                  </>
                )}
              </div>
              {measuredHex && (
                <span
                  className="w-4 h-4 rounded-full border border-white/20 shrink-0"
                  style={{ backgroundColor: measuredHex }}
                  title="Ölçülen Renk Önizleme"
                />
              )}
            </div>
          )}
        </div>

        {/* Step 3: Operator Notes & Verify Action */}
        <div className="space-y-2 pt-2 border-t border-[var(--border)]">
          <input
            type="text"
            placeholder="Operatör Notları (ör: Kuruma süresi: 30dk, 120µm aplikatör, 23°C)"
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
            <span>Fiziksel Kabul & Model Doğrulamasını Hesapla</span>
          </button>
        </div>

        {/* Verification Result Display */}
        {verificationResult && (
          <div className="pt-3 border-t border-[var(--border)] space-y-3">
            {/* Acceptance Outcome Banner */}
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
              <div className="space-y-1 w-full">
                <div className="flex items-center justify-between font-mono text-xs font-bold">
                  <span>
                    {verificationResult.outcome === 'ACCEPTED'
                      ? '✓ ÜRETİM KABUL EDİLDİ (ACCEPTED)'
                      : verificationResult.outcome === 'ADDBACK_REQUIRED'
                      ? '⚠️ İLAVE PASTA DÜZELTMESİ GEREKİYOR (ADDBACK REQUIRED)'
                      : '✗ SPESİFİKASYON DIŞI - REDDEDİLDİ (REJECTED)'}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-black/40 text-white font-mono text-[11px]">
                    Üretim ΔE00 = {verificationResult.de00_target_vs_measured.toFixed(2)}
                  </span>
                </div>
                <p className="text-xs opacity-90">{verificationResult.outcomeMessage}</p>
              </div>
            </div>

            {/* Golden Batch vs Simulation Status Callout */}
            {verificationResult.is_golden_batch ? (
              <div className="p-3 bg-emerald-950/70 border border-emerald-500/60 rounded-[var(--radius)] flex items-center gap-3 text-emerald-200 text-xs font-mono">
                <Award className="h-6 w-6 text-amber-400 shrink-0" />
                <div>
                  <div className="font-bold text-amber-300">⭐ GOLDEN BATCH ONAYLANDI (Üretime Hazır)</div>
                  <div className="text-[11px] text-emerald-300/90">
                    Fiziksel boya filmi gerçek spektrofotometre ile ölçülmüş ve hedef kabul toleransı (ΔE00 ≤{' '}
                    {(verificationResult.tolerance_profile?.target_de00_acceptance ?? 0.50).toFixed(2)}) içinde
                    doğrulanmıştır. Bu parti fabrika referansı olarak mühürlendi.
                  </div>
                </div>
              </div>
            ) : verificationResult.outcome === 'ACCEPTED' && verificationResult.is_simulation ? (
              <div className="p-3 bg-amber-950/60 border border-amber-500/50 rounded-[var(--radius)] flex items-center gap-3 text-amber-200 text-xs font-mono">
                <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0" />
                <div>
                  <div className="font-bold text-amber-300">🧪 SİMÜLASYON TESTİ (Golden Batch Olarak Onaylanmadı)</div>
                  <div className="text-[11px] text-amber-300/90">
                    Ölçüm tolerans içinde olsa da simülasyon spektrumu kullanıldığı için Golden Batch olarak mühürlenmedi.
                    Üretim onayı için spektrofotometre ile gerçek film ölçümü yapınız.
                  </div>
                </div>
              </div>
            ) : null}

            {/* The 3 Industrial Metrics: Target vs Measured, Target vs Predicted, Predicted vs Measured */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs font-mono">
              {/* Metric 1: Üretim Kabulü (Target vs Measured) */}
              <div className="p-2.5 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] space-y-1">
                <div className="text-[10px] uppercase text-[var(--text-muted)] font-semibold flex items-center gap-1">
                  <span>🎯 Üretim Sonucu</span>
                  <span className="text-[9px] px-1 py-0.2 rounded bg-blue-500/20 text-blue-300 font-bold">KABUL</span>
                </div>
                <div className="text-base font-bold text-[var(--text-primary)]">
                  ΔE00 {verificationResult.de00_target_vs_measured.toFixed(2)}
                </div>
                <div className="text-[10px] text-[var(--text-secondary)]">
                  Hedef ↔ Gerçek Drawdown
                  <br />
                  <span className="text-[9px] text-[var(--text-muted)]">
                    Tolerans: ≤ {(verificationResult.tolerance_profile?.target_de00_acceptance ?? 0.50).toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Metric 2: CCM Beklentisi (Target vs Predicted) */}
              <div className="p-2.5 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] space-y-1">
                <div className="text-[10px] uppercase text-[var(--text-muted)] font-semibold flex items-center gap-1">
                  <span>💡 CCM Beklentisi</span>
                  <span className="text-[9px] px-1 py-0.2 rounded bg-neutral-500/20 text-neutral-300">TEORİK</span>
                </div>
                <div className="text-base font-bold text-[var(--text-primary)]">
                  ΔE00 {verificationResult.de00_target_vs_predicted.toFixed(2)}
                </div>
                <div className="text-[10px] text-[var(--text-secondary)]">
                  Hedef ↔ Model Tahmini
                  <br />
                  <span className="text-[9px] text-[var(--text-muted)]">Reçete hesaplama anındaki hata</span>
                </div>
              </div>

              {/* Metric 3: Model Sapması (Predicted vs Measured) */}
              <div className="p-2.5 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] space-y-1">
                <div className="text-[10px] uppercase text-[var(--text-muted)] font-semibold flex items-center gap-1">
                  <span>🔬 Model Tutarlılığı</span>
                  <span
                    className={`text-[9px] px-1 py-0.2 rounded font-bold ${
                      verificationResult.model_divergence_warning
                        ? 'bg-amber-500/20 text-amber-300'
                        : 'bg-emerald-500/20 text-emerald-300'
                    }`}
                  >
                    {verificationResult.model_divergence_warning ? 'SAPMA' : 'TUTARLI'}
                  </span>
                </div>
                <div
                  className={`text-base font-bold ${
                    verificationResult.model_divergence_warning ? 'text-amber-400' : 'text-[var(--text-primary)]'
                  }`}
                >
                  ΔE00 {verificationResult.de00_predicted_vs_measured.toFixed(2)}
                </div>
                <div className="text-[10px] text-[var(--text-secondary)]">
                  Tahmin ↔ Gerçek Drawdown
                  <br />
                  <span className="text-[9px] text-[var(--text-muted)]">
                    Model Sapma Eşiği: {(verificationResult.tolerance_profile?.model_divergence_warning_de00 ?? 0.80).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            {/* Model Divergence Warning Callout */}
            {verificationResult.model_divergence_warning && (
              <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-[var(--radius)] text-xs font-mono text-amber-300 space-y-1">
                <div className="flex items-center gap-1.5 font-bold">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                  <span>Model Sapma Uyarısı (Kubelka-Munk Ayrışması)</span>
                </div>
                <p className="text-[11px] text-amber-200/90">
                  {verificationResult.model_divergence_note ||
                    'Model tahmini ile gerçek drawdown filmi arasında sistematik sapma saptandı.'}
                  {' '}Add-back optimizasyonu model sapmasını tekrarlamamak için formülasyonu modele değil, doğrudan <strong>GERÇEK HEDEFE</strong> doğru düzeltmiştir.
                </p>
              </div>
            )}

            {/* Add-back suggestion details if required */}
            {verificationResult.outcome === 'ADDBACK_REQUIRED' &&
              verificationResult.addbackSuggestion &&
              verificationResult.addbackSuggestion.additional_pastes && (
                <div className="p-3 bg-[var(--surface-0)] border border-amber-500/30 rounded-[var(--radius)] space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-amber-400 font-mono">
                    <div className="flex items-center gap-1.5">
                      <PlusCircle className="h-4 w-4" />
                      <span>Gerçek Hedefe Yönelik İlave Renklendiriciler (Add-Back):</span>
                    </div>
                    <span className="text-[10px] font-normal text-[var(--text-muted)]">
                      Tanktaki Gerçek Tartım Baz Alındı
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="text-[10px] uppercase text-[var(--text-muted)] border-b border-[var(--border)]">
                        <tr>
                          <th className="p-1.5">Renklendirici</th>
                          <th className="p-1.5 text-right">Eklenecek Net Miktar (g)</th>
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
                      İlave Sonrası Hedefe Tahmini ΔE00:{' '}
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
