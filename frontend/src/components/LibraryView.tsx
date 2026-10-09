import React, { useState, useEffect } from 'react';
import type { BasePaint, ColorantPaste, CanSize, ColorCard, CardColor } from '../types';
import { SpectralChart } from './SpectralChart';
import { AddBaseModal } from './AddBaseModal';
import { AddCardColorModal } from './AddCardColorModal';
import { FactoryBatchHistoryTable } from './FactoryBatchHistoryTable';
import {
  fetchCanSizes,
  createCanSize,
  deleteCanSize,
  fetchColorCards,
  fetchCardColors,
  createColorCard,
  addCardColor,
  deleteCardColor,
  deleteColorCard
} from '../services/api';
import {
  Layers,
  Palette,
  Package,
  History,
  Search,
  Plus,
  Trash2,
  CheckCircle2,
  Sliders,
  Sparkles,
  ArrowRight
} from 'lucide-react';

interface LibraryViewProps {
  bases: BasePaint[];
  pastes: ColorantPaste[];
  onSelectPasteForSim?: (paste: ColorantPaste) => void;
  onNavigateToFormulationWithTarget?: (reflectance: number[], colorName: string) => void;
  onRefreshData?: () => void;
}

export const LibraryView: React.FC<LibraryViewProps> = ({
  bases,
  pastes,
  onSelectPasteForSim,
  onNavigateToFormulationWithTarget,
  onRefreshData
}) => {
  const [activeTab, setActiveTab] = useState<'pastes_bases' | 'cards' | 'cans' | 'history'>('pastes_bases');

  // Pastes & Bases sub-state
  const [pasteOrBase, setPasteOrBase] = useState<'pastes' | 'bases'>('pastes');
  const [isAddBaseOpen, setIsAddBaseOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPasteId, setSelectedPasteId] = useState<number>(pastes.length > 0 ? pastes[0].id : 1);
  const [selectedBaseId, setSelectedBaseId] = useState<number>(bases.length > 0 ? bases[0].id : 1);

  // Can Sizes state
  const [canSizes, setCanSizes] = useState<CanSize[]>([]);
  const [isAddCanOpen, setIsAddCanOpen] = useState(false);
  const [newCanCode, setNewCanCode] = useState('');
  const [newCanName, setNewCanName] = useState('');
  const [newCanNominal, setNewCanNominal] = useState(15.0);
  const [newCanBaseFill, setNewCanBaseFill] = useState(14.0);
  const [newCanMaxColorant, setNewCanMaxColorant] = useState(1.2);
  const [newCanCost, setNewCanCost] = useState(95.0);

  // Color Cards state
  const [cards, setCards] = useState<ColorCard[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null);
  const [cardColors, setCardColors] = useState<CardColor[]>([]);
  const [cardSearch, setCardSearch] = useState('');
  const [selectedColor, setSelectedColor] = useState<CardColor | null>(null);
  const [isAddCardOpen, setIsAddCardOpen] = useState(false);
  const [isAddColorOpen, setIsAddColorOpen] = useState(false);
  const [newCardCode, setNewCardCode] = useState('');
  const [newCardName, setNewCardName] = useState('');

  const refreshCardColors = async () => {
    if (!selectedCardId) return;
    try {
      const [data, updatedCards] = await Promise.all([
        fetchCardColors(selectedCardId),
        fetchColorCards(),
      ]);
      const colorsList = Array.isArray(data) ? data : data.colors || [];
      setCardColors(colorsList);
      setCards(updatedCards);
      if (colorsList.length > 0 && (!selectedColor || !colorsList.some((c: CardColor) => c.id === selectedColor.id))) {
        setSelectedColor(colorsList[0]);
      }
    } catch {}
  };

  const handleDeleteCardColor = async (colorId: number) => {
    if (!confirm('Bu rengi karteladan silmek istediğinize emin misiniz?')) return;
    if (!selectedCardId) return;
    try {
      await deleteCardColor(selectedCardId, colorId);
      refreshCardColors();
    } catch (err: any) {
      alert(err.message || 'Renk silinemedi');
    }
  };

  useEffect(() => {
    fetchCanSizes().then(setCanSizes).catch(() => {});
    fetchColorCards()
      .then((data) => {
        setCards(data);
        if (data.length > 0) setSelectedCardId(data[0].id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedCardId) return;
    fetchCardColors(selectedCardId)
      .then((data) => {
        const colorsList = Array.isArray(data) ? data : data.colors || [];
        setCardColors(colorsList);
        if (colorsList.length > 0) setSelectedColor(colorsList[0]);
        else setSelectedColor(null);
      })
      .catch(() => {});
  }, [selectedCardId]);

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

  // Chart data for Paste/Base
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

  const handleCreateCan = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createCanSize({
        code: newCanCode,
        name: newCanName,
        nominal_volume_l: newCanNominal,
        default_base_fill_l: newCanBaseFill,
        max_colorant_volume_l: newCanMaxColorant,
        package_cost: newCanCost
      });
      const updated = await fetchCanSizes();
      setCanSizes(updated);
      setIsAddCanOpen(false);
      setNewCanCode('');
      setNewCanName('');
    } catch (err: any) {
      alert(err.message || 'Kutu boyutu kaydedilemedi');
    }
  };

  const handleDeleteCan = async (id: number) => {
    if (!confirm('Bu ambalaj boyutunu silmek istediğinize emin misiniz?')) return;
    try {
      await deleteCanSize(id);
      setCanSizes((prev) => prev.filter((c) => c.id !== id));
    } catch (err: any) {
      alert(err.message || 'Silinemedi');
    }
  };

  const handleCreateCard = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await createColorCard({
        code: newCardCode,
        name: newCardName
      });
      const updated = await fetchColorCards();
      setCards(updated);
      setSelectedCardId(res.id);
      setIsAddCardOpen(false);
      setNewCardCode('');
      setNewCardName('');
    } catch (err: any) {
      alert(err.message || 'Kartela oluşturulamadı');
    }
  };

  const handleDeleteCard = async (id: number) => {
    if (!confirm('Bu renk kartelasını silmek istediğinize emin misiniz?')) return;
    try {
      await deleteColorCard(id);
      const updated = await fetchColorCards();
      setCards(updated);
      if (selectedCardId === id) {
        setSelectedCardId(updated[0]?.id || null);
      }
    } catch (err: any) {
      alert(err.message || 'Kartela silinemedi');
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-6 w-full space-y-6">
      {/* Top Header & Section Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-[var(--border)]">
        <div>
          <h1 className="text-lg font-bold text-[var(--text-primary)] tracking-tight">
            Laboratuvar Kütüphanesi & Kartelalar
          </h1>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            Pastalar, bazlar, standart renk kartelaları ve ambalaj boyutları yönetimi
          </p>
        </div>

        {/* 4 Tabs Segmented Control */}
        <div className="flex items-center bg-[var(--surface-0)] border border-[var(--border)] p-1 rounded-[var(--radius-lg)] text-xs">
          <button
            onClick={() => setActiveTab('pastes_bases')}
            className={`px-3 py-1.5 rounded-[var(--radius)] font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'pastes_bases'
                ? 'bg-[var(--surface-3)] text-[var(--brand-clay)] font-bold shadow-xs border border-[var(--border)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Pastalar & Bazlar</span>
          </button>
          <button
            onClick={() => setActiveTab('cards')}
            className={`px-3 py-1.5 rounded-[var(--radius)] font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'cards'
                ? 'bg-[var(--surface-3)] text-[var(--brand-clay)] font-bold shadow-xs border border-[var(--border)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Palette className="h-3.5 w-3.5" />
            <span>Renk Kartelaları</span>
          </button>
          <button
            onClick={() => setActiveTab('cans')}
            className={`px-3 py-1.5 rounded-[var(--radius)] font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'cans'
                ? 'bg-[var(--surface-3)] text-[var(--brand-clay)] font-bold shadow-xs border border-[var(--border)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Package className="h-3.5 w-3.5" />
            <span>Kutu & Ambalaj</span>
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-3 py-1.5 rounded-[var(--radius)] font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'history'
                ? 'bg-[var(--surface-3)] text-[var(--brand-clay)] font-bold shadow-xs border border-[var(--border)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <History className="h-3.5 w-3.5" />
            <span>Üretim Arşivi</span>
          </button>
        </div>
      </div>

      {/* TAB 1: Pastes & Bases */}
      {activeTab === 'pastes_bases' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Sol Kolon: Liste */}
          <div className="lg:col-span-4 space-y-3">
            <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-4 flex flex-col shadow-[var(--shadow-sm)]">
              {/* Segmented Switcher */}
              <div className="grid grid-cols-2 gap-1 bg-[var(--surface-0)] p-1 rounded-[var(--radius)] border border-[var(--border)] mb-3 text-xs font-medium">
                <button
                  onClick={() => setPasteOrBase('pastes')}
                  className={`py-1 rounded-[var(--radius-xs)] transition-colors cursor-pointer ${
                    pasteOrBase === 'pastes'
                      ? 'bg-[var(--surface-3)] text-[var(--text-primary)] font-semibold shadow-xs'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  Pastalar ({pastes.length})
                </button>
                <button
                  onClick={() => setPasteOrBase('bases')}
                  className={`py-1 rounded-[var(--radius-xs)] transition-colors cursor-pointer ${
                    pasteOrBase === 'bases'
                      ? 'bg-[var(--surface-3)] text-[var(--text-primary)] font-semibold shadow-xs'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  Bazlar ({bases.length})
                </button>
              </div>

              {/* Search */}
              <div className="relative mb-3">
                <Search className="h-3.5 w-3.5 absolute left-2.5 top-2 text-[var(--text-muted)]" />
                <input
                  type="text"
                  placeholder={pasteOrBase === 'pastes' ? 'Pasta filtrele...' : 'Baz filtrele...'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-2.5 py-1.5 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-clay)]"
                />
              </div>

              {/* List */}
              <div className="space-y-1.5 overflow-y-auto max-h-[460px] pr-1">
                {pasteOrBase === 'pastes' ? (
                  filteredPastes.map((p) => {
                    const isSelected = p.id === selectedPasteId;
                    return (
                      <div
                        key={p.id}
                        onClick={() => setSelectedPasteId(p.id)}
                        className={`p-2.5 rounded-[var(--radius)] border transition-all cursor-pointer flex items-center justify-between ${
                          isSelected
                            ? 'bg-[var(--surface-0)] border-[var(--brand-clay)] shadow-xs'
                            : 'bg-[var(--surface-1)] border-[var(--border)] hover:bg-[var(--surface-0)]'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            className="w-4 h-4 rounded-full border border-black/20 shrink-0 shadow-2xs"
                            style={{ backgroundColor: p.color_hex || '#cbd5e1' }}
                          />
                          <div>
                            <span className="block text-xs font-bold text-[var(--text-primary)]">{p.name}</span>
                            <span className="text-[10px] text-[var(--text-muted)] font-mono">{p.code}</span>
                          </div>
                        </div>
                        <div className="text-right font-mono text-[11px] text-[var(--text-secondary)]">
                          <span>{p.cost_per_kg || 150} TL/kg</span>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  filteredBases.map((b) => {
                    const isSelected = b.id === selectedBaseId;
                    return (
                      <div
                        key={b.id}
                        onClick={() => setSelectedBaseId(b.id)}
                        className={`p-2.5 rounded-[var(--radius)] border transition-all cursor-pointer flex items-center justify-between ${
                          isSelected
                            ? 'bg-[var(--surface-0)] border-[var(--brand-clay)] shadow-xs'
                            : 'bg-[var(--surface-1)] border-[var(--border)] hover:bg-[var(--surface-0)]'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            className="w-4 h-4 rounded-full border border-black/20 shrink-0 shadow-2xs"
                            style={{ backgroundColor: b.hex }}
                          />
                          <div>
                            <span className="block text-xs font-bold text-[var(--text-primary)]">{b.name}</span>
                            <span className="text-[10px] text-[var(--text-muted)] font-mono">{b.code} ({b.base_type})</span>
                          </div>
                        </div>
                        <span className="text-[10px] font-mono text-[var(--text-muted)]">
                          CR: %{b.contrast_ratio}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Add Base Button */}
              {pasteOrBase === 'bases' && (
                <div className="pt-3 border-t border-[var(--border)] mt-3">
                  <button
                    onClick={() => setIsAddBaseOpen(true)}
                    className="w-full py-1.5 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] border border-[var(--border)] text-xs text-[var(--text-primary)] rounded flex items-center justify-center gap-1.5 cursor-pointer font-medium"
                  >
                    <Plus className="h-3.5 w-3.5 text-[var(--brand-clay)]" />
                    <span>Yeni Baz Ekle</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Sağ Kolon: Spektral Eğri & Özellikler */}
          <div className="lg:col-span-8 space-y-4">
            <SpectralChart
              series={chartSeries}
              title={`${selectedPaste?.name || 'Pigment'} Spektral Eğrisi`}
              subtitle={`CHNSpec DS-36D (d/8° SCI) • ${selectedBase?.name || 'Baz A'} ile K/S Matrisi`}
              height={320}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Pasta Kartı */}
              <div className="p-4 bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono uppercase font-bold text-[var(--text-muted)]">
                    Seçili Renklendirici
                  </span>
                  <span
                    className="w-4 h-4 rounded-full border border-black/20 shadow-xs"
                    style={{ backgroundColor: selectedPaste?.color_hex }}
                  />
                </div>
                <h3 className="text-sm font-bold text-[var(--text-primary)]">
                  {selectedPaste?.name} ({selectedPaste?.code})
                </h3>
                <div className="grid grid-cols-2 gap-2 text-xs font-mono pt-1 border-t border-[var(--border)]">
                  <div>
                    <span className="text-[10px] text-[var(--text-muted)] block">Yoğunluk</span>
                    <span className="font-semibold">{selectedPaste?.density} g/cm³</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[var(--text-muted)] block">Birim Fiyat</span>
                    <span className="font-semibold text-[var(--brand-clay)]">{selectedPaste?.cost_per_kg || 150} TL/kg</span>
                  </div>
                </div>
                {onSelectPasteForSim && selectedPaste && (
                  <button
                    onClick={() => onSelectPasteForSim(selectedPaste)}
                    className="w-full mt-2 py-1.5 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white text-xs font-medium rounded flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Sliders className="h-3.5 w-3.5" />
                    <span>CCM Reçete Masasına Aktar</span>
                  </button>
                )}
              </div>

              {/* Baz Kartı */}
              <div className="p-4 bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono uppercase font-bold text-[var(--text-muted)]">
                    Seçili Taşıyıcı Baz
                  </span>
                  <span
                    className="w-4 h-4 rounded-full border border-black/20 shadow-xs"
                    style={{ backgroundColor: selectedBase?.hex }}
                  />
                </div>
                <h3 className="text-sm font-bold text-[var(--text-primary)]">
                  {selectedBase?.name} ({selectedBase?.code})
                </h3>
                <div className="grid grid-cols-2 gap-2 text-xs font-mono pt-1 border-t border-[var(--border)]">
                  <div>
                    <span className="text-[10px] text-[var(--text-muted)] block">Opaklık Kontrastı</span>
                    <span className="font-semibold">%{selectedBase?.contrast_ratio}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[var(--text-muted)] block">Baz Tipi</span>
                    <span className="font-semibold">{selectedBase?.is_opaque ? 'Opak (Beyaz)' : 'Şeffaf / Derin'}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Color Cards */}
      {activeTab === 'cards' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Kartela Seçimi */}
          <div className="lg:col-span-4 space-y-3">
            <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-4 space-y-3 shadow-[var(--shadow-sm)]">
              <div className="flex items-center justify-between pb-2 border-b border-[var(--border)]">
                <span className="text-xs font-bold text-[var(--text-primary)] font-mono uppercase">
                  Renk Kartelaları ({cards.length})
                </span>
                <button
                  onClick={() => setIsAddCardOpen(true)}
                  className="px-2 py-1 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] border border-[var(--border)] rounded text-xs flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="h-3 w-3 text-[var(--brand-clay)]" />
                  <span>Yeni Kartela</span>
                </button>
              </div>

              <div className="space-y-1.5">
                {cards.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => setSelectedCardId(c.id)}
                    className={`p-2.5 rounded-[var(--radius)] border flex items-center justify-between cursor-pointer transition-colors ${
                      c.id === selectedCardId
                        ? 'bg-[var(--surface-0)] border-[var(--brand-clay)] font-bold shadow-xs'
                        : 'bg-[var(--surface-1)] border-[var(--border)] hover:bg-[var(--surface-0)]'
                    }`}
                  >
                    <div>
                      <span className="block text-xs text-[var(--text-primary)]">{c.name}</span>
                      <span className="text-[10px] text-[var(--text-muted)] font-mono">{c.code} • {c.color_count} Renk</span>
                    </div>
                    {cards.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteCard(c.id);
                        }}
                        className="text-[var(--text-muted)] hover:text-red-500 p-1 cursor-pointer"
                        title="Kartelayı Sil"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Renk Listesi & Seçili Renk Detayı */}
          <div className="lg:col-span-8 space-y-4">
            <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-4 space-y-4 shadow-[var(--shadow-sm)]">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--border)]">
                <div>
                  <h3 className="text-xs font-bold text-[var(--text-primary)] font-mono uppercase">
                    Kartela Renkleri ({cardColors.length})
                  </h3>
                  <p className="text-[11px] text-[var(--text-secondary)]">
                    İstediğiniz renge tıklayarak doğrudan CCM Reçete Masası'na hedef olarak aktarabilirsiniz
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="h-3.5 w-3.5 absolute left-2.5 top-2 text-[var(--text-muted)]" />
                    <input
                      type="text"
                      placeholder="Renk ara..."
                      value={cardSearch}
                      onChange={(e) => setCardSearch(e.target.value)}
                      className="pl-8 pr-2.5 py-1 bg-[var(--surface-0)] border border-[var(--border)] rounded text-xs text-[var(--text-primary)] w-36 focus:outline-none focus:ring-1 focus:ring-[var(--brand-clay)]"
                    />
                  </div>
                  {selectedCardId && (
                    <button
                      type="button"
                      onClick={() => setIsAddColorOpen(true)}
                      className="px-3 py-1 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white rounded text-xs font-mono font-bold flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors shrink-0"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Yeni Renk Ekle</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Empty state if card has 0 colors */}
              {cardColors.length === 0 ? (
                <div className="p-8 text-center border-2 border-dashed border-[var(--border)] rounded-[var(--radius)] space-y-3">
                  <Palette className="h-8 w-8 text-[var(--text-muted)] mx-auto opacity-50" />
                  <div>
                    <span className="font-bold text-xs text-[var(--text-primary)] block">Bu Kartelada Henüz Renk Yok</span>
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                      Spektrofotometre ile okutarak, 31-dalga boyu spektrum yapıştırarak veya CSV yükleyerek hemen renk ekleyin.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsAddColorOpen(true)}
                    className="px-3.5 py-1.5 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white text-xs font-bold font-mono rounded inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>İlk Rengi Ekle</span>
                  </button>
                </div>
              ) : (
                /* Swatch Grid */
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-2.5 max-h-[380px] overflow-y-auto pr-1">
                  {cardColors
                    .filter((col) => col.color_name.toLowerCase().includes(cardSearch.toLowerCase()) || col.color_code.toLowerCase().includes(cardSearch.toLowerCase()))
                    .map((col) => {
                      const isSelected = selectedColor?.id === col.id;
                      return (
                        <div
                          key={col.id}
                          onClick={() => setSelectedColor(col)}
                          className={`p-2 rounded border cursor-pointer transition-all flex flex-col items-center gap-1.5 text-center ${
                            isSelected
                              ? 'border-[var(--brand-clay)] ring-1 ring-[var(--brand-clay)] shadow-xs bg-[var(--surface-0)]'
                              : 'border-[var(--border)] hover:border-[var(--border-strong)] bg-[var(--surface-1)]'
                          }`}
                        >
                          <div
                            className="w-12 h-12 rounded-sm border border-black/20 shadow-xs"
                            style={{ backgroundColor: col.hex }}
                          />
                          <div className="w-full truncate font-mono">
                            <span className="block text-[11px] font-bold text-[var(--text-primary)] truncate">{col.color_code}</span>
                            <span className="text-[10px] text-[var(--text-muted)] truncate block">{col.color_name}</span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}

              {/* Selected Color Action Footer */}
              {selectedColor && (
                <div className="p-3 bg-[var(--surface-0)] border border-[var(--border)] rounded flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="w-8 h-8 rounded border border-black/20 shadow-xs"
                      style={{ backgroundColor: selectedColor.hex }}
                    />
                    <div>
                      <span className="text-xs font-bold text-[var(--text-primary)] font-mono">
                        {selectedColor.color_code} - {selectedColor.color_name}
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)] font-mono block">
                        Lab: L={selectedColor.lab?.L?.toFixed(1)} a={selectedColor.lab?.a?.toFixed(1)} b={selectedColor.lab?.b?.toFixed(1)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleDeleteCardColor(selectedColor.id)}
                      className="p-1.5 text-[var(--text-muted)] hover:text-red-500 rounded border border-[var(--border)] hover:bg-[var(--surface-1)] cursor-pointer"
                      title="Bu Rengi Karteladan Sil"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    {onNavigateToFormulationWithTarget && (
                      <button
                        onClick={() => onNavigateToFormulationWithTarget(selectedColor.reflectance, `${selectedColor.color_code} ${selectedColor.color_name}`)}
                        className="px-3.5 py-1.5 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white text-xs font-bold rounded flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>Bu Rengi CCM'de Eşle</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: Can Sizing */}
      {activeTab === 'cans' && (
        <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-5 space-y-4 shadow-[var(--shadow-sm)]">
          <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)] font-mono">
                Ön Dolumlu Ambalaj & Kutu Boyutları (Can Sizing)
              </h2>
              <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                Fabrikada kullanılan standart ambalaj boyutları, baz dolum hacimleri ve kutu birim maliyetleri
              </p>
            </div>
            <button
              onClick={() => setIsAddCanOpen(true)}
              className="px-3 py-1.5 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white text-xs font-medium rounded flex items-center gap-1 cursor-pointer shadow-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Yeni Kutu Boyutu Ekle</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
            {canSizes.map((can) => (
              <div
                key={can.id}
                className="p-4 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] space-y-2 relative group hover:border-[var(--brand-clay)] transition-all"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[var(--text-primary)] font-mono">{can.name}</span>
                  <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-[var(--surface-3)] border border-[var(--border)]">
                    {can.code}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-[var(--text-secondary)] pt-1 border-t border-[var(--border)]">
                  <div>
                    <span className="text-[10px] text-[var(--text-muted)] block">Nominal Hacim</span>
                    <span className="font-bold text-[var(--text-primary)]">{can.nominal_volume_l} L</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[var(--text-muted)] block">Baz Dolumu</span>
                    <span className="font-bold text-[var(--text-primary)]">{can.default_base_fill_l} L</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[var(--text-muted)] block">Maks Pasta Hacmi</span>
                    <span>{can.max_colorant_volume_l} L</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[var(--text-muted)] block">Ambalaj Maliyeti</span>
                    <span className="text-[var(--brand-clay)] font-bold">{can.package_cost || 0} TL</span>
                  </div>
                </div>

                <button
                  onClick={() => handleDeleteCan(can.id)}
                  className="absolute top-2 right-2 text-[var(--text-muted)] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-1 cursor-pointer"
                  title="Sil"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 4: Batch History */}
      {activeTab === 'history' && (
        <FactoryBatchHistoryTable />
      )}

      {/* Add Base Modal */}
      <AddBaseModal
        isOpen={isAddBaseOpen}
        onClose={() => setIsAddBaseOpen(false)}
        onSuccess={() => {
          if (onRefreshData) onRefreshData();
        }}
      />

      {/* Add Can Modal */}
      {isAddCanOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-5 max-w-md w-full space-y-4 shadow-xl">
            <h3 className="text-sm font-bold text-[var(--text-primary)]">Yeni Ambalaj Boyutu Ekle</h3>
            <form onSubmit={handleCreateCan} className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">Ambalaj Kodu</label>
                <input
                  type="text"
                  required
                  placeholder="CAN-15L"
                  value={newCanCode}
                  onChange={(e) => setNewCanCode(e.target.value)}
                  className="w-full p-2 bg-[var(--surface-0)] border border-[var(--border)] rounded font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">Ambalaj Adı</label>
                <input
                  type="text"
                  required
                  placeholder="15 L Büyük Kova"
                  value={newCanName}
                  onChange={(e) => setNewCanName(e.target.value)}
                  className="w-full p-2 bg-[var(--surface-0)] border border-[var(--border)] rounded"
                />
              </div>
              <div className="grid grid-cols-2 gap-2 font-mono">
                <div>
                  <label className="block text-[10px] text-[var(--text-muted)] mb-1">Nominal Hacim (L)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={newCanNominal}
                    onChange={(e) => setNewCanNominal(parseFloat(e.target.value) || 0)}
                    className="w-full p-2 bg-[var(--surface-0)] border border-[var(--border)] rounded"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-[var(--text-muted)] mb-1">Baz Dolum Hacmi (L)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={newCanBaseFill}
                    onChange={(e) => setNewCanBaseFill(parseFloat(e.target.value) || 0)}
                    className="w-full p-2 bg-[var(--surface-0)] border border-[var(--border)] rounded"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-[var(--text-muted)] mb-1">Maksimum Pasta (L)</label>
                  <input
                    type="number"
                    step="0.05"
                    value={newCanMaxColorant}
                    onChange={(e) => setNewCanMaxColorant(parseFloat(e.target.value) || 0)}
                    className="w-full p-2 bg-[var(--surface-0)] border border-[var(--border)] rounded"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-[var(--text-muted)] mb-1">Kutu Maliyeti (TL)</label>
                  <input
                    type="number"
                    step="1"
                    value={newCanCost}
                    onChange={(e) => setNewCanCost(parseFloat(e.target.value) || 0)}
                    className="w-full p-2 bg-[var(--surface-0)] border border-[var(--border)] rounded"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setIsAddCanOpen(false)}
                  className="px-3 py-1.5 rounded bg-[var(--surface-0)] border border-[var(--border)] text-[var(--text-secondary)]"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="px-3.5 py-1.5 rounded bg-[var(--brand-clay)] text-white font-bold"
                >
                  Kaydet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Card Modal */}
      {isAddCardOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-5 max-w-md w-full space-y-4 shadow-xl">
            <h3 className="text-sm font-bold text-[var(--text-primary)]">Yeni Renk Kartelası Oluştur</h3>
            <form onSubmit={handleCreateCard} className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">Kartela Kodu</label>
                <input
                  type="text"
                  required
                  placeholder="NCS-CORE"
                  value={newCardCode}
                  onChange={(e) => setNewCardCode(e.target.value)}
                  className="w-full p-2 bg-[var(--surface-0)] border border-[var(--border)] rounded font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">Kartela Adı</label>
                <input
                  type="text"
                  required
                  placeholder="NCS Standart Palet"
                  value={newCardName}
                  onChange={(e) => setNewCardName(e.target.value)}
                  className="w-full p-2 bg-[var(--surface-0)] border border-[var(--border)] rounded"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setIsAddCardOpen(false)}
                  className="px-3 py-1.5 rounded bg-[var(--surface-0)] border border-[var(--border)] text-[var(--text-secondary)]"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="px-3.5 py-1.5 rounded bg-[var(--brand-clay)] text-white font-bold"
                >
                  Oluştur
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Card Color Modal */}
      {selectedCardId && (
        <AddCardColorModal
          isOpen={isAddColorOpen}
          onClose={() => setIsAddColorOpen(false)}
          cardId={selectedCardId}
          cardName={cards.find((c) => c.id === selectedCardId)?.name || 'Kartela'}
          onSuccess={refreshCardColors}
        />
      )}
    </div>
  );
};
