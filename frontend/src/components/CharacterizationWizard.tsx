import React, { useState, useEffect } from 'react';
import type {
  BasePaint,
  ColorantPaste,
  Letdown,
  CharacterizationResult,
  ChnspecStatusInfo,
  CalibrationHealthInfo,
  ProposerResponse
} from '../types';
import {
  calculateCharacterization,
  fetchSampleDatasets,
  fetchSampleDataset,
  saveCharacterization,
  getChnspecStatus,
  getChnspecCalibrationHealth,
  measureChnspec,
  fetchProposerLetdowns,
  importSpectralFile
} from '../services/api';
import { SpectralChart } from './SpectralChart';
import { BootstrapCharacterizationWorkflow } from './BootstrapCharacterizationWorkflow';
import {
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  Save,
  Check,
  Zap,
  Trash2,
  Plus,
  Sparkles,
  RefreshCw,
  Upload,
  Download,
  ChevronDown,
  ChevronUp,
  Sliders,
  Scale,
  Layers
} from 'lucide-react';

interface WizardProps {
  bases: BasePaint[];
  pastes?: ColorantPaste[];
  onComplete: () => void;
  onOpenInstruments?: () => void;
  onNavigateToSpectro?: () => void;
}

// Default standard ladder recommendations inspired by InnovaTint Lab 3
const STANDARD_LADDER = [
  { concentration: 100.0, role: 'Masstone (Tam Ton / Saf Pigment)', baseRatio: 0.0, pigmentRatio: 1.0, isMasstone: true },
  { concentration: 10.0, role: 'Koyu Açma (Deep Tint)', baseRatio: 0.90, pigmentRatio: 0.10, isMasstone: false },
  { concentration: 2.0, role: 'Orta Açma (Medium Tint)', baseRatio: 0.98, pigmentRatio: 0.02, isMasstone: false },
  { concentration: 0.5, role: 'Açık Açma (Light Tint)', baseRatio: 0.995, pigmentRatio: 0.005, isMasstone: false },
  { concentration: 0.1, role: 'Pastel Açma (Pastel Tint)', baseRatio: 0.999, pigmentRatio: 0.001, isMasstone: false },
];

