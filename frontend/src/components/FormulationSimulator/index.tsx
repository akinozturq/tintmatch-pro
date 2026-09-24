import React, { useState, useEffect } from 'react';
import type {
  BasePaint,
  ColorantPaste,
  RecipeSimulation,
  RecipeMatch,
  SensitivityItem,
} from '../../types';
import { predictRecipe, matchColor } from '../../services/api';
import { RecipeCards } from './RecipeCards';
import { ConcentrationSliders } from './ConcentrationSliders';
import { SpectralPreview } from './SpectralPreview';
import { ColorMetrics } from './ColorMetrics';
import { SolverDiagnosticsView } from './SolverDiagnosticsView';
import { SensitivityMatrixView } from './SensitivityMatrixView';
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
}

export const FormulationSimulator: React.FC<SimulatorProps> = ({
  bases,
  pastes,
  initialPaste,
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

  const handleRunAutoMatch = async () => {
    setIsLoading(true);
    setErrorMessage(null);

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

    setTargetReflectance(synthTargetReflectance);

    try {
      const matchRes = await matchColor({
        target_reflectance: synthTargetReflectance,
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-zinc-100">
              Canlı CCM Reçete Simülatörü & Otomasyon
            </h2>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-sky-950/70 border border-sky-800/80 text-sky-300">
              CCM Engine 2.0 (SLSQP)
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            Dinamik pasta kaydırıcıları ile çoklu aydınlatıcı analizi, duyarlılık matrisi ve 3 bağımsız formülasyon profili
          </p>
        </div>

        {/* Mode Switcher */}
        <div className="flex items-center bg-zinc-900 border border-zinc-800 p-1 rounded-lg text-xs">
          <button
            onClick={() => setMode('manual')}
            className={`px-3 py-1 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
              mode === 'manual'
                ? 'bg-zinc-800 text-zinc-100'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Sliders className="h-3.5 w-3.5" />
            <span>Manuel Sürgüler</span>
          </button>
          <button
            onClick={() => setMode('automatch')}
            className={`px-3 py-1 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
              mode === 'automatch'
                ? 'bg-zinc-800 text-zinc-100'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Wand2 className="h-3.5 w-3.5" />
            <span>Auto-Match CCM (3 Reçete)</span>
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="p-3 bg-red-950/40 border border-red-900/60 rounded-lg text-xs text-red-300 font-mono">
          {errorMessage}
        </div>
      )}

      {/* Grid: Sliders & Auto-Match (Left 5 Cols) + Spectral & Swatch (Right 7 Cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* SOL: Reçete Girişleri (5 Cols) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Base selector */}
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4 space-y-2.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 block">
              Taşıyıcı Baz Boya
            </span>
            <div className="grid grid-cols-2 gap-2">
              {bases.map((b) => (
                <button
                  key={b.id}
                  onClick={() => setSelectedBaseId(b.id)}
                  className={`p-2 rounded-lg border text-left text-xs transition-colors flex items-center gap-2 ${
                    b.id === selectedBaseId
                      ? 'bg-zinc-800 border-zinc-600 text-zinc-100 font-medium'
                      : 'bg-zinc-950/60 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full border border-zinc-700"
                    style={{ backgroundColor: b.hex }}
                  />
                  <span className="truncate">{b.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Auto-Match Target Picker */}
          {mode === 'automatch' && (
            <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                  Hedef Spektral Eşleme
                </span>
                <span className="text-xs font-mono text-zinc-300">{targetHex}</span>
              </div>

              {/* Presets */}
              <div className="grid grid-cols-3 gap-2">
                {presetTargets.map((pt, idx) => (
                  <button
                    key={idx}
                    onClick={() => setTargetHex(pt.hex)}
                    className="p-1.5 bg-zinc-950 border border-zinc-800 rounded-md hover:border-zinc-700 flex items-center gap-1.5 text-left transition-colors"
                  >
                    <span
                      className="w-3 h-3 rounded flex-shrink-0 border border-zinc-700"
                      style={{ backgroundColor: pt.hex }}
                    />
                    <span className="text-[10px] text-zinc-300 font-mono truncate">{pt.name}</span>
                  </button>
                ))}
              </div>

              {/* Custom input */}
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="color"
                  value={targetHex}
                  onChange={(e) => setTargetHex(e.target.value)}
                  className="w-8 h-8 rounded border border-zinc-700 cursor-pointer bg-transparent"
                />
                <input
                  type="text"
                  value={targetHex}
                  onChange={(e) => setTargetHex(e.target.value)}
                  className="flex-1 px-2.5 py-1 bg-zinc-950 border border-zinc-800 rounded text-xs font-mono uppercase text-zinc-200 focus:outline-none focus:border-zinc-600"
                />
                <button
                  onClick={handleRunAutoMatch}
                  disabled={isLoading}
                  className="px-3.5 py-1 bg-zinc-100 hover:bg-white text-zinc-900 rounded text-xs font-semibold transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Sparkles className="h-3.5 w-3.5 text-amber-600" />
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

          <SolverDiagnosticsView diagnostics={diagnostics} />

          <SensitivityMatrixView sensitivityMatrix={sensitivityMatrix} />
        </div>
      </div>
    </div>
  );
};
export default FormulationSimulator;
