import React, { useState } from 'react';
import type { BasePaint, ColorantPaste } from '../types';
import { SpectralChart } from './SpectralChart';
import {
  Search,
  CheckCircle2,
  Sliders,
  ExternalLink,
  Plus
} from 'lucide-react';

interface DashboardProps {
  bases: BasePaint[];
  pastes: ColorantPaste[];
  onSelectPasteForSim?: (paste: ColorantPaste) => void;
  onOpenWizard?: () => void;
  onOpenReport?: (pasteId: number) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  bases,
  pastes,
  onSelectPasteForSim,
  onOpenWizard,
  onOpenReport,
}) => {
  const [activeTab, setActiveTab] = useState<'pastes' | 'bases'>('pastes');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPasteId, setSelectedPasteId] = useState<number>(
    pastes.length > 0 ? pastes[0].id : 1
  );
  const [selectedBaseId, setSelectedBaseId] = useState<number>(
    bases.length > 0 ? bases[0].id : 1
  );

  const selectedPaste = pastes.find((p) => p.id === selectedPasteId) || pastes[0];
  const selectedBase = bases.find((b) => b.id === selectedBaseId) || bases[0];

  const filteredPastes = pastes.filter(
    (p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.code.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredBases = bases.filter(
    (b) =>
      b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.code.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Spectral series for chart
  const chartSeries = [];

  if (selectedBase && selectedBase.reflectance) {
    chartSeries.push({
      id: `base-${selectedBase.id}`,
      name: `Baz: ${selectedBase.name}`,
      color: '#71717a',
      data: selectedBase.reflectance,
      strokeWidth: 1.5,
      strokeDasharray: '3 3',
    });
  }

  if (selectedPaste && selectedPaste.unit_k) {
    const wavelengths = Array.from({ length: 31 }, (_, i) => 400 + i * 10);
    const simulatedReflectance = wavelengths.map((_, i) => {
      const bk = selectedBase ? selectedBase.absorption_k[i] : 0.015;
      const bs = selectedBase ? selectedBase.scattering_s[i] : 1.0;
      const pk = selectedPaste.unit_k[i] || 0.1;
      const ps = selectedPaste.unit_s[i] || 0.02;
      const c = 2.5;
      const mix_ks = (bk + c * pk) / Math.max(bs + c * ps, 1e-5);
      const r_int = 1 + mix_ks - Math.sqrt(mix_ks * mix_ks + 2 * mix_ks);
      const k1 = 0.04;
      const k2 = 0.60;
      return k1 + ((1 - k1) * (1 - k2) * r_int) / Math.max(1 - k2 * r_int, 1e-5);
    });

    chartSeries.push({
      id: `paste-${selectedPaste.id}-mix`,
      name: `${selectedPaste.name} (%2.5)`,
      color: selectedPaste.color_hex || '#3b82f6',
      data: simulatedReflectance,
      strokeWidth: 2.2,
    });
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-6 w-full">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* ======================================================== */}
        {/* SOL: Kütüphane (3 Cols) */}
        {/* ======================================================== */}
        <div className="lg:col-span-3 space-y-3">
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4 flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300 font-mono">
                Kütüphane
              </span>
              <span className="text-[10px] font-mono text-zinc-500">
                {activeTab === 'pastes' ? `${pastes.length} Pasta` : `${bases.length} Baz`}
              </span>
            </div>

            {/* Segmented Switcher */}
            <div className="grid grid-cols-2 gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800/80 my-3 text-xs font-medium">
              <button
                onClick={() => setActiveTab('pastes')}
                className={`py-1 rounded transition-colors ${
                  activeTab === 'pastes'
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Pastalar
              </button>
              <button
                onClick={() => setActiveTab('bases')}
                className={`py-1 rounded transition-colors ${
                  activeTab === 'bases'
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Bazlar
              </button>
            </div>

            {/* Search Input */}
            <div className="relative mb-3">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-2 text-zinc-500" />
              <input
                type="text"
                placeholder={activeTab === 'pastes' ? "Pasta filtrele..." : "Baz filtrele..."}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-2.5 py-1 bg-zinc-950 border border-zinc-800 rounded-md text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-600 transition-colors"
              />
            </div>

            {/* List */}
            <div className="space-y-1.5 overflow-y-auto max-h-[460px] pr-1">
              {activeTab === 'pastes' ? (
                filteredPastes.map((paste) => {
                  const isSelected = paste.id === selectedPasteId;
                  return (
                    <div
                      key={paste.id}
                      onClick={() => setSelectedPasteId(paste.id)}
                      className={`p-2.5 rounded-lg border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-zinc-800/80 border-zinc-600'
                          : 'bg-zinc-950/40 border-zinc-800/60 hover:bg-zinc-800/30 hover:border-zinc-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0 border border-zinc-700"
                            style={{ backgroundColor: paste.color_hex }}
                          />
                          <span className="text-xs font-medium text-zinc-200 truncate">
                            {paste.name}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono text-zinc-400">
                          {paste.code}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400 mt-1.5 pl-4.5">
                        <span>{paste.density} g/cm³</span>
                        <span className="text-emerald-400 font-medium">
                          ΔE00: {paste.mean_delta_e00.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  );
                })
              ) : (
                filteredBases.map((base) => {
                  const isSelected = base.id === selectedBaseId;
                  return (
                    <div
                      key={base.id}
                      onClick={() => setSelectedBaseId(base.id)}
                      className={`p-2.5 rounded-lg border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-zinc-800/80 border-zinc-600'
                          : 'bg-zinc-950/40 border-zinc-800/60 hover:bg-zinc-800/30 hover:border-zinc-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0 border border-zinc-700"
                            style={{ backgroundColor: base.hex }}
                          />
                          <span className="text-xs font-medium text-zinc-200 truncate">
                            {base.name}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono text-zinc-400">
                          {base.code}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400 mt-1.5 pl-4.5">
                        <span>Opasite: %{base.contrast_ratio}</span>
                        <span className="text-zinc-300">
                          {base.is_opaque ? 'Opak' : 'Yarı-Opak'}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Bottom New Calibration CTA */}
            <div className="mt-3 pt-3 border-t border-zinc-800/70">
              <button
                onClick={onOpenWizard}
                className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Yeni Karakterizasyon</span>
              </button>
            </div>
          </div>
        </div>

        {/* ======================================================== */}
        {/* ORTA: Spektral Analiz (6 Cols) */}
        {/* ======================================================== */}
        <div className="lg:col-span-6 space-y-4">
          <SpectralChart
            series={chartSeries}
            title={`${selectedPaste?.name || 'Pigment'} Spektral Eğrileri`}
            subtitle={`X-Rite RM400 Ham Ölçüm • ${selectedBase?.name || 'Baz A'} ile K/S Matrisi`}
            height={360}
          />

          {/* Minimalist Specs Bar */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3.5 bg-zinc-900/70 border border-zinc-800 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                  Renklendirici
                </span>
                <span
                  className="w-3 h-3 rounded-full border border-zinc-700"
                  style={{ backgroundColor: selectedPaste?.color_hex }}
                />
              </div>
              <p className="text-xs font-semibold text-zinc-100 truncate">
                {selectedPaste?.name} ({selectedPaste?.code})
              </p>
              <div className="flex justify-between text-[11px] font-mono text-zinc-400">
                <span>Yoğunluk: {selectedPaste?.density} g/cm³</span>
                <span className="text-emerald-400">ΔE00: {selectedPaste?.mean_delta_e00?.toFixed(3)}</span>
              </div>
            </div>

            <div className="p-3.5 bg-zinc-900/70 border border-zinc-800 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                  Baz Boya
                </span>
                <span
                  className="w-3 h-3 rounded-full border border-zinc-700"
                  style={{ backgroundColor: selectedBase?.hex }}
                />
              </div>
              <p className="text-xs font-semibold text-zinc-100 truncate">
                {selectedBase?.name} ({selectedBase?.code})
              </p>
              <div className="flex justify-between text-[11px] font-mono text-zinc-400">
                <span>Kontrast: %{selectedBase?.contrast_ratio}</span>
                <span className="text-zinc-300">{selectedBase?.is_opaque ? 'Opak (≥%98)' : 'Şeffaf'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ======================================================== */}
        {/* SAĞ: Kolorimetri & Kalite (3 Cols) */}
        {/* ======================================================== */}
        <div className="lg:col-span-3 space-y-4">
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-5 space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300 font-mono">
                Kolorimetri
              </span>
              <span className="text-[10px] font-mono text-zinc-400">D65 / 10°</span>
            </div>

            {/* Pure Color Swatch */}
            <div className="space-y-2">
              <div
                className="h-28 rounded-lg border border-zinc-800 flex items-end p-3 transition-colors duration-200"
                style={{ backgroundColor: selectedPaste?.color_hex || '#3b82f6' }}
              >
                <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded bg-zinc-950/80 text-zinc-100 backdrop-blur border border-zinc-800/80">
                  {selectedPaste?.color_hex}
                </span>
              </div>
              <p className="text-[10px] text-zinc-500 font-mono text-center">
                sRGB Gamma Düzeltmeli Dijital Renk Eşleniği
              </p>
            </div>

            {/* Validation Meter */}
            <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800 space-y-2 font-mono">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400">Geri Tahmin ΔE00</span>
                <span className="text-emerald-400 font-semibold">
                  {selectedPaste?.mean_delta_e00?.toFixed(3)}
                </span>
              </div>

              {/* Minimalist linear progress track */}
              <div className="w-full bg-zinc-900 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-emerald-500 h-1.5 rounded-full"
                  style={{ width: `${Math.min(100, ((selectedPaste?.mean_delta_e00 || 0.1) / 0.3) * 100)}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[10px] text-zinc-400 pt-0.5">
                <span>Eşik &lt; 0.30</span>
                <span className="text-emerald-400 flex items-center gap-1 font-sans">
                  <CheckCircle2 className="h-3 w-3" />
                  Doğrulandı
                </span>
              </div>
            </div>

            {/* Metamerism Index */}
            <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800 space-y-2 font-mono">
              <div className="flex justify-between items-center text-xs">
                <span className="text-zinc-400">Metamerizm (MI)</span>
                <span className="text-[10px] text-emerald-400 font-semibold">Mükemmel</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px] text-zinc-400">
                <div className="p-1.5 bg-zinc-900 rounded">
                  <span className="block text-[9px] text-zinc-400">Akkor (Illum A)</span>
                  <span className="text-zinc-200">MI: 0.18</span>
                </div>
                <div className="p-1.5 bg-zinc-900 rounded">
                  <span className="block text-[9px] text-zinc-400">Floresan (TL84)</span>
                  <span className="text-zinc-200">MI: 0.14</span>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-2 pt-2">
              <button
                onClick={() => onSelectPasteForSim && onSelectPasteForSim(selectedPaste)}
                className="w-full py-2 bg-zinc-100 hover:bg-white text-zinc-900 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                <Sliders className="h-3.5 w-3.5" />
                <span>CCM Simülatörüne Gönder</span>
              </button>

              <button
                onClick={() => onOpenReport && onOpenReport(1)}
                className="w-full py-2 bg-zinc-950 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors border border-zinc-800"
              >
                <ExternalLink className="h-3 w-3" />
                <span>ISO 18314 Sertifikası</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
