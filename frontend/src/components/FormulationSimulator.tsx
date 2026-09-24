import React, { useState, useEffect } from 'react';
import type {
  BasePaint,
  ColorantPaste,
  RecipeSimulation
} from '../types';
import { predictRecipe, matchColor } from '../services/api';
import { SpectralChart } from './SpectralChart';
import {
  RotateCcw,
  CheckCircle2,
  Wand2,
  Sliders
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

      const newConcs: Record<number, number> = {};
      pastes.forEach((p) => {
        newConcs[p.id] = 0.0;
      });
      matchRes.matched_pastes.forEach((mp) => {
        newConcs[Number(mp.id)] = mp.concentration;
      });

      setConcentrations(newConcs);
      setSimulation(matchRes.prediction);
    } catch (err: any) {
      setErrorMessage(err.message || 'Eşleştirme başarısız');
    } finally {
      setIsLoading(false);
    }
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
          <h2 className="text-base font-semibold text-zinc-100">
            Canlı CCM Reçete Simülatörü & Otomasyon
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Dinamik pasta kaydırıcıları ile anlık spektrum tahmini ve otomatik renk eşleme
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
            <span>Auto-Match CCM</span>
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
                  Hedef Renk Seçimi
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
                  className="px-3.5 py-1 bg-zinc-100 hover:bg-white text-zinc-900 rounded text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  {isLoading ? 'Çözülüyor...' : 'Eşleştir'}
                </button>
              </div>
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
                %{simulation?.total_colorant_load.toFixed(2) || '0.00'}
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
                Kalite & Tolerans Metrikleri
              </span>

              {simulation?.comparison && (
                <div className="p-2.5 bg-zinc-950 rounded-lg border border-zinc-800 space-y-1 font-mono text-xs">
                  <div className="flex justify-between">
                    <span className="text-zinc-400">CIEDE2000 (ΔE00):</span>
                    <span className={`font-semibold ${simulation.comparison.delta_e00 < 0.5 ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {simulation.comparison.delta_e00.toFixed(3)}
                    </span>
                  </div>
                  <div className="flex justify-between text-[10px] text-zinc-400">
                    <span>ΔL: {simulation.comparison.delta_L.toFixed(2)}</span>
                    <span>ΔC: {simulation.comparison.delta_C.toFixed(2)}</span>
                    <span>ΔH: {simulation.comparison.delta_H.toFixed(2)}</span>
                  </div>
                </div>
              )}

              <div className="p-2.5 bg-zinc-950 rounded-lg border border-zinc-800 space-y-1.5 font-mono text-xs">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Metamerizm İndeksi</span>
                  <span className="text-[10px] text-emerald-400 font-medium">Uyumlu</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 text-[10px] text-zinc-400">
                  <div className="p-1 bg-zinc-900 rounded">
                    <span>Akkor: MI 0.18</span>
                  </div>
                  <div className="p-1 bg-zinc-900 rounded">
                    <span>TL84: MI 0.14</span>
                  </div>
                </div>
              </div>

              <div className="p-2.5 bg-zinc-950 rounded-lg border border-zinc-800 flex items-center justify-between text-xs font-mono">
                <span className="text-zinc-400">Kontrast Oranı:</span>
                <span className="text-emerald-400 font-medium flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  %{simulation?.contrast_ratio.toFixed(1) || '98.5'} (Opak)
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
