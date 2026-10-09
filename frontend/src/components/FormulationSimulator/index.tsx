import React, { useState, useEffect } from 'react';
import type {
  BasePaint,
  ColorantPaste,
  RecipeSimulation,
  RecipeMatch,
  CanSize,
  CanScaledRecipe,
} from '../../types';
import {
  predictRecipe,
  matchColor,
  fetchCanSizes,
  scaleRecipeToCan,
  measureChnspec,
  saveRecipe,
} from '../../services/api';
import { ConcentrationSliders } from './ConcentrationSliders';
import { SpectralPreview } from './SpectralPreview';
import { ColorMetrics } from './ColorMetrics';
import { CanSizingView } from './CanSizingView';
import { RecipeConfidenceCard } from './RecipeConfidenceCard';
import { ManufacturableRecipeTable } from './ManufacturableRecipeTable';
import { DrawdownVerificationModal } from './DrawdownVerificationModal';
import { MAX_TOTAL_COLORANT_LOAD } from '../../constants/limits';
import {
  Wand2,
  Sliders,
  Sparkles,
  Zap,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Package,
  Save,
  CheckCircle2,
  SlidersHorizontal,
  FlaskConical,
  Target,
  SunMedium,
  Coins,
  X,
  Scale
} from 'lucide-react';

interface SimulatorProps {
  bases: BasePaint[];
  pastes: ColorantPaste[];
  initialPaste?: ColorantPaste | null;
  initialTarget?: { reflectance: number[]; name: string; hex?: string } | null;
}

