import React, { useState } from 'react';
import {
  X,
  Plus,
  Zap,
  Check,
  AlertCircle,
  FileText,
  Upload,
  RefreshCw,
  Sparkles,
  Layers,
  ArrowRight
} from 'lucide-react';
import { addCardColor, addBatchCardColors, measureChnspec, getChnspecStatus } from '../services/api';

interface AddCardColorModalProps {
  isOpen: boolean;
  onClose: () => void;
  cardId: number;
  cardName: string;
  onSuccess: () => void;
}

export const AddCardColorModal: React.FC<AddCardColorModalProps> = ({
  isOpen,
  onClose,
  cardId,
  cardName,
  onSuccess,
}) => {
  const [activeMode, setActiveMode] = useState<'device' | 'paste' | 'batch_csv'>('device');

  // Single color state
  const [colorCode, setColorCode] = useState('');
  const [colorName, setColorName] = useState('');
  const [reflectance, setReflectance] = useState<number[] | null>(null);
  const [lab, setLab] = useState<{ L: number; a: number; b: number } | null>(null);
  const [hexColor, setHexColor] = useState<string>('#999999');

  // Device measurement state
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [measureError, setMeasureError] = useState<string | null>(null);

  // Manual paste state
  const [rawPastedText, setRawPastedText] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);

  // Batch CSV state
  const [batchFile, setBatchFile] = useState<File | null>(null);
  const [parsedBatchColors, setParsedBatchColors] = useState<
    Array<{ color_code: string; color_name: string; reflectance: number[]; hex?: string }>
  >([]);
  const [batchStatus, setBatchStatus] = useState<string | null>(null);
  const [isSubmittingBatch, setIsSubmittingBatch] = useState(false);

  // Submit state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [keepOpenAfterSave, setKeepOpenAfterSave] = useState(false);

  if (!isOpen) return null;

  // 1-Click Measure from CHNSpec DS-36D
  const handleMeasureFromDevice = async () => {
    setIsMeasuring(true);
    setMeasureError(null);
    try {
      const status = await getChnspecStatus().catch(() => null);
      if (!status || !status.connected) {
        throw new Error('CHNSpec DS-36D spektrofotometresi bağlı değil veya COM portu kapalı.');
      }
      const sampleLabel = `${colorCode ? colorCode + ' ' : ''}${colorName || 'Kartela Numunesi'}`;
      const res = await measureChnspec('SCI', sampleLabel);
      if (res && res.reflectance && res.reflectance.length === 31) {
        setReflectance(res.reflectance);
        if (res.lab) {
          if (Array.isArray(res.lab)) {
            setLab({ L: res.lab[0], a: res.lab[1], b: res.lab[2] });
          } else {
            setLab(res.lab);
          }
        }
        if (res.hex) setHexColor(res.hex);
        return;
      }
      throw new Error('Cihazdan geçerli 31-dalga boyu spektral veri alınamadı.');
    } catch (err: any) {
      setMeasureError(err.message || 'Spektrofotometre okuma hatası.');
    } finally {
      setIsMeasuring(false);
    }
  };

  // Parse pasted spectral text (comma, space, or newline separated 31 numbers)
  const handleParsePastedSpectrum = (text: string) => {
    setRawPastedText(text);
    setPasteError(null);
    if (!text.trim()) {
      setReflectance(null);
      return;
    }

    // Split by comma, tab, space, or newline
    const tokens = text.trim().split(/[\s,\t\r\n]+/).filter(Boolean);
    const nums = tokens.map((t) => parseFloat(t)).filter((n) => !isNaN(n));

    if (nums.length !== 31) {
      setPasteError(`31 adet dalga boyu değeri gerekli. (Şu an: ${nums.length} değer algılandı)`);
      setReflectance(null);
      return;
    }

    // Normalize percentage (0..100) to 0..1
    const maxVal = Math.max(...nums);
    const normalized = nums.map((v) => {
      let norm = maxVal > 1.5 ? v / 100.0 : v;
      return Math.min(0.9999, Math.max(0.0001, parseFloat(norm.toFixed(5))));
    });

    setReflectance(normalized);
  };

  // Parse CSV File for Batch Import
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBatchFile(file);
    setBatchStatus(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length < 2) {
          throw new Error('Dosya boş veya başlık satırı dışında veri içermiyor.');
        }

        const parsed: Array<{ color_code: string; color_name: string; reflectance: number[]; hex?: string }> = [];

        // Check if first line is header
        const startIndex = lines[0].toLowerCase().includes('code') || lines[0].toLowerCase().includes('400') ? 1 : 0;

        for (let i = startIndex; i < lines.length; i++) {
          const parts = lines[i].split(/[,;\t]/).map((p) => p.trim());
          if (parts.length >= 33) {
            // Format: code, name, 31 reflectance values
            const cCode = parts[0];
            const cName = parts[1];
            const rawRefl = parts.slice(2, 33).map((v) => parseFloat(v));
            if (rawRefl.every((v) => !isNaN(v))) {
              const maxVal = Math.max(...rawRefl);
              const norm = rawRefl.map((v) => (maxVal > 1.5 ? v / 100.0 : v));
              parsed.push({
                color_code: cCode,
                color_name: cName || cCode,
                reflectance: norm,
              });
            }
          }
        }

        if (parsed.length === 0) {
          throw new Error('Geçerli formatta renk bulunamadı. Beklenen format: kod, ad, 31 adet yansıma değeri.');
        }

        setParsedBatchColors(parsed);
        setBatchStatus(`${parsed.length} adet renk başarıyla tespit edildi ve yüklenmeye hazır.`);
      } catch (err: any) {
        setBatchStatus(`Hata: ${err.message}`);
        setParsedBatchColors([]);
      }
    };
    reader.readAsText(file);
  };

  // Submit Single Color
  const handleSaveSingleColor = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!colorCode.trim()) {
      setSubmitError('Lütfen bir renk kodu girin (örn: RAL 5015 veya DY-104).');
      return;
    }
    if (!reflectance || reflectance.length !== 31) {
      setSubmitError('Geçerli bir 31 dalga boylu spektral yansıma verisi gereklidir. Lütfen cihazdan okutun veya spektrum yapıştırın.');
      return;
    }

    setIsSubmitting(true);
    try {
      await addCardColor(cardId, {
        color_code: colorCode.trim(),
        color_name: colorName.trim() || colorCode.trim(),
        reflectance,
        hex: hexColor,
      });

      onSuccess();

      if (keepOpenAfterSave) {
        // Reset for serial measuring
        setColorCode('');
        setColorName('');
        setReflectance(null);
        setLab(null);
        setRawPastedText('');
      } else {
        onClose();
      }
    } catch (err: any) {
      setSubmitError(err.message || 'Renk kaydedilirken hata oluştu.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit Batch Colors
  const handleSaveBatchColors = async () => {
    if (parsedBatchColors.length === 0) return;
    setIsSubmittingBatch(true);
    setBatchStatus(null);
    try {
      await addBatchCardColors(cardId, parsedBatchColors);
      onSuccess();
      onClose();
    } catch (err: any) {
      setBatchStatus(err.message || 'Toplu yükleme sırasında hata oluştu.');
    } finally {
      setIsSubmittingBatch(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] w-full max-w-xl shadow-[var(--shadow-xl)] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 border-b border-[var(--border)] flex items-center justify-between bg-[var(--surface-2)]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded bg-[var(--brand-clay)]/10 text-[var(--brand-clay)]">
              <Plus className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[var(--text-primary)] font-mono uppercase">
                Kartelaya Yeni Renk Ekle
              </h2>
              <span className="text-[11px] text-[var(--text-muted)] font-mono">
                Hedef Kartela: <strong className="text-[var(--text-primary)]">{cardName}</strong>
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded hover:bg-[var(--surface-0)] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Mode Selector Tabs */}
        <div className="flex border-b border-[var(--border)] bg-[var(--surface-1)] text-xs font-mono">
          <button
            type="button"
            onClick={() => setActiveMode('device')}
            className={`flex-1 py-2.5 px-3 flex items-center justify-center gap-1.5 border-b-2 cursor-pointer transition-colors ${
              activeMode === 'device'
                ? 'border-[var(--brand-clay)] text-[var(--brand-clay)] font-bold bg-[var(--surface-3)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Zap className="h-3.5 w-3.5" />
            <span>1-Tıkla Ölç (DS-36D)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveMode('paste')}
            className={`flex-1 py-2.5 px-3 flex items-center justify-center gap-1.5 border-b-2 cursor-pointer transition-colors ${
              activeMode === 'paste'
                ? 'border-[var(--brand-clay)] text-[var(--brand-clay)] font-bold bg-[var(--surface-3)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <FileText className="h-3.5 w-3.5" />
            <span>Spektrum Yapıştır</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveMode('batch_csv')}
            className={`flex-1 py-2.5 px-3 flex items-center justify-center gap-1.5 border-b-2 cursor-pointer transition-colors ${
              activeMode === 'batch_csv'
                ? 'border-[var(--brand-clay)] text-[var(--brand-clay)] font-bold bg-[var(--surface-3)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Upload className="h-3.5 w-3.5" />
            <span>Toplu CSV İçe Aktar</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4">
          {/* TAB 1 & 2: Single Color Form */}
          {activeMode !== 'batch_csv' && (
            <form onSubmit={handleSaveSingleColor} className="space-y-4">
              {/* Basic Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono text-xs">
                <div>
                  <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">
                    Renk Kodu *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Örn: RAL 5015 veya DY-104"
                    value={colorCode}
                    onChange={(e) => setColorCode(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-[var(--surface-0)] border border-[var(--border)] rounded text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand-clay)]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">
                    Renk Adı (Opsiyonel)
                  </label>
                  <input
                    type="text"
                    placeholder="Örn: Gök Mavisi"
                    value={colorName}
                    onChange={(e) => setColorName(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-[var(--surface-0)] border border-[var(--border)] rounded text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand-clay)]"
                  />
                </div>
              </div>

              {/* MODE 1: CHNSpec Spectrophotometer Trigger */}
              {activeMode === 'device' && (
                <div className="p-4 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-[var(--text-primary)] font-mono block">
                        CHNSpec DS-36D Spektrofotometre
                      </span>
                      <span className="text-[11px] text-[var(--text-muted)]">
                        Numuneyi diyaframa yerleştirip butona basın (d/8° SCI okuma)
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={isMeasuring}
                      onClick={handleMeasureFromDevice}
                      className="px-3.5 py-2 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] disabled:opacity-50 text-white rounded text-xs font-mono font-bold flex items-center gap-1.5 cursor-pointer shadow-xs transition-all"
                    >
                      {isMeasuring ? (
                        <>
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          <span>Ölçülüyor...</span>
                        </>
                      ) : (
                        <>
                          <Zap className="h-3.5 w-3.5" />
                          <span>Cihazdan Oku</span>
                        </>
                      )}
                    </button>
                  </div>

                  {measureError && (
                    <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs rounded flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <span>{measureError}</span>
                    </div>
                  )}
                </div>
              )}

              {/* MODE 2: Paste Raw Spectral Data */}
              {activeMode === 'paste' && (
                <div className="space-y-2 font-mono text-xs">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-semibold text-[var(--text-secondary)]">
                      31 Dalga Boyu Spektral Yansıma (400-700 nm @ 10 nm)
                    </label>
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {reflectance ? '✓ 31/31 Nokta Algılandı' : 'Virgül veya boşlukla ayrılmış 31 değer'}
                    </span>
                  </div>
                  <textarea
                    rows={3}
                    placeholder="Örn: 0.045, 0.048, 0.052, 0.060, ... (veya % cinsinden 4.5, 4.8, 5.2)"
                    value={rawPastedText}
                    onChange={(e) => handleParsePastedSpectrum(e.target.value)}
                    className="w-full p-2.5 bg-[var(--surface-0)] border border-[var(--border)] rounded text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand-clay)]"
                  />
                  {pasteError && (
                    <span className="text-[11px] text-amber-500 block font-mono">{pasteError}</span>
                  )}
                </div>
              )}

              {/* Color Swatch & LAB Preview */}
              {reflectance && (
                <div className="p-3 bg-[var(--surface-0)] border border-[var(--border)] rounded flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="w-10 h-10 rounded border border-black/20 shadow-xs shrink-0"
                      style={{ backgroundColor: hexColor }}
                    />
                    <div>
                      <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-[var(--text-primary)]">
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                        <span>Spektrum Hazır (31 Dalga Boyu)</span>
                      </div>
                      <span className="text-[10px] text-[var(--text-muted)] font-mono block">
                        {lab ? `CIELAB: L=${lab.L.toFixed(1)} a=${lab.a.toFixed(1)} b=${lab.b.toFixed(1)}` : 'Spektral koordinatlar hesaplandı'}
                      </span>
                    </div>
                  </div>

                  <div className="text-right font-mono text-xs">
                    <span className="text-[10px] text-[var(--text-muted)] block">Tahmini HEX</span>
                    <span className="font-bold text-[var(--text-primary)]">{hexColor}</span>
                  </div>
                </div>
              )}

              {submitError && (
                <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs rounded flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{submitError}</span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-2 border-t border-[var(--border)]">
                <label className="flex items-center gap-2 text-xs font-mono text-[var(--text-secondary)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={keepOpenAfterSave}
                    onChange={(e) => setKeepOpenAfterSave(e.target.checked)}
                    className="rounded border-[var(--border)] text-[var(--brand-clay)] focus:ring-0"
                  />
                  <span>Seri Okuma (Kaydettikten sonra formu açık tut)</span>
                </label>

                <div className="flex items-center gap-2 font-mono text-xs">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-3 py-1.5 rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-0)] cursor-pointer"
                  >
                    İptal
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || !reflectance}
                    className="px-4 py-1.5 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] disabled:opacity-50 text-white font-bold rounded flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    {isSubmitting ? (
                      <>
                        <RefreshCw className="h-3 w-3 animate-spin" />
                        <span>Kaydediliyor...</span>
                      </>
                    ) : (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        <span>Kartelaya Kaydet</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* TAB 3: Batch CSV Import */}
          {activeMode === 'batch_csv' && (
            <div className="space-y-4 font-mono text-xs">
              <div className="p-4 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] space-y-3">
                <div className="flex items-start gap-2.5">
                  <FileText className="h-4 w-4 text-[var(--brand-clay)] shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-[var(--text-primary)] block">
                      Desteklenen CSV / Excel Formatı
                    </span>
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                      Sütunlar: <code>color_code, color_name, 400, 410, 420, ..., 700</code> (Toplam 33 sütun)
                    </p>
                  </div>
                </div>

                <div className="border-2 border-dashed border-[var(--border)] hover:border-[var(--brand-clay)] rounded-[var(--radius)] p-6 text-center cursor-pointer bg-[var(--surface-1)] transition-colors">
                  <input
                    type="file"
                    accept=".csv,.txt"
                    onChange={handleFileChange}
                    className="hidden"
                    id="batch-csv-input"
                  />
                  <label htmlFor="batch-csv-input" className="cursor-pointer space-y-1 block">
                    <Upload className="h-6 w-6 text-[var(--brand-clay)] mx-auto" />
                    <span className="text-xs font-semibold text-[var(--text-primary)] block">
                      {batchFile ? batchFile.name : 'CSV Dosyası Seçin veya Sürükleyin'}
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)] block">
                      Yüzlerce rengi aynı anda kartelaya içe aktarın
                    </span>
                  </label>
                </div>

                {batchStatus && (
                  <div
                    className={`p-2.5 rounded text-xs flex items-center gap-2 ${
                      batchStatus.startsWith('Hata')
                        ? 'bg-rose-500/10 border border-rose-500/20 text-rose-500'
                        : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-500'
                    }`}
                  >
                    <span>{batchStatus}</span>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-0)] cursor-pointer"
                >
                  Kapat
                </button>
                <button
                  type="button"
                  disabled={isSubmittingBatch || parsedBatchColors.length === 0}
                  onClick={handleSaveBatchColors}
                  className="px-4 py-1.5 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] disabled:opacity-50 text-white font-bold rounded flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  {isSubmittingBatch ? (
                    <>
                      <RefreshCw className="h-3 w-3 animate-spin" />
                      <span>İçe Aktarılıyor...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>{parsedBatchColors.length} Rengi İçe Aktar</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
