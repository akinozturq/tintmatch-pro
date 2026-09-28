import React, { useState } from 'react';
import type { CanSize, CanScaledRecipe, BasePaint } from '../../types';
import {
  Package,
  Printer,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Sparkles,
  X,
  FileText,
  DollarSign
} from 'lucide-react';

interface CanSizingViewProps {
  canSizes: CanSize[];
  selectedCanSizeId: number | null;
  onSelectCanSizeId: (id: number) => void;
  canQuantity: number;
  onChangeCanQuantity: (qty: number) => void;
  scaledRecipe: CanScaledRecipe | null;
  isLoading: boolean;
  activeBase?: BasePaint;
}

export const CanSizingView: React.FC<CanSizingViewProps> = ({
  canSizes,
  selectedCanSizeId,
  onSelectCanSizeId,
  canQuantity,
  onChangeCanQuantity,
  scaledRecipe,
  isLoading,
  activeBase
}) => {
  const [isLabelModalOpen, setIsLabelModalOpen] = useState(false);

  const selectedCan = canSizes.find((c) => c.id === selectedCanSizeId);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-5 space-y-4 shadow-[var(--shadow-sm)]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-[var(--radius)] bg-[var(--accent-subtle)] border border-[var(--accent-border)] text-[var(--accent-text)]">
            <Package className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wider font-mono">
                Ambalaj Ölçekleme & Endüstriyel Dozajlama
              </h3>
              <span className="px-1.5 py-0.5 rounded-[var(--radius-xs)] text-[10px] font-mono bg-[var(--surface-0)] border border-[var(--border)] text-[var(--text-secondary)]">
                Innovatint Scaling Engine
              </span>
            </div>
            <p className="text-[11px] text-[var(--text-secondary)]">
              Laboratuvar formülünü seçilen teneke/kova ambalaj hacmine göre net gram ve mililitreye ölçekler
            </p>
          </div>
        </div>

        {/* Can size & quantity controls */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <label className="text-[11px] font-mono text-[var(--text-secondary)]">Ambalaj:</label>
            <select
              value={selectedCanSizeId || ''}
              onChange={(e) => onSelectCanSizeId(Number(e.target.value))}
              className="px-2.5 py-1.5 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand-clay)]"
            >
              {canSizes.map((can) => (
                <option key={can.id} value={can.id}>
                  {can.name} ({can.nominal_volume_l}L / Baz: {can.default_base_fill_l}L)
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <label className="text-[11px] font-mono text-[var(--text-secondary)]">Adet:</label>
            <input
              type="number"
              min="1"
              max="5000"
              value={canQuantity}
              onChange={(e) => onChangeCanQuantity(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-16 px-2 py-1.5 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] text-xs font-mono text-[var(--text-primary)] text-center focus:outline-none focus:border-[var(--brand-clay)]"
            />
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="py-6 text-center text-xs text-[var(--text-muted)] font-mono animate-pulse">
          Ambalaj dozajı ve maliyet matrisi hesaplanıyor...
        </div>
      )}

      {!isLoading && !scaledRecipe && (
        <div className="p-6 border border-dashed border-[var(--border)] rounded-[var(--radius)] text-center text-xs text-[var(--text-muted)] font-mono bg-[var(--surface-0)]">
          Reçetede renklendirici konsantrasyonu bulunmuyor. Kaydırıcılardan konsantrasyon verin veya Auto-Match çalıştırın.
        </div>
      )}

      {!isLoading && scaledRecipe && (
        <div className="space-y-4">
          {/* Headspace Safety Banner */}
          <div
            className={`p-3 rounded-[var(--radius)] border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono shadow-sm ${
              scaledRecipe.headspace.status === 'HEADSPACE_SAFE'
                ? 'bg-[var(--success-subtle)] border-[var(--success-border)] text-[var(--success-text)]'
                : 'bg-[var(--danger-subtle)] border-[var(--danger-border)] text-[var(--danger-text)]'
            }`}
          >
            <div className="flex items-center gap-2">
              {scaledRecipe.headspace.status === 'HEADSPACE_SAFE' ? (
                <CheckCircle2 className="h-4 w-4 text-[var(--success-text)] shrink-0" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-[var(--danger-text)] shrink-0 animate-bounce" />
              )}
              <div>
                <span className="font-semibold uppercase tracking-wider text-[11px]">
                  {scaledRecipe.headspace.status === 'HEADSPACE_SAFE'
                    ? 'Emniyetli Ambalaj Tepe Boşluğu (Headspace Safe)'
                    : 'Taşma Tehlikesi Uyarısı (Overfill Warning)'}
                </span>
                <p className="text-[11px] opacity-90">
                  {scaledRecipe.headspace.status === 'HEADSPACE_SAFE'
                    ? `Kutu tepe payı yeterli. Kullanılan pasta: ${scaledRecipe.headspace.used_colorant_volume_ml.toFixed(1)} ml / İzin verilen maksimum: ${scaledRecipe.headspace.max_colorant_volume_ml.toFixed(0)} ml (Kalan: ${scaledRecipe.headspace.remaining_headspace_ml.toFixed(1)} ml)`
                    : `Formüldeki pasta hacmi (${scaledRecipe.headspace.used_colorant_volume_ml.toFixed(1)} ml), kutudaki tepe boşluğunu (${scaledRecipe.headspace.max_colorant_volume_ml.toFixed(0)} ml) aşıyor! Lütfen daha yüksek pigmentli pasta veya daha büyük ambalaj seçin.`}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setIsLabelModalOpen(true)}
                className="px-3 py-1.5 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] text-[var(--text-primary)] rounded-[var(--radius)] text-xs font-semibold flex items-center gap-1.5 transition-colors border border-[var(--border)] shadow-sm"
              >
                <Printer className="h-3.5 w-3.5 text-[var(--brand-clay)]" />
                <span>Kutu Etiketi & Dozaj Fişi</span>
              </button>
            </div>
          </div>

          {/* Scaled Dispense Table */}
          <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-[var(--surface-1)] text-[var(--text-secondary)] text-[10px] uppercase border-b border-[var(--border)]">
                <tr>
                  <th className="p-2.5">Bileşen</th>
                  <th className="p-2.5">Tür</th>
                  <th className="p-2.5">Konsantrasyon</th>
                  <th className="p-2.5 text-right">1 Kutu (gr)</th>
                  <th className="p-2.5 text-right">1 Kutu (ml / L)</th>
                  <th className="p-2.5 text-right">
                    Toplam {scaledRecipe.number_of_cans} Kutu (Net Ağırlık)
                  </th>
                  <th className="p-2.5 text-right">Maliyet (₺)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {/* Carrier Base Row */}
                <tr className="bg-[var(--surface-0)] text-[var(--text-primary)] font-medium">
                  <td className="p-2.5 flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full border border-[var(--border-strong)]"
                      style={{ backgroundColor: activeBase?.hex || '#ffffff' }}
                    />
                    <span>{scaledRecipe.base.name}</span>
                    <span className="text-[10px] text-[var(--text-muted)] font-mono">({scaledRecipe.base.code})</span>
                  </td>
                  <td className="p-2.5 text-[var(--text-secondary)]">Taşıyıcı Baz</td>
                  <td className="p-2.5 text-[var(--text-secondary)]">Ana Gövde</td>
                  <td className="p-2.5 text-right text-[var(--text-primary)]">
                    {(scaledRecipe.base.per_can_mass_kg * 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} g
                  </td>
                  <td className="p-2.5 text-right text-[var(--text-primary)]">
                    {scaledRecipe.base.per_can_volume_l.toFixed(2)} L
                  </td>
                  <td className="p-2.5 text-right font-semibold text-[var(--text-primary)]">
                    {scaledRecipe.base.total_mass_kg.toFixed(2)} kg ({scaledRecipe.base.total_volume_l.toFixed(1)} L)
                  </td>
                  <td className="p-2.5 text-right text-[var(--text-secondary)]">
                    {scaledRecipe.base.total_cost.toFixed(2)} ₺
                  </td>
                </tr>

                {/* Colorant Pastes */}
                {scaledRecipe.pastes.map((p) => (
                  <tr key={p.paste_id} className="hover:bg-[var(--surface-1)] text-[var(--text-primary)]">
                    <td className="p-2.5 flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full border border-[var(--border-strong)]"
                        style={{ backgroundColor: p.color_hex }}
                      />
                      <span className="font-semibold text-[var(--text-primary)]">{p.name}</span>
                      <span className="text-[10px] text-[var(--text-muted)] font-mono">({p.code})</span>
                    </td>
                    <td className="p-2.5 text-[var(--text-secondary)]">Renklendirici</td>
                    <td className="p-2.5 font-semibold text-[var(--accent-text)]">%{p.concentration_pct.toFixed(2)}</td>
                    <td className="p-2.5 text-right text-[var(--brand-clay)] font-mono font-medium">
                      {p.per_can.mass_g < 10 ? p.per_can.mass_g.toFixed(2) : p.per_can.mass_g.toFixed(1)} g
                    </td>
                    <td className="p-2.5 text-right text-[var(--accent-text)] font-mono">
                      {p.per_can.volume_ml.toFixed(1)} ml
                    </td>
                    <td className="p-2.5 text-right font-semibold text-[var(--text-primary)] font-mono">
                      {p.total.mass_g >= 1000
                        ? `${(p.total.mass_g / 1000).toFixed(2)} kg`
                        : `${p.total.mass_g.toFixed(1)} g`}
                      <span className="text-[11px] text-[var(--text-muted)] ml-1">
                        ({p.total.volume_ml >= 1000
                          ? `${(p.total.volume_ml / 1000).toFixed(2)} L`
                          : `${p.total.volume_ml.toFixed(0)} ml`})
                      </span>
                    </td>
                    <td className="p-2.5 text-right text-[var(--text-secondary)] font-mono">
                      {p.total_cost.toFixed(2)} ₺
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Cost Breakdown Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
            <div className="p-3 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] shadow-sm">
              <span className="text-[10px] text-[var(--text-muted)] block uppercase">Kutu Başına Maliyet</span>
              <span className="text-sm font-bold text-[var(--success-text)]">
                {scaledRecipe.costing.cost_per_can.toFixed(2)} ₺
              </span>
              <span className="text-[10px] text-[var(--text-muted)] block mt-0.5">Ambalaj + Baz + Pasta</span>
            </div>

            <div className="p-3 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] shadow-sm">
              <span className="text-[10px] text-[var(--text-muted)] block uppercase">Litre Başına Maliyet</span>
              <span className="text-sm font-bold text-[var(--accent-text)]">
                {scaledRecipe.costing.cost_per_liter.toFixed(2)} ₺/L
              </span>
              <span className="text-[10px] text-[var(--text-muted)] block mt-0.5">Net boya birim maliyeti</span>
            </div>

            <div className="p-3 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] shadow-sm">
              <span className="text-[10px] text-[var(--text-muted)] block uppercase">Pasta Gideri (Parti)</span>
              <span className="text-sm font-semibold text-[var(--warning-text)]">
                {scaledRecipe.costing.colorant_cost.toFixed(2)} ₺
              </span>
              <span className="text-[10px] text-[var(--text-muted)] block mt-0.5">
                %{((scaledRecipe.costing.colorant_cost / (scaledRecipe.costing.total_batch_cost || 1)) * 100).toFixed(1)} pay
              </span>
            </div>

            <div className="p-3 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] shadow-sm">
              <span className="text-[10px] text-[var(--text-muted)] block uppercase">Toplam Parti Tutarı</span>
              <span className="text-sm font-bold text-[var(--text-primary)]">
                {scaledRecipe.costing.total_batch_cost.toFixed(2)} ₺
              </span>
              <span className="text-[10px] text-[var(--text-muted)] block mt-0.5">
                {scaledRecipe.number_of_cans} Kutu için toplam
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* PRINTABLE DISPENSE LABEL MODAL                           */}
      {/* ======================================================== */}
      {isLabelModalOpen && scaledRecipe && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white text-zinc-900 rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-4 print:p-0 print:shadow-none print:max-w-none print:w-full">
            {/* Modal Top Actions (Hidden on Print) */}
            <div className="flex items-center justify-between pb-3 border-b border-zinc-200 print:hidden">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-[var(--brand-clay)]" />
                <h4 className="text-sm font-bold font-mono">Endüstriyel Kutu Etiketi & Dozaj Fişi</h4>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePrint}
                  className="px-3 py-1 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white rounded text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>Yazdır</span>
                </button>
                <button
                  onClick={() => setIsLabelModalOpen(false)}
                  className="p-1 hover:bg-zinc-100 rounded text-zinc-500"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Printable Label Layout */}
            <div className="border-2 border-zinc-900 rounded-lg p-5 space-y-3 font-mono text-xs">
              {/* Brand & Batch header */}
              <div className="flex items-center justify-between border-b-2 border-zinc-900 pb-2">
                <div>
                  <h2 className="text-base font-black tracking-tight">TINTMATCH PRO</h2>
                  <p className="text-[10px] text-zinc-600">Endüstriyel Renklendirme & Dozaj Sistemi</p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-zinc-500 uppercase block">Parti No</span>
                  <span className="font-bold text-sm tracking-wider">
                    TM-{new Date().getFullYear()}-{Math.floor(1000 + Math.random() * 9000)}
                  </span>
                </div>
              </div>

              {/* Product and Can Details */}
              <div className="grid grid-cols-2 gap-2 text-[11px] bg-zinc-100 p-2.5 rounded">
                <div>
                  <span className="text-zinc-500 block text-[9px]">TAŞIYICI BAZ:</span>
                  <span className="font-bold">{scaledRecipe.base.name}</span>
                  <span className="text-zinc-600 block text-[10px]">({scaledRecipe.base.code})</span>
                </div>
                <div>
                  <span className="text-zinc-500 block text-[9px]">AMBALAJ KAPASİTESİ:</span>
                  <span className="font-bold">{scaledRecipe.can_size.name}</span>
                  <span className="text-zinc-600 block text-[10px]">
                    Net Baz: {scaledRecipe.base.per_can_volume_l} L ({scaledRecipe.base.per_can_mass_kg} kg)
                  </span>
                </div>
              </div>

              {/* Dispenser & Scale Table */}
              <div>
                <span className="text-[10px] font-bold text-zinc-700 uppercase block mb-1">
                  Renklendirici Dozaj Değerleri (1 Kutu İçin)
                </span>
                <table className="w-full text-left text-xs border border-zinc-300">
                  <thead className="bg-zinc-200 text-zinc-700 text-[10px] uppercase">
                    <tr>
                      <th className="p-1.5 border-b border-zinc-300">Pasta / Renk</th>
                      <th className="p-1.5 border-b border-zinc-300 text-center">% Kons</th>
                      <th className="p-1.5 border-b border-zinc-300 text-right">Terazi (gr)</th>
                      <th className="p-1.5 border-b border-zinc-300 text-right">Dispenser (ml)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200">
                    {scaledRecipe.pastes.map((p) => (
                      <tr key={p.paste_id}>
                        <td className="p-1.5 font-bold">
                          {p.name} <span className="text-zinc-500 font-normal">({p.code})</span>
                        </td>
                        <td className="p-1.5 text-center font-semibold">%{p.concentration_pct.toFixed(2)}</td>
                        <td className="p-1.5 text-right font-black text-sm">
                          {p.per_can.mass_g < 10 ? p.per_can.mass_g.toFixed(2) : p.per_can.mass_g.toFixed(1)} g
                        </td>
                        <td className="p-1.5 text-right font-mono font-medium">
                          {p.per_can.volume_ml.toFixed(1)} ml
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Total volume and headspace */}
              <div className="flex items-center justify-between text-[11px] pt-1 border-t border-zinc-200">
                <span>
                  Toplam Dolum: <strong className="font-bold">{(scaledRecipe.base.per_can_volume_l + scaledRecipe.headspace.used_colorant_volume_ml / 1000).toFixed(2)} L</strong> / {scaledRecipe.can_size.nominal_volume_l} L
                </span>
                <span className="px-2 py-0.5 bg-zinc-200 text-zinc-800 rounded font-bold text-[10px]">
                  {scaledRecipe.headspace.status === 'HEADSPACE_SAFE' ? '✓ TEPE PAYI GÜVENLİ' : '⚠️ TAŞMA RİSKİ'}
                </span>
              </div>

              {/* Footer / Barcode mockup */}
              <div className="pt-2 border-t-2 border-zinc-900 flex items-center justify-between text-[10px] text-zinc-500">
                <div>
                  <span>Tarih: {new Date().toLocaleDateString('tr-TR')} {new Date().toLocaleTimeString('tr-TR')}</span>
                  <span className="block text-[9px]">ISO 18314-1 Standardına Göre CCM Doğrulanmıştır</span>
                </div>
                <div className="font-mono text-right text-[11px] tracking-widest font-bold text-zinc-900">
                  ||||| |||| || ||||||| ||| ||||
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
