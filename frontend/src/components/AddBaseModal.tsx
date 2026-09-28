import React, { useState } from 'react';
import {
  X,
  Plus,
  Zap,
  Check,
  AlertCircle,
  Layers,
  Activity,
  Save,
  RefreshCw,
  Sparkles
} from 'lucide-react';
import { createBase, measureChnspec, measureRm400, getChnspecStatus } from '../services/api';

interface AddBaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const AddBaseModal: React.FC<AddBaseModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [baseType, setBaseType] = useState<'white_a' | 'medium_b' | 'deep_c' | 'transparent_d'>('white_a');
  const [density, setDensity] = useState<number>(1.45);
  const [thickness, setThickness] = useState<number>(100.0);
  const [k1, setK1] = useState<number>(0.04);
  const [k2, setK2] = useState<number>(0.60);
  const [reflectance, setReflectance] = useState<number[] | null>(null);

  const [isMeasuring, setIsMeasuring] = useState(false);
  const [measureError, setMeasureError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (!isOpen) return null;

  // Pre-fill standard templates
  const applyTemplate = (type: 'white_a' | 'medium_b' | 'deep_c' | 'transparent_d') => {
    setBaseType(type);
    if (type === 'white_a') {
      setDensity(1.45);
      setName('Yeni Opak Beyaz Baz');
      setCode('BASE-A-NEW');
      setReflectance([
        0.832, 0.854, 0.871, 0.882, 0.888, 0.892,
        0.895, 0.897, 0.898, 0.899, 0.898, 0.897,
        0.896, 0.894, 0.893, 0.891, 0.890, 0.889,
        0.887, 0.885, 0.884, 0.882, 0.880, 0.879,
        0.877, 0.875, 0.874, 0.872, 0.870, 0.868, 0.865
      ]);
    } else if (type === 'medium_b') {
      setDensity(1.38);
      setName('Yeni Yarı-Opak Orta Baz');
      setCode('BASE-B-NEW');
      setReflectance([
        0.650, 0.680, 0.710, 0.730, 0.745, 0.755,
        0.760, 0.765, 0.768, 0.770, 0.770, 0.768,
        0.765, 0.760, 0.755, 0.750, 0.745, 0.740,
        0.735, 0.730, 0.725, 0.720, 0.715, 0.710,
        0.705, 0.700, 0.695, 0.690, 0.685, 0.680, 0.675
      ]);
    } else if (type === 'deep_c') {
      setDensity(1.25);
      setName('Yeni Derin Baz');
      setCode('BASE-C-NEW');
      setReflectance([
        0.280, 0.310, 0.340, 0.360, 0.375, 0.385,
        0.390, 0.395, 0.398, 0.400, 0.400, 0.398,
        0.395, 0.390, 0.385, 0.380, 0.375, 0.370,
        0.365, 0.360, 0.355, 0.350, 0.345, 0.340,
        0.335, 0.330, 0.325, 0.320, 0.315, 0.310, 0.305
      ]);
    } else {
      setDensity(1.05);
      setName('Yeni Şeffaf / Vernik Bazı');
      setCode('BASE-D-NEW');
      setReflectance([
        0.050, 0.055, 0.060, 0.062, 0.064, 0.065,
        0.066, 0.067, 0.068, 0.068, 0.068, 0.067,
        0.066, 0.065, 0.064, 0.063, 0.062, 0.061,
        0.060, 0.059, 0.058, 0.057, 0.056, 0.055,
        0.054, 0.053, 0.052, 0.051, 0.050, 0.049, 0.048
      ]);
    }
  };

  // Live measurement from connected spectro
  const handleMeasureFromDevice = async () => {
    setIsMeasuring(true);
    setMeasureError(null);
    try {
      // Check CHNSpec status first
      const status = await getChnspecStatus().catch(() => null);
      if (status && status.connected) {
        const res = await measureChnspec('SCI', name || 'Yeni Baz Olcumu');
        if (res && res.reflectance && res.reflectance.length === 31) {
          setReflectance(res.reflectance);
          return;
        }
      }

      // Fallback: try RM400
      const rmRes = await measureRm400(name || 'Yeni Baz Olcumu');
      if (rmRes && rmRes.reflectance && rmRes.reflectance.length === 31) {
        setReflectance(rmRes.reflectance);
        return;
      }

      throw new Error('Cihazdan spektral okuma alınamadı. Spektrofotometrenin açık, bağlı ve kalibre olduğundan emin olun.');
    } catch (err: any) {
      setMeasureError(err.message || 'Ölçüm sırasında hata oluştu.');
    } finally {
      setIsMeasuring(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setSubmitError('Lütfen baz boya adı girin.');
      return;
    }
    if (!code.trim()) {
      setSubmitError('Lütfen baz kodu girin.');
      return;
    }
    if (!reflectance || reflectance.length !== 31) {
      setSubmitError('Lütfen 31 kanallı spektral yansıma ölçümü alın veya hazır şablon uygulayın.');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      await createBase({
        name: name.trim(),
        code: code.trim().toUpperCase(),
        base_type: baseType,
        density,
        reflectance,
        k1,
        k2,
        thickness
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      setSubmitError(err.message || 'Baz kaydedilirken sunucu hatası oluştu.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-950/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Layers className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Yeni Taşıyıcı Baz Boya Tanımla</h2>
              <p className="text-[11px] text-zinc-400">Kubelka-Munk ve Saunderson modelleri için baz parametreleri</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[80vh] overflow-y-auto font-sans">
          {submitError && (
            <div className="p-3 bg-red-950/40 border border-red-800/80 rounded-xl text-xs text-red-300 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          {/* Baz Adı & Kodu */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Baz Boya Adı <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                placeholder="Örn: Süper Beyaz Opak Baz"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500 transition-colors"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Baz Kodu <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                placeholder="Örn: BASE-A-WHITE"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 placeholder-zinc-500 font-mono focus:outline-none focus:border-blue-500 transition-colors"
                required
              />
            </div>
          </div>

          {/* Baz Tipi ve Yoğunluk */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Baz Sınıfı (Kubelka-Munk Tipi)
              </label>
              <select
                value={baseType}
                onChange={(e) => applyTemplate(e.target.value as any)}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-blue-500 transition-colors"
              >
                <option value="white_a">Base A (Opak Beyaz - Yüksek TiO2, S=1.0)</option>
                <option value="medium_b">Base B (Orta / Yarı-Opak - S=0.65)</option>
                <option value="deep_c">Base C (Derin Baz - S=0.25)</option>
                <option value="transparent_d">Base D (Şeffaf / Vernik Bazı - S=0.005)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Yoğunluk (g/cm³)
              </label>
              <input
                type="number"
                step="0.01"
                min="0.80"
                max="2.50"
                value={density}
                onChange={(e) => setDensity(parseFloat(e.target.value) || 1.45)}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-blue-500 transition-colors font-mono"
              />
            </div>
          </div>

          {/* Spektral Yansıma Ölçümü (31 Nokta) */}
          <div className="p-4 bg-zinc-950/70 border border-zinc-800/90 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                  <Activity className="h-3.5 w-3.5 text-blue-400" />
                  Spektral Yansıma Eğrisi ($R_\lambda$ 400-700 nm @ 10 nm)
                </span>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Bağlı spektrofotometre ile baz çekimini ölçün veya tipik referans şablonu uygulayın.
                </p>
              </div>
              {reflectance ? (
                <span className="px-2 py-0.5 rounded bg-emerald-950 border border-emerald-800 text-emerald-400 font-mono text-[10px] flex items-center gap-1">
                  <Check className="h-3 w-3" />
                  31 Kanal Hazır
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded bg-amber-950/50 border border-amber-800/60 text-amber-400 font-mono text-[10px]">
                  Ölçüm Bekleniyor
                </span>
              )}
            </div>

            {measureError && (
              <div className="p-2.5 bg-red-950/30 border border-red-900/60 rounded-lg text-[11px] text-red-300 flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                <span>{measureError}</span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleMeasureFromDevice}
                disabled={isMeasuring}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
              >
                {isMeasuring ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Cihazdan Okunuyor...</span>
                  </>
                ) : (
                  <>
                    <Zap className="h-3.5 w-3.5" />
                    <span>Spektrofotometreden Canlı Oku</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => applyTemplate(baseType)}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                <span>Şablon Eğri Doldur</span>
              </button>
            </div>

            {/* Spektrum Önizleme (Mini bar chart) */}
            {reflectance && reflectance.length === 31 && (
              <div className="mt-3 pt-3 border-t border-zinc-800/80">
                <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400 mb-1.5">
                  <span>Ort. Yansıma: %{(reflectance.reduce((a, b) => a + b, 0) / 31 * 100).toFixed(1)}</span>
                  <span>400 nm → 700 nm</span>
                </div>
                <div className="h-10 flex items-end gap-1 bg-zinc-900 p-1.5 rounded-lg border border-zinc-800">
                  {reflectance.map((val, idx) => (
                    <div
                      key={idx}
                      className="flex-1 bg-blue-500/80 hover:bg-blue-400 rounded-t transition-all"
                      style={{ height: `${Math.min(100, Math.max(5, val * 100))}%` }}
                      title={`${400 + idx * 10} nm: %${(val * 100).toFixed(1)}`}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Saunderson ve Film Kalınlığı Ayarları (Gelişmiş) */}
          <div className="grid grid-cols-3 gap-3 p-3 bg-zinc-950/40 border border-zinc-800/60 rounded-xl text-xs">
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">Saunderson k1 (Dış)</label>
              <input
                type="number"
                step="0.005"
                value={k1}
                onChange={(e) => setK1(parseFloat(e.target.value) || 0.04)}
                className="w-full px-2 py-1 bg-zinc-900 border border-zinc-800 rounded text-zinc-300 font-mono text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">Saunderson k2 (İç)</label>
              <input
                type="number"
                step="0.01"
                value={k2}
                onChange={(e) => setK2(parseFloat(e.target.value) || 0.60)}
                className="w-full px-2 py-1 bg-zinc-900 border border-zinc-800 rounded text-zinc-300 font-mono text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">Film Kalınlığı (µm)</label>
              <input
                type="number"
                step="10"
                value={thickness}
                onChange={(e) => setThickness(parseFloat(e.target.value) || 100.0)}
                className="w-full px-2 py-1 bg-zinc-900 border border-zinc-800 rounded text-zinc-300 font-mono text-xs"
              />
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-medium transition-colors"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !reflectance}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  <span>Kaydediliyor...</span>
                </>
              ) : (
                <>
                  <Save className="h-3.5 w-3.5" />
                  <span>Bazı Kaydet ve Kütüphaneye Ekle</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
