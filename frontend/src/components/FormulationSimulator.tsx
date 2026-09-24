import React, { useState, useEffect } from 'react';
import type {
  BasePaint,
  ColorantPaste,
  RecipeSimulation,
  RecipeMatch,
  SensitivityItem
} from '../types';
import { predictRecipe, matchColor } from '../services/api';
import { SpectralChart } from './SpectralChart';
import {
  RotateCcw,
  CheckCircle2,
  Wand2,
  Sliders,
  Sparkles,
  ShieldCheck,
  Scale,
  Activity,
  AlertTriangle,
  HelpCircle,
  Hash
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
      [pasteId]: Math.max(0, Math.min(15.0, parseFloat(value.toFixed(2)))),
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
        max_total_load: 12.0,
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

  const chartSeries = [];
  if (simulation && simulation.reflectance) {
    chartSeries.push({
      id: 'predicted-recipe',
      name: 'Reçete Spektrumu (Composite)',
      color: simulation.hex || '#38bdf8',
      data: simulation.reflectance,
      strokeWidth: 2.2,
    });
  }

  if (targetReflectance) {
    chartSeries.push({
      id: 'target-ref',
      name: 'Hedef Standart',
      color: targetHex || '#f43f5e',
      data: targetReflectance,
      strokeWidth: 1.6,
      strokeDasharray: '3 3',
    });
  }

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
        {/* ======================================================== */}
        {/* SOL: Reçete Girişleri (5 Cols) */}
        {/* ======================================================== */}
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
              {allRecipes && (
                <div className="space-y-2 pt-2 border-t border-zinc-800">
                  <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400">
                    <span>CCM OPTİMİZASYON PROFİLLERİ</span>
                    <span>Aktif: {activeRecipeKey.toUpperCase()}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {/* Recipe A Card */}
                    <button
                      type="button"
                      onClick={() => handleSelectRecipe('recipe_a')}
                      className={`p-2 rounded-lg border text-left transition-all ${
                        activeRecipeKey === 'recipe_a'
                          ? 'bg-zinc-800 border-sky-500 shadow-sm shadow-sky-950 text-zinc-100'
                          : 'bg-zinc-950/70 border-zinc-800 hover:border-zinc-700 text-zinc-400'
                      }`}
                    >
                      <div className="text-[10px] font-semibold text-zinc-200 truncate">Reçete A</div>
                      <div className="text-[9px] text-zinc-400">Color Match</div>
                      <div className="mt-1 font-mono text-[11px] font-bold text-sky-400">
                        ΔE {allRecipes.recipe_a?.delta_e00?.toFixed(2) || '0.00'}
                      </div>
                      <div className="text-[9px] font-mono text-zinc-400">
                        %{allRecipes.recipe_a?.total_load?.toFixed(1) || '0.0'} yük
                      </div>
                    </button>

                    {/* Recipe B Card */}
                    <button
                      type="button"
                      onClick={() => handleSelectRecipe('recipe_b')}
                      className={`p-2 rounded-lg border text-left transition-all ${
                        activeRecipeKey === 'recipe_b'
                          ? 'bg-zinc-800 border-amber-500 shadow-sm shadow-amber-950 text-zinc-100'
                          : 'bg-zinc-950/70 border-zinc-800 hover:border-zinc-700 text-zinc-400'
                      }`}
                    >
                      <div className="text-[10px] font-semibold text-zinc-200 truncate">Reçete B</div>
                      <div className="text-[9px] text-zinc-400">Light Stability</div>
                      <div className="mt-1 font-mono text-[11px] font-bold text-amber-400">
                        MI {allRecipes.recipe_b?.composite_mi?.toFixed(2) || '0.00'}
                      </div>
                      <div className="text-[9px] font-mono text-zinc-400">
                        ΔE {allRecipes.recipe_b?.delta_e00?.toFixed(2) || '0.00'}
                      </div>
                    </button>

                    {/* Recipe C Card */}
                    <button
                      type="button"
                      onClick={() => handleSelectRecipe('recipe_c')}
                      className={`p-2 rounded-lg border text-left transition-all ${
                        activeRecipeKey === 'recipe_c'
                          ? 'bg-zinc-800 border-emerald-500 shadow-sm shadow-emerald-950 text-zinc-100'
                          : 'bg-zinc-950/70 border-zinc-800 hover:border-zinc-700 text-zinc-400'
                      }`}
                    >
                      <div className="text-[10px] font-semibold text-zinc-200 truncate">Reçete C</div>
                      <div className="text-[9px] text-zinc-400">Ekonomi / Yük</div>
                      <div className="mt-1 font-mono text-[11px] font-bold text-emerald-400">
                        %{allRecipes.recipe_c?.total_load?.toFixed(1) || '0.0'}
                      </div>
                      <div className="text-[9px] font-mono text-zinc-400">
                        ΔE {allRecipes.recipe_c?.delta_e00?.toFixed(2) || '0.00'}
                      </div>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Sliders */}
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
              <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                Renklendirici Konsantrasyonları
              </span>
              <button
                onClick={handleResetSliders}
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
                        max="12.00"
                        step="0.05"
                        value={conc}
                        onChange={(e) => handleConcChange(p.id, parseFloat(e.target.value))}
                        className="flex-1 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
                      />
                      <input
                        type="number"
                        min="0.00"
                        max="20.00"
                        step="0.1"
                        value={conc}
                        onChange={(e) => handleConcChange(p.id, parseFloat(e.target.value) || 0)}
                        className="w-12 px-1 py-0.5 bg-zinc-900 border border-zinc-800 rounded text-center text-xs font-mono text-zinc-200 focus:outline-none"
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pt-2 border-t border-zinc-800 flex items-center justify-between text-xs font-mono">
              <span className="text-zinc-400">Toplam Pasta Oranı:</span>
              <span className="font-semibold text-zinc-200">
                %{simulation?.total_colorant_load.toFixed(2) || '0.00'} / max %12.0
              </span>
            </div>
          </div>
        </div>

        {/* ======================================================== */}
        {/* SAĞ: Spektral Eğri & Swatch (7 Cols) */}
        {/* ======================================================== */}
        <div className="lg:col-span-7 space-y-4">
          <SpectralChart
            series={chartSeries}
            title="Reçete Spektral Tahmini (400 - 700 nm)"
            subtitle="Kubelka-Munk Çift Sabitli Model • Anlık Yansıma"
            height={340}
          />

          {/* Minimalist swatch & colorimetric metrics */}
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-5 grid grid-cols-1 sm:grid-cols-2 gap-5">
            {/* Color Swatch */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                  Renk Swatch Eşleniği
                </span>
                <span className="text-xs font-mono font-medium text-zinc-300">
                  {simulation?.hex || '#ffffff'}
                </span>
              </div>

              {simulation?.comparison ? (
                <div className="h-28 rounded-lg overflow-hidden border border-zinc-800 grid grid-cols-2">
                  <div
                    className="h-full flex items-end p-2 transition-colors duration-200"
                    style={{ backgroundColor: simulation.comparison.target_hex }}
                  >
                    <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-zinc-950/80 text-zinc-200">
                      Hedef: {simulation.comparison.target_hex}
                    </span>
                  </div>
                  <div
                    className="h-full flex items-end p-2 transition-colors duration-200 border-l border-zinc-800/80"
                    style={{ backgroundColor: simulation.hex }}
                  >
                    <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-zinc-950/80 text-zinc-200">
                      Reçete: {simulation.hex}
                    </span>
                  </div>
                </div>
              ) : (
                <div
                  className="h-28 rounded-lg border border-zinc-800 flex items-end p-2.5 transition-colors duration-200"
                  style={{ backgroundColor: simulation?.hex || '#ffffff' }}
                >
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-950/80 text-zinc-200">
                    {simulation?.hex || '#ffffff'}
                  </span>
                </div>
              )}

              {/* Lab coordinates */}
              <div className="grid grid-cols-3 gap-1.5 text-center text-xs font-mono">
                <div className="p-1.5 bg-zinc-950 rounded border border-zinc-800">
                  <span className="block text-[9px] text-zinc-400">L*</span>
                  <span className="text-zinc-200">{simulation?.lab.L.toFixed(1) || '0.0'}</span>
                </div>
                <div className="p-1.5 bg-zinc-950 rounded border border-zinc-800">
                  <span className="block text-[9px] text-zinc-400">a*</span>
                  <span className="text-zinc-200">{simulation?.lab.a.toFixed(1) || '0.0'}</span>
                </div>
                <div className="p-1.5 bg-zinc-950 rounded border border-zinc-800">
                  <span className="block text-[9px] text-zinc-400">b*</span>
                  <span className="text-zinc-200">{simulation?.lab.b.toFixed(1) || '0.0'}</span>
                </div>
              </div>
            </div>

            {/* Quality Analysis */}
            <div className="space-y-2.5">
              <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 block">
                Kalite Gate & Tolerans Denetimi
              </span>

              {simulation?.comparison && (
                <div className="p-2.5 bg-zinc-950 rounded-lg border border-zinc-800 space-y-1 font-mono text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-zinc-400">CIEDE2000 (ΔE00):</span>
                    <span className={`font-semibold px-1.5 py-0.2 rounded ${simulation.comparison.delta_e00 < 0.5 ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/80' : 'bg-amber-950/80 text-amber-400 border border-amber-800/80'}`}>
                      {simulation.comparison.delta_e00.toFixed(3)}
                    </span>
                  </div>
                  <div className="flex justify-between text-[10px] text-zinc-400 pt-1 border-t border-zinc-900">
                    <span>ΔL: {simulation.comparison.delta_L > 0 ? `+${simulation.comparison.delta_L.toFixed(2)}` : simulation.comparison.delta_L.toFixed(2)}</span>
                    <span>Δa: {simulation.comparison.delta_a > 0 ? `+${simulation.comparison.delta_a.toFixed(2)}` : simulation.comparison.delta_a.toFixed(2)}</span>
                    <span>Δb: {simulation.comparison.delta_b > 0 ? `+${simulation.comparison.delta_b.toFixed(2)}` : simulation.comparison.delta_b.toFixed(2)}</span>
                    <span>ΔC: {simulation.comparison.delta_C > 0 ? `+${simulation.comparison.delta_C.toFixed(2)}` : simulation.comparison.delta_C.toFixed(2)}</span>
                  </div>
                </div>
              )}

              {/* Metamerism DIN 6172 */}
              <div className="p-2.5 bg-zinc-950 rounded-lg border border-zinc-800 space-y-1.5 font-mono text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-zinc-400">Metamerizm İndeksi (DIN 6172)</span>
                  <span className="text-[10px] text-emerald-400 font-medium">
                    {simulation?.comparison?.metamerism?.rating || 'Uyumlu'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 text-[10px] text-zinc-400">
                  <div className="p-1 bg-zinc-900 rounded flex justify-between">
                    <span>MI(Akkor A):</span>
                    <span className="text-zinc-200 font-semibold">{simulation?.comparison?.metamerism?.MI_A?.toFixed(2) || '0.00'}</span>
                  </div>
                  <div className="p-1 bg-zinc-900 rounded flex justify-between">
                    <span>MI(TL84 F11):</span>
                    <span className="text-zinc-200 font-semibold">{simulation?.comparison?.metamerism?.MI_F11?.toFixed(2) || '0.00'}</span>
                  </div>
                </div>
              </div>

              {/* Contrast Ratio */}
              <div className="p-2.5 bg-zinc-950 rounded-lg border border-zinc-800 flex items-center justify-between text-xs font-mono">
                <span className="text-zinc-400">Kontrast / Örtücülük:</span>
                <span className="text-emerald-400 font-medium flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  %{simulation?.contrast_ratio.toFixed(1) || '98.5'} (Opak)
                </span>
              </div>
            </div>
          </div>

          {/* Solver Diagnostics Card */}
          {diagnostics && (
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3.5 text-xs font-mono space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="h-3.5 w-3.5 text-sky-400" />
                  <span className="text-zinc-300 font-medium text-[11px]">SLSQP Çözücü Teşhisi</span>
                </div>
                <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                  diagnostics.success ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-amber-950 text-amber-300 border border-amber-800'
                }`}>
                  {diagnostics.success ? 'OPTIMAL_CONVERGED' : 'FEASIBLE_LOCAL_MIN'}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2 text-[10px] text-zinc-400 pt-1 border-t border-zinc-800/80">
                <div>
                  <span className="block text-zinc-500">İterasyon:</span>
                  <span className="text-zinc-200">{diagnostics.iterations}</span>
                </div>
                <div>
                  <span className="block text-zinc-500">Fonksiyon Çağrısı:</span>
                  <span className="text-zinc-200">{diagnostics.function_evaluations}</span>
                </div>
                <div>
                  <span className="block text-zinc-500">Kütle Marjı:</span>
                  <span className="text-zinc-200">+{diagnostics.constraint_slack?.toFixed(2)}%</span>
                </div>
                <div>
                  <span className="block text-zinc-500">Son Kayıp:</span>
                  <span className="text-zinc-200">{diagnostics.final_loss?.toFixed(4)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Analytical Sensitivity Matrix Table */}
          {sensitivityMatrix && sensitivityMatrix.length > 0 && (
            <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Scale className="h-4 w-4 text-amber-400" />
                  <span className="text-xs font-semibold text-zinc-200">
                    Pigment Duyarlılık Matrisi (What-If Kısmi Türevleri)
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
          )}
        </div>
      </div>
    </div>
  );
};