export const FormulationSimulator: React.FC<SimulatorProps> = ({
  bases,
  pastes,
  initialPaste,
  initialTarget,
}) => {
  const [selectedBaseId, setSelectedBaseId] = useState<number>(bases[0]?.id || 1);
  const [k1] = useState<number>(0.04);
  const [k2] = useState<number>(0.60);

  const [concentrations, setConcentrations] = useState<Record<number, number>>({});
  const [simulation, setSimulation] = useState<RecipeSimulation | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isMeasuringTarget, setIsMeasuringTarget] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [mode, setMode] = useState<'automatch' | 'manual'>('automatch');
  const [targetHex, setTargetHex] = useState<string>('#2563eb');
  const [targetReflectance, setTargetReflectance] = useState<number[] | null>(null);
  const [targetName, setTargetName] = useState<string>('Hedef Renk');

  // Optimization Presets State (A: Color Match, B: Light Stability, C: Economy)
  const [allRecipes, setAllRecipes] = useState<{
    recipe_a?: RecipeMatch;
    recipe_b?: RecipeMatch;
    recipe_c?: RecipeMatch;
  } | null>(null);
  const [activeRecipeKey, setActiveRecipeKey] = useState<'recipe_a' | 'recipe_b' | 'recipe_c'>('recipe_a');

  // Recipe Save Feedback
  const [isSavingRecipe, setIsSavingRecipe] = useState<boolean>(false);
  const [savedRecipeFeedback, setSavedRecipeFeedback] = useState<{ id: number; message: string } | null>(null);

  // Endüstriyel Can Sizing State (Collapsible)
  const [showCanSizing, setShowCanSizing] = useState<boolean>(false);
  const [canSizes, setCanSizes] = useState<CanSize[]>([]);
  const [selectedCanSizeId, setSelectedCanSizeId] = useState<number | null>(null);
  const [canQuantity, setCanQuantity] = useState<number>(1);
  const [scaledRecipe, setScaledRecipe] = useState<CanScaledRecipe | null>(null);
  const [isScalingLoading, setIsScalingLoading] = useState<boolean>(false);

  // Industrial Batch & Drawdown State
  const [batchSizeG, setBatchSizeG] = useState<number>(1000);
  const [scaleResolutionG] = useState<number>(0.01);
  const [isDrawdownModalOpen, setIsDrawdownModalOpen] = useState<boolean>(false);

  const presetTargets = [
    { name: 'RAL 5012 Işık Mavi', hex: '#2563eb' },
    { name: 'RAL 6005 Yosun Yeşil', hex: '#166534' },
    { name: 'RAL 3001 Sinyal Kırmızı', hex: '#991b1b' },
    { name: 'RAL 1021 Hardal Sarı', hex: '#ca8a04' },
    { name: 'RAL 7016 Antrasit', hex: '#334155' },
    { name: 'Adaçayı Yeşili', hex: '#65a30d' },
  ];

  useEffect(() => {
    const initConcs: Record<number, number> = {};
    pastes.forEach((p, idx) => {
      if (initialPaste && p.id === initialPaste.id) {
        initConcs[p.id] = 2.5;
      } else if (!initialPaste && idx === 0) {
        initConcs[p.id] = 2.0;
      } else {
        initConcs[p.id] = 0.0;
      }
    });
    setConcentrations(initConcs);
  }, [pastes, initialPaste]);

  useEffect(() => {
    fetchCanSizes()
      .then((data) => {
        setCanSizes(data);
        if (data.length > 0) {
          const defaultCan = data.find((c) => c.nominal_volume_l === 15.0) || data[0];
          setSelectedCanSizeId(defaultCan.id);
        }
      })
      .catch((err) => console.error('Can sizes load error:', err));
  }, []);

  // Update simulation when manual concentrations change
  useEffect(() => {
    if (mode !== 'manual' || Object.keys(concentrations).length === 0) return;

    const activePastes = pastes
      .filter((p) => (concentrations[p.id] || 0) > 0)
      .map((p) => ({
        id: p.id,
        name: p.name,
        concentration: concentrations[p.id] || 0,
        unit_k: p.unit_k,
        unit_s: p.unit_s,
      }));

    setIsLoading(true);
    predictRecipe({
      base_id: selectedBaseId,
      pastes: activePastes,
      k1,
      k2,
      target_reflectance: targetReflectance || undefined,
    })
      .then((sim) => setSimulation(sim))
      .catch((err) => setErrorMessage(err.message))
      .finally(() => setIsLoading(false));
  }, [selectedBaseId, concentrations, k1, k2, targetReflectance, mode]);

  // Update can-scaled recipe whenever concentrations or can size change
  useEffect(() => {
    if (!selectedCanSizeId) return;
    const activePastes = Object.entries(concentrations)
      .filter(([_, conc]) => (conc as number) > 0)
      .map(([id, conc]) => ({
        paste_id: Number(id),
        concentration: conc as number,
      }));

    if (activePastes.length === 0) {
      setScaledRecipe(null);
      return;
    }

    setIsScalingLoading(true);
    scaleRecipeToCan({
      can_size_id: selectedCanSizeId,
      base_id: selectedBaseId,
      pastes: activePastes,
      number_of_cans: canQuantity,
    })
      .then((data) => setScaledRecipe(data))
      .catch((err) => console.warn('Scale recipe error:', err))
      .finally(() => setIsScalingLoading(false));
  }, [selectedCanSizeId, selectedBaseId, concentrations, canQuantity]);

  const handleConcChange = (pasteId: number, value: number) => {
    setConcentrations((prev) => ({
      ...prev,
      [pasteId]: Math.max(0, Math.min(MAX_TOTAL_COLORANT_LOAD, parseFloat(value.toFixed(2)))),
    }));
  };

  const handleResetSliders = () => {
    const resetConcs: Record<number, number> = {};
    pastes.forEach((p) => {
      resetConcs[p.id] = 0.0;
    });
    setConcentrations(resetConcs);
    setAllRecipes(null);
  };

  const handleSelectRecipe = (key: 'recipe_a' | 'recipe_b' | 'recipe_c') => {
    setActiveRecipeKey(key);
    if (!allRecipes || !allRecipes[key]) return;
    const selected = allRecipes[key]!;

    const newConcs: Record<number, number> = {};
    pastes.forEach((p) => {
      newConcs[p.id] = 0.0;
    });
    selected.matched_pastes.forEach((mp) => {
      newConcs[Number(mp.id)] = mp.concentration;
    });

    setConcentrations(newConcs);
    setSimulation(selected.prediction);
  };

  const runAutoMatchWithReflectance = async (
    refl: number[],
    hex?: string,
    name?: string,
    customBatchSize?: number
  ) => {
    setIsLoading(true);
    setErrorMessage(null);
    if (hex) setTargetHex(hex);
    if (name) setTargetName(name);
    setTargetReflectance(refl);

    const activeBatchSize = customBatchSize !== undefined ? customBatchSize : batchSizeG;

    try {
      const currentBase = bases.find((b) => b.id === selectedBaseId);
      const matchRes = await matchColor({
        target_reflectance: refl,
        base_id: selectedBaseId,
        geometry: currentBase?.geometry || '45°/0°',
        measurement_mode: currentBase?.measurement_mode || 'SCI',
        k1,
        k2,
        max_pastes: 4,
        max_total_load: MAX_TOTAL_COLORANT_LOAD,
        batch_size_g: activeBatchSize,
        scale_resolution_g: scaleResolutionG,
      });

      if (matchRes.recipes) {
        setAllRecipes(matchRes.recipes);
      }

      const activeKey = (matchRes.primary_recipe_key as 'recipe_a' | 'recipe_b' | 'recipe_c') || activeRecipeKey || 'recipe_a';
      setActiveRecipeKey(activeKey);

      const targetRecipe = matchRes.recipes ? matchRes.recipes[activeKey] : null;

      const newConcs: Record<number, number> = {};
      pastes.forEach((p) => {
        newConcs[p.id] = 0.0;
      });

      const pastesToApply = targetRecipe ? targetRecipe.matched_pastes : matchRes.matched_pastes;
      pastesToApply.forEach((mp) => {
        newConcs[Number(mp.id)] = mp.concentration;
      });

      setConcentrations(newConcs);
      setSimulation(targetRecipe ? targetRecipe.prediction : matchRes.prediction);
    } catch (err: any) {
      setErrorMessage(err.message || 'Eşleştirme başarısız');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBatchSizeChange = (newSize: number) => {
    setBatchSizeG(newSize);
    if (mode === 'automatch' && targetReflectance) {
      runAutoMatchWithReflectance(targetReflectance, targetHex, targetName, newSize);
    }
  };

  // Direct 1-Click Measure from CHNSpec DS-36D
  const handleMeasureTargetFromDevice = async () => {
    setIsMeasuringTarget(true);
    setErrorMessage(null);
    try {
      const res = await measureChnspec('SCI', 'Hedef Numune');
      if (!res || !res.reflectance || res.reflectance.length !== 31) {
        throw new Error('CHNSpec DS-36D cihazından geçerli 31-dalga boyu okuma alınamadı.');
      }

      // Auto-suggest optimal base based on lightness L*
      if (res.lab) {
        const L = Array.isArray(res.lab) ? res.lab[0] : res.lab.L;
        let suggestedBase = bases[0];
        if (L >= 70) {
          suggestedBase = bases.find((b) => b.base_type === 'white_a') || bases[0];
        } else if (L >= 45) {
          suggestedBase = bases.find((b) => b.base_type === 'medium_b') || bases[0];
        } else {
          suggestedBase = bases.find((b) => b.base_type === 'deep_c' || b.base_type === 'transparent_d') || bases[0];
        }
        if (suggestedBase) {
          setSelectedBaseId(suggestedBase.id);
        }
      }

      await runAutoMatchWithReflectance(res.reflectance, res.hex, 'Cihazdan Okunan Hedef');
    } catch (err: any) {
      setErrorMessage(err.message || 'Hedef ölçümü alınamadı. Spektrofotometreyi kontrol edin.');
    } finally {
      setIsMeasuringTarget(false);
    }
  };

  useEffect(() => {
    if (initialTarget && initialTarget.reflectance && initialTarget.reflectance.length === 31) {
      setMode('automatch');
      if (initialTarget.hex) setTargetHex(initialTarget.hex);
      runAutoMatchWithReflectance(initialTarget.reflectance, initialTarget.hex, initialTarget.name);
    }
  }, [initialTarget]);

  const handleRunAutoMatch = async () => {
    const r_num = parseInt(targetHex.slice(1, 3), 16) / 255.0;
    const g_num = parseInt(targetHex.slice(3, 5), 16) / 255.0;
    const b_num = parseInt(targetHex.slice(5, 7), 16) / 255.0;

    const synthTargetReflectance = Array.from({ length: 31 }, (_, i) => {
      const wl = 400 + i * 10;
      let val = 0.05;
      if (wl < 490) val += b_num * 0.7;
      if (wl >= 490 && wl < 580) val += g_num * 0.7;
      if (wl >= 580) val += r_num * 0.7;
      return Math.max(0.02, Math.min(0.95, val));
    });

    await runAutoMatchWithReflectance(synthTargetReflectance, targetHex, 'Örnek Renk');
  };

  const handleTransferToManual = () => {
    setMode('manual');
  };

  const handleSaveCurrentRecipe = async () => {
    if (!currentActiveRecipe || !simulation) return;
    setIsSavingRecipe(true);
    setErrorMessage(null);
    try {
      const res = await saveRecipe({
        name: `${targetName} - ${
          mode === 'manual'
            ? 'Manuel Reçete'
            : activeRecipeKey === 'recipe_b'
            ? 'Düşük Metamerizm'
            : activeRecipeKey === 'recipe_c'
            ? 'En Uygun Fiyat'
            : 'En İyi Renk'
        }`,
        base_id: selectedBaseId,
        pastes: currentActiveRecipe.matched_pastes.map((p) => {
          const isMatch = currentActiveRecipe.batch_size_g === batchSizeG;
          return {
            paste_id: Number(p.id),
            id: Number(p.id),
            concentration: p.concentration,
            amount_g: (isMatch && p.amount_g !== undefined)
              ? p.amount_g
              : parseFloat(((p.concentration / 100) * batchSizeG).toFixed(2)),
          };
        }),
        predicted_reflectance: simulation.reflectance,
        lab: simulation.lab,
        hex_color: simulation.hex,
        delta_e00: currentActiveRecipe.delta_e00,
        contrast_ratio: activeBase.contrast_ratio,
        profile_id: mode === 'manual' ? 'manual' : activeRecipeKey,
        batch_size_g: batchSizeG,
        scale_resolution_g: scaleResolutionG,
        recipe_confidence: currentActiveRecipe.recipe_confidence,
        operator_notes: `Laboratuvar reçetesi kaydedildi (${mode === 'manual' ? 'Manuel Ayar' : activeRecipeKey}).`,
      });

      setSavedRecipeFeedback({
        id: res.id,
        message: `Reçete #${res.id} başarıyla arşive kaydedildi. (Kütüphane > Üretim Arşivi sekmesinden inceleyebilirsiniz)`,
      });

      // Auto dismiss feedback after 8 seconds
      setTimeout(() => {
        setSavedRecipeFeedback(null);
      }, 8000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Reçete kaydedilemedi');
    } finally {
      setIsSavingRecipe(false);
    }
  };

  const activeBase = bases.find((b) => b.id === selectedBaseId) || bases[0];

  const currentActiveRecipe: RecipeMatch | null =
    (allRecipes && allRecipes[activeRecipeKey]) ||
    (simulation
      ? {
          profile_id: 'manual',
          profile_name: 'Manuel Sürgüler',
          description: 'Manuel ayarlanmış formülasyon',
          matched_pastes: pastes
            .filter((p) => (concentrations[p.id] || 0) > 0)
            .map((p) => ({
              id: p.id,
              name: p.name,
              code: p.code,
              hex: p.color_hex,
              color_hex: p.color_hex,
              concentration: concentrations[p.id] || 0,
              amount_g: parseFloat((((concentrations[p.id] || 0) / 100) * batchSizeG).toFixed(2)),
            })),
          delta_e00: simulation.comparison?.delta_e00 ?? 0,
          composite_mi: simulation.comparison?.metamerism?.MI_A ?? 0,
          total_load: Object.values(concentrations).reduce((a, b) => a + b, 0),
          prediction: simulation,
          batch_size_g: batchSizeG,
          scale_resolution_g: scaleResolutionG,
          base_amount_g: Math.max(
            0,
            parseFloat(
              (
                batchSizeG -
                (Object.values(concentrations).reduce((a, b) => a + b, 0) / 100) * batchSizeG
              ).toFixed(2)
            )
          ),
          passed_target_threshold: true,
          status: 'MANUAL',
        }
      : null);

  return (
    <div className="max-w-7xl mx-auto px-6 py-6 w-full space-y-5">
      {/* Top Header & Mode Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-[var(--border)]">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-lg font-bold text-[var(--text-primary)] tracking-tight">
              CCM Reçete & Eşleme Masası
            </h1>
            <span className="px-2 py-0.5 rounded-[var(--radius-xs)] text-[10px] font-mono font-semibold bg-[var(--accent-subtle)] border border-[var(--accent-border)] text-[var(--accent-text)]">
              SLSQP CCM v2.0
            </span>
          </div>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            CHNSpec DS-36D ile hedef renk ölçümü, önayarlı optimizasyon ve 0.01g terazi tartım reçetesi
          </p>
        </div>

        {/* Clean Mode Switcher */}
        <div className="flex items-center bg-[var(--surface-0)] border border-[var(--border)] p-1 rounded-[var(--radius-lg)] text-xs">
          <button
            type="button"
            onClick={() => setMode('automatch')}
            className={`px-3.5 py-1.5 rounded-[var(--radius)] font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
              mode === 'automatch'
                ? 'bg-[var(--surface-3)] text-[var(--text-primary)] font-semibold shadow-sm border border-[var(--border)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Wand2 className="h-3.5 w-3.5 text-[var(--brand-clay)]" />
            <span>Otomatik Eşleme</span>
          </button>
          <button
            type="button"
            onClick={() => setMode('manual')}
            className={`px-3.5 py-1.5 rounded-[var(--radius)] font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
              mode === 'manual'
                ? 'bg-[var(--surface-3)] text-[var(--text-primary)] font-semibold shadow-sm border border-[var(--border)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Sliders className="h-3.5 w-3.5 text-[var(--brand-clay)]" />
            <span>Manuel Sürgüler</span>
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="p-3 bg-[var(--danger-subtle)] border border-[var(--danger-border)] rounded-[var(--radius)] text-xs text-[var(--danger-text)] font-mono shadow-sm flex items-center justify-between">
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-[var(--danger-text)] hover:opacity-80 p-1 cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Main Grid: Inputs (Left 5 Cols) + Recipe Workstation (Right 7 Cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* SOL KOLON: Girdiler & Kontroller (5 Cols) */}
        <div className="lg:col-span-5 space-y-4">
          {/* HEDEF RENK & TEK TIKLA DS-36D ÖLÇÜMÜ */}
          <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-4 space-y-3.5 shadow-[var(--shadow-sm)]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)] font-mono flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-[var(--brand-clay)]" />
                Hedef Renk Belirleme
              </span>
              <span className="text-xs font-mono font-bold text-[var(--text-primary)]">
                {targetHex.toUpperCase()}
              </span>
            </div>

            {/* Direct CHNSpec DS-36D Hardware Measure Button */}
            <button
              type="button"
              onClick={handleMeasureTargetFromDevice}
              disabled={isMeasuringTarget || isLoading}
              className="w-full py-2.5 px-4 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white rounded-[var(--radius)] text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer disabled:opacity-50"
            >
              {isMeasuringTarget ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin text-white" />
                  <span>DS-36D ile Hedef Okunuyor...</span>
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4 fill-current text-white" />
                  <span>📷 CHNSpec DS-36D ile Hedefi Oku ve Eşle</span>
                </>
              )}
            </button>

            {/* Renk Seçici & Eşle Butonu */}
            <div className="flex items-center gap-2 pt-1 border-t border-[var(--border)]/60">
              <input
                type="color"
                value={targetHex}
                onChange={(e) => setTargetHex(e.target.value)}
                className="w-8 h-8 rounded border border-[var(--border)] cursor-pointer bg-transparent"
                title="Renk Paletinden Seç"
              />
              <input
                type="text"
                value={targetHex}
                onChange={(e) => setTargetHex(e.target.value)}
                placeholder="#2563EB"
                className="flex-1 px-2.5 py-1.5 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius-xs)] text-xs font-mono uppercase text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand-clay)]"
              />
              <button
                type="button"
                onClick={handleRunAutoMatch}
                disabled={isLoading}
                className="px-3.5 py-1.5 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] border border-[var(--border)] text-[var(--text-primary)] rounded-[var(--radius-xs)] text-xs font-semibold transition-colors disabled:opacity-50 flex items-center gap-1.5 shadow-xs cursor-pointer"
              >
                <Wand2 className="h-3.5 w-3.5 text-[var(--brand-clay)]" />
                <span>{isLoading ? 'Hesaplanıyor...' : 'Eşle'}</span>
              </button>
            </div>

            {/* Hızlı Renk Kartelası */}
            <div className="space-y-1.5 pt-1">
              <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase block">
                Hazır Renk Kartelası:
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {presetTargets.map((pt, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setTargetHex(pt.hex);
                      setTargetName(pt.name);
                    }}
                    className={`p-1.5 bg-[var(--surface-0)] border rounded-[var(--radius-xs)] flex items-center gap-2 text-left transition-colors cursor-pointer ${
                      targetHex.toLowerCase() === pt.hex.toLowerCase()
                        ? 'border-[var(--brand-clay)] ring-1 ring-[var(--brand-clay)]'
                        : 'border-[var(--border)] hover:border-[var(--border-strong)]'
                    }`}
                  >
                    <span
                      className="w-3.5 h-3.5 rounded-full shrink-0 border border-[var(--border)] shadow-xs"
                      style={{ backgroundColor: pt.hex }}
                    />
                    <span className="text-[11px] text-[var(--text-primary)] font-mono truncate">{pt.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* TAŞIYICI BAZ BOYA SEÇİMİ */}
          <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-4 space-y-2.5 shadow-[var(--shadow-sm)]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--text-primary)] font-mono uppercase tracking-wider">
                Taşıyıcı Baz Boya
              </span>
              <span className="text-[10px] font-mono text-[var(--text-muted)]">
                Örtücülük: %{activeBase.contrast_ratio}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {bases.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setSelectedBaseId(b.id)}
                  className={`p-2.5 rounded-[var(--radius)] border text-left text-xs transition-colors flex items-center gap-2 cursor-pointer ${
                    b.id === selectedBaseId
                      ? 'bg-[var(--surface-1)] border-[var(--brand-clay)] text-[var(--text-primary)] font-bold ring-1 ring-[var(--brand-clay)] shadow-xs'
                      : 'bg-[var(--surface-0)] border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
                  }`}
                >
                  <span
                    className="w-3 h-3 rounded-full border border-[var(--border)] shrink-0 shadow-xs"
                    style={{ backgroundColor: b.hex }}
                  />
                  <div className="truncate">
                    <span className="block truncate">{b.name}</span>
                    <span className="text-[10px] text-[var(--text-muted)] font-mono block">
                      {b.code} ({b.base_type})
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* 3 PRESET SEÇİCİ (EN İYİ RENK / DÜŞÜK METAMERİZM / EN UYGUN FİYAT) */}
          {mode === 'automatch' && (
            <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-4 space-y-2.5 shadow-[var(--shadow-sm)]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--text-primary)] font-mono uppercase tracking-wider">
                  Reçete Optimizasyon Önayarı
                </span>
                {allRecipes && (
                  <span className="text-[10px] font-mono text-[var(--brand-clay)] font-bold">
                    Aktif: {activeRecipeKey === 'recipe_a' ? '🎯 En İyi Renk' : activeRecipeKey === 'recipe_b' ? '💡 Düşük Metamerizm' : '💰 En Uygun Fiyat'}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2">
                {/* Preset 1: En İyi Renk */}
                <button
                  type="button"
                  onClick={() => handleSelectRecipe('recipe_a')}
                  className={`p-2.5 rounded-[var(--radius)] border text-left transition-all cursor-pointer ${
                    activeRecipeKey === 'recipe_a'
                      ? 'bg-[var(--surface-1)] border-[var(--brand-clay)] ring-1 ring-[var(--brand-clay)] shadow-xs text-[var(--text-primary)]'
                      : 'bg-[var(--surface-0)] border border-[var(--border)] hover:border-[var(--border-strong)] text-[var(--text-secondary)]'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Target className="h-3.5 w-3.5 text-[var(--brand-clay)] shrink-0" />
                    <span className="text-xs font-bold truncate">En İyi Renk</span>
                  </div>
                  <p className="text-[10px] text-[var(--text-muted)] line-clamp-1">Min ΔE00</p>
                  {allRecipes?.recipe_a && (
                    <div className="mt-1.5 pt-1 border-t border-[var(--border)]/60 flex items-center justify-between font-mono text-[10px]">
                      <span className="font-bold text-[var(--brand-clay)]">ΔE {allRecipes.recipe_a.delta_e00.toFixed(2)}</span>
                      <span className="text-[var(--text-muted)]">{allRecipes.recipe_a.matched_pastes.length} pst</span>
                    </div>
                  )}
                </button>

                {/* Preset 2: Düşük Metamerizm */}
                <button
                  type="button"
                  onClick={() => handleSelectRecipe('recipe_b')}
                  className={`p-2.5 rounded-[var(--radius)] border text-left transition-all cursor-pointer ${
                    activeRecipeKey === 'recipe_b'
                      ? 'bg-[var(--surface-1)] border-[var(--brand-clay)] ring-1 ring-[var(--brand-clay)] shadow-xs text-[var(--text-primary)]'
                      : 'bg-[var(--surface-0)] border border-[var(--border)] hover:border-[var(--border-strong)] text-[var(--text-secondary)]'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <SunMedium className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    <span className="text-xs font-bold truncate">Düşük Metam.</span>
                  </div>
                  <p className="text-[10px] text-[var(--text-muted)] line-clamp-1">Işıkta Kararlı</p>
                  {allRecipes?.recipe_b && (
                    <div className="mt-1.5 pt-1 border-t border-[var(--border)]/60 flex items-center justify-between font-mono text-[10px]">
                      <span className="font-bold text-amber-500">MI {allRecipes.recipe_b.composite_mi?.toFixed(2) || '0.00'}</span>
                      <span className="text-[var(--text-muted)]">{allRecipes.recipe_b.matched_pastes.length} pst</span>
                    </div>
                  )}
                </button>

                {/* Preset 3: En Uygun Fiyat */}
                <button
                  type="button"
                  onClick={() => handleSelectRecipe('recipe_c')}
                  className={`p-2.5 rounded-[var(--radius)] border text-left transition-all cursor-pointer ${
                    activeRecipeKey === 'recipe_c'
                      ? 'bg-[var(--surface-1)] border-[var(--brand-clay)] ring-1 ring-[var(--brand-clay)] shadow-xs text-[var(--text-primary)]'
                      : 'bg-[var(--surface-0)] border border-[var(--border)] hover:border-[var(--border-strong)] text-[var(--text-secondary)]'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Coins className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    <span className="text-xs font-bold truncate">En Uygun</span>
                  </div>
                  <p className="text-[10px] text-[var(--text-muted)] line-clamp-1">Ekonomik Maliyet</p>
                  {allRecipes?.recipe_c && (
                    <div className="mt-1.5 pt-1 border-t border-[var(--border)]/60 flex items-center justify-between font-mono text-[10px]">
                      <span className="font-bold text-emerald-500">ΔE {allRecipes.recipe_c.delta_e00.toFixed(2)}</span>
                      <span className="text-[var(--text-muted)]">Tasarruf</span>
                    </div>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* MANUEL SÜRGÜLER MODU */}
          {mode === 'manual' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between p-2.5 bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius)] text-xs">
                <span className="font-mono text-[var(--text-secondary)]">Manuel Hassas Ayar Aktif</span>
                <button
                  type="button"
                  onClick={() => setMode('automatch')}
                  className="px-2.5 py-1 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] border border-[var(--border)] rounded text-[11px] font-mono text-[var(--brand-clay)] font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Wand2 className="h-3 w-3" />
                  <span>Otomatik Eşlemeye Dön</span>
                </button>
              </div>
              <ConcentrationSliders
                pastes={pastes}
                concentrations={concentrations}
                simulation={simulation}
                onConcChange={handleConcChange}
                onResetSliders={handleResetSliders}
              />
            </div>
          )}
        </div>

        {/* SAĞ KOLON: Reçete Sonuç Masası & Eylemler (7 Cols) */}
        <div className="lg:col-span-7 space-y-4">
          {/* Reçete Kayıt Başarı Bildirimi */}
          {savedRecipeFeedback && (
            <div className="p-3.5 bg-emerald-500/15 border border-emerald-500/30 rounded-[var(--radius)] text-xs text-emerald-700 dark:text-emerald-300 font-mono shadow-sm flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                <span>{savedRecipeFeedback.message}</span>
              </div>
              <button
                type="button"
                onClick={() => setSavedRecipeFeedback(null)}
                className="text-emerald-500 hover:text-emerald-700 p-1 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* REÇETE GÜVEN SKORU KARTI */}
          {currentActiveRecipe && currentActiveRecipe.recipe_confidence && (() => {
            const isMatch = currentActiveRecipe.batch_size_g === batchSizeG;
            const curPastes = currentActiveRecipe.matched_pastes || [];
            const totalColG = curPastes.reduce(
              (acc, p) => acc + (
                (isMatch && p.amount_g !== undefined)
                  ? p.amount_g
                  : parseFloat(((p.concentration / 100) * batchSizeG).toFixed(2))
              ),
              0
            );
            const curBaseG = (isMatch && currentActiveRecipe.base_amount_g !== undefined)
              ? currentActiveRecipe.base_amount_g
              : Math.max(0, parseFloat((batchSizeG - totalColG).toFixed(2)));

            return (
              <RecipeConfidenceCard
                confidence={currentActiveRecipe.recipe_confidence}
                batchSizeG={batchSizeG}
                scaleResolutionG={scaleResolutionG}
                baseAmountG={curBaseG}
                totalColorantG={parseFloat(totalColG.toFixed(2))}
                extrapolationWarning={currentActiveRecipe.extrapolation_warning}
                extrapolationNotes={currentActiveRecipe.extrapolation_notes}
              />
            );
          })()}

          {/* ÜRETİLEBİLİR FİZİKSEL TARTIM TABLOSU (0.01g HASSASİYET) */}
          {currentActiveRecipe && (
            <ManufacturableRecipeTable
              activeRecipe={currentActiveRecipe}
              activeBase={activeBase}
              batchSizeG={batchSizeG}
              scaleResolutionG={scaleResolutionG}
              onChangeBatchSize={handleBatchSizeChange}
              onOpenDrawdownModal={() => setIsDrawdownModalOpen(true)}
            />
          )}

          {/* ANA EYLEMLER ÇUBUĞU: Reçeteyi Kaydet & Manuel Sürgülere Aktar & Drawdown */}
          {currentActiveRecipe && (
            <div className="p-3 bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] flex flex-wrap items-center justify-between gap-2.5 shadow-xs">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSaveCurrentRecipe}
                  disabled={isSavingRecipe}
                  className="px-3.5 py-2 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white rounded-[var(--radius)] text-xs font-bold font-mono flex items-center gap-1.5 shadow-sm transition-all cursor-pointer disabled:opacity-50"
                  title="Reçeteyi Arşive Kaydet"
                >
                  {isSavingRecipe ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  <span>{isSavingRecipe ? 'Kaydediliyor...' : '💾 Reçeteyi Arşive Kaydet'}</span>
                </button>

                {mode === 'automatch' && (
                  <button
                    type="button"
                    onClick={handleTransferToManual}
                    className="px-3 py-2 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] border border-[var(--border)] text-[var(--text-primary)] rounded-[var(--radius)] text-xs font-medium font-mono flex items-center gap-1.5 cursor-pointer shadow-2xs transition-colors"
                    title="Bu reçeteyi manuel sürgülere aktararak ±0.1g ince ayar yap"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5 text-[var(--brand-clay)]" />
                    <span>🎚️ Manuel Sürgülere Aktar</span>
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => setIsDrawdownModalOpen(true)}
                className="px-3 py-2 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] border border-[var(--border)] text-[var(--text-primary)] rounded-[var(--radius)] text-xs font-semibold font-mono flex items-center gap-1.5 cursor-pointer shadow-2xs transition-colors"
              >
                <FlaskConical className="h-3.5 w-3.5 text-[var(--brand-clay)]" />
                <span>🧪 Drawdown & Add-Back</span>
              </button>
            </div>
          )}

          {/* KUTU & AMBALAJ DOZAJLAMA (KATLANABİLİR ENDÜSTRİYEL PANEL) */}
          <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] overflow-hidden shadow-xs">
            <button
              type="button"
              onClick={() => setShowCanSizing(!showCanSizing)}
              className="w-full p-3.5 flex items-center justify-between text-xs font-mono text-[var(--text-primary)] hover:bg-[var(--surface-1)] transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-[var(--brand-clay)]" />
                <span className="font-bold">Kutu & Ambalaj Dozajlama (1L, 2.5L, 15L Boyutları)</span>
                {selectedCanSizeId && (
                  <span className="text-[11px] text-[var(--text-muted)] font-normal hidden sm:inline">
                    — {canSizes.find((c) => c.id === selectedCanSizeId)?.name || '15 L Kova'}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                <span>{showCanSizing ? 'Daralt' : 'Genişlet & İncele'}</span>
                {showCanSizing ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </button>

            {showCanSizing && (
              <div className="p-4 border-t border-[var(--border)] bg-[var(--surface-0)]">
                <CanSizingView
                  canSizes={canSizes}
                  selectedCanSizeId={selectedCanSizeId}
                  onSelectCanSizeId={(id) => setSelectedCanSizeId(id)}
                  canQuantity={canQuantity}
                  onChangeCanQuantity={(qty) => setCanQuantity(qty)}
                  scaledRecipe={scaledRecipe}
                  isLoading={isScalingLoading}
                  activeBase={activeBase}
                />
              </div>
            )}
          </div>

          {/* RENK METRİKLERİ & DELTA E */}
          <ColorMetrics simulation={simulation} />

          {/* SPEKTRAL EĞRİ KARŞILAŞTIRMA */}
          <SpectralPreview
            simulation={simulation}
            targetReflectance={targetReflectance}
            targetHex={targetHex}
          />
        </div>
      </div>

      {/* DRAWDOWN DOĞRULAMA MODALI (GOLDEN BATCH & ADDBACK) */}
      <DrawdownVerificationModal
        isOpen={isDrawdownModalOpen}
        onClose={() => setIsDrawdownModalOpen(false)}
        activeRecipe={currentActiveRecipe}
        activeRecipeKey={activeRecipeKey}
        activeBase={activeBase}
        targetReflectance={targetReflectance}
        targetHex={targetHex}
        targetName={targetName}
        batchSizeG={batchSizeG}
        scaleResolutionG={scaleResolutionG}
      />
    </div>
  );
};

export default FormulationSimulator;
