import React, { useState, useEffect } from 'react';
import {
  Package,
  Layers,
  Palette,
  Plus,
  Trash2,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Search,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Zap,
  TrendingUp,
  Tag
} from 'lucide-react';
import {
  fetchCanSizes,
  createCanSize,
  deleteCanSize,
  fetchProducts,
  createProduct,
  deleteProduct,
  fetchColorCards,
  fetchCardColors,
  createColorCard,
  addCardColor,
  deleteColorCard,
  batchMatchCard
} from '../services/api';
import type {
  CanSize,
  Product,
  ColorCard,
  CardColor,
  BasePaint,
  BatchMatchResponse
} from '../types';

interface ConfigurationViewProps {
  bases: BasePaint[];
  onNavigateToFormulationWithTarget?: (reflectance: number[], colorName: string) => void;
}

export const ConfigurationView: React.FC<ConfigurationViewProps> = ({
  bases,
  onNavigateToFormulationWithTarget
}) => {
  const [subTab, setSubTab] = useState<'cans' | 'products' | 'cards'>('cans');

  // Can Sizes state
  const [canSizes, setCanSizes] = useState<CanSize[]>([]);
  const [isAddCanOpen, setIsAddCanOpen] = useState(false);
  const [newCanCode, setNewCanCode] = useState('');
  const [newCanName, setNewCanName] = useState('');
  const [newCanNominal, setNewCanNominal] = useState(15.0);
  const [newCanBaseFill, setNewCanBaseFill] = useState(14.0);
  const [newCanMaxColorant, setNewCanMaxColorant] = useState(1.2);
  const [newCanCost, setNewCanCost] = useState(95.0);

  // Products state
  const [products, setProducts] = useState<Product[]>([]);
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [newProdCode, setNewProdCode] = useState('');
  const [newProdName, setNewProdName] = useState('');
  const [newProdType, setNewProdType] = useState('interior_matte');
  const [newProdVoc, setNewProdVoc] = useState(25.0);
  const [selectedSwBase, setSelectedSwBase] = useState<number>(bases[0]?.id || 1);
  const [selectedWBase, setSelectedWBase] = useState<number>(bases[1]?.id || bases[0]?.id || 1);
  const [selectedTrBase, setSelectedTrBase] = useState<number>(bases[3]?.id || bases[0]?.id || 1);

  // Color Cards state
  const [cards, setCards] = useState<ColorCard[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null);
  const [cardColors, setCardColors] = useState<CardColor[]>([]);
  const [cardSearch, setCardSearch] = useState('');
  const [selectedColor, setSelectedColor] = useState<CardColor | null>(null);

  // Batch Matching State
  const [isBatchMatching, setIsBatchMatching] = useState(false);
  const [batchMatchResult, setBatchMatchResult] = useState<BatchMatchResponse | null>(null);
  const [batchMatchError, setBatchMatchError] = useState<string | null>(null);

  // General Loading & Feedback
  const [isLoading, setIsLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadAll = async () => {
    setIsLoading(true);
    try {
      const [canData, prodData, cardData] = await Promise.all([
        fetchCanSizes(),
        fetchProducts(),
        fetchColorCards()
      ]);
      setCanSizes(canData);
      setProducts(prodData);
      setCards(cardData);
      if (cardData.length > 0 && !selectedCardId) {
        setSelectedCardId(cardData[0].id);
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Yapılandırma verileri yüklenemedi' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    if (selectedCardId) {
      fetchCardColors(selectedCardId)
        .then((res) => {
          setCardColors(res.colors);
          if (res.colors.length > 0) setSelectedColor(res.colors[0]);
        })
        .catch(() => setCardColors([]));
    }
  }, [selectedCardId]);

  // Handlers
  const handleCreateCanSize = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createCanSize({
        code: newCanCode.trim().toUpperCase(),
        name: newCanName.trim(),
        nominal_volume_l: newCanNominal,
        default_base_fill_l: newCanBaseFill,
        max_colorant_volume_l: newCanMaxColorant,
        package_cost: newCanCost
      });
      setIsAddCanOpen(false);
      setNewCanCode('');
      setNewCanName('');
      loadAll();
      setActionMessage({ type: 'success', text: 'Yeni ambalaj boyutu başarıyla eklendi.' });
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message });
    }
  };

  const handleDeleteCanSize = async (id: number) => {
    if (!window.confirm('Bu ambalaj boyutunu silmek istediğinizden emin misiniz?')) return;
    try {
      await deleteCanSize(id);
      loadAll();
      setActionMessage({ type: 'success', text: 'Ambalaj boyutu silindi.' });
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message });
    }
  };

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createProduct({
        code: newProdCode.trim().toUpperCase(),
        name: newProdName.trim(),
        product_type: newProdType,
        voc_limit: newProdVoc,
        bases: [
          { abstract_base_code: 'SW', base_id: selectedSwBase, specific_gravity: 1.48, cost_per_liter: 52.0 },
          { abstract_base_code: 'W', base_id: selectedWBase, specific_gravity: 1.38, cost_per_liter: 46.0 },
          { abstract_base_code: 'TR', base_id: selectedTrBase, specific_gravity: 1.05, cost_per_liter: 65.0 },
        ]
      });
      setIsAddProductOpen(false);
      setNewProdCode('');
      setNewProdName('');
      loadAll();
      setActionMessage({ type: 'success', text: 'Yeni ürün ve soyut baz eşleşmeleri oluşturuldu.' });
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message });
    }
  };

  const handleRunBatchMatch = async () => {
    if (!selectedCardId || bases.length === 0) return;
    setIsBatchMatching(true);
    setBatchMatchError(null);
    setBatchMatchResult(null);

    try {
      const res = await batchMatchCard({
        card_id: selectedCardId,
        base_id: bases[0].id,
        max_pastes: 3,
        profile_id: 'color_match',
        max_de_threshold: 1.2
      });
      setBatchMatchResult(res);
      setActionMessage({
        type: 'success',
        text: `Toplu kartela eşleme tamamlandı: %${res.success_rate_pct} başarı oranı (${res.passed_colors}/${res.total_colors} renk).`
      });
    } catch (err: any) {
      setBatchMatchError(err.message || 'Toplu kartela eşleme sırasında hata oluştu.');
    } finally {
      setIsBatchMatching(false);
    }
  };

  const filteredCardColors = cardColors.filter(
    (c) =>
      c.color_code.toLowerCase().includes(cardSearch.toLowerCase()) ||
      c.color_name.toLowerCase().includes(cardSearch.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto px-6 py-6 w-full space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--border)]">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
              Endüstriyel Yapılandırma ve İş Akışı
            </h1>
            <span className="px-2 py-0.5 rounded-[var(--radius-xs)] text-[10px] font-mono bg-[var(--accent-subtle)] border border-[var(--accent-border)] text-[var(--accent-text)] font-semibold">
              Endüstriyel CCM Mimarisi
            </span>
          </div>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            Ambalaj kutu boyutları, ürün serileri & soyut bazlar (SW, W, TR) ve renk kartelası kütüphanesi
          </p>
        </div>

        {/* Sub-tab Navigation */}
        <div className="flex items-center gap-1 bg-[var(--surface-0)] border border-[var(--border)] p-1 rounded-[var(--radius)] shadow-inner">
          <button
            onClick={() => setSubTab('cans')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-xs)] text-xs font-medium transition-all ${
              subTab === 'cans'
                ? 'bg-[var(--surface-3)] text-[var(--text-primary)] shadow-sm font-semibold border border-[var(--border)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Package className="h-3.5 w-3.5" />
            <span>Ambalajlar ({canSizes.length})</span>
          </button>

          <button
            onClick={() => setSubTab('products')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-xs)] text-xs font-medium transition-all ${
              subTab === 'products'
                ? 'bg-[var(--surface-3)] text-[var(--text-primary)] shadow-sm font-semibold border border-[var(--border)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Ürünler & Bazlar ({products.length})</span>
          </button>

          <button
            onClick={() => setSubTab('cards')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-xs)] text-xs font-medium transition-all ${
              subTab === 'cards'
                ? 'bg-[var(--surface-3)] text-[var(--text-primary)] shadow-sm font-semibold border border-[var(--border)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Palette className="h-3.5 w-3.5" />
            <span>Renk Kartelaları ({cards.length})</span>
          </button>
        </div>
      </div>

      {/* Global Feedback Banner */}
      {actionMessage && (
        <div
          className={`p-3 rounded-[var(--radius)] border text-xs flex items-center justify-between shadow-sm ${
            actionMessage.type === 'success'
              ? 'bg-[var(--success-subtle)] border-[var(--success-border)] text-[var(--success-text)]'
              : 'bg-[var(--danger-subtle)] border-[var(--danger-border)] text-[var(--danger-text)]'
          }`}
        >
          <div className="flex items-center gap-2">
            {actionMessage.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 text-[var(--success-text)] shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-[var(--danger-text)] shrink-0" />
            )}
            <span>{actionMessage.text}</span>
          </div>
          <button
            onClick={() => setActionMessage(null)}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs px-2 py-0.5"
          >
            Kapat
          </button>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 1. AMBALAJ BOYUTLARI (CAN SIZES)                                      */}
      {/* ===================================================================== */}
      {subTab === 'cans' && (
        <div className="space-y-4 animate-in fade-in duration-150">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Ön Dolumlu Ambalaj Boyutları (Pre-filled Cans)</h2>
              <p className="text-xs text-[var(--text-secondary)]">
                Kutu nominal hacmi, fabrika baz dolumu ve renklendirici tepe boşluğu (headspace capacity)
              </p>
            </div>
            <button
              onClick={() => setIsAddCanOpen(true)}
              className="px-3 py-1.5 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white rounded-[var(--radius)] text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Yeni Ambalaj Boyutu</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {canSizes.map((can) => {
              const basePct = Math.round((can.default_base_fill_l / can.nominal_volume_l) * 100);
              const maxColorantPct = Math.round((can.max_colorant_volume_l / can.nominal_volume_l) * 100);
              return (
                <div
                  key={can.id}
                  className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-4 space-y-3 relative group hover:border-[var(--border-strong)] transition-all shadow-[var(--shadow-sm)]"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-[var(--radius)] bg-[var(--surface-0)] border border-[var(--border)] flex items-center justify-center text-[var(--text-primary)] font-mono font-bold text-xs">
                        {can.code}
                      </div>
                      <div>
                        <h3 className="text-xs font-semibold text-[var(--text-primary)]">{can.name}</h3>
                        <p className="text-[11px] font-mono text-[var(--text-secondary)]">
                          Nominal: {can.nominal_volume_l} Litre
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteCanSize(can.id)}
                      className="opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--danger-text)] transition-all p-1"
                      title="Ambalajı Sil"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Visual Fill Gauge */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[10px] font-mono text-[var(--text-secondary)]">
                      <span>Baz Dolum: {can.default_base_fill_l} L (%{basePct})</span>
                      <span className="text-[var(--warning-text)]">Max Renklendirici: {can.max_colorant_volume_l} L</span>
                    </div>
                    <div className="h-2.5 bg-[var(--surface-0)] rounded-full overflow-hidden flex border border-[var(--border)]">
                      <div
                        className="bg-[var(--accent)] transition-all"
                        style={{ width: `${basePct}%` }}
                        title={`Baz: ${can.default_base_fill_l} L`}
                      />
                      <div
                        className="bg-[var(--brand-clay)] transition-all"
                        style={{ width: `${maxColorantPct}%` }}
                        title={`Tepe Boşluğu: ${can.max_colorant_volume_l} L`}
                      />
                    </div>
                  </div>

                  {/* Specs & Cost */}
                  <div className="pt-2 border-t border-[var(--border)] flex items-center justify-between text-[11px] font-mono">
                    <span className="text-[var(--text-secondary)]">
                      Tepe Boşluğu: <strong className="text-[var(--text-primary)]">{(can.nominal_volume_l - can.default_base_fill_l).toFixed(2)} L</strong>
                    </span>
                    <span className="px-2 py-0.5 rounded-[var(--radius-xs)] bg-[var(--surface-0)] border border-[var(--border)] text-[var(--success-text)] font-semibold">
                      Ambalaj: ₺{can.package_cost.toFixed(2)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Add Can Modal */}
          {isAddCanOpen && (
            <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] w-full max-w-md p-6 space-y-4 shadow-2xl">
                <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                    <Package className="h-4 w-4 text-[var(--brand-clay)]" />
                    Yeni Ambalaj Boyutu Ekle
                  </h3>
                  <button
                    onClick={() => setIsAddCanOpen(false)}
                    className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs"
                  >
                    Kapat
                  </button>
                </div>

                <form onSubmit={handleCreateCanSize} className="space-y-3.5 text-xs">
                  <div>
                    <label className="block text-[var(--text-secondary)] mb-1">Ambalaj Kodu (Örn: 20L, 5L)</label>
                    <input
                      type="text"
                      required
                      value={newCanCode}
                      onChange={(e) => setNewCanCode(e.target.value.toUpperCase())}
                      placeholder="15L"
                      className="w-full px-3 py-2 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] text-[var(--text-primary)] font-mono focus:outline-none focus:ring-1 focus:ring-[var(--brand-clay)]"
                    />
                  </div>
                  <div>
                    <label className="block text-[var(--text-secondary)] mb-1">Ambalaj Tanımı</label>
                    <input
                      type="text"
                      required
                      value={newCanName}
                      onChange={(e) => setNewCanName(e.target.value)}
                      placeholder="15 Litre Standart Teneke"
                      className="w-full px-3 py-2 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-clay)]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[var(--text-secondary)] mb-1">Nominal Hacim (L)</label>
                      <input
                        type="number"
                        step="0.1"
                        required
                        value={newCanNominal}
                        onChange={(e) => setNewCanNominal(parseFloat(e.target.value) || 0)}
                        className="w-full px-3 py-2 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] text-[var(--text-primary)] font-mono focus:outline-none focus:ring-1 focus:ring-[var(--brand-clay)]"
                      />
                    </div>
                    <div>
                      <label className="block text-[var(--text-secondary)] mb-1">Ön Baz Dolumu (L)</label>
                      <input
                        type="number"
                        step="0.1"
                        required
                        value={newCanBaseFill}
                        onChange={(e) => setNewCanBaseFill(parseFloat(e.target.value) || 0)}
                        className="w-full px-3 py-2 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] text-[var(--text-primary)] font-mono focus:outline-none focus:ring-1 focus:ring-[var(--brand-clay)]"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[var(--text-secondary)] mb-1">Max Renklendirici Hacmi (L)</label>
                      <input
                        type="number"
                        step="0.05"
                        required
                        value={newCanMaxColorant}
                        onChange={(e) => setNewCanMaxColorant(parseFloat(e.target.value) || 0)}
                        className="w-full px-3 py-2 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] text-[var(--text-primary)] font-mono focus:outline-none focus:ring-1 focus:ring-[var(--brand-clay)]"
                      />
                    </div>
                    <div>
                      <label className="block text-[var(--text-secondary)] mb-1">Ambalaj Maliyeti (TL)</label>
                      <input
                        type="number"
                        step="1"
                        required
                        value={newCanCost}
                        onChange={(e) => setNewCanCost(parseFloat(e.target.value) || 0)}
                        className="w-full px-3 py-2 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] text-[var(--text-primary)] font-mono focus:outline-none focus:ring-1 focus:ring-[var(--brand-clay)]"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
                    <button
                      type="button"
                      onClick={() => setIsAddCanOpen(false)}
                      className="px-3 py-1.5 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] border border-[var(--border)] text-[var(--text-primary)] rounded-[var(--radius)] transition-colors shadow-sm"
                    >
                      Vazgeç
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white rounded-[var(--radius)] font-medium shadow-sm transition-colors"
                    >
                      Kaydet
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* 2. ÜRÜNLER VE SOYUT BAZLAR (PRODUCTS & ABSTRACT BASES)                */}
      {/* ===================================================================== */}
      {subTab === 'products' && (
        <div className="space-y-4 animate-in fade-in duration-150">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Ürün Serileri ve Soyut Bazlar (SW, W, TR)</h2>
              <p className="text-xs text-[var(--text-secondary)]">
                Örnek ürün serisi (PT.505.25), soyut baz atamaları (Süper Beyaz, Beyaz, Şeffaf) ve yoğunluklar
              </p>
            </div>
            <button
              onClick={() => setIsAddProductOpen(true)}
              className="px-3 py-1.5 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white rounded-[var(--radius)] text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Yeni Ürün Serisi Tanımla</span>
            </button>
          </div>

          <div className="space-y-4">
            {products.map((prod) => (
              <div
                key={prod.id}
                className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-5 space-y-4 shadow-[var(--shadow-sm)]"
              >
                <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
                  <div className="flex items-center gap-3">
                    <span className="px-2.5 py-1 rounded-[var(--radius-xs)] bg-[var(--accent-subtle)] border border-[var(--accent-border)] text-[var(--accent-text)] font-mono font-bold text-xs">
                      {prod.code}
                    </span>
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--text-primary)]">{prod.name}</h3>
                      <p className="text-[11px] text-[var(--text-secondary)] font-mono">
                        Tip: {prod.product_type} • VOC Sınırı: {prod.voc_limit} g/L
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (window.confirm(`${prod.code} ürününü silmek istediğinize emin misiniz?`)) {
                        deleteProduct(prod.id).then(() => loadAll());
                      }
                    }}
                    className="text-[var(--text-muted)] hover:text-[var(--danger-text)] text-xs flex items-center gap-1 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Sil</span>
                  </button>
                </div>

                {/* Abstract Bases Table */}
                <div className="space-y-2">
                  <span className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider font-mono">
                    Soyut Baz Matrisi (Abstract Bases)
                  </span>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {prod.bases.map((b) => (
                      <div
                        key={b.id}
                        className="bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="px-2 py-0.5 rounded-[var(--radius-xs)] bg-[var(--surface-1)] text-[var(--text-primary)] font-mono font-bold text-[11px] border border-[var(--border)]">
                            {b.abstract_base_code}
                          </span>
                          <span
                            className="w-3.5 h-3.5 rounded-full border border-[var(--border-strong)]"
                            style={{ backgroundColor: b.base_hex }}
                          />
                        </div>
                        <div>
                          <p className="text-xs font-medium text-[var(--text-primary)] truncate">{b.base_name}</p>
                          <p className="text-[10px] font-mono text-[var(--text-secondary)]">Kod: {b.base_code}</p>
                        </div>
                        <div className="pt-2 border-t border-[var(--border)] flex justify-between text-[10px] font-mono text-[var(--text-secondary)]">
                          <span>SG: {b.specific_gravity} g/cm³</span>
                          <span className="text-[var(--success-text)] font-semibold">₺{b.cost_per_liter}/L</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Add Product Modal */}
          {isAddProductOpen && (
            <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] w-full max-w-md p-6 space-y-4 shadow-2xl">
                <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                    <Layers className="h-4 w-4 text-[var(--brand-clay)]" />
                    Yeni Ürün & Soyut Baz Tanımla
                  </h3>
                  <button onClick={() => setIsAddProductOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs">
                    Kapat
                  </button>
                </div>
                <form onSubmit={handleCreateProduct} className="space-y-3.5 text-xs">
                  <div>
                    <label className="block text-[var(--text-secondary)] mb-1">Ürün Kodu (Örn: PT.505.25)</label>
                    <input
                      type="text"
                      required
                      value={newProdCode}
                      onChange={(e) => setNewProdCode(e.target.value.toUpperCase())}
                      placeholder="PT.505.25"
                      className="w-full px-3 py-2 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] text-[var(--text-primary)] font-mono focus:outline-none focus:ring-1 focus:ring-[var(--brand-clay)]"
                    />
                  </div>
                  <div>
                    <label className="block text-[var(--text-secondary)] mb-1">Ürün Serisi Adı</label>
                    <input
                      type="text"
                      required
                      value={newProdName}
                      onChange={(e) => setNewProdName(e.target.value)}
                      placeholder="Süper Mat İç Cephe Boyası"
                      className="w-full px-3 py-2 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-clay)]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[var(--text-secondary)] mb-1">Ürün Tipi</label>
                      <select
                        value={newProdType}
                        onChange={(e) => setNewProdType(e.target.value)}
                        className="w-full px-3 py-2 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-clay)]"
                      >
                        <option value="interior_matte">İç Cephe Mat</option>
                        <option value="exterior_acrylic">Dış Cephe Akrilik</option>
                        <option value="epoxy_floor">Epoksi Zemin</option>
                        <option value="wood_varnish">Ahşap Verniği</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[var(--text-secondary)] mb-1">VOC Limiti (g/L)</label>
                      <input
                        type="number"
                        value={newProdVoc}
                        onChange={(e) => setNewProdVoc(parseFloat(e.target.value) || 0)}
                        className="w-full px-3 py-2 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] text-[var(--text-primary)] font-mono focus:outline-none focus:ring-1 focus:ring-[var(--brand-clay)]"
                      />
                    </div>
                  </div>

                  {/* Abstract Base mapping */}
                  <div className="p-3 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] space-y-2">
                    <span className="block text-[11px] font-semibold text-[var(--text-primary)] font-mono">
                      Soyut Baz Eşleştirmeleri:
                    </span>
                    <div>
                      <label className="block text-[10px] text-[var(--text-secondary)] mb-0.5">SW (Süper Beyaz / Super White)</label>
                      <select
                        value={selectedSwBase}
                        onChange={(e) => setSelectedSwBase(parseInt(e.target.value))}
                        className="w-full px-2 py-1.5 bg-[var(--surface-1)] border border-[var(--border)] rounded-[var(--radius-xs)] text-xs text-[var(--text-primary)]"
                      >
                        {bases.map((b) => (
                          <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-[var(--text-secondary)] mb-0.5">W (Beyaz / Standart White)</label>
                      <select
                        value={selectedWBase}
                        onChange={(e) => setSelectedWBase(parseInt(e.target.value))}
                        className="w-full px-2 py-1.5 bg-[var(--surface-1)] border border-[var(--border)] rounded-[var(--radius-xs)] text-xs text-[var(--text-primary)]"
                      >
                        {bases.map((b) => (
                          <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-[var(--text-secondary)] mb-0.5">TR (Şeffaf / Transparent Clear)</label>
                      <select
                        value={selectedTrBase}
                        onChange={(e) => setSelectedTrBase(parseInt(e.target.value))}
                        className="w-full px-2 py-1.5 bg-[var(--surface-1)] border border-[var(--border)] rounded-[var(--radius-xs)] text-xs text-[var(--text-primary)]"
                      >
                        {bases.map((b) => (
                          <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
                    <button
                      type="button"
                      onClick={() => setIsAddProductOpen(false)}
                      className="px-3 py-1.5 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] border border-[var(--border)] text-[var(--text-primary)] rounded-[var(--radius)] transition-colors shadow-sm"
                    >
                      Vazgeç
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white rounded-[var(--radius)] font-medium shadow-sm transition-colors"
                    >
                      Kaydet
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* 3. RENK KARTELALARI VE TOPLU EŞLEME (COLOR CARDS & BATCH MATCH)       */}
      {/* ===================================================================== */}
      {subTab === 'cards' && (
        <div className="space-y-4 animate-in fade-in duration-150">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Renk Kartelası Kütüphanesi</h2>
              <p className="text-xs text-[var(--text-secondary)]">
                Endüstriyel renk kartelaları (RAL Classic vb.), standart spektrumlar ve toplu reçete eşleme
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleRunBatchMatch}
                disabled={isBatchMatching || cardColors.length === 0}
                className="px-3.5 py-1.5 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] disabled:opacity-50 text-white rounded-[var(--radius)] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
              >
                {isBatchMatching ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Kartela Eşleniyor...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Tüm Kartelayı Toplu Eşle (Batch Match)</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Cards Selector & Filter */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Left: Cards List & Search (4 Cols) */}
            <div className="lg:col-span-4 space-y-3">
              <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-4 space-y-3 shadow-[var(--shadow-sm)]">
                <span className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider font-mono">
                  Mevcut Kartelalar
                </span>
                <div className="space-y-1.5">
                  {cards.map((card) => (
                    <div
                      key={card.id}
                      onClick={() => setSelectedCardId(card.id)}
                      className={`p-3 rounded-[var(--radius)] border transition-all cursor-pointer ${
                        selectedCardId === card.id
                          ? 'bg-[var(--surface-1)] border-[var(--brand-clay)] ring-1 ring-[var(--brand-clay)] shadow-sm'
                          : 'bg-[var(--surface-0)] border border-[var(--border)] hover:bg-[var(--surface-1)]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-[var(--text-primary)]">{card.name}</span>
                        <span className="px-2 py-0.5 rounded-[var(--radius-xs)] bg-[var(--surface-0)] border border-[var(--border)] text-[10px] font-mono text-[var(--accent-text)] font-semibold">
                          {card.color_count} Renk
                        </span>
                      </div>
                      <p className="text-[10px] text-[var(--text-secondary)] font-mono mt-1">{card.code}</p>
                    </div>
                  ))}
                </div>

                <div className="pt-2 border-t border-[var(--border)] relative">
                  <Search className="h-3.5 w-3.5 absolute left-2.5 top-5 text-[var(--text-muted)]" />
                  <input
                    type="text"
                    placeholder="Kartela içinde renk ara..."
                    value={cardSearch}
                    onChange={(e) => setCardSearch(e.target.value)}
                    className="w-full pl-8 pr-2.5 py-1.5 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-clay)]"
                  />
                </div>
              </div>
            </div>

            {/* Right: Colors Grid & Detail (8 Cols) */}
            <div className="lg:col-span-8 space-y-4">
              <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-4 space-y-3 shadow-[var(--shadow-sm)]">
                <div className="flex items-center justify-between pb-2 border-b border-[var(--border)]">
                  <span className="text-xs font-semibold text-[var(--text-primary)]">
                    Kartela Renkleri ({filteredCardColors.length})
                  </span>
                  {selectedColor && (
                    <span className="text-[11px] font-mono text-[var(--text-secondary)]">
                      Seçili: <strong className="text-[var(--text-primary)]">{selectedColor.color_code}</strong>
                    </span>
                  )}
                </div>

                {/* Swatches Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 max-h-[360px] overflow-y-auto pr-1">
                  {filteredCardColors.map((col) => {
                    const isSelected = selectedColor?.id === col.id;
                    return (
                      <div
                        key={col.id}
                        onClick={() => setSelectedColor(col)}
                        className={`p-2 rounded-[var(--radius)] border transition-all cursor-pointer flex flex-col items-center text-center space-y-1.5 ${
                          isSelected
                            ? 'bg-[var(--surface-1)] border-[var(--brand-clay)] shadow-md ring-1 ring-[var(--brand-clay)]'
                            : 'bg-[var(--surface-0)] border border-[var(--border)] hover:border-[var(--border-strong)]'
                        }`}
                      >
                        <div
                          className="w-full h-12 rounded-[var(--radius-xs)] border border-[var(--border-strong)] shadow-inner"
                          style={{ backgroundColor: col.hex }}
                        />
                        <span className="text-[11px] font-bold text-[var(--text-primary)] font-mono truncate w-full">
                          {col.color_code}
                        </span>
                        <span className="text-[9px] text-[var(--text-secondary)] truncate w-full">
                          {col.color_name}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Selected Color Inspector & Action */}
                {selectedColor && (
                  <div className="pt-3 border-t border-[var(--border)] flex flex-col sm:flex-row items-center justify-between gap-3 bg-[var(--surface-0)] p-3 rounded-[var(--radius)] border border-[var(--border)]">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-[var(--radius)] border border-[var(--border-strong)] shadow"
                        style={{ backgroundColor: selectedColor.hex }}
                      />
                      <div>
                        <h4 className="text-xs font-bold text-[var(--text-primary)]">
                          {selectedColor.color_code} — {selectedColor.color_name}
                        </h4>
                        <p className="text-[11px] font-mono text-[var(--text-secondary)]">
                          L*: {selectedColor.lab.L} • a*: {selectedColor.lab.a} • b*: {selectedColor.lab.b} • Hex: {selectedColor.hex}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        if (onNavigateToFormulationWithTarget) {
                          onNavigateToFormulationWithTarget(selectedColor.reflectance, selectedColor.color_code);
                        }
                      }}
                      className="px-3.5 py-1.5 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white rounded-[var(--radius)] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 shadow-sm"
                    >
                      <span>CCM Reçete Motoruna Gönder</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* Batch Match Results Report */}
              {batchMatchResult && (
                <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-4 space-y-3 animate-in fade-in duration-200 shadow-[var(--shadow-sm)]">
                  <div className="flex items-center justify-between pb-2 border-b border-[var(--border)]">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-[var(--success-text)]" />
                      <h4 className="text-xs font-bold text-[var(--text-primary)]">
                        Toplu Eşleme Raporu ({batchMatchResult.card.name})
                      </h4>
                    </div>
                    <span className="px-2 py-0.5 rounded-[var(--radius-xs)] bg-[var(--success-subtle)] border border-[var(--success-border)] text-[var(--success-text)] font-mono text-xs font-bold">
                      %{batchMatchResult.success_rate_pct} Başarı ({batchMatchResult.passed_colors}/{batchMatchResult.total_colors})
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 max-h-[220px] overflow-y-auto pr-1 text-xs">
                    {batchMatchResult.results.map((r) => (
                      <div
                        key={r.color_id}
                        className={`p-2 rounded-[var(--radius)] border flex flex-col justify-between ${
                          r.passed
                            ? 'bg-[var(--surface-0)] border-[var(--success-border)] text-[var(--success-text)]'
                            : 'bg-[var(--surface-0)] border-[var(--warning-border)] text-[var(--warning-text)]'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-[11px] text-[var(--text-primary)]">{r.color_code}</span>
                          <span
                            className="w-3 h-3 rounded-full border border-[var(--border-strong)]"
                            style={{ backgroundColor: r.hex }}
                          />
                        </div>
                        <div className="mt-1 flex items-center justify-between font-mono text-[10px]">
                          <span className="text-[var(--text-secondary)]">ΔE00:</span>
                          <strong className={r.passed ? 'text-[var(--success-text)]' : 'text-[var(--warning-text)]'}>
                            {r.delta_e00 !== null ? r.delta_e00.toFixed(2) : 'N/A'}
                          </strong>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