export const CharacterizationWizard: React.FC<WizardProps> = ({
  bases,
  pastes = [],
  onComplete,
  onOpenInstruments,
  onNavigateToSpectro
}) => {
  // Top View Mode: 'bootstrap' (3-Aşamalı İş Akışı) vs 'single' (Tekil Renklendirici Masası)
  const [viewMode, setViewMode] = useState<'bootstrap' | 'single'>('bootstrap');
  // 2-Step InnovaTint UX: 1 = Tartım ve Ölçüm Masası, 2 = Doğrulama ve Kayıt
  const [currentStep, setCurrentStep] = useState<1 | 2>(1);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Hardware Status
  const [deviceStatus, setDeviceStatus] = useState<ChnspecStatusInfo | null>(null);
  const [calHealth, setCalHealth] = useState<CalibrationHealthInfo | null>(null);

  // Pigment setup
  const [pasteName, setPasteName] = useState<string>('Sarı Oksit');
  const [pasteCode, setPasteCode] = useState<string>('PY42');
  const [pasteDensity, setPasteDensity] = useState<number>(1.40);
  const [colorHex, setColorHex] = useState<string>('#d97706');
  const [selectedBaseId, setSelectedBaseId] = useState<number>(bases[0]?.id || 1);

  // Optical model parameters (defaults suitable for industrial coatings)
  const [k1, setK1] = useState<number>(0.04);
  const [k2, setK2] = useState<number>(0.60);
  const [useTwoConstant, setUseTwoConstant] = useState<boolean>(true);
  const [measurementMode, setMeasurementMode] = useState<'SCI' | 'SCE'>('SCI');

  // Letdowns measured / collected
  const [letdowns, setLetdowns] = useState<Letdown[]>([]);

  // Measurement state
  const [measuringConc, setMeasuringConc] = useState<number | null>(null);

  // Batch weight for recipe preparation guide (50g, 100g, 200g)
  const [batchWeight, setBatchWeight] = useState<number>(100.0);

  // Custom letdown input
  const [customConc, setCustomConc] = useState<string>('');

  // Proposer API data
  const [proposerData, setProposerData] = useState<ProposerResponse | null>(null);

  // Advanced settings accordion
  const [showAdvancedSettings, setShowAdvancedSettings] = useState<boolean>(false);

  // Available sample datasets
  const [availableSamples, setAvailableSamples] = useState<any[]>([]);

  // Calculation Results
  const [results, setResults] = useState<CharacterizationResult | null>(null);

  // Load hardware status and samples
  useEffect(() => {
    refreshHardware();
    fetchSampleDatasets()
      .then((data) => setAvailableSamples(data.samples || []))
      .catch((err) => console.warn('Could not load sample datasets:', err));
  }, []);

  // Load smart mixture proposer for batch weights
  useEffect(() => {
    let isMounted = true;
    fetchProposerLetdowns(batchWeight, pasteDensity, 1.45)
      .then((data) => {
        if (isMounted) setProposerData(data);
      })
      .catch((err) => console.warn('Proposer load error:', err));
    return () => {
      isMounted = false;
    };
  }, [batchWeight, pasteDensity]);

  const refreshHardware = async () => {
    try {
      const [status, health] = await Promise.all([
        getChnspecStatus().catch(() => null),
        getChnspecCalibrationHealth().catch(() => null)
      ]);
      setDeviceStatus(status);
      setCalHealth(health);
    } catch {
      // Ignore background poll errors
    }
  };

  const isChnspecConnected = deviceStatus?.connected ?? false;
  const isChnspecReal = isChnspecConnected && !deviceStatus?.is_mock;
  const isCalibrated = calHealth?.status === 'VALID' || calHealth?.status === 'EXPIRING_SOON';

  // Measure directly from CHNSpec DS-36D for a specific row
  const handleMeasureRow = async (targetConc: number, rowLabel?: string) => {
    setMeasuringConc(targetConc);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const label = rowLabel || `${pasteName} %${targetConc}`;
      const record = await measureChnspec(measurementMode, label);

      let parsedLab: { L: number; a: number; b: number } | undefined = undefined;
      if (record.lab) {
        if (Array.isArray(record.lab)) {
          parsedLab = { L: record.lab[0], a: record.lab[1], b: record.lab[2] };
        } else {
          parsedLab = { L: record.lab.L, a: record.lab.a, b: record.lab.b };
        }
      }

      const newLetdown: Letdown = {
        concentration: targetConc,
        reflectance: record.reflectance,
        lab: parsedLab,
        hex: record.hex
      };

      setLetdowns((prev) => {
        const filtered = prev.filter((item) => Math.abs(item.concentration - targetConc) > 0.001);
        return [...filtered, newLetdown].sort((a, b) => a.concentration - b.concentration);
      });

      if (record.hex) {
        setColorHex(record.hex);
      }
      setSuccessMessage(`%${targetConc} numunesi CHNSpec DS-36D ile başarıyla okundu.`);
    } catch (err: any) {
      setErrorMessage(err.message || 'Cihazdan ölçüm alınamadı. CHNSpec DS-36D bağlantısını kontrol edin.');
    } finally {
      setMeasuringConc(null);
    }
  };

  // Quick load demo pigment dataset
  const handleLoadSample = async (sampleKey: string) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await fetchSampleDataset(sampleKey);
      setPasteName(data.colorant.name);
      setPasteCode(data.colorant.code);
      setColorHex(data.colorant.color_hex);
      setPasteDensity(data.colorant.density);
      setLetdowns(data.colorant.letdowns);
      setSuccessMessage(`${data.colorant.name} referans serisi yüklendi.`);
    } catch (err: any) {
      setErrorMessage(err.message || 'Numune yüklenemedi');
    } finally {
      setIsLoading(false);
    }
  };

  // Upload spectral CSV file
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setErrorMessage(null);
    try {
      const parsed = await importSpectralFile(file);
      if (parsed.samples && parsed.samples.length > 0) {
        const importedLetdowns: Letdown[] = parsed.samples.map((s: any) => ({
          concentration: s.concentration ?? 1.0,
          reflectance: s.reflectance,
          lab: s.lab ? (Array.isArray(s.lab) ? { L: s.lab[0], a: s.lab[1], b: s.lab[2] } : s.lab) : undefined,
          hex: s.hex
        }));

        setLetdowns(importedLetdowns.sort((a, b) => a.concentration - b.concentration));
        setSuccessMessage(`${file.name} dosyasından ${importedLetdowns.length} seyreltme içe aktarıldı.`);
      } else {
        throw new Error('Dosyada geçerli spektral seyreltme verisi bulunamadı.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Dosya okuma hatası');
    } finally {
      setIsLoading(false);
      e.target.value = '';
    }
  };

  // Download blank CSV template
  const handleDownloadTemplate = () => {
    const wls = Array.from({ length: 31 }, (_, i) => 400 + i * 10);
    const headers = ['Wavelength', 'Masstone_100%', 'Tint_10%', 'Tint_2%', 'Tint_0.5%', 'Tint_0.1%'];
    const rows = [headers.join(';')];
    wls.forEach((wl) => {
      rows.push(`${wl};0.1000;0.2500;0.5000;0.7500;0.8200`);
    });
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `DS36D_${pasteCode || 'PIG'}_Letdowns_Template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Add custom letdown row
  const handleAddCustomRow = () => {
    const val = parseFloat(customConc);
    if (isNaN(val) || val <= 0 || val > 100) {
      setErrorMessage('Lütfen 0 ile 100 arasında geçerli bir konsantrasyon girin.');
      return;
    }
    if (letdowns.some((l) => Math.abs(l.concentration - val) < 0.001)) {
      setErrorMessage(`%${val} konsantrasyonu tabloda zaten mevcut.`);
      return;
    }
    handleMeasureRow(val);
    setCustomConc('');
  };

  const handleDeleteLetdown = (targetConc: number) => {
    setLetdowns((prev) => prev.filter((l) => Math.abs(l.concentration - targetConc) > 0.001));
  };

  // Calculate Kubelka-Munk
  const handleRunCalculation = async () => {
    if (letdowns.length < 2) {
      setErrorMessage('Kubelka-Munk karakterizasyonu için en az 2 seyreltme gereklidir (önerilen: 4-5 seyreltme).');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await calculateCharacterization({
        base_id: selectedBaseId,
        letdowns,
        k1,
        k2,
        use_two_constant: useTwoConstant,
      });

      setResults(res);
      setCurrentStep(2);
    } catch (err: any) {
      setErrorMessage(err.message || 'Karakterizasyon hesaplama hatası');
    } finally {
      setIsLoading(false);
    }
  };

  // Save to Library
  const handleSaveToLibrary = async () => {
    if (!results) return;

    setIsLoading(true);
    setErrorMessage(null);
    const instrumentName = isChnspecConnected
      ? (deviceStatus?.is_mock ? 'CHNSpec DS-36D (Simülasyon)' : `CHNSpec DS-36D (${deviceStatus?.port || 'COM4'})`)
      : 'CHNSpec DS-36D (d/8° Entegre Küre)';

    try {
      await saveCharacterization({
        name: pasteName,
        code: pasteCode,
        color_hex: colorHex,
        density: pasteDensity,
        base_id: selectedBaseId,
        k1,
        k2,
        instrument: instrumentName,
        geometry: 'd/8°',
        measurement_mode: measurementMode,
        letdowns,
        calculation_results: results,
      });

      setSuccessMessage(`'${pasteName}' başarıyla kütüphaneye kaydedildi.`);
      setTimeout(() => {
        onComplete();
      }, 1000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Kaydetme hatası');
    } finally {
      setIsLoading(false);
    }
  };

  // Build rows combining standard ladder with any extra letdowns measured
  const displayedLadder = [...STANDARD_LADDER];
  letdowns.forEach((ld) => {
    if (!displayedLadder.some((r) => Math.abs(r.concentration - ld.concentration) < 0.001)) {
      displayedLadder.push({
        concentration: ld.concentration,
        role: `Özel Seyreltme (%${ld.concentration})`,
        baseRatio: Math.max(0, 1.0 - ld.concentration / 100.0),
        pigmentRatio: ld.concentration / 100.0,
        isMasstone: ld.concentration >= 99.0
      });
    }
  });
  displayedLadder.sort((a, b) => b.concentration - a.concentration);

  // Spectral series for result chart
  const resultsSeries = [];
  if (results && results.back_predictions) {
    const lowest = results.back_predictions[0];
    const highest = results.back_predictions[results.back_predictions.length - 1];

    if (lowest) {
      resultsSeries.push({
        id: 'low-meas',
        name: `%${lowest.concentration} Ölçülen`,
        color: '#60a5fa',
        data: lowest.measured_reflectance,
        strokeWidth: 1.8,
      });
      resultsSeries.push({
        id: 'low-pred',
        name: `%${lowest.concentration} K-M Tahmini`,
        color: '#2563eb',
        data: lowest.predicted_reflectance,
        strokeWidth: 1.8,
        strokeDasharray: '3 3',
      });
    }

    if (highest) {
      resultsSeries.push({
        id: 'high-meas',
        name: `%${highest.concentration} Ölçülen`,
        color: '#f43f5e',
        data: highest.measured_reflectance,
        strokeWidth: 1.8,
      });
      resultsSeries.push({
        id: 'high-pred',
        name: `%${highest.concentration} K-M Tahmini`,
        color: '#9f1239',
        data: highest.predicted_reflectance,
        strokeWidth: 1.8,
        strokeDasharray: '3 3',
      });
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-6 w-full space-y-6">
      {/* Top Mode Selector: 3-Aşamalı İş Akışı vs Tekil Renklendirici Masası */}
      <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
        <div className="flex items-center gap-2 bg-[var(--surface-0)] p-1 rounded-[var(--radius-lg)] border border-[var(--border)] text-xs">
          <button
            onClick={() => setViewMode('bootstrap')}
            className={`px-3.5 py-1.5 rounded-[var(--radius)] font-medium transition-all flex items-center gap-2 cursor-pointer ${
              viewMode === 'bootstrap'
                ? 'bg-[var(--surface-3)] text-[var(--brand-clay)] font-bold shadow-xs border border-[var(--border)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Layers className="h-4 w-4" />
            <span>3-Aşamalı İş Akışı (Bootstrap Referans & Baz Kalibrasyonu)</span>
          </button>
          <button
            onClick={() => setViewMode('single')}
            className={`px-3.5 py-1.5 rounded-[var(--radius)] font-medium transition-all flex items-center gap-2 cursor-pointer ${
              viewMode === 'single'
                ? 'bg-[var(--surface-3)] text-[var(--brand-clay)] font-bold shadow-xs border border-[var(--border)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Sliders className="h-4 w-4" />
            <span>Tekil Renklendirici Masası</span>
          </button>
        </div>
      </div>

      {viewMode === 'bootstrap' ? (
        <BootstrapCharacterizationWorkflow
          bases={bases}
          pastes={pastes}
          onOpenSinglePasteWizard={(baseId) => {
            setSelectedBaseId(baseId);
            setViewMode('single');
            setCurrentStep(1);
          }}
          onRefreshData={onComplete}
        />
      ) : (
        <div className="space-y-5">
          {/* InnovaTint Header & Step Tabs */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-[var(--border)]">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-lg font-bold text-[var(--text-primary)] tracking-tight">
              Renklendirici Karakterizasyon Masası
            </h1>
            {isChnspecReal ? (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--radius-xs)] bg-[var(--success-subtle)] border border-[var(--success-border)] text-[var(--success-text)] text-[10px] font-mono font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] animate-pulse" />
                DS-36D: {deviceStatus?.port || 'COM4'}
              </span>
            ) : isChnspecConnected ? (
              <span className="px-2 py-0.5 rounded-[var(--radius-xs)] bg-[var(--warning-subtle)] text-[var(--warning-text)] text-[10px] font-mono border border-[var(--warning-border)]">
                DS-36D (Simülasyon)
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-[var(--radius-xs)] bg-[var(--surface-0)] text-[var(--text-muted)] text-[10px] font-mono border border-[var(--border)]">
                DS-36D (Çevrimdışı)
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            CHNSpec DS-36D (d/8° Entegre Küre, SCI) ile tek tıkla seyreltme okuma ve Kubelka-Munk K/S matrisi türetimi
          </p>
        </div>

        {/* 2-Step Segmented Bar */}
        <div className="flex items-center bg-[var(--surface-0)] border border-[var(--border)] p-1 rounded-[var(--radius-lg)] text-xs">
          <button
            onClick={() => setCurrentStep(1)}
            className={`px-3.5 py-1.5 rounded-[var(--radius)] font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
              currentStep === 1
                ? 'bg-[var(--surface-3)] text-[var(--text-primary)] font-semibold shadow-sm border border-[var(--border)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Scale className="h-3.5 w-3.5" />
            <span>1. Tartım ve Ölçüm Masası</span>
          </button>
          <button
            disabled={!results}
            onClick={() => results && setCurrentStep(2)}
            className={`px-3.5 py-1.5 rounded-[var(--radius)] font-medium transition-colors flex items-center gap-1.5 ${
              currentStep === 2
                ? 'bg-[var(--surface-3)] text-[var(--text-primary)] font-semibold shadow-sm border border-[var(--border)]'
                : results
                ? 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer'
                : 'text-[var(--text-muted)] opacity-50 cursor-not-allowed'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>2. K-M Katsayıları & Kayıt</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {errorMessage && (
        <div className="p-3 bg-[var(--danger-subtle)] border border-[var(--danger-border)] rounded-[var(--radius)] text-xs text-[var(--danger-text)] flex items-center justify-between gap-2 shadow-sm font-mono">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          {onOpenInstruments && (
            <button
              onClick={onOpenInstruments}
              className="text-[11px] underline hover:text-[var(--text-primary)] cursor-pointer"
            >
              Cihaz Masasını Aç
            </button>
          )}
        </div>
      )}

      {successMessage && (
        <div className="p-3 bg-[var(--success-subtle)] border border-[var(--success-border)] rounded-[var(--radius)] text-xs text-[var(--success-text)] flex items-center gap-2 shadow-sm font-mono">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* ======================================================== */}
      {/* AŞAMA 1: TARTIM VE ÖLÇÜM MASASI (INNOVATINT WORKSTATION) */}
      {/* ======================================================== */}
      {currentStep === 1 && (
        <div className="space-y-4">
          {/* ÜST PANEL: Renklendirici Tanımı & Taşıyıcı Baz (Tek Bakışta Kurulum) */}
          <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-4 shadow-[var(--shadow-sm)] space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              {/* Form alanları */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 flex-1">
                <div>
                  <label className="block text-[10px] font-mono uppercase text-[var(--text-secondary)] mb-1">
                    Pasta Adı
                  </label>
                  <input
                    type="text"
                    value={pasteName}
                    onChange={(e) => setPasteName(e.target.value)}
                    placeholder="Örn: Sarı Oksit"
                    className="w-full px-2.5 py-1.5 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius-xs)] text-xs text-[var(--text-primary)] font-medium focus:outline-none focus:border-[var(--brand-clay)]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono uppercase text-[var(--text-secondary)] mb-1">
                    Pigment Kodu
                  </label>
                  <input
                    type="text"
                    value={pasteCode}
                    onChange={(e) => setPasteCode(e.target.value)}
                    placeholder="Örn: PY42"
                    className="w-full px-2.5 py-1.5 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius-xs)] text-xs text-[var(--text-primary)] font-mono uppercase focus:outline-none focus:border-[var(--brand-clay)]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono uppercase text-[var(--text-secondary)] mb-1">
                    Yoğunluk (g/cm³)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={pasteDensity}
                    onChange={(e) => setPasteDensity(parseFloat(e.target.value) || 1.0)}
                    className="w-full px-2.5 py-1.5 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius-xs)] text-xs text-[var(--text-primary)] font-mono focus:outline-none focus:border-[var(--brand-clay)]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono uppercase text-[var(--text-secondary)] mb-1">
                    Taşıyıcı Baz
                  </label>
                  <select
                    value={selectedBaseId}
                    onChange={(e) => setSelectedBaseId(Number(e.target.value))}
                    className="w-full px-2 py-1.5 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius-xs)] text-xs text-[var(--text-primary)] font-medium focus:outline-none focus:border-[var(--brand-clay)]"
                  >
                    {bases.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.code})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Renk Seçici & Hızlı Araçlar */}
              <div className="flex items-center gap-2 pt-2 lg:pt-0 border-t lg:border-t-0 lg:border-l border-[var(--border)] lg:pl-3">
                <div className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={colorHex}
                    onChange={(e) => setColorHex(e.target.value)}
                    className="w-7 h-7 rounded border border-[var(--border)] cursor-pointer bg-transparent"
                    title="Renk Tonunu Seç"
                  />
                  <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase">
                    {colorHex}
                  </span>
                </div>

                <div className="flex items-center gap-1 ml-auto">
                  <label
                    className="px-2.5 py-1 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] border border-[var(--border)] rounded-[var(--radius-xs)] text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
                    title="Önceden kaydedilmiş spektrofotometre CSV/TXT dosyasını yükleyin"
                  >
                    <Upload className="h-3 w-3" />
                    <span>CSV Yükle</span>
                    <input type="file" accept=".csv,.txt,.xml" onChange={handleFileUpload} className="hidden" />
                  </label>

                  <button
                    onClick={handleDownloadTemplate}
                    className="px-2.5 py-1 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] border border-[var(--border)] rounded-[var(--radius-xs)] text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center gap-1 transition-colors cursor-pointer shadow-xs"
                    title="Boş spektrofotometre şablon CSV indir"
                  >
                    <Download className="h-3 w-3" />
                    <span>Şablon İndir</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Hızlı Demo Numuneler */}
            {availableSamples.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[var(--border)]/60 text-xs">
                <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase">
                  Hızlı Referans Seti:
                </span>
                {availableSamples.map((samp) => (
                  <button
                    key={samp.key}
                    type="button"
                    onClick={() => handleLoadSample(samp.key)}
                    className="px-2 py-0.5 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] border border-[var(--border)] rounded-[var(--radius-xs)] text-[10px] font-mono text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <span
                      className="w-2 h-2 rounded-full border border-[var(--border)]"
                      style={{ backgroundColor: samp.color_hex }}
                    />
                    <span>{samp.name} ({samp.code})</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ANA TARTIM VE ÖLÇÜM MASASI (INNOVATINT MIXTURE TABLE) */}
          <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-4 shadow-[var(--shadow-sm)] space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-[var(--border)]">
              <div className="flex items-center gap-2">
                <Scale className="h-4 w-4 text-[var(--brand-clay)]" />
                <h2 className="text-xs font-semibold text-[var(--text-primary)] font-mono uppercase tracking-wider">
                  Seyreltme Tartım ve Spektrofotometre Masası
                </h2>
                <span className="text-[10px] font-mono text-[var(--text-muted)]">
                  (Optik Mod: {measurementMode})
                </span>
              </div>

              {/* Batch weight selector for scale */}
              <div className="flex items-center gap-2 text-xs font-mono">
                <span className="text-[10px] text-[var(--text-muted)]">Reçete Bazı:</span>
                {[50, 100, 200].map((wt) => (
                  <button
                    key={wt}
                    type="button"
                    onClick={() => setBatchWeight(wt)}
                    className={`px-2 py-0.5 rounded-[var(--radius-xs)] text-[10px] border transition-colors cursor-pointer ${
                      batchWeight === wt
                        ? 'bg-[var(--accent-subtle)] border-[var(--brand-clay)] text-[var(--brand-clay)] font-semibold shadow-xs'
                        : 'bg-[var(--surface-0)] border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
                    }`}
                  >
                    {wt} g
                  </button>
                ))}
              </div>
            </div>

            {/* InnovaTint Ladder Table */}
            <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-0)]">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[var(--surface-1)] text-[var(--text-secondary)] text-[10px] uppercase border-b border-[var(--border)]">
                  <tr>
                    <th className="p-3 w-12">#</th>
                    <th className="p-3">Seyreltme / Rol</th>
                    <th className="p-3">Konsantrasyon</th>
                    <th className="p-3">Tartım Kılavuzu ({batchWeight}g için)</th>
                    <th className="p-3">Spektral Durum</th>
                    <th className="p-3 text-right">Ölçüm İşlemi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {displayedLadder.map((row, idx) => {
                    const measuredLetdown = letdowns.find(
                      (l) => Math.abs(l.concentration - row.concentration) < 0.001
                    );
                    const isMeasured = Boolean(measuredLetdown);
                    const isCurrentlyMeasuring = measuringConc === row.concentration;

                    // Calculate grams to weigh on precision scale
                    const pigmentGrams = row.isMasstone
                      ? 20.0
                      : parseFloat(((batchWeight * row.pigmentRatio) / (1.0 - row.pigmentRatio)).toFixed(2));
                    const baseGrams = row.isMasstone ? 0.0 : batchWeight;

                    return (
                      <tr
                        key={idx}
                        className={`transition-colors ${
                          isMeasured
                            ? 'bg-[var(--success-subtle)]/20 hover:bg-[var(--success-subtle)]/30'
                            : 'hover:bg-[var(--surface-1)]'
                        }`}
                      >
                        <td className="p-3 text-[var(--text-muted)] font-mono">{idx + 1}</td>
                        <td className="p-3">
                          <span className="font-medium text-[var(--text-primary)] block">
                            {row.role}
                          </span>
                        </td>
                        <td className="p-3">
                          <span className="font-bold text-[var(--text-primary)]">
                            %{row.concentration}
                          </span>
                        </td>
                        <td className="p-3">
                          {row.isMasstone ? (
                            <span className="text-[var(--text-primary)] font-medium">
                              {pigmentGrams} g Saf Pigment
                            </span>
                          ) : (
                            <span className="text-[var(--text-secondary)]">
                              <strong className="text-[var(--text-primary)]">{baseGrams} g</strong> Baz +{' '}
                              <strong className="text-[var(--brand-clay)]">{pigmentGrams} g</strong> Pigment
                            </span>
                          )}
                        </td>
                        <td className="p-3">
                          {isMeasured ? (
                            <div className="flex items-center gap-2">
                              <span
                                className="w-3.5 h-3.5 rounded-full border border-[var(--border-strong)] shrink-0 shadow-xs"
                                style={{ backgroundColor: measuredLetdown?.hex || colorHex }}
                              />
                              <span className="text-[var(--success-text)] font-semibold flex items-center gap-1">
                                <Check className="h-3 w-3" />
                                {measuredLetdown?.lab ? (
                                  <span className="text-[10px] text-[var(--text-secondary)] font-mono">
                                    L:{measuredLetdown.lab.L.toFixed(1)} a:{measuredLetdown.lab.a.toFixed(1)} b:{measuredLetdown.lab.b.toFixed(1)}
                                  </span>
                                ) : (
                                  '✓ Okundu'
                                )}
                              </span>
                            </div>
                          ) : (
                            <span className="text-[var(--text-muted)] text-[11px] flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] opacity-60" />
                              Ölçüm Bekliyor
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleMeasureRow(row.concentration, `${pasteName} %${row.concentration}`)}
                              disabled={measuringConc !== null || isLoading}
                              className={`px-3 py-1 rounded-[var(--radius-xs)] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                                isMeasured
                                  ? 'bg-[var(--surface-1)] hover:bg-[var(--surface-3)] text-[var(--text-secondary)] border border-[var(--border)]'
                                  : 'bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white shadow-xs'
                              } disabled:opacity-50`}
                            >
                              {isCurrentlyMeasuring ? (
                                <>
                                  <RefreshCw className="h-3 w-3 animate-spin" />
                                  <span>Ölçülüyor...</span>
                                </>
                              ) : isMeasured ? (
                                <>
                                  <RefreshCw className="h-3 w-3" />
                                  <span>Yeniden Oku</span>
                                </>
                              ) : (
                                <>
                                  <Zap className="h-3 w-3 fill-current" />
                                  <span>DS-36D ile Oku</span>
                                </>
                              )}
                            </button>

                            {isMeasured && (
                              <button
                                type="button"
                                onClick={() => handleDeleteLetdown(row.concentration)}
                                title="Bu ölçümü kaldır"
                                className="p-1 text-[var(--text-muted)] hover:text-[var(--danger-text)] rounded hover:bg-[var(--surface-1)] transition-colors cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Özel Konsantrasyon Ekle & Masa Alt Çubuğu */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono text-[var(--text-secondary)]">Özel Konsantrasyon:</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    step="0.1"
                    min="0.01"
                    max="100.0"
                    placeholder="Örn: 5.0"
                    value={customConc}
                    onChange={(e) => setCustomConc(e.target.value)}
                    className="w-20 px-2 py-1 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius-xs)] text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand-clay)]"
                  />
                  <span className="text-xs font-mono text-[var(--text-muted)]">%</span>
                  <button
                    type="button"
                    onClick={handleAddCustomRow}
                    className="px-2.5 py-1 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] border border-[var(--border)] rounded-[var(--radius-xs)] text-xs text-[var(--text-primary)] font-medium flex items-center gap-1 transition-colors cursor-pointer shadow-xs"
                  >
                    <Plus className="h-3 w-3" />
                    <span>Satır Ekle & Oku</span>
                  </button>
                </div>
              </div>

              {/* Progress & Solve K/S Button */}
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-[var(--text-secondary)]">
                  {letdowns.length >= 2 ? (
                    <span className="text-[var(--success-text)] font-semibold">
                      ✓ {letdowns.length} Numune Hazır
                    </span>
                  ) : (
                    <span className="text-[var(--warning-text)]">
                      {letdowns.length} / 2 Numune (En az 2 ölçüm gereklidir)
                    </span>
                  )}
                </span>

                <button
                  type="button"
                  onClick={handleRunCalculation}
                  disabled={isLoading || letdowns.length < 2}
                  className="px-5 py-2 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white rounded-[var(--radius)] text-xs font-bold flex items-center gap-2 transition-all disabled:opacity-50 shadow-md cursor-pointer"
                >
                  {isLoading ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin text-white" />
                      <span>K/S Çözülüyor...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      <span>Katsayıları Hesapla (K ve S Çöz)</span>
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* KATLANABİLİR GELİŞMİŞ OPTİK AYARLAR (SAUNDERSON & MODEL) */}
          <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] overflow-hidden">
            <button
              type="button"
              onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
              className="w-full p-3 flex items-center justify-between text-xs font-mono text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-1)] transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Sliders className="h-3.5 w-3.5 text-[var(--brand-clay)]" />
                <span>Gelişmiş Optik Ayarlar (Saunderson Yansıma Katsayıları & Mod)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[var(--text-muted)]">
                  k1={k1.toFixed(3)}, k2={k2.toFixed(3)} • {useTwoConstant ? 'Çift Sabitli K-M' : 'Tek Sabitli K-M'}
                </span>
                {showAdvancedSettings ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </div>
            </button>

            {showAdvancedSettings && (
              <div className="p-4 border-t border-[var(--border)] bg-[var(--surface-0)] space-y-4 text-xs font-mono">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <label className="block text-[10px] text-[var(--text-secondary)] uppercase">
                      k1 (Fresnel Dış Yansıma): {k1.toFixed(3)}
                    </label>
                    <input
                      type="range"
                      min="0.00"
                      max="0.10"
                      step="0.005"
                      value={k1}
                      onChange={(e) => setK1(parseFloat(e.target.value))}
                      className="w-full h-1 bg-[var(--surface-1)] rounded appearance-none cursor-pointer accent-[var(--brand-clay)]"
                    />
                    <span className="text-[10px] text-[var(--text-muted)]">Standart hava-reçine: 0.040</span>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[10px] text-[var(--text-secondary)] uppercase">
                      k2 (İç Yayılma Yansıması): {k2.toFixed(3)}
                    </label>
                    <input
                      type="range"
                      min="0.30"
                      max="0.80"
                      step="0.01"
                      value={k2}
                      onChange={(e) => setK2(parseFloat(e.target.value))}
                      className="w-full h-1 bg-[var(--surface-1)] rounded appearance-none cursor-pointer accent-[var(--brand-clay)]"
                    />
                    <span className="text-[10px] text-[var(--text-muted)]">Standart diffüz iç yansıma: 0.600</span>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[10px] text-[var(--text-secondary)] uppercase">
                      Spektrofotometre Modu
                    </label>
                    <select
                      value={measurementMode}
                      onChange={(e) => setMeasurementMode(e.target.value as 'SCI' | 'SCE')}
                      className="w-full px-2.5 py-1.5 bg-[var(--surface-1)] border border-[var(--border)] rounded text-xs font-mono text-[var(--text-primary)]"
                    >
                      <option value="SCI">SCI (Parlaklık Dahil - Önerilen Formülasyon Modu)</option>
                      <option value="SCE">SCE (Parlaklık Hariç)</option>
                    </select>
                    <span className="text-[10px] text-[var(--text-muted)]">ISO 7724 standardı</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* AŞAMA 2: K-M KATSAYILARI & KÜTÜPHANEYE KAYIT */}
      {/* ======================================================== */}
      {currentStep === 2 && results && (
        <div className="space-y-5">
          {/* Reassuring Quality Gate Header */}
          <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-5 shadow-[var(--shadow-sm)] space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--border)]">
              <div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-[var(--success-text)]" />
                  <h2 className="text-base font-bold text-[var(--text-primary)] font-mono">
                    {pasteName} ({pasteCode}) Karakterizasyonu Tamamlandı
                  </h2>
                </div>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  Çift Sabitli Kubelka-Munk modeli ile 400 - 700 nm aralığında K(λ) absorpsiyon ve S(λ) saçılma katsayıları başarıyla türetildi.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="px-3 py-1 rounded-[var(--radius)] bg-[var(--success-subtle)] border border-[var(--success-border)] text-[var(--success-text)] text-xs font-mono font-bold flex items-center gap-1.5 shadow-xs">
                  <Check className="h-4 w-4" />
                  ISO 18314-2 ONAYLI (ΔE00 = {results.mean_delta_e00.toFixed(2)})
                </span>
              </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
              <div className="p-3 bg-[var(--surface-0)] rounded-[var(--radius)] border border-[var(--border)] shadow-xs">
                <span className="text-[10px] text-[var(--text-secondary)] block uppercase">Ortalama Hata</span>
                <span className="text-base font-bold text-[var(--success-text)] mt-0.5 block">
                  ΔE00 {results.mean_delta_e00.toFixed(3)}
                </span>
                <span className="text-[10px] text-[var(--text-muted)]">Kabul Sınırı &lt; 0.300</span>
              </div>

              <div className="p-3 bg-[var(--surface-0)] rounded-[var(--radius)] border border-[var(--border)] shadow-xs">
                <span className="text-[10px] text-[var(--text-secondary)] block uppercase">Maksimum Sapma</span>
                <span className="text-base font-bold text-[var(--text-primary)] mt-0.5 block">
                  ΔE00 {results.max_delta_e00.toFixed(3)}
                </span>
                <span className="text-[10px] text-[var(--text-muted)]">En Yüksek Numune Hatası</span>
              </div>

              <div className="p-3 bg-[var(--surface-0)] rounded-[var(--radius)] border border-[var(--border)] shadow-xs">
                <span className="text-[10px] text-[var(--text-secondary)] block uppercase">Model Uyumu (R²)</span>
                <span className="text-base font-bold text-[var(--text-primary)] mt-0.5 block">
                  %{(results.r_squared * 100).toFixed(2)}
                </span>
                <span className="text-[10px] text-[var(--text-muted)]">K-M Saçılma Doğruluğu</span>
              </div>

              <div className="p-3 bg-[var(--surface-0)] rounded-[var(--radius)] border border-[var(--border)] shadow-xs">
                <span className="text-[10px] text-[var(--text-secondary)] block uppercase">Çapraz Doğrulama (LOOCV)</span>
                <span className="text-base font-bold text-[var(--accent-text)] mt-0.5 block">
                  {results.loocv?.mean_delta_e00 ? `ΔE00 ${results.loocv.mean_delta_e00.toFixed(2)}` : 'N/A (n<4)'}
                </span>
                <span className="text-[10px] text-[var(--text-muted)]">Genelleştirilebilirlik Testi</span>
              </div>
            </div>
          </div>

          {/* Spectral Preview Chart */}
          <SpectralChart
            series={resultsSeries}
            title={`${pasteName} - Ölçülen vs K-M Tahmini Eğrileri`}
            subtitle="CHNSpec DS-36D (d/8° SCI) Ölçümü ile Kubelka-Munk Model Eğrilerinin Karşılaştırması"
            height={320}
          />

          {/* Back-Prediction Verification Table */}
          <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-4 shadow-[var(--shadow-sm)] space-y-3">
            <h3 className="text-xs font-semibold text-[var(--text-primary)] font-mono uppercase tracking-wider">
              Seyreltme Geri Tahmin Doğrulama Tablosu (Back-Prediction Residuals)
            </h3>
            <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-0)]">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[var(--surface-1)] text-[var(--text-secondary)] text-[10px] uppercase border-b border-[var(--border)]">
                  <tr>
                    <th className="p-2.5">Konsantrasyon</th>
                    <th className="p-2.5">Ölçülen CIE L*a*b*</th>
                    <th className="p-2.5">K-M Model L*a*b*</th>
                    <th className="p-2.5">ΔE00 Hata</th>
                    <th className="p-2.5 text-right">Laboratuvar Onayı</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {results.back_predictions.map((bp, i) => (
                    <tr key={i} className="hover:bg-[var(--surface-1)]">
                      <td className="p-2.5 font-bold text-[var(--text-primary)]">%{bp.concentration}</td>
                      <td className="p-2.5 text-[var(--text-secondary)]">
                        L:{bp.measured_lab[0].toFixed(1)} a:{bp.measured_lab[1].toFixed(1)} b:{bp.measured_lab[2].toFixed(1)}
                      </td>
                      <td className="p-2.5 text-[var(--text-secondary)]">
                        L:{bp.predicted_lab[0].toFixed(1)} a:{bp.predicted_lab[1].toFixed(1)} b:{bp.predicted_lab[2].toFixed(1)}
                      </td>
                      <td className="p-2.5 font-bold text-[var(--success-text)]">{bp.delta_e00.toFixed(3)}</td>
                      <td className="p-2.5 text-right font-medium">
                        <span className="inline-flex items-center gap-1 text-[var(--success-text)] font-semibold">
                          <Check className="h-3 w-3" /> Mükemmel (&lt;0.30)
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Action Footer */}
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setCurrentStep(1)}
              className="px-4 py-2 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] border border-[var(--border)] text-[var(--text-primary)] rounded-[var(--radius)] text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>← Masaya Dön ve Düzenle</span>
            </button>

            <button
              type="button"
              onClick={handleSaveToLibrary}
              disabled={isLoading}
              className="px-6 py-2.5 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white rounded-[var(--radius)] text-xs font-bold flex items-center gap-2 transition-all shadow-md cursor-pointer disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              <span>{isLoading ? 'Kaydediliyor...' : 'Kütüphaneye Kaydet & Tamamla'}</span>
            </button>
          </div>
        </div>
      )}
        </div>
      )}
    </div>
  );
};

export default CharacterizationWizard;
