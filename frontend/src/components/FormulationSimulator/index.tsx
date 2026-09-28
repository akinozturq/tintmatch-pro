import React, { useState, useEffect } from 'react';
import type {
  BasePaint,
  ColorantPaste,
  RecipeSimulation,
  RecipeMatch,
  SensitivityItem,
  CanSize,
  CanScaledRecipe,
} from '../../types';
import { predictRecipe, matchColor, fetchCanSizes, scaleRecipeToCan } from '../../services/api';
import { RecipeCards } from './RecipeCards';
import { RecipeComparisonMatrix } from './RecipeComparisonMatrix';
import { ConcentrationSliders } from './ConcentrationSliders';
import { SpectralPreview } from './SpectralPreview';
import { ColorMetrics } from './ColorMetrics';
import { SolverDiagnosticsView } from './SolverDiagnosticsView';
import { SensitivityMatrixView } from './SensitivityMatrixView';
import { CanSizingView } from './CanSizingView';
import { MAX_TOTAL_COLORANT_LOAD } from '../../constants/limits';
import {
  Wand2,
  Sliders,
  Sparkles,
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [mode, setMode] = useState<'manual' | 'automatch'>('manual');
  const [targetHex, setTargetHex] = useState<string>('#2563eb');
  const [targetReflectance, setTargetReflectance] = useState<number[] | null>(null);

  // 3-Recipe CCM State
  const [allRecipes, setAllRecipes] = useState<{
    recipe_a?: RecipeMatch;
    recipe_b?: RecipeMatch;
    recipe_c?: RecipeMatch;
  } | null>(null);
  const [activeRecipeKey, setActiveRecipeKey] = useState<'recipe_a' | 'recipe_b' | 'recipe_c'>('recipe_a');
  const [sensitivityMatrix, setSensitivityMatrix] = useState<SensitivityItem[]>([]);
  const [diagnostics, setDiagnostics] = useState<any>(null);

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
    if (Object.keys(concentrations).length === 0) return;

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
  }, [selectedBaseId, concentrations, k1, k2, targetReflectance]);

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
    setSensitivityMatrix([]);
    setDiagnostics(null);
  };

  // Innovatint Can Sizing State
  const [canSizes, setCanSizes] = useState<CanSize[]>([]);
  const [selectedCanSizeId, setSelectedCanSizeId] = useState<number | null>(null);
  const [canQuantity, setCanQuantity] = useState<number>(1);
  const [scaledRecipe, setScaledRecipe] = useState<CanScaledRecipe | null>(null);
  const [isScalingLoading, setIsScalingLoading] = useState<boolean>(false);

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

  const runAutoMatchWithReflectance = async (refl: number[], hex?: string) => {
    setIsLoading(true);
    setErrorMessage(null);
    if (hex) setTargetHex(hex);
    setTargetReflectance(refl);

    try {
      const matchRes = await matchColor({
        target_reflectance: refl,
        base_id: selectedBaseId,
        k1,
        k2,
        max_pastes: 4,
        max_total_load: MAX_TOTAL_COLORANT_LOAD,
      });

      if (matchRes.recipes) {
        setAllRecipes(matchRes.recipes);
      }

      const activeKey = (matchRes.primary_recipe_key as 'recipe_a' | 'recipe_b' | 'recipe_c') || 'recipe_a';
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
      setSensitivityMatrix(targetRecipe?.sensitivity_matrix || matchRes.sensitivity_matrix || []);
      setDiagnostics(targetRecipe?.diagnostics || matchRes.diagnostics || null);
    } catch (err: any) {
      setErrorMessage(err.message || 'Eşleştirme başarısız');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (initialTarget && initialTarget.reflectance && initialTarget.reflectance.length === 31) {
      setMode('automatch');
      if (initialTarget.hex) setTargetHex(initialTarget.hex);
      runAutoMatchWithReflectance(initialTarget.reflectance, initialTarget.hex);
    }
  }, [initialTarget]);

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

    await runAutoMatchWithReflectance(synthTargetReflectance, targetHex);
  };

  const handleSelectRecipe = (key: 'recipe_a' | 'recipe_b' | 'recipe_c') => {
    if (!allRecipes || !allRecipes[key]) return;
    setActiveRecipeKey(key);
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
    setSensitivityMatrix(selected.sensitivity_matrix || []);
    setDiagnostics(selected.diagnostics || null);
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-6 w-full space-y-5">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--border)]">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              Canlı CCM Reçete Simülatörü & Otomasyon
            </h2>
            <span className="px-2 py-0.5 rounded-[var(--radius-xs)] text-[10px] font-mono font-semibold bg-[var(--accent-subtle)] border border-[var(--accent-border)] text-[var(--accent-text)]">
              CCM Engine 2.0 (SLSQP)
            </span>
          </div>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            Dinamik pasta kaydırıcıları ile çoklu aydınlatıcı analizi, duyarlılık matrisi ve 3 bağımsız formülasyon profili
          </p>
        </div>

        {/* Mode Switcher */}
        <div className="flex items-center bg-[var(--surface-0)] border border-[var(--border)] p-1 rounded-[var(--radius)] text-xs shadow-inner">
          <button
            onClick={() => setMode('manual')}
            className={`px-3 py-1 rounded-[var(--radius-xs)] font-medium transition-colors flex items-center gap-1.5 ${
              mode === 'manual'
                ? 'bg-[var(--surface-3)] text-[var(--text-primary)] font-semibold shadow-sm border border-[var(--border)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Sliders className="h-3.5 w-3.5" />
            <span>Manuel Sürgüler</span>
          </button>
          <button
            onClick={() => setMode('automatch')}
            className={`px-3 py-1 rounded-[var(--radius-xs)] font-medium transition-colors flex items-center gap-1.5 ${
              mode === 'automatch'
                ? 'bg-[var(--surface-3)] text-[var(--text-primary)] font-semibold shadow-sm border border-[var(--border)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Wand2 className="h-3.5 w-3.5" />
            <span>Auto-Match CCM (3 Reçete)</span>
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="p-3 bg-[var(--danger-subtle)] border border-[var(--danger-border)] rounded-[var(--radius)] text-xs text-[var(--danger-text)] font-mono shadow-sm">
          {errorMessage}
        </div>
      )}

      {/* Grid: Sliders & Auto-Match (Left 5 Cols) + Spectral & Swatch (Right 7 Cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* SOL: Reçete Girişleri (5 Cols) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Base selector */}
          <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-4 space-y-2.5 shadow-[var(--shadow-sm)]">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-secondary)] block">
              Taşıyıcı Baz Boya
            </span>
            <div className="grid grid-cols-2 gap-2">
              {bases.map((b) => (
                <button
                  key={b.id}
                  onClick={() => setSelectedBaseId(b.id)}
                  className={`p-2 rounded-[var(--radius)] border text-left text-xs transition-colors flex items-center gap-2 ${
                    b.id === selectedBaseId
                      ? 'bg-[var(--surface-1)] border-[var(--brand-clay)] text-[var(--text-primary)] font-semibold ring-1 ring-[var(--brand-clay)] shadow-sm'
                      : 'bg-[var(--surface-0)] border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full border border-[var(--border-strong)]"
                    style={{ backgroundColor: b.hex }}
                  />
                  <span className="truncate">{b.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Auto-Match Target Picker */}
          {mode === 'automatch' && (
            <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-4 space-y-3 shadow-[var(--shadow-sm)]">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-secondary)]">
                  Hedef Spektral Eşleme
                </span>
                <span className="text-xs font-mono text-[var(--text-primary)]">{targetHex}</span>
              </div>

              {/* Presets */}
              <div className="grid grid-cols-3 gap-2">
                {presetTargets.map((pt, idx) => (
                  <button
                    key={idx}
                    onClick={() => setTargetHex(pt.hex)}
                    className="p-1.5 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius-xs)] hover:border-[var(--border-strong)] flex items-center gap-1.5 text-left transition-colors"
                  >
                    <span
                      className="w-3 h-3 rounded flex-shrink-0 border border-[var(--border-strong)]"
                      style={{ backgroundColor: pt.hex }}
                    />
                    <span className="text-[10px] text-[var(--text-primary)] font-mono truncate">{pt.name}</span>
                  </button>
                ))}
              </div>

              {/* Custom input */}
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="color"
                  value={targetHex}
                  onChange={(e) => setTargetHex(e.target.value)}
                  className="w-8 h-8 rounded border border-[var(--border-strong)] cursor-pointer bg-transparent"
                />
                <input
                  type="text"
                  value={targetHex}
                  onChange={(e) => setTargetHex(e.target.value)}
                  className="flex-1 px-2.5 py-1 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius-xs)] text-xs font-mono uppercase text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand-clay)]"
                />
                <button
                  onClick={handleRunAutoMatch}
                  disabled={isLoading}
                  className="px-3.5 py-1 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white rounded-[var(--radius-xs)] text-xs font-semibold transition-colors disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>{isLoading ? 'Hesaplanıyor...' : '3 Reçete Türet'}</span>
                </button>
              </div>

              {/* 3 Alternative Recipe Selector Cards */}
              <RecipeCards
                allRecipes={allRecipes}
                activeRecipeKey={activeRecipeKey}
                onSelectRecipe={handleSelectRecipe}
              />
            </div>
          )}

          {/* Sliders */}
          <ConcentrationSliders
            pastes={pastes}
            concentrations={concentrations}
            simulation={simulation}
            onConcChange={handleConcChange}
            onResetSliders={handleResetSliders}
          />
        </div>

        {/* SAĞ: Spektral Eğri & Swatch (7 Cols) */}
        <div className="lg:col-span-7 space-y-4">
          <SpectralPreview
            simulation={simulation}
            targetReflectance={targetReflectance}
            targetHex={targetHex}
          />

          <ColorMetrics simulation={simulation} />

          <RecipeComparisonMatrix
            allRecipes={allRecipes}
            activeRecipeKey={activeRecipeKey}
            onSelectRecipe={handleSelectRecipe}
          />

          <SolverDiagnosticsView diagnostics={diagnostics} />

          <SensitivityMatrixView sensitivityMatrix={sensitivityMatrix} />
        </div>
      </div>

      {/* Innovatint Can Sizing & Scaling Engine */}
      <CanSizingView
        canSizes={canSizes}
        selectedCanSizeId={selectedCanSizeId}
        onSelectCanSizeId={(id) => setSelectedCanSizeId(id)}
        canQuantity={canQuantity}
        onChangeCanQuantity={(qty) => setCanQuantity(qty)}
        scaledRecipe={scaledRecipe}
        isLoading={isScalingLoading}
        activeBase={bases.find((b) => b.id === selectedBaseId)}
      />
    </div>
  );
};
export default FormulationSimulator;
