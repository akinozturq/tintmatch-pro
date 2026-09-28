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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-zinc-100">
              Endüstriyel Yapılandırma ve İş Akışı
            </h1>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-blue-950 border border-blue-800 text-blue-300">
              Innovatint Mimarisi
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Ambalaj kutu boyutları, ürün serileri & soyut bazlar (SW, W, TR) ve renk kartelası kütüphanesi
          </p>
        </div>

        {/* Sub-tab Navigation */}
        <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 p-1 rounded-xl">
          <button
            onClick={() => setSubTab('cans')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              subTab === 'cans'
                ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Package className="h-3.5 w-3.5" />
            <span>Ambalajlar ({canSizes.length})</span>
          </button>

          <button
            onClick={() => setSubTab('products')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              subTab === 'products'
                ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Ürünler & Bazlar ({products.length})</span>
          </button>

          <button
            onClick={() => setSubTab('cards')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              subTab === 'cards'
                ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
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
          className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
            actionMessage.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-300'
              : 'bg-red-950/40 border-red-800/80 text-red-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {actionMessage.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
            )}
            <span>{actionMessage.text}</span>
          </div>
          <button
            onClick={() => setActionMessage(null)}
            className="text-zinc-400 hover:text-zinc-200 text-xs px-2 py-0.5"
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
              <h2 className="text-sm font-semibold text-zinc-200">Ön Dolumlu Ambalaj Boyutları (Pre-filled Cans)</h2>
              <p className="text-xs text-zinc-400">
                Kutu nominal hacmi, fabrika baz dolumu ve renklendirici tepe boşluğu (headspace capacity)
              </p>
            </div>
            <button
              onClick={() => setIsAddCanOpen(true)}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
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
                  className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4 space-y-3 relative group hover:border-zinc-700 transition-all"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 font-mono font-bold text-xs">
                        {can.code}
                      </div>
                      <div>
                        <h3 className="text-xs font-semibold text-zinc-100">{can.name}</h3>
                        <p className="text-[11px] font-mono text-zinc-400">
                          Nominal: {can.nominal_volume_l} Litre
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteCanSize(can.id)}
                      className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 transition-all p-1"
                      title="Ambalajı Sil"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Visual Fill Gauge */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[10px] font-mono text-zinc-400">
                      <span>Baz Dolum: {can.default_base_fill_l} L (%{basePct})</span>
                      <span className="text-amber-400">Max Renklendirici: {can.max_colorant_volume_l} L</span>
                    </div>
                    <div className="h-2.5 bg-zinc-950 rounded-full overflow-hidden flex border border-zinc-800">
                      <div
                        className="bg-blue-600 transition-all"
                        style={{ width: `${basePct}%` }}
                        title={`Baz: ${can.default_base_fill_l} L`}
                      />
                      <div
                        className="bg-amber-500 transition-all"
                        style={{ width: `${maxColorantPct}%` }}
                        title={`Tepe Boşluğu: ${can.max_colorant_volume_l} L`}
                      />
                    </div>
                  </div>

                  {/* Specs & Cost */}
                  <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between text-[11px] font-mono">
                    <span className="text-zinc-400">
                      Tepe Boşluğu: <strong className="text-zinc-200">{(can.nominal_volume_l - can.default_base_fill_l).toFixed(2)} L</strong>
                    </span>
                    <span className="px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-emerald-400">
                      Ambalaj: ₺{can.package_cost.toFixed(2)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Add Can Modal */}
          {isAddCanOpen && (
            <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                  <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                    <Package className="h-4 w-4 text-blue-400" />
                    Yeni Ambalaj Boyutu Ekle
                  </h3>
                  <button
                    onClick={() => setIsAddCanOpen(false)}
                    className="text-zinc-400 hover:text-zinc-200 text-xs"
                  >
                    Kapat
                  </button>
                </div>

                <form onSubmit={handleCreateCanSize} className="space-y-3.5 text-xs">
                  <div>
                    <label className="block text-zinc-300 mb-1">Ambalaj Kodu (Örn: 20L, 5L)</label>
                    <input
                      type="text"
                      required
                      value={newCanCode}
                      onChange={(e) => setNewCanCode(e.target.value.toUpperCase())}
                      placeholder="15L"
                      className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-zinc-300 mb-1">Ambalaj Tanımı</label>
                    <input
                      type="text"
                      required
                      value={newCanName}
                      onChange={(e) => setNewCanName(e.target.value)}
                      placeholder="15 Litre Standart Teneke"
                      className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-zinc-300 mb-1">Nominal Hacim (L)</label>
                      <input
                        type="number"
                        step="0.1"
                        required
                        value={newCanNominal}
                        onChange={(e) => setNewCanNominal(parseFloat(e.target.value) || 0)}
                        className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-zinc-300 mb-1">Ön Baz Dolumu (L)</label>
                      <input
                        type="number"
                        step="0.1"
                        required
                        value={newCanBaseFill}
                        onChange={(e) => setNewCanBaseFill(parseFloat(e.target.value) || 0)}
                        className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200 font-mono"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-zinc-300 mb-1">Max Renklendirici Hacmi (L)</label>
                      <input
                        type="number"
                        step="0.05"
                        required
                        value={newCanMaxColorant}
                        onChange={(e) => setNewCanMaxColorant(parseFloat(e.target.value) || 0)}
                        className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-zinc-300 mb-1">Ambalaj Maliyeti (TL)</label>
                      <input
                        type="number"
                        step="1"
                        required
                        value={newCanCost}
                        onChange={(e) => setNewCanCost(parseFloat(e.target.value) || 0)}
                        className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200 font-mono"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
                    <button
                      type="button"
                      onClick={() => setIsAddCanOpen(false)}
                      className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg"
                    >
                      Vazgeç
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium"
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
              <h2 className="text-sm font-semibold text-zinc-200">Ürün Serileri ve Soyut Bazlar (SW, W, TR)</h2>
              <p className="text-xs text-zinc-400">
                Örnek ürün serisi (PT.505.25), soyut baz atamaları (Süper Beyaz, Beyaz, Şeffaf) ve yoğunluklar
              </p>
            </div>
            <button
              onClick={() => setIsAddProductOpen(true)}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Yeni Ürün Serisi Tanımla</span>
            </button>
          </div>

          <div className="space-y-4">
            {products.map((prod) => (
              <div
                key={prod.id}
                className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-5 space-y-4"
              >
                <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
                  <div className="flex items-center gap-3">
                    <span className="px-2.5 py-1 rounded bg-blue-950 border border-blue-800 text-blue-300 font-mono font-bold text-xs">
                      {prod.code}
                    </span>
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-100">{prod.name}</h3>
                      <p className="text-[11px] text-zinc-400 font-mono">
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
                    className="text-zinc-500 hover:text-red-400 text-xs flex items-center gap-1 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Sil</span>
                  </button>
                </div>

                {/* Abstract Bases Table */}
                <div className="space-y-2">
                  <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider font-mono">
                    Soyut Baz Matrisi (Abstract Bases)
                  </span>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {prod.bases.map((b) => (
                      <div
                        key={b.id}
                        className="bg-zinc-950/70 border border-zinc-800/80 rounded-lg p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-200 font-mono font-bold text-[11px]">
                            {b.abstract_base_code}
                          </span>
                          <span
                            className="w-3.5 h-3.5 rounded-full border border-zinc-700"
                            style={{ backgroundColor: b.base_hex }}
                          />
                        </div>
                        <div>
                          <p className="text-xs font-medium text-zinc-200 truncate">{b.base_name}</p>
                          <p className="text-[10px] font-mono text-zinc-400">Kod: {b.base_code}</p>
                        </div>
                        <div className="pt-2 border-t border-zinc-800 flex justify-between text-[10px] font-mono text-zinc-400">
                          <span>SG: {b.specific_gravity} g/cm³</span>
                          <span className="text-emerald-400">₺{b.cost_per_liter}/L</span>
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
            <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                  <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                    <Layers className="h-4 w-4 text-blue-400" />
                    Yeni Ürün & Soyut Baz Tanımla
                  </h3>
                  <button onClick={() => setIsAddProductOpen(false)} className="text-zinc-400 text-xs">
                    Kapat
                  </button>
                </div>
                <form onSubmit={handleCreateProduct} className="space-y-3.5 text-xs">
                  <div>
                    <label className="block text-zinc-300 mb-1">Ürün Kodu (Örn: PT.505.25)</label>
                    <input
                      type="text"
                      required
                      value={newProdCode}
                      onChange={(e) => setNewProdCode(e.target.value.toUpperCase())}
                      placeholder="PT.505.25"
                      className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-zinc-300 mb-1">Ürün Serisi Adı</label>
                    <input
                      type="text"
                      required
                      value={newProdName}
                      onChange={(e) => setNewProdName(e.target.value)}
                      placeholder="Süper Mat İç Cephe Boyası"
                      className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-zinc-300 mb-1">Ürün Tipi</label>
                      <select
                        value={newProdType}
                        onChange={(e) => setNewProdType(e.target.value)}
                        className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200"
                      >
                        <option value="interior_matte">İç Cephe Mat</option>
                        <option value="exterior_acrylic">Dış Cephe Akrilik</option>
                        <option value="epoxy_floor">Epoksi Zemin</option>
                        <option value="wood_varnish">Ahşap Verniği</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-zinc-300 mb-1">VOC Limiti (g/L)</label>
                      <input
                        type="number"
                        value={newProdVoc}
                        onChange={(e) => setNewProdVoc(parseFloat(e.target.value) || 0)}
                        className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200 font-mono"
                      />
                    </div>
                  </div>

                  {/* Abstract Base mapping */}
                  <div className="p-3 bg-zinc-950/70 border border-zinc-800 rounded-xl space-y-2">
                    <span className="block text-[11px] font-semibold text-zinc-300 font-mono">
                      Soyut Baz Eşleştirmeleri:
                    </span>
                    <div>
                      <label className="block text-[10px] text-zinc-400 mb-0.5">SW (Süper Beyaz / Super White)</label>
                      <select
                        value={selectedSwBase}
                        onChange={(e) => setSelectedSwBase(parseInt(e.target.value))}
                        className="w-full px-2 py-1.5 bg-zinc-900 border border-zinc-800 rounded text-xs text-zinc-200"
                      >
                        {bases.map((b) => (
                          <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-zinc-400 mb-0.5">W (Beyaz / Standart White)</label>
                      <select
                        value={selectedWBase}
                        onChange={(e) => setSelectedWBase(parseInt(e.target.value))}
                        className="w-full px-2 py-1.5 bg-zinc-900 border border-zinc-800 rounded text-xs text-zinc-200"
                      >
                        {bases.map((b) => (
                          <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-zinc-400 mb-0.5">TR (Şeffaf / Transparent Clear)</label>
                      <select
                        value={selectedTrBase}
                        onChange={(e) => setSelectedTrBase(parseInt(e.target.value))}
                        className="w-full px-2 py-1.5 bg-zinc-900 border border-zinc-800 rounded text-xs text-zinc-200"
                      >
                        {bases.map((b) => (
                          <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
                    <button
                      type="button"
                      onClick={() => setIsAddProductOpen(false)}
                      className="px-3 py-1.5 bg-zinc-800 text-zinc-300 rounded-lg"
                    >
                      Vazgeç
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 bg-blue-600 text-white rounded-lg font-medium"
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
              <h2 className="text-sm font-semibold text-zinc-200">Renk Kartelası Kütüphanesi</h2>
              <p className="text-xs text-zinc-400">
                Endüstriyel renk kartelaları (RAL Classic vb.), standart spektrumlar ve toplu reçete eşleme
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleRunBatchMatch}
                disabled={isBatchMatching || cardColors.length === 0}
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
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
              <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4 space-y-3">
                <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider font-mono">
                  Mevcut Kartelalar
                </span>
                <div className="space-y-1.5">
                  {cards.map((card) => (
                    <div
                      key={card.id}
                      onClick={() => setSelectedCardId(card.id)}
                      className={`p-3 rounded-lg border transition-all cursor-pointer ${
                        selectedCardId === card.id
                          ? 'bg-zinc-800 border-zinc-600'
                          : 'bg-zinc-950/40 border-zinc-800 hover:bg-zinc-800/40'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-zinc-200">{card.name}</span>
                        <span className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[10px] font-mono text-blue-400">
                          {card.color_count} Renk
                        </span>
                      </div>
                      <p className="text-[10px] text-zinc-400 font-mono mt-1">{card.code}</p>
                    </div>
                  ))}
                </div>

                <div className="pt-2 border-t border-zinc-800 relative">
                  <Search className="h-3.5 w-3.5 absolute left-2.5 top-5 text-zinc-500" />
                  <input
                    type="text"
                    placeholder="Kartela içinde renk ara..."
                    value={cardSearch}
                    onChange={(e) => setCardSearch(e.target.value)}
                    className="w-full pl-8 pr-2.5 py-1.5 bg-zinc-950 border border-zinc-800 rounded-md text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Right: Colors Grid & Detail (8 Cols) */}
            <div className="lg:col-span-8 space-y-4">
              <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                  <span className="text-xs font-semibold text-zinc-200">
                    Kartela Renkleri ({filteredCardColors.length})
                  </span>
                  {selectedColor && (
                    <span className="text-[11px] font-mono text-zinc-400">
                      Seçili: <strong className="text-zinc-200">{selectedColor.color_code}</strong>
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
                        className={`p-2 rounded-lg border transition-all cursor-pointer flex flex-col items-center text-center space-y-1.5 ${
                          isSelected
                            ? 'bg-zinc-800 border-blue-500 shadow-md ring-1 ring-blue-500'
                            : 'bg-zinc-950/60 border-zinc-800/80 hover:border-zinc-700'
                        }`}
                      >
                        <div
                          className="w-full h-12 rounded-md border border-zinc-700 shadow-inner"
                          style={{ backgroundColor: col.hex }}
                        />
                        <span className="text-[11px] font-bold text-zinc-200 font-mono truncate w-full">
                          {col.color_code}
                        </span>
                        <span className="text-[9px] text-zinc-400 truncate w-full">
                          {col.color_name}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Selected Color Inspector & Action */}
                {selectedColor && (
                  <div className="pt-3 border-t border-zinc-800 flex flex-col sm:flex-row items-center justify-between gap-3 bg-zinc-950/40 p-3 rounded-xl border border-zinc-800/60">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-lg border border-zinc-700 shadow"
                        style={{ backgroundColor: selectedColor.hex }}
                      />
                      <div>
                        <h4 className="text-xs font-bold text-zinc-100">
                          {selectedColor.color_code} — {selectedColor.color_name}
                        </h4>
                        <p className="text-[11px] font-mono text-zinc-400">
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
                      className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 shadow-sm"
                    >
                      <span>CCM Reçete Motoruna Gönder</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* Batch Match Results Report */}
              {batchMatchResult && (
                <div className="bg-zinc-900/90 border border-emerald-800/80 rounded-xl p-4 space-y-3 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-emerald-400" />
                      <h4 className="text-xs font-bold text-zinc-100">
                        Toplu Eşleme Raporu ({batchMatchResult.card.name})
                      </h4>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-emerald-950 border border-emerald-800 text-emerald-300 font-mono text-xs font-bold">
                      %{batchMatchResult.success_rate_pct} Başarı ({batchMatchResult.passed_colors}/{batchMatchResult.total_colors})
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 max-h-[220px] overflow-y-auto pr-1 text-xs">
                    {batchMatchResult.results.map((r) => (
                      <div
                        key={r.color_id}
                        className={`p-2 rounded-lg border flex flex-col justify-between ${
                          r.passed
                            ? 'bg-zinc-950 border-emerald-900/60 text-emerald-200'
                            : 'bg-zinc-950 border-amber-900/60 text-amber-200'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-[11px]">{r.color_code}</span>
                          <span
                            className="w-3 h-3 rounded-full border border-zinc-700"
                            style={{ backgroundColor: r.hex }}
                          />
                        </div>
                        <div className="mt-1 flex items-center justify-between font-mono text-[10px]">
                          <span>ΔE00:</span>
                          <strong className={r.passed ? 'text-emerald-400' : 'text-amber-400'}>
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
