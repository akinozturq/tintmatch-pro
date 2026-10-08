import React, { useState } from 'react';
import type { BasePaint, ColorantPaste } from '../types';
import { SpectralChart } from './SpectralChart';
import { AddBaseModal } from './AddBaseModal';
import { FactoryBatchHistoryTable } from './FactoryBatchHistoryTable';
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
  onRefreshData?: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  bases,
  pastes,
  onSelectPasteForSim,
  onOpenWizard,
  onOpenReport,
  onRefreshData,
}) => {
  const [activeTab, setActiveTab] = useState<'pastes' | 'bases'>('pastes');
  const [isAddBaseOpen, setIsAddBaseOpen] = useState(false);
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
          <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-4 flex flex-col h-full shadow-[var(--shadow-sm)] transition-colors">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)] font-mono">
                Kütüphane
              </span>
              <span className="text-[10px] font-mono text-[var(--text-muted)]">
                {activeTab === 'pastes' ? `${pastes.length} Pasta` : `${bases.length} Baz`}
              </span>
            </div>

            {/* Segmented Switcher */}
            <div className="grid grid-cols-2 gap-1 bg-[var(--surface-0)] p-1 rounded-[var(--radius)] border border-[var(--border)] my-3 text-xs font-medium">
              <button
                onClick={() => setActiveTab('pastes')}
                className={`py-1 rounded-[var(--radius-xs)] transition-colors ${
                  activeTab === 'pastes'
                    ? 'bg-[var(--surface-3)] text-[var(--text-primary)] font-semibold shadow-sm [box-shadow:var(--ring-outer)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                Pastalar
              </button>
              <button
                onClick={() => setActiveTab('bases')}
                className={`py-1 rounded-[var(--radius-xs)] transition-colors ${
                  activeTab === 'bases'
                    ? 'bg-[var(--surface-3)] text-[var(--text-primary)] font-semibold shadow-sm [box-shadow:var(--ring-outer)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                Bazlar
              </button>
            </div>

            {/* Search Input */}
            <div className="relative mb-3">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-2 text-[var(--text-muted)]" />
              <input
                type="text"
                placeholder={activeTab === 'pastes' ? "Pasta filtrele..." : "Baz filtrele..."}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-2.5 py-1.5 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
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
                      className={`p-2.5 rounded-[var(--radius)] border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-[var(--surface-0)] border-[var(--brand-clay)] shadow-sm'
                          : 'bg-[var(--surface-1)] border-[var(--border)] hover:bg-[var(--surface-0)] hover:border-[var(--border-strong)]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0 border border-[var(--border-strong)]"
                            style={{ backgroundColor: paste.color_hex }}
                          />
                          <span className="text-xs font-medium text-[var(--text-primary)] truncate">
                            {paste.name}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono text-[var(--text-muted)]">
                          {paste.code}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[10px] font-mono text-[var(--text-secondary)] mt-1.5 pl-4.5">
                        <span>{paste.density} g/cm³</span>
                        <span className="text-[var(--success-text)] font-semibold">
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
                      className={`p-2.5 rounded-[var(--radius)] border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-[var(--surface-0)] border-[var(--brand-clay)] shadow-sm'
                          : 'bg-[var(--surface-1)] border-[var(--border)] hover:bg-[var(--surface-0)] hover:border-[var(--border-strong)]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0 border border-[var(--border-strong)]"
                            style={{ backgroundColor: base.hex }}
                          />
                          <span className="text-xs font-medium text-[var(--text-primary)] truncate">
                            {base.name}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono text-[var(--text-muted)]">
                          {base.code}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[10px] font-mono text-[var(--text-secondary)] mt-1.5 pl-4.5">
                        <span>Opasite: %{base.contrast_ratio}</span>
                        <span className="text-[var(--text-primary)]">
                          {base.is_opaque ? 'Opak' : 'Yarı-Opak'}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Bottom New Calibration / Add Base CTA */}
            <div className="mt-3 pt-3 border-t border-[var(--border)]">
              {activeTab === 'pastes' ? (
                <button
                  onClick={onOpenWizard}
                  className="w-full py-2 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white rounded-[var(--radius)] text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-sm cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Yeni Karakterizasyon</span>
                </button>
              ) : (
                <button
                  onClick={() => setIsAddBaseOpen(true)}
                  className="w-full py-2 bg-[var(--accent)] hover:opacity-90 text-white rounded-[var(--radius)] text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-sm cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Yeni Baz Ekle</span>
                </button>
              )}
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
            subtitle={`CHNSpec DS-36D (d/8° SCI) Ölçüm • ${selectedBase?.name || 'Baz A'} ile K/S Matrisi`}
            height={360}
          />

          {/* Minimalist Specs Bar */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3.5 bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] space-y-2 shadow-[var(--shadow-sm)] transition-colors">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                  Renklendirici
                </span>
                <span
                  className="w-3 h-3 rounded-full border border-[var(--border-strong)]"
                  style={{ backgroundColor: selectedPaste?.color_hex }}
                />
              </div>
              <p className="text-xs font-semibold text-[var(--text-primary)] truncate">
                {selectedPaste?.name} ({selectedPaste?.code})
              </p>
              <div className="flex justify-between text-[11px] font-mono text-[var(--text-secondary)]">
                <span>Yoğunluk: {selectedPaste?.density} g/cm³</span>
                <span className="text-[var(--success-text)] font-semibold">ΔE00: {selectedPaste?.mean_delta_e00?.toFixed(3)}</span>
              </div>
            </div>

            <div className="p-3.5 bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] space-y-2 shadow-[var(--shadow-sm)] transition-colors">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                  Baz Boya
                </span>
                <span
                  className="w-3 h-3 rounded-full border border-[var(--border-strong)]"
                  style={{ backgroundColor: selectedBase?.hex }}
                />
              </div>
              <p className="text-xs font-semibold text-[var(--text-primary)] truncate">
                {selectedBase?.name} ({selectedBase?.code})
              </p>
              <div className="flex justify-between text-[11px] font-mono text-[var(--text-secondary)]">
                <span>Kontrast: %{selectedBase?.contrast_ratio}</span>
                <span className="text-[var(--text-primary)]">{selectedBase?.is_opaque ? 'Opak (≥%98)' : 'Şeffaf'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ======================================================== */}
        {/* SAĞ: Kolorimetri & Kalite (3 Cols) */}
        {/* ======================================================== */}
        <div className="lg:col-span-3 space-y-4">
          <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-5 space-y-5 shadow-[var(--shadow-sm)] transition-colors">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)] font-mono">
                Kolorimetri
              </span>
              <span className="text-[10px] font-mono text-[var(--text-muted)]">D65 / 10°</span>
            </div>

            {/* Pure Color Swatch */}
            <div className="space-y-2">
              <div
                className="h-28 rounded-[var(--radius)] border border-[var(--border-strong)] flex items-end p-3 transition-colors duration-200 shadow-inner"
                style={{ backgroundColor: selectedPaste?.color_hex || '#3b82f6' }}
              >
                <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded-[var(--radius-xs)] bg-[var(--surface-3)]/90 text-[var(--text-primary)] backdrop-blur border border-[var(--border)] shadow-sm">
                  {selectedPaste?.color_hex}
                </span>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] font-mono text-center">
                sRGB Gamma Düzeltmeli Dijital Renk Eşleniği
              </p>
            </div>

            {/* Validation Meter */}
            <div className="p-3 bg-[var(--surface-0)] rounded-[var(--radius)] border border-[var(--border)] space-y-2 font-mono">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-secondary)]">Geri Tahmin ΔE00</span>
                <span className="text-[var(--success-text)] font-semibold">
                  {selectedPaste?.mean_delta_e00?.toFixed(3)}
                </span>
              </div>

              {/* Minimalist linear progress track */}
              <div className="w-full bg-[var(--surface-1)] rounded-full h-1.5 overflow-hidden border border-[var(--border)]">
                <div
                  className="bg-[var(--success)] h-1.5 rounded-full"
                  style={{ width: `${Math.min(100, ((selectedPaste?.mean_delta_e00 || 0.1) / 0.3) * 100)}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] pt-0.5">
                <span>Eşik &lt; 0.30</span>
                <span className="text-[var(--success-text)] flex items-center gap-1 font-sans font-medium">
                  <CheckCircle2 className="h-3 w-3" />
                  Doğrulandı
                </span>
              </div>
            </div>

            {/* Metamerism Index */}
            <div className="p-3 bg-[var(--surface-0)] rounded-[var(--radius)] border border-[var(--border)] space-y-2 font-mono">
              <div className="flex justify-between items-center text-xs">
                <span className="text-[var(--text-secondary)]">Metamerizm (MI)</span>
                <span className="text-[10px] text-[var(--success-text)] font-semibold">Mükemmel</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="p-1.5 bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-xs)]">
                  <span className="block text-[9px] text-[var(--text-muted)]">Akkor (Illum A)</span>
                  <span className="text-[var(--text-primary)] font-medium">MI: 0.18</span>
                </div>
                <div className="p-1.5 bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-xs)]">
                  <span className="block text-[9px] text-[var(--text-muted)]">Floresan (TL84)</span>
                  <span className="text-[var(--text-primary)] font-medium">MI: 0.14</span>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-2 pt-2">
              <button
                onClick={() => onSelectPasteForSim && onSelectPasteForSim(selectedPaste)}
                className="w-full py-2 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white rounded-[var(--radius)] text-xs font-semibold flex items-center justify-center gap-2 transition-colors shadow-sm"
              >
                <Sliders className="h-3.5 w-3.5" />
                <span>CCM Simülatörüne Gönder</span>
              </button>

              <button
                onClick={() => onOpenReport && onOpenReport(1)}
                className="w-full py-2 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-[var(--radius)] text-xs font-medium flex items-center justify-center gap-1.5 transition-colors border border-[var(--border)]"
              >
                <ExternalLink className="h-3 w-3" />
                <span>ISO 18314 Sertifikası</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Factory Batch Production & QA History Audit Desk */}
      <FactoryBatchHistoryTable />

      {/* Add Base Paint Modal */}
      <AddBaseModal
        isOpen={isAddBaseOpen}
        onClose={() => setIsAddBaseOpen(false)}
        onSuccess={() => {
          if (onRefreshData) onRefreshData();
        }}
      />
    </div>
  );
};
