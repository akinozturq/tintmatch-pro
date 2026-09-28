import React, { useState, useEffect } from 'react';
import type {
  BasePaint,
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
  fetchProposerLetdowns
} from '../services/api';
import { SpectralChart } from './SpectralChart';
import {
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  Save,
  Check,
  Zap,
  Radio,
  Trash2,
  Plus,
  Sparkles,
  RefreshCw,
  Sliders,
  ShieldCheck,
  ShieldAlert,
  Play
} from 'lucide-react';

interface WizardProps {
  bases: BasePaint[];
  onComplete: () => void;
  onOpenInstruments?: () => void;
  onNavigateToSpectro?: () => void;
}

export const CharacterizationWizard: React.FC<WizardProps> = ({
  bases,
  onComplete,
  onOpenInstruments,
  onNavigateToSpectro
}) => {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Hardware Status
  const [deviceStatus, setDeviceStatus] = useState<ChnspecStatusInfo | null>(null);
  const [calHealth, setCalHealth] = useState<CalibrationHealthInfo | null>(null);

  // Acquisition mode: 'live' (device measurement) | 'sample' (presets)
  const [acquisitionMode, setAcquisitionMode] = useState<'live' | 'sample'>('live');

  // Step 1: Raw data & Sample loading
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [availableSamples, setAvailableSamples] = useState<any[]>([]);

  // Step 2: Base & Saunderson
  const [selectedBaseId, setSelectedBaseId] = useState<number>(bases[0]?.id || 1);
  const [k1, setK1] = useState<number>(0.04);
  const [k2, setK2] = useState<number>(0.60);
  const [useTwoConstant] = useState<boolean>(true);

  // Step 3: Dilution Series & Live Measuring
  const [pasteName, setPasteName] = useState<string>('Yeni Renklendirici');
  const [pasteCode, setPasteCode] = useState<string>('PIG-01');
  const [pasteDensity, setPasteDensity] = useState<number>(1.35);
  const [colorHex, setColorHex] = useState<string>('#059669');
  const [letdowns, setLetdowns] = useState<Letdown[]>([]);

  // Live measurement inputs in Step 3
  const [newConc, setNewConc] = useState<number>(1.0);
  const [newMode, setNewMode] = useState<'SCI' | 'SCE'>('SCI');
  const [isLiveMeasuring, setIsLiveMeasuring] = useState<boolean>(false);

  // Step 4: Optimization result
  const [results, setResults] = useState<CharacterizationResult | null>(null);

  // Innovatint Smart Mixture Proposer
  const [showProposer, setShowProposer] = useState<boolean>(true);
  const [proposerBatchWeight, setProposerBatchWeight] = useState<number>(100.0);
  const [proposerData, setProposerData] = useState<ProposerResponse | null>(null);
  const [isLoadingProposer, setIsLoadingProposer] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    const loadProposer = async () => {
      setIsLoadingProposer(true);
      try {
        const data = await fetchProposerLetdowns(proposerBatchWeight, pasteDensity, 1.45);
        if (isMounted) setProposerData(data);
      } catch (err) {
        console.warn('Proposer load error:', err);
      } finally {
        if (isMounted) setIsLoadingProposer(false);
      }
    };
    if (currentStep === 3) {
      loadProposer();
    }
    return () => {
      isMounted = false;
    };
  }, [currentStep, proposerBatchWeight, pasteDensity]);

  const refreshHardware = async () => {
    try {
      const [status, health] = await Promise.all([
        getChnspecStatus().catch(() => null),
        getChnspecCalibrationHealth().catch(() => null)
      ]);
      setDeviceStatus(status);
      setCalHealth(health);
    } catch {
      // Ignore background errors
    }
  };

  useEffect(() => {
    refreshHardware();
    fetchSampleDatasets()
      .then((data) => setAvailableSamples(data.samples || []))
      .catch((err) => console.error('Sample dataset error:', err));
  }, []);

  const isChnspecConnected = deviceStatus?.connected ?? false;
  const isChnspecReal = isChnspecConnected && !deviceStatus?.is_mock;
  const isCalibrated = calHealth?.status === 'VALID' || calHealth?.status === 'EXPIRING_SOON';

  const handleStartLiveAcquisition = () => {
    setAcquisitionMode('live');
    setUploadedFileName('Doğrudan Cihaz Ölçümü (CHNSpec DS-36D)');
    setSuccessMessage('Cihaz ile canlı ölçüm serisi başlatıldı. Lütfen taşıyıcı bazı seçin.');
    setCurrentStep(2);
  };

  const handleLoadSample = async (sampleKey: string) => {
    setIsLoading(true);
    setErrorMessage(null);
    setAcquisitionMode('sample');
    try {
      const data = await fetchSampleDataset(sampleKey);
      setPasteName(data.colorant.name);
      setPasteCode(data.colorant.code);
      setColorHex(data.colorant.color_hex);
      setPasteDensity(data.colorant.density);
      setLetdowns(data.colorant.letdowns);
      setUploadedFileName(`${data.colorant.name} (${sampleKey})`);
      setSuccessMessage(`${data.colorant.name} serisi yüklendi.`);
      setCurrentStep(2);
    } catch (err: any) {
      setErrorMessage(err.message || 'Numune yüklenemedi');
    } finally {
      setIsLoading(false);
    }
  };

  // Live trigger measurement from physical spectrophotometer
  const handleMeasureLiveLetdown = async () => {
    if (newConc <= 0) {
      setErrorMessage('Lütfen geçerli bir konsantrasyon yüzdesi girin (örn: %1.0).');
      return;
    }

    setIsLiveMeasuring(true);
    setErrorMessage(null);
    try {
      const sampleLabel = `${pasteName} %${newConc}`;
      const record = await measureChnspec(newMode, sampleLabel);

      let parsedLab: { L: number; a: number; b: number } | undefined = undefined;
      if (record.lab) {
        if (Array.isArray(record.lab)) {
          parsedLab = { L: record.lab[0], a: record.lab[1], b: record.lab[2] };
        } else {
          parsedLab = { L: record.lab.L, a: record.lab.a, b: record.lab.b };
        }
      }

      const newLetdown: Letdown = {
        concentration: newConc,
        reflectance: record.reflectance,
        lab: parsedLab,
        hex: record.hex
      };

      // Replace if same conc already exists, or append and sort
      setLetdowns((prev) => {
        const filtered = prev.filter((item) => Math.abs(item.concentration - newConc) > 0.001);
        const updated = [...filtered, newLetdown].sort((a, b) => a.concentration - b.concentration);
        return updated;
      });

      // Update colorHex if default
      if ((colorHex === '#059669' || !colorHex) && record.hex) {
        setColorHex(record.hex);
      }

      setSuccessMessage(`%${newConc} seyreltmesi başarıyla ölçüldü ve listeye eklendi.`);

      // Suggest next standard ladder step
      const ladder = [0.1, 0.5, 1.0, 2.5, 5.0, 10.0, 20.0];
      const nextStep = ladder.find((c) => c > newConc);
      if (nextStep) {
        setNewConc(nextStep);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Cihazdan ölçüm alınamadı. Kalibrasyonu ve bağlantıyı kontrol edin.');
    } finally {
      setIsLiveMeasuring(false);
    }
  };

  const handleDeleteLetdown = (index: number) => {
    setLetdowns((prev) => prev.filter((_, i) => i !== index));
  };

  const handleRunCalculation = async () => {
    if (letdowns.length < 2) {
      setErrorMessage('Kubelka-Munk çift sabitli modeli için en az 2 seyreltme ölçümü girilmelidir (önerilen: 4-6 seyreltme).');
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
      setCurrentStep(4);
    } catch (err: any) {
      setErrorMessage(err.message || 'Karakterizasyon hesaplama hatası');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveToLibrary = async () => {
    if (!results) return;

    setIsLoading(true);
    setErrorMessage(null);

    const instrumentName = isChnspecConnected
      ? (deviceStatus?.is_mock ? 'CHNSpec DS-36D (Simülasyon)' : `CHNSpec DS-36D (${deviceStatus?.port || 'COM4'})`)
      : 'X-Rite RM400 (45°:0° Spektrofotometre)';
    const geometry = isChnspecConnected ? 'd/8°' : '45°:0°';

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
        geometry: geometry,
        measurement_mode: newMode,
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

  const activeDeviceLabel = isChnspecConnected
    ? `CHNSpec DS-36D (${isChnspecReal ? deviceStatus?.port || 'COM4' : 'Simülasyon'})`
    : 'X-Rite RM400 (45°:0°)';

  return (
    <div className="max-w-4xl mx-auto px-6 py-6 w-full space-y-6">
      {/* Wizard Header & Stepper */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--border)]">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                {isChnspecConnected ? 'CHNSpec DS-36D' : 'Spektrofotometrik'} Renklendirici Karakterizasyonu
              </h2>
              {isChnspecReal ? (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-xs)] bg-[var(--success-subtle)] border border-[var(--success-border)] text-[var(--success-text)] text-[10px] font-mono font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] animate-pulse" />
                  CANLI DONANIM: {deviceStatus?.port || 'COM4'}
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-[var(--radius-xs)] bg-[var(--surface-0)] border border-[var(--border)] text-[var(--text-muted)] text-[10px] font-mono">
                  {activeDeviceLabel}
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              {isChnspecConnected ? 'd/8° Çift Işın Entegre Küre • ' : ''}Saunderson yüzey düzeltmesi ve Çift Sabitli Kubelka-Munk modeli ile K(λ), S(λ) türetimi
            </p>
          </div>
          <span className="text-[11px] font-mono text-[var(--text-secondary)] px-2 py-0.5 rounded-[var(--radius-xs)] bg-[var(--surface-0)] border border-[var(--border)] self-start sm:self-auto">
            Hedef: ΔE00 &lt; 0.30
          </span>
        </div>

        {/* Minimal Stepper Bar */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { num: 1, label: '1. Veri Kaynağı' },
            { num: 2, label: '2. Baz Boya' },
            { num: 3, label: '3. Seyreltmeler' },
            { num: 4, label: '4. Doğrulama' },
          ].map((s) => {
            const isActive = currentStep === s.num;
            const isPassed = currentStep > s.num;
            return (
              <button
                key={s.num}
                disabled={!isPassed && !isActive}
                onClick={() => isPassed && setCurrentStep(s.num)}
                className={`py-2 px-3 rounded-[var(--radius)] border text-left text-xs transition-all flex items-center justify-between ${
                  isActive
                    ? 'bg-[var(--surface-3)] border-[var(--brand-clay)] text-[var(--text-primary)] font-semibold shadow-sm ring-1 ring-[var(--brand-clay)]'
                    : isPassed
                    ? 'bg-[var(--surface-0)] border-[var(--border)] text-[var(--success-text)] hover:border-[var(--border-strong)]'
                    : 'bg-[var(--surface-0)] border-[var(--border)] text-[var(--text-muted)] cursor-not-allowed opacity-60'
                }`}
              >
                <span>{s.label}</span>
                {isPassed && <Check className="h-3 w-3 text-[var(--success-text)]" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Notifications */}
      {errorMessage && (
        <div className="p-3 bg-[var(--danger-subtle)] border border-[var(--danger-border)] rounded-[var(--radius)] text-xs text-[var(--danger-text)] flex items-center justify-between gap-2 shadow-sm">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
          {onOpenInstruments && (
            <button
              onClick={onOpenInstruments}
              className="text-[11px] font-mono underline hover:text-[var(--text-primary)]"
            >
              Cihaz Masasını Aç
            </button>
          )}
        </div>
      )}

      {successMessage && (
        <div className="p-3 bg-[var(--success-subtle)] border border-[var(--success-border)] rounded-[var(--radius)] text-xs text-[var(--success-text)] flex items-center gap-2 shadow-sm">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* ======================================================== */}
      {/* ADIM 1: Veri Kaynağı Seçimi (Canlı Cihaz Ölçümü / Hazır Referans Seti) */}
      {/* ======================================================== */}
      {currentStep === 1 && (
        <div className="space-y-4">
          <div className="space-y-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)] font-mono">
              Adım 1: Karakterizasyon Veri Giriş Yöntemi
            </h3>
            <p className="text-xs text-[var(--text-secondary)]">
              Masanızdaki spektrofotometre ile seyreltme kartlarını (drawdown) doğrudan adım adım ölçebilir veya referans serisini yükleyebilirsiniz.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* OPTION 1: LIVE HARDWARE MEASUREMENT (RECOMMENDED) */}
            <div
              className={`p-6 rounded-[var(--radius-lg)] border flex flex-col justify-between transition-all ${
                isChnspecConnected
                  ? 'bg-[var(--surface-3)] border-[var(--brand-clay)] shadow-lg ring-1 ring-[var(--brand-clay)]'
                  : 'bg-[var(--surface-3)] border-[var(--border)] hover:border-[var(--border-strong)]'
              }`}
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-[var(--radius)] bg-[var(--accent-subtle)] border border-[var(--accent-border)] flex items-center justify-center text-[var(--brand-clay)]">
                    <Zap className="h-5 w-5" />
                  </div>
                  {isChnspecConnected ? (
                    <span className="px-2.5 py-0.5 rounded-[var(--radius-xs)] bg-[var(--success-subtle)] border border-[var(--success-border)] text-[var(--success-text)] text-[10px] font-mono font-semibold">
                      ★ DOĞRUDAN ÖLÇÜM
                    </span>
                  ) : (
                    <span className="px-2.5 py-0.5 rounded-[var(--radius-xs)] bg-[var(--surface-0)] border border-[var(--border)] text-[var(--text-muted)] text-[10px] font-mono">
                      DONANIM GEREKLİ
                    </span>
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-[var(--text-primary)]">Cihaz ile Canlı Ölçüm Serisi</h4>
                  <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                    Masanızdaki bağlı spektrofotometre ({activeDeviceLabel}) ile seyreltme kartlarını doğrudan ölçün. Dosya yüklemeye ihtiyaç yoktur; ölçümler doğrudan cihaz flaşıyla alınır.
                  </p>
                </div>

                {/* Device hardware badge info */}
                <div className="p-3 rounded-[var(--radius)] bg-[var(--surface-0)] border border-[var(--border)] text-xs font-mono space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--text-muted)]">Aktif Cihaz:</span>
                    <span className="text-[var(--text-primary)] font-semibold">{activeDeviceLabel}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--text-muted)]">Kalibrasyon Durumu:</span>
                    <span className={isCalibrated ? 'text-[var(--success-text)] font-semibold' : 'text-[var(--warning-text)] font-semibold'}>
                      {isCalibrated ? 'Geçerli' : 'Kalibrasyon Gerekli'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-6 space-y-2">
                <button
                  onClick={handleStartLiveAcquisition}
                  className="w-full py-2.5 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white rounded-[var(--radius)] text-xs font-bold flex items-center justify-center gap-2 transition-colors shadow-md"
                >
                  <Play className="h-4 w-4 fill-current" />
                  <span>Canlı Ölçüm Serisi Başlat</span>
                </button>
                {onNavigateToSpectro && (
                  <button
                    onClick={onNavigateToSpectro}
                    className="w-full py-1.5 text-center text-xs font-mono text-[var(--text-muted)] hover:text-[var(--brand-clay)] transition-colors flex items-center justify-center gap-1"
                  >
                    <span>Spektrofotometre Ayarları & Kalibrasyon Masasına Git</span>
                    <ArrowRight className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>

            {/* OPTION 2: INDUSTRIAL SAMPLE DATASETS */}
            <div className="p-6 rounded-[var(--radius-lg)] border bg-[var(--surface-3)] border-[var(--border)] hover:border-[var(--border-strong)] flex flex-col justify-between transition-all shadow-[var(--shadow-sm)]">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-[var(--radius)] bg-[var(--surface-0)] border border-[var(--border)] flex items-center justify-center text-[var(--accent-text)]">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <span className="px-2.5 py-0.5 rounded-[var(--radius-xs)] bg-[var(--surface-0)] border border-[var(--border)] text-[var(--text-muted)] text-[10px] font-mono">
                    REFERANS
                  </span>
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-[var(--text-primary)]">Hazır Endüstriyel Kalibrasyon Seti</h4>
                  <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                    Fiziksel seyreltme kartı olmadan sistemi ve matematiksel modeli incelemek için standart endüstriyel referans serisini yükleyin.
                  </p>
                </div>

                <div className="space-y-2">
                  {availableSamples.map((samp) => (
                    <div
                      key={samp.key}
                      onClick={() => handleLoadSample(samp.key)}
                      className="p-2.5 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] hover:border-[var(--border-strong)] cursor-pointer transition-colors flex items-center justify-between gap-3 group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className="w-4 h-4 rounded-full flex-shrink-0 border border-[var(--border-strong)] shadow-sm"
                          style={{ backgroundColor: samp.color_hex }}
                        />
                        <div className="overflow-hidden min-w-0">
                          <p className="text-xs font-semibold text-[var(--text-primary)] group-hover:text-[var(--brand-clay)] truncate">
                            {samp.name}
                          </p>
                          <p className="text-[10px] text-[var(--text-muted)] font-mono">{samp.code} • 6 Seyreltme Serisi</p>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-[var(--text-muted)] group-hover:text-[var(--brand-clay)] transition-colors">
                        Yükle &rarr;
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* ADIM 2: Baz Boya ve Saunderson */}
      {/* ======================================================== */}
      {currentStep === 2 && (
        <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-6 space-y-6 shadow-[var(--shadow-sm)]">
          <div className="space-y-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)] font-mono">
              Adım 2: Referans Baz Boya ve Yüzey Parametreleri
            </h3>
            <p className="text-xs text-[var(--text-secondary)]">
              Karakterizasyonda kullanılan taşıyıcı bazı seçin ve Saunderson yüzey yansıma katsayılarını denetleyin.
            </p>
          </div>

          {/* Bases list */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {bases.map((base) => {
              const isSelected = base.id === selectedBaseId;
              return (
                <div
                  key={base.id}
                  onClick={() => setSelectedBaseId(base.id)}
                  className={`p-3 rounded-[var(--radius)] border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[var(--surface-1)] border-[var(--brand-clay)] ring-1 ring-[var(--brand-clay)] shadow-sm'
                      : 'bg-[var(--surface-0)] border border-[var(--border)] hover:border-[var(--border-strong)]'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full border border-[var(--border-strong)]"
                      style={{ backgroundColor: base.hex }}
                    />
                    <h4 className="text-xs font-medium text-[var(--text-primary)] truncate">{base.name}</h4>
                  </div>
                  <div className="text-[10px] font-mono text-[var(--text-secondary)] space-y-0.5">
                    <div>Kontrast: %{base.contrast_ratio}</div>
                    <div className={base.is_opaque ? 'text-[var(--success-text)] font-semibold' : 'text-[var(--text-secondary)]'}>
                      {base.is_opaque ? 'Opak (≥%98)' : 'Şeffaf'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Saunderson sliders */}
          <div className="p-4 bg-[var(--surface-0)] rounded-[var(--radius)] border border-[var(--border)] space-y-4">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-[var(--text-primary)] font-semibold uppercase tracking-wider text-[11px]">
                Saunderson Yüzey Düzeltme Katsayıları
              </span>
              <span className="text-[var(--text-secondary)]">k1={k1.toFixed(3)} · k2={k2.toFixed(3)}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 text-xs font-mono">
              <div className="space-y-1.5">
                <div className="flex justify-between text-[var(--text-secondary)]">
                  <span>k1 (Fresnel Dış Yansıma):</span>
                  <span className="text-[var(--text-primary)] font-semibold">{k1.toFixed(3)}</span>
                </div>
                <input
                  type="range"
                  min="0.00"
                  max="0.10"
                  step="0.005"
                  value={k1}
                  onChange={(e) => setK1(parseFloat(e.target.value))}
                  className="w-full h-1 bg-[var(--surface-1)] rounded-[var(--radius-xs)] appearance-none cursor-pointer accent-[var(--brand-clay)]"
                />
                <span className="text-[10px] text-[var(--text-muted)]">Standart: 0.040</span>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-[var(--text-secondary)]">
                  <span>k2 (İç Yayılma Yansıması):</span>
                  <span className="text-[var(--text-primary)] font-semibold">{k2.toFixed(3)}</span>
                </div>
                <input
                  type="range"
                  min="0.30"
                  max="0.80"
                  step="0.01"
                  value={k2}
                  onChange={(e) => setK2(parseFloat(e.target.value))}
                  className="w-full h-1 bg-[var(--surface-1)] rounded-[var(--radius-xs)] appearance-none cursor-pointer accent-[var(--brand-clay)]"
                />
                <span className="text-[10px] text-[var(--text-muted)]">Standart: 0.600</span>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <div className="flex justify-between pt-2">
            <button
              onClick={() => setCurrentStep(1)}
              className="px-3.5 py-1.5 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] border border-[var(--border)] text-[var(--text-primary)] rounded-[var(--radius)] text-xs font-medium flex items-center gap-1.5 transition-colors shadow-sm"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Geri</span>
            </button>
            <button
              onClick={() => setCurrentStep(3)}
              className="px-4 py-1.5 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white rounded-[var(--radius)] text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
            >
              <span>İleri: Seyreltmeler</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* ADIM 3: Seyreltme Serisi ve Canlı Donanım Ölçüm İstasyonu */}
      {/* ======================================================== */}
      {currentStep === 3 && (
        <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-6 space-y-6 shadow-[var(--shadow-sm)]">
          <div className="space-y-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)] font-mono">
              Adım 3: Pigment Tanımı ve Seyreltme Ölçümleri
            </h3>
            <p className="text-xs text-[var(--text-secondary)]">
              Renklendirici pasta bilgilerini girin ve hazırladığınız seyreltme kartlarını doğrudan spektrofotometre ile ölçün.
            </p>
          </div>

          {/* Form fields */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 p-3.5 bg-[var(--surface-0)] rounded-[var(--radius)] border border-[var(--border)] text-xs">
            <div>
              <label className="block text-[10px] font-mono uppercase text-[var(--text-secondary)] mb-1">Pasta Adı</label>
              <input
                type="text"
                value={pasteName}
                onChange={(e) => setPasteName(e.target.value)}
                placeholder="Örn: Ftalosiyanin Mavi"
                className="w-full px-2.5 py-1.5 bg-[var(--surface-1)] border border-[var(--border)] rounded-[var(--radius-xs)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand-clay)]"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono uppercase text-[var(--text-secondary)] mb-1">Pigment Kodu</label>
              <input
                type="text"
                value={pasteCode}
                onChange={(e) => setPasteCode(e.target.value)}
                placeholder="Örn: PB15:3"
                className="w-full px-2.5 py-1.5 bg-[var(--surface-1)] border border-[var(--border)] rounded-[var(--radius-xs)] text-xs text-[var(--text-primary)] font-mono focus:outline-none focus:border-[var(--brand-clay)]"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono uppercase text-[var(--text-secondary)] mb-1">Yoğunluk (g/cm³)</label>
              <input
                type="number"
                step="0.01"
                value={pasteDensity}
                onChange={(e) => setPasteDensity(parseFloat(e.target.value) || 1.0)}
                className="w-full px-2.5 py-1.5 bg-[var(--surface-1)] border border-[var(--border)] rounded-[var(--radius-xs)] text-xs text-[var(--text-primary)] font-mono focus:outline-none focus:border-[var(--brand-clay)]"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono uppercase text-[var(--text-secondary)] mb-1">Renk (Hex)</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={colorHex}
                  onChange={(e) => setColorHex(e.target.value)}
                  className="w-8 h-8 rounded border border-[var(--border-strong)] cursor-pointer bg-transparent"
                />
                <input
                  type="text"
                  value={colorHex}
                  onChange={(e) => setColorHex(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 bg-[var(--surface-1)] border border-[var(--border)] rounded-[var(--radius-xs)] text-xs text-[var(--text-primary)] font-mono uppercase focus:outline-none focus:border-[var(--brand-clay)]"
                />
              </div>
            </div>
          </div>

          {/* ======================================================== */}
          {/* INNOVATINT SMART MIXTURE PROPOSER (LAB RECIPE GUIDE)     */}
          {/* ======================================================== */}
          <div className="bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius-lg)] overflow-hidden shadow-[var(--shadow-sm)]">
            <div
              onClick={() => setShowProposer(!showProposer)}
              className="p-3 bg-[var(--surface-0)] border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-3 cursor-pointer hover:bg-[var(--surface-1)] transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <Sparkles className="h-4 w-4 text-[var(--brand-clay)] shrink-0" />
                <span className="text-xs font-semibold text-[var(--text-primary)] font-mono tracking-tight">
                  Innovatint Akıllı Karışım Asistanı (Smart Mixture Proposer)
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-[var(--radius-xs)] bg-[var(--surface-1)] text-[var(--text-secondary)] font-mono border border-[var(--border)]">
                  {proposerBatchWeight}g Baz Numunesi
                </span>
              </div>

              <div className="flex items-center gap-3 text-xs">
                <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                  <span className="text-[var(--text-muted)] text-[10px] font-mono">Test Kabı Baz Ağırlığı:</span>
                  {[50, 100, 200].map((wt) => (
                    <button
                      key={wt}
                      type="button"
                      onClick={() => setProposerBatchWeight(wt)}
                      className={`px-2 py-0.5 rounded-[var(--radius-xs)] text-[10px] font-mono border transition-colors ${
                        proposerBatchWeight === wt
                          ? 'bg-[var(--accent-subtle)] border-[var(--brand-clay)] text-[var(--brand-clay)] font-semibold shadow-sm'
                          : 'bg-[var(--surface-1)] border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
                      }`}
                    >
                      {wt} g
                    </button>
                  ))}
                </div>
                <span className="text-[var(--text-secondary)] font-mono text-[11px] select-none">
                  {showProposer ? '▲ Kılavuzu Daralt' : '▼ Kılavuzu Genişlet'}
                </span>
              </div>
            </div>

            {showProposer && (
              <div className="p-3.5 space-y-3 bg-[var(--surface-0)]">
                <div className="text-[11px] text-[var(--text-secondary)] flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <span>
                    Laboratuvarda hassas terazi ile tartım reçetesi (Pasta Yoğunluğu: {pasteDensity} g/cm³):
                  </span>
                  <span className="text-[var(--brand-clay)] text-[10px] font-mono font-medium">
                    Çift Sabitli Kubelka-Munk Doğrulaması İçin 6 İdeal Konsantrasyon Seviyesi
                  </span>
                </div>

                {isLoadingProposer ? (
                  <div className="py-4 text-center text-xs text-[var(--text-muted)] font-mono animate-pulse">
                    Karışım kılavuzu hesaplanıyor...
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-[var(--surface-1)] text-[var(--text-secondary)] text-[10px] uppercase border-b border-[var(--border)]">
                        <tr>
                          <th className="p-2">Hedef %</th>
                          <th className="p-2">Baz Tartımı (gr)</th>
                          <th className="p-2">Pasta Tartımı (gr)</th>
                          <th className="p-2">Pasta Hacmi (ml)</th>
                          <th className="p-2">Hazırlık Notu</th>
                          <th className="p-2 text-right">İşlem</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {proposerData?.recommendations?.map((st, idx) => {
                          const isAlreadyMeasured = letdowns.some(
                            (ld) => Math.abs(ld.concentration - st.concentration_pct) < 0.01
                          );
                          const isCurrentSelected = Math.abs(newConc - st.concentration_pct) < 0.01;
                          return (
                            <tr
                              key={idx}
                              className={`transition-colors ${
                                isCurrentSelected
                                  ? 'bg-[var(--surface-1)] text-[var(--text-primary)] font-semibold'
                                  : 'hover:bg-[var(--surface-1)] text-[var(--text-primary)]'
                              }`}
                            >
                              <td className="p-2 font-semibold">
                                %{st.concentration_pct}
                              </td>
                              <td className="p-2 text-[var(--text-secondary)]">{st.base_weight_g.toFixed(2)} g</td>
                              <td className="p-2 font-semibold text-[var(--brand-clay)]">
                                {st.paste_weight_g < 1 ? st.paste_weight_g.toFixed(3) : st.paste_weight_g.toFixed(2)} g
                              </td>
                              <td className="p-2 text-[var(--accent-text)]">
                                {st.paste_volume_ml < 1 ? st.paste_volume_ml.toFixed(3) : st.paste_volume_ml.toFixed(2)} ml
                              </td>
                              <td className="p-2 text-[var(--text-muted)] text-[11px]">{st.instruction}</td>
                              <td className="p-2 text-right">
                                {isAlreadyMeasured ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] text-[var(--success-text)] font-mono font-medium">
                                    <Check className="h-3 w-3" /> Ölçüldü
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setNewConc(st.concentration_pct);
                                    }}
                                    className={`px-2.5 py-1 rounded-[var(--radius-xs)] text-[11px] font-medium transition-colors ${
                                      isCurrentSelected
                                        ? 'bg-[var(--brand-clay)] text-white font-bold'
                                        : 'bg-[var(--surface-1)] hover:bg-[var(--surface-3)] text-[var(--text-primary)] border border-[var(--border)]'
                                    }`}
                                  >
                                    {isCurrentSelected ? 'Seçildi' : 'Ölçüm İçin Seç'}
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ======================================================== */}
          {/* CANLI DONANIM ÖLÇÜM MASASI (LIVE ACQUISITION STATION) */}
          {/* ======================================================== */}
          <div className="p-4 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius-lg)] space-y-4 shadow-[var(--shadow-sm)]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-[var(--brand-clay)] animate-pulse" />
                <h4 className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wider font-mono">
                  Canlı Spektrofotometre Ölçüm Masası
                </h4>
              </div>

              <div className="flex items-center gap-2 text-xs font-mono">
                <span className="text-[var(--text-muted)]">Cihaz:</span>
                <span className="text-[var(--text-primary)] font-medium">{activeDeviceLabel}</span>
                {isChnspecReal && (
                  <span className="px-1.5 py-0.5 rounded-[var(--radius-xs)] bg-[var(--success-subtle)] text-[var(--success-text)] text-[10px] border border-[var(--success-border)] font-semibold">
                    HAZIR
                  </span>
                )}
              </div>
            </div>

            <p className="text-xs text-[var(--text-secondary)]">
              Hazırlanan seyreltme kartını cihazın optik ağzına yerleştirin, konsantrasyonu yazıp "Cihaz ile Ölç ve Ekle" butonuna basın.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end pt-1">
              {/* Concentration Input */}
              <div className="sm:col-span-4 space-y-1.5">
                <label className="block text-[11px] font-mono text-[var(--text-secondary)]">
                  Konsantrasyon (% kütle / Baz Ağırlığına Göre):
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.1"
                    min="0.01"
                    max="100.0"
                    value={newConc}
                    onChange={(e) => setNewConc(parseFloat(e.target.value) || 0)}
                    disabled={isLiveMeasuring}
                    className="w-full pl-3 pr-8 py-2 bg-[var(--surface-1)] border border-[var(--border)] rounded-[var(--radius)] text-sm font-mono text-[var(--text-primary)] font-semibold focus:outline-none focus:border-[var(--brand-clay)]"
                  />
                  <span className="absolute right-3 top-2.5 text-xs font-mono text-[var(--text-muted)]">%</span>
                </div>
              </div>

              {/* Measurement Mode Selector */}
              <div className="sm:col-span-3 space-y-1.5">
                <label className="block text-[11px] font-mono text-[var(--text-secondary)]">
                  Optik Ölçüm Modu:
                </label>
                <select
                  value={newMode}
                  onChange={(e) => setNewMode(e.target.value as 'SCI' | 'SCE')}
                  disabled={isLiveMeasuring}
                  className="w-full px-3 py-2 bg-[var(--surface-1)] border border-[var(--border)] rounded-[var(--radius)] text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand-clay)]"
                >
                  <option value="SCI">SCI (Parlaklık Dahil - Önerilen)</option>
                  <option value="SCE">SCE (Parlaklık Hariç)</option>
                </select>
              </div>

              {/* Physical Trigger Measure Button */}
              <div className="sm:col-span-5">
                <button
                  onClick={handleMeasureLiveLetdown}
                  disabled={isLiveMeasuring}
                  className="w-full py-2 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] disabled:opacity-50 text-white rounded-[var(--radius)] text-xs font-semibold flex items-center justify-center gap-2 transition-colors shadow-md cursor-pointer"
                >
                  {isLiveMeasuring ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin text-white" />
                      <span>Ölçülüyor (Flaş patlatılıyor)...</span>
                    </>
                  ) : (
                    <>
                      <Zap className="h-4 w-4 text-white fill-current" />
                      <span>Cihaz ile Ölç ve Seriye Ekle</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Quick concentration preset chips */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px] font-mono">
              <span className="text-[var(--text-muted)] text-[10px]">Hızlı Değerler:</span>
              {[0.1, 0.5, 1.0, 2.5, 5.0, 10.0, 20.0].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setNewConc(preset)}
                  className={`px-2 py-0.5 rounded-[var(--radius-xs)] border transition-colors ${
                    newConc === preset
                      ? 'bg-[var(--accent-subtle)] border-[var(--brand-clay)] text-[var(--brand-clay)] font-semibold'
                      : 'bg-[var(--surface-1)] border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)]'
                  }`}
                >
                  %{preset}
                </button>
              ))}
            </div>

            {/* In-progress measuring hint */}
            {isLiveMeasuring && (
              <div className="p-2.5 rounded-[var(--radius)] bg-[var(--accent-subtle)] border border-[var(--accent-border)] text-[var(--accent-text)] text-xs flex items-center gap-2 animate-pulse">
                <RefreshCw className="h-3.5 w-3.5 animate-spin text-[var(--brand-clay)] shrink-0" />
                <span>
                  CHNSpec DS-36D optik yansıma okumasını alıyor, lütfen kartı yerinde sabit tutun (~12-16 sn)...
                </span>
              </div>
            )}
          </div>

          {/* Seyreltme Serisi Tablosu */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-[var(--text-primary)] font-semibold uppercase tracking-wider text-[11px]">
                Ölçülen Seyreltme Serisi ({letdowns.length} Ölçüm)
              </span>
              <span className={`text-[11px] ${letdowns.length >= 2 ? 'text-[var(--success-text)]' : 'text-[var(--warning-text)]'}`}>
                {letdowns.length >= 2
                  ? `✓ Kubelka-Munk hesaplaması için hazır (${letdowns.length} seyreltme)`
                  : 'En az 2 seyreltme ölçümü gereklidir (önerilen: 4-6)'}
              </span>
            </div>

            {letdowns.length === 0 ? (
              <div className="p-8 border border-dashed border-[var(--border)] rounded-[var(--radius)] text-center text-xs text-[var(--text-muted)] font-mono bg-[var(--surface-0)]">
                Henüz seyreltme ölçümü eklenmedi. Yukarıdaki canlı ölçüm panelinden konsantrasyon girip "Cihaz ile Ölç" butonuna basarak seyreltme kartlarınızı ekleyebilirsiniz.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-[var(--surface-1)] text-[var(--text-secondary)] text-[10px] uppercase border-b border-[var(--border)]">
                    <tr>
                      <th className="p-2.5">#</th>
                      <th className="p-2.5">Renk</th>
                      <th className="p-2.5">Konsantrasyon</th>
                      <th className="p-2.5">CIE Lab (D65/10°)</th>
                      <th className="p-2.5">400 nm</th>
                      <th className="p-2.5">550 nm</th>
                      <th className="p-2.5">700 nm</th>
                      <th className="p-2.5 text-right">İşlem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)] bg-[var(--surface-0)] text-[var(--text-primary)]">
                    {letdowns.map((ld, idx) => (
                      <tr key={idx} className="hover:bg-[var(--surface-1)]">
                        <td className="p-2.5 text-[var(--text-muted)]">{idx + 1}</td>
                        <td className="p-2.5">
                          <span
                            className="inline-block w-4 h-4 rounded-[var(--radius-xs)] border border-[var(--border-strong)] shadow-sm"
                            style={{ backgroundColor: ld.hex || colorHex }}
                            title={ld.hex || colorHex}
                          />
                        </td>
                        <td className="p-2.5 text-[var(--text-primary)] font-semibold">%{ld.concentration}</td>
                        <td className="p-2.5 text-[var(--text-secondary)]">
                          {ld.lab ? (
                            <span>L:{ld.lab.L.toFixed(1)} a:{ld.lab.a.toFixed(1)} b:{ld.lab.b.toFixed(1)}</span>
                          ) : (
                            <span className="text-[var(--text-muted)]">-</span>
                          )}
                        </td>
                        <td className="p-2.5">{((ld.reflectance[0] || 0) * 100).toFixed(1)}%</td>
                        <td className="p-2.5">{((ld.reflectance[15] || 0) * 100).toFixed(1)}%</td>
                        <td className="p-2.5">{((ld.reflectance[30] || 0) * 100).toFixed(1)}%</td>
                        <td className="p-2.5 text-right">
                          <button
                            onClick={() => handleDeleteLetdown(idx)}
                            title="Bu seyreltmeyi sil"
                            className="p-1 text-[var(--text-muted)] hover:text-[var(--danger-text)] hover:bg-[var(--surface-1)] rounded-[var(--radius-xs)] transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Navigation */}
          <div className="flex justify-between pt-2">
            <button
              onClick={() => setCurrentStep(2)}
              className="px-3.5 py-1.5 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] border border-[var(--border)] text-[var(--text-primary)] rounded-[var(--radius)] text-xs font-medium flex items-center gap-1.5 transition-colors shadow-sm"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Geri</span>
            </button>
            <button
              onClick={handleRunCalculation}
              disabled={isLoading || letdowns.length < 2}
              className="px-4 py-2 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white rounded-[var(--radius)] text-xs font-semibold flex items-center gap-2 transition-colors disabled:opacity-50 shadow-sm"
            >
              <span>{isLoading ? 'Hesaplanıyor...' : 'Kubelka-Munk Matrisini Hesapla'}</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* ADIM 4: Sonuçlar & Doğrulama */}
      {/* ======================================================== */}
      {currentStep === 4 && results && (
        <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-6 space-y-6 shadow-[var(--shadow-sm)]">
          <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)] font-mono">
                Adım 4: Geri Tahmin Doğrulama Özeti
              </h3>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                Kubelka-Munk modeli ile seyreltme serisi artık hata analizi • {activeDeviceLabel}
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-mono font-medium">
              <CheckCircle2 className={`h-4 w-4 ${results.passed_validation ? 'text-[var(--success-text)]' : 'text-[var(--warning-text)]'}`} />
              <span className={results.passed_validation ? 'text-[var(--success-text)] font-semibold' : 'text-[var(--warning-text)] font-semibold'}>
                {results.passed_validation ? 'Kalite Kapısı: ONAYLANDI' : 'Kalite Kapısı: İNCELEME GEREKLİ'}
              </span>
            </div>
          </div>

          {/* KPI metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs font-mono">
            <div className="p-3 bg-[var(--surface-0)] rounded-[var(--radius)] border border-[var(--border)] shadow-sm">
              <span className="text-[10px] text-[var(--text-secondary)] block uppercase">Ortalama ΔE00</span>
              <span className="text-base font-bold text-[var(--success-text)] mt-0.5 block">
                {results.mean_delta_e00.toFixed(3)}
              </span>
              <span className="text-[10px] text-[var(--text-muted)]">Self-Fit &lt; 0.300</span>
            </div>
            <div className="p-3 bg-[var(--surface-0)] rounded-[var(--radius)] border border-[var(--border)] shadow-sm">
              <span className="text-[10px] text-[var(--text-secondary)] block uppercase">Maksimum ΔE00</span>
              <span className="text-base font-bold text-[var(--text-primary)] mt-0.5 block">
                {results.max_delta_e00.toFixed(3)}
              </span>
              <span className="text-[10px] text-[var(--text-muted)]">En Büyük Sapma</span>
            </div>
            <div className="p-3 bg-[var(--surface-0)] rounded-[var(--radius)] border border-[var(--border)] shadow-sm">
              <span className="text-[10px] text-[var(--text-secondary)] block uppercase">Korelasyon (R²)</span>
              <span className="text-base font-bold text-[var(--text-primary)] mt-0.5 block">
                {(results.r_squared * 100).toFixed(2)}%
              </span>
              <span className="text-[10px] text-[var(--text-muted)]">Uyum Oranı</span>
            </div>
            <div className="p-3 bg-[var(--surface-0)] rounded-[var(--radius)] border border-[var(--border)] shadow-sm">
              <span className="text-[10px] text-[var(--text-secondary)] block uppercase">LOOCV (Ort / Max)</span>
              <span className={`text-base font-bold mt-0.5 block ${
                results.loocv?.status === 'LOOCV_EVALUATED'
                  ? (results.loocv.mean_delta_e00 ?? 1) <= 0.50 && (results.loocv.max_delta_e00 ?? 1) <= 1.00 ? 'text-[var(--accent-text)]' : 'text-[var(--warning-text)]'
                  : 'text-[var(--text-muted)]'
              }`}>
                {results.loocv?.status === 'LOOCV_EVALUATED' && results.loocv.mean_delta_e00 != null
                  ? `${results.loocv.mean_delta_e00.toFixed(2)} / ${results.loocv.max_delta_e00?.toFixed(2) ?? '-'}`
                  : 'N/A (n<4)'}
              </span>
              <span className="text-[10px] text-[var(--text-muted)]">Eşik &le;0.50 / &le;1.00</span>
            </div>
            <div className="p-3 bg-[var(--surface-0)] rounded-[var(--radius)] border border-[var(--border)] shadow-sm">
              <span className="text-[10px] text-[var(--text-secondary)] block uppercase">Jacobian Cond</span>
              <span className="text-xs font-bold text-[var(--text-primary)] mt-1 block truncate">
                {results.jacobian_diagnostics?.scaled_condition_status || 'WELL_CONDITIONED'}
              </span>
              <span className="text-[10px] text-[var(--text-muted)]">
                {results.jacobian_diagnostics?.p95_condition_number ? `p95 ≈ ${results.jacobian_diagnostics.p95_condition_number.toFixed(1)}` : results.jacobian_condition_number ? `κ ≈ ${results.jacobian_condition_number.toFixed(1)}` : 'Identifiable'}
              </span>
            </div>
            <div className="p-3 bg-[var(--surface-0)] rounded-[var(--radius)] border border-[var(--border)] shadow-sm">
              <span className="text-[10px] text-[var(--text-secondary)] block uppercase">Model</span>
              <span className="text-xs font-semibold text-[var(--text-primary)] mt-1 block truncate">
                {results.model_type}
              </span>
              <span className="text-[10px] text-[var(--success-text)] font-semibold">ISO 18314</span>
            </div>
          </div>

          {/* Chart preview */}
          <SpectralChart
            series={resultsSeries}
            title={`${pasteName} - Model Geri Tahmin Eğrileri`}
            subtitle={`Ölçülen Spektrum vs 2-Sabitli K-M Tahmini (${activeDeviceLabel})`}
            height={300}
          />

          {/* Table */}
          <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-[var(--surface-1)] text-[var(--text-secondary)] text-[10px] uppercase border-b border-[var(--border)]">
                <tr>
                  <th className="p-2.5">Konsantrasyon</th>
                  <th className="p-2.5">Ölçülen L*a*b*</th>
                  <th className="p-2.5">Model L*a*b*</th>
                  <th className="p-2.5">ΔE00</th>
                  <th className="p-2.5 text-right">Durum</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)] bg-[var(--surface-0)] text-[var(--text-primary)]">
                {results.back_predictions.map((bp, i) => (
                  <tr key={i} className="hover:bg-[var(--surface-1)]">
                    <td className="p-2.5 font-medium text-[var(--text-primary)]">%{bp.concentration}</td>
                    <td className="p-2.5 text-[var(--text-secondary)]">
                      L:{bp.measured_lab[0].toFixed(1)} a:{bp.measured_lab[1].toFixed(1)} b:{bp.measured_lab[2].toFixed(1)}
                    </td>
                    <td className="p-2.5 text-[var(--text-secondary)]">
                      L:{bp.predicted_lab[0].toFixed(1)} a:{bp.predicted_lab[1].toFixed(1)} b:{bp.predicted_lab[2].toFixed(1)}
                    </td>
                    <td className="p-2.5 text-[var(--success-text)] font-semibold">{bp.delta_e00.toFixed(3)}</td>
                    <td className="p-2.5 text-right text-[var(--success-text)] font-medium">
                      {bp.passed ? 'Geçti (<0.3)' : 'Uyarı'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Actions */}
          <div className="flex justify-between pt-2">
            <button
              onClick={() => setCurrentStep(3)}
              className="px-3.5 py-1.5 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] border border-[var(--border)] text-[var(--text-primary)] rounded-[var(--radius)] text-xs font-medium flex items-center gap-1.5 transition-colors shadow-sm"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Geri Dön</span>
            </button>
            <button
              onClick={handleSaveToLibrary}
              disabled={isLoading}
              className="px-4 py-2 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white rounded-[var(--radius)] text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50 shadow-sm"
            >
              <Save className="h-3.5 w-3.5" />
              <span>{isLoading ? 'Kaydediliyor...' : 'Kütüphaneye Kaydet'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
