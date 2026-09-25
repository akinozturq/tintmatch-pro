import React, { useState, useEffect } from 'react';
import type {
  BasePaint,
  Letdown,
  CharacterizationResult,
  ChnspecStatusInfo,
  CalibrationHealthInfo
} from '../types';
import {
  calculateCharacterization,
  importRm400,
  fetchSampleDatasets,
  fetchSampleDataset,
  saveCharacterization,
  getChnspecStatus,
  getChnspecCalibrationHealth,
  measureChnspec
} from '../services/api';
import { SpectralChart } from './SpectralChart';
import {
  UploadCloud,
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
}

export const CharacterizationWizard: React.FC<WizardProps> = ({
  bases,
  onComplete,
  onOpenInstruments
}) => {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Hardware Status
  const [deviceStatus, setDeviceStatus] = useState<ChnspecStatusInfo | null>(null);
  const [calHealth, setCalHealth] = useState<CalibrationHealthInfo | null>(null);

  // Acquisition mode: 'live' (device measurement) | 'file' (upload) | 'sample' (presets)
  const [acquisitionMode, setAcquisitionMode] = useState<'live' | 'file' | 'sample'>('live');

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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setErrorMessage(null);
    setAcquisitionMode('file');
    setUploadedFileName(file.name);

    try {
      const parsed = await importRm400(file);
      if (parsed.samples.length === 0) {
        throw new Error('Dosyada 31 kanallı (400-700 nm) spektral veri bulunamadı.');
      }

      const newLetdowns: Letdown[] = [];
      parsed.samples.forEach((s, idx) => {
        const conc = s.concentration !== null ? s.concentration : (idx === 0 ? 0.1 : idx * 2.0);
        newLetdowns.push({
          concentration: conc,
          reflectance: s.reflectance,
        });
      });

      setLetdowns(newLetdowns);
      setPasteName(parsed.samples[0].name.replace(/\d+%/, '').trim() || file.name.split('.')[0]);
      setSuccessMessage(`${parsed.samples.length} adet spektral okuma ayrıştırıldı.`);
      setCurrentStep(2);
    } catch (err: any) {
      setErrorMessage(err.message || 'Dosya okuma hatası');
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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-800">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-base font-semibold text-zinc-100">
                {isChnspecConnected ? 'CHNSpec DS-36D' : 'Spektrofotometrik'} Renklendirici Karakterizasyonu
              </h2>
              {isChnspecReal ? (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-[10px] font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  CANLI DONANIM: {deviceStatus?.port || 'COM4'}
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400 text-[10px] font-mono">
                  {activeDeviceLabel}
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              {isChnspecConnected ? 'd/8° Çift Işın Entegre Küre • ' : ''}Saunderson yüzey düzeltmesi ve Çift Sabitli Kubelka-Munk modeli ile K(λ), S(λ) türetimi
            </p>
          </div>
          <span className="text-[11px] font-mono text-zinc-400 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 self-start sm:self-auto">
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
                className={`py-2 px-3 rounded-lg border text-left text-xs transition-all flex items-center justify-between ${
                  isActive
                    ? 'bg-zinc-800/90 border-zinc-500 text-zinc-100 font-medium'
                    : isPassed
                    ? 'bg-zinc-950/40 border-zinc-800 text-emerald-400 hover:border-zinc-700'
                    : 'bg-zinc-950/20 border-zinc-900 text-zinc-600 cursor-not-allowed'
                }`}
              >
                <span>{s.label}</span>
                {isPassed && <Check className="h-3 w-3 text-emerald-400" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Notifications */}
      {errorMessage && (
        <div className="p-3 bg-red-950/40 border border-red-900/60 rounded-lg text-xs text-red-300 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
          {onOpenInstruments && (
            <button
              onClick={onOpenInstruments}
              className="text-[11px] font-mono underline hover:text-white"
            >
              Cihaz Masasını Aç
            </button>
          )}
        </div>
      )}

      {successMessage && (
        <div className="p-3 bg-emerald-950/40 border border-emerald-900/60 rounded-lg text-xs text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* ======================================================== */}
      {/* ADIM 1: Veri Kaynağı Seçimi (Canlı Ölçüm / Dosya / Örnek) */}
      {/* ======================================================== */}
      {currentStep === 1 && (
        <div className="space-y-4">
          <div className="space-y-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 font-mono">
              Adım 1: Karakterizasyon Veri Giriş Yöntemi
            </h3>
            <p className="text-xs text-zinc-400">
              Spektrofotometreniz bağlıysa seyreltme kartlarını (drawdown) doğrudan masada adım adım ölçebilir veya önceden kaydedilmiş dosyaları içe aktarabilirsiniz.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* OPTION 1: LIVE HARDWARE MEASUREMENT (RECOMMENDED) */}
            <div
              className={`p-5 rounded-xl border flex flex-col justify-between transition-all ${
                isChnspecConnected
                  ? 'bg-blue-950/20 border-blue-800/80 shadow-lg shadow-blue-950/30'
                  : 'bg-zinc-900/60 border-zinc-800 hover:border-zinc-700'
              }`}
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="w-8 h-8 rounded-lg bg-blue-900/40 border border-blue-700/60 flex items-center justify-center text-blue-400">
                    <Zap className="h-4 w-4" />
                  </div>
                  {isChnspecConnected ? (
                    <span className="px-2 py-0.5 rounded bg-emerald-950 border border-emerald-800 text-emerald-400 text-[10px] font-mono font-medium">
                      ★ ÖNERİLEN
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[10px] font-mono">
                      DONANIM
                    </span>
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-zinc-100">Cihazdan Canlı Ölçüm</h4>
                  <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                    Bağlı spektrofotometre ile seyreltme kartlarını doğrudan masada adım adım ölçün. Dosya yüklemeye gerek yoktur.
                  </p>
                </div>

                {/* Device hardware badge info */}
                <div className="p-2.5 rounded bg-zinc-950/80 border border-zinc-800/80 text-[11px] font-mono space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Cihaz:</span>
                    <span className="text-zinc-200">{activeDeviceLabel}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Kalibrasyon:</span>
                    <span className={isCalibrated ? 'text-emerald-400' : 'text-amber-400'}>
                      {isCalibrated ? 'Geçerli' : 'Kalibrasyon Gerekli'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-4 space-y-2">
                <button
                  onClick={handleStartLiveAcquisition}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-md shadow-blue-900/40"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  <span>Canlı Ölçüm Serisi Başlat</span>
                </button>
                {onOpenInstruments && (
                  <button
                    onClick={onOpenInstruments}
                    className="w-full py-1 text-center text-[11px] font-mono text-zinc-400 hover:text-zinc-200 transition-colors"
                  >
                    Donanım Masası & Kalibrasyon
                  </button>
                )}
              </div>
            </div>

            {/* OPTION 2: FILE UPLOAD (RM400 / CxF3 / CSV) */}
            <div className="p-5 rounded-xl border bg-zinc-900/60 border-zinc-800 hover:border-zinc-700 flex flex-col justify-between transition-all">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="w-8 h-8 rounded-lg bg-zinc-800/60 border border-zinc-700 flex items-center justify-center text-zinc-300">
                    <UploadCloud className="h-4 w-4" />
                  </div>
                  <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[10px] font-mono">
                    DIŞ DOSYA
                  </span>
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-zinc-100">Ölçüm Dosyası Yükle</h4>
                  <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                    X-Rite RM400, CxF3, CSV, TXT veya XML formatında önceden kaydedilmiş spektral yansıma dosyasını içe aktarın.
                  </p>
                </div>

                <div className="border border-dashed border-zinc-800 hover:border-zinc-600 bg-zinc-950/40 rounded-lg p-3 text-center transition-colors">
                  <input
                    type="file"
                    id="rm400-upload"
                    accept=".csv,.txt,.xml,.cxf"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <label htmlFor="rm400-upload" className="cursor-pointer space-y-1 block">
                    <span className="text-xs text-blue-400 hover:underline block font-medium">
                      Dosya Seçin veya Bırakın
                    </span>
                    <span className="text-[10px] text-zinc-500 font-mono block">
                      400-700 nm @ 10 nm
                    </span>
                  </label>
                </div>
              </div>

              {uploadedFileName && (
                <div className="pt-3">
                  <span className="text-[11px] font-mono text-zinc-400 truncate block">
                    Yüklü: {uploadedFileName}
                  </span>
                </div>
              )}
            </div>

            {/* OPTION 3: INDUSTRIAL SAMPLE DATASETS */}
            <div className="p-5 rounded-xl border bg-zinc-900/60 border-zinc-800 hover:border-zinc-700 flex flex-col justify-between transition-all">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="w-8 h-8 rounded-lg bg-emerald-950/50 border border-emerald-800/60 flex items-center justify-center text-emerald-400">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[10px] font-mono">
                    ÖRNEKLER
                  </span>
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-zinc-100">Hazır Kalibrasyon Seti</h4>
                  <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                    Standart endüstriyel pigment kalibrasyon setlerini (6 seyreltme serisi) hızlıca yükleyip inceleyin.
                  </p>
                </div>

                <div className="space-y-1.5">
                  {availableSamples.map((samp) => (
                    <div
                      key={samp.key}
                      onClick={() => handleLoadSample(samp.key)}
                      className="p-2 bg-zinc-950/70 border border-zinc-800 rounded-lg hover:border-zinc-600 cursor-pointer transition-colors flex items-center gap-2"
                    >
                      <span
                        className="w-3 h-3 rounded-full flex-shrink-0 border border-zinc-700"
                        style={{ backgroundColor: samp.color_hex }}
                      />
                      <div className="overflow-hidden min-w-0">
                        <p className="text-xs font-medium text-zinc-200 truncate">{samp.name}</p>
                        <p className="text-[10px] text-zinc-500 font-mono">{samp.code} • 6 Seyreltme</p>
                      </div>
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
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-6 space-y-6">
          <div className="space-y-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 font-mono">
              Adım 2: Referans Baz Boya ve Yüzey Parametreleri
            </h3>
            <p className="text-xs text-zinc-400">
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
                  className={`p-3 rounded-lg border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-zinc-800/90 border-zinc-500'
                      : 'bg-zinc-950/60 border-zinc-800 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full border border-zinc-700"
                      style={{ backgroundColor: base.hex }}
                    />
                    <h4 className="text-xs font-medium text-zinc-200 truncate">{base.name}</h4>
                  </div>
                  <div className="text-[10px] font-mono text-zinc-400 space-y-0.5">
                    <div>Kontrast: %{base.contrast_ratio}</div>
                    <div className={base.is_opaque ? 'text-emerald-400' : 'text-zinc-300'}>
                      {base.is_opaque ? 'Opak (≥%98)' : 'Şeffaf'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Saunderson sliders */}
          <div className="p-4 bg-zinc-950 rounded-lg border border-zinc-800 space-y-4">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-zinc-300 font-semibold uppercase tracking-wider text-[11px]">
                Saunderson Yüzey Düzeltme Katsayıları
              </span>
              <span className="text-zinc-400">k1={k1.toFixed(3)} · k2={k2.toFixed(3)}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 text-xs font-mono">
              <div className="space-y-1.5">
                <div className="flex justify-between text-zinc-400">
                  <span>k1 (Fresnel Dış Yansıma):</span>
                  <span className="text-zinc-100">{k1.toFixed(3)}</span>
                </div>
                <input
                  type="range"
                  min="0.00"
                  max="0.10"
                  step="0.005"
                  value={k1}
                  onChange={(e) => setK1(parseFloat(e.target.value))}
                  className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
                />
                <span className="text-[10px] text-zinc-400">Standart: 0.040</span>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-zinc-400">
                  <span>k2 (İç Yayılma Yansıması):</span>
                  <span className="text-zinc-100">{k2.toFixed(3)}</span>
                </div>
                <input
                  type="range"
                  min="0.30"
                  max="0.80"
                  step="0.01"
                  value={k2}
                  onChange={(e) => setK2(parseFloat(e.target.value))}
                  className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
                />
                <span className="text-[10px] text-zinc-400">Standart: 0.600</span>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <div className="flex justify-between pt-2">
            <button
              onClick={() => setCurrentStep(1)}
              className="px-3.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Geri</span>
            </button>
            <button
              onClick={() => setCurrentStep(3)}
              className="px-4 py-1.5 bg-zinc-100 hover:bg-white text-zinc-900 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
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
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-6 space-y-6">
          <div className="space-y-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 font-mono">
              Adım 3: Pigment Tanımı ve Seyreltme Ölçümleri
            </h3>
            <p className="text-xs text-zinc-400">
              Renklendirici pasta bilgilerini girin ve hazırladığınız seyreltme kartlarını doğrudan spektrofotometre ile ölçün.
            </p>
          </div>

          {/* Form fields */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 p-3.5 bg-zinc-950 rounded-lg border border-zinc-800 text-xs">
            <div>
              <label className="block text-[10px] font-mono uppercase text-zinc-400 mb-1">Pasta Adı</label>
              <input
                type="text"
                value={pasteName}
                onChange={(e) => setPasteName(e.target.value)}
                placeholder="Örn: Ftalosiyanin Mavi"
                className="w-full px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded text-xs text-zinc-200 focus:outline-none focus:border-zinc-600"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono uppercase text-zinc-400 mb-1">Pigment Kodu</label>
              <input
                type="text"
                value={pasteCode}
                onChange={(e) => setPasteCode(e.target.value)}
                placeholder="Örn: PB15:3"
                className="w-full px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded text-xs text-zinc-200 font-mono focus:outline-none focus:border-zinc-600"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono uppercase text-zinc-400 mb-1">Yoğunluk (g/cm³)</label>
              <input
                type="number"
                step="0.01"
                value={pasteDensity}
                onChange={(e) => setPasteDensity(parseFloat(e.target.value) || 1.0)}
                className="w-full px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded text-xs text-zinc-200 font-mono focus:outline-none focus:border-zinc-600"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono uppercase text-zinc-400 mb-1">Renk (Hex)</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={colorHex}
                  onChange={(e) => setColorHex(e.target.value)}
                  className="w-8 h-8 rounded border border-zinc-700 cursor-pointer bg-transparent"
                />
                <input
                  type="text"
                  value={colorHex}
                  onChange={(e) => setColorHex(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded text-xs text-zinc-200 font-mono uppercase focus:outline-none focus:border-zinc-600"
                />
              </div>
            </div>
          </div>

          {/* ======================================================== */}
          {/* CANLI DONANIM ÖLÇÜM MASASI (LIVE ACQUISITION STATION) */}
          {/* ======================================================== */}
          <div className="p-4 bg-gradient-to-b from-blue-950/20 to-zinc-950/80 border border-blue-900/50 rounded-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.8)] animate-pulse" />
                <h4 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider font-mono">
                  Canlı Spektrofotometre Ölçüm Masası
                </h4>
              </div>

              <div className="flex items-center gap-2 text-xs font-mono">
                <span className="text-zinc-500">Cihaz:</span>
                <span className="text-blue-300 font-medium">{activeDeviceLabel}</span>
                {isChnspecReal && (
                  <span className="px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 text-[10px] border border-emerald-800">
                    HAZIR
                  </span>
                )}
              </div>
            </div>

            <p className="text-xs text-zinc-400">
              Hazırlanan seyreltme kartını cihazın optik ağzına yerleştirin, konsantrasyonu yazıp "Cihaz ile Ölç ve Ekle" butonuna basın.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end pt-1">
              {/* Concentration Input */}
              <div className="sm:col-span-4 space-y-1.5">
                <label className="block text-[11px] font-mono text-zinc-300">
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
                    className="w-full pl-3 pr-8 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-sm font-mono text-zinc-100 font-semibold focus:outline-none focus:border-blue-500"
                  />
                  <span className="absolute right-3 top-2.5 text-xs font-mono text-zinc-500">%</span>
                </div>
              </div>

              {/* Measurement Mode Selector */}
              <div className="sm:col-span-3 space-y-1.5">
                <label className="block text-[11px] font-mono text-zinc-300">
                  Optik Ölçüm Modu:
                </label>
                <select
                  value={newMode}
                  onChange={(e) => setNewMode(e.target.value as 'SCI' | 'SCE')}
                  disabled={isLiveMeasuring}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-xs font-mono text-zinc-200 focus:outline-none focus:border-blue-500"
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
                  className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors shadow-lg shadow-blue-900/30"
                >
                  {isLiveMeasuring ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin text-white" />
                      <span>Ölçülüyor (Flaş patlatılıyor)...</span>
                    </>
                  ) : (
                    <>
                      <Zap className="h-4 w-4 text-amber-300 fill-amber-300" />
                      <span>Cihaz ile Ölç ve Seriye Ekle</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Quick concentration preset chips */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px] font-mono">
              <span className="text-zinc-500 text-[10px]">Hızlı Değerler:</span>
              {[0.1, 0.5, 1.0, 2.5, 5.0, 10.0, 20.0].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setNewConc(preset)}
                  className={`px-2 py-0.5 rounded border transition-colors ${
                    newConc === preset
                      ? 'bg-blue-900/60 border-blue-600 text-blue-200'
                      : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                  }`}
                >
                  %{preset}
                </button>
              ))}
            </div>

            {/* In-progress measuring hint */}
            {isLiveMeasuring && (
              <div className="p-2.5 rounded-lg bg-blue-950/60 border border-blue-800 text-blue-300 text-xs flex items-center gap-2 animate-pulse">
                <RefreshCw className="h-3.5 w-3.5 animate-spin text-blue-400 shrink-0" />
                <span>
                  CHNSpec DS-36D optik yansıma okumasını alıyor, lütfen kartı yerinde sabit tutun (~12-16 sn)...
                </span>
              </div>
            )}
          </div>

          {/* Seyreltme Serisi Tablosu */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-zinc-300 font-semibold uppercase tracking-wider text-[11px]">
                Ölçülen Seyreltme Serisi ({letdowns.length} Ölçüm)
              </span>
              <span className={`text-[11px] ${letdowns.length >= 2 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {letdowns.length >= 2
                  ? `✓ Kubelka-Munk hesaplaması için hazır (${letdowns.length} seyreltme)`
                  : 'En az 2 seyreltme ölçümü gereklidir (önerilen: 4-6)'}
              </span>
            </div>

            {letdowns.length === 0 ? (
              <div className="p-8 border border-dashed border-zinc-800 rounded-lg text-center text-xs text-zinc-500 font-mono">
                Henüz seyreltme ölçümü eklenmedi. Yukarıdaki canlı ölçüm panelinden konsantrasyon girip "Cihaz ile Ölç" butonuna basarak seyreltme kartlarınızı ekleyebilirsiniz.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-zinc-800">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-zinc-950 text-zinc-400 text-[10px] uppercase border-b border-zinc-800">
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
                  <tbody className="divide-y divide-zinc-800/80 bg-zinc-950/40 text-zinc-300">
                    {letdowns.map((ld, idx) => (
                      <tr key={idx} className="hover:bg-zinc-800/20">
                        <td className="p-2.5 text-zinc-400">{idx + 1}</td>
                        <td className="p-2.5">
                          <span
                            className="inline-block w-4 h-4 rounded border border-zinc-700 shadow-sm"
                            style={{ backgroundColor: ld.hex || colorHex }}
                            title={ld.hex || colorHex}
                          />
                        </td>
                        <td className="p-2.5 text-zinc-100 font-medium">%{ld.concentration}</td>
                        <td className="p-2.5 text-zinc-400">
                          {ld.lab ? (
                            <span>L:{ld.lab.L.toFixed(1)} a:{ld.lab.a.toFixed(1)} b:{ld.lab.b.toFixed(1)}</span>
                          ) : (
                            <span className="text-zinc-600">-</span>
                          )}
                        </td>
                        <td className="p-2.5">{((ld.reflectance[0] || 0) * 100).toFixed(1)}%</td>
                        <td className="p-2.5">{((ld.reflectance[15] || 0) * 100).toFixed(1)}%</td>
                        <td className="p-2.5">{((ld.reflectance[30] || 0) * 100).toFixed(1)}%</td>
                        <td className="p-2.5 text-right">
                          <button
                            onClick={() => handleDeleteLetdown(idx)}
                            title="Bu seyreltmeyi sil"
                            className="p-1 text-zinc-500 hover:text-red-400 hover:bg-zinc-800 rounded transition-colors"
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
              className="px-3.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Geri</span>
            </button>
            <button
              onClick={handleRunCalculation}
              disabled={isLoading || letdowns.length < 2}
              className="px-4 py-2 bg-zinc-100 hover:bg-white text-zinc-900 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors disabled:opacity-50"
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
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-6 space-y-6">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 font-mono">
                Adım 4: Geri Tahmin Doğrulama Özeti
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Kubelka-Munk modeli ile seyreltme serisi artık hata analizi • {activeDeviceLabel}
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-mono font-medium">
              <CheckCircle2 className={`h-4 w-4 ${results.passed_validation ? 'text-emerald-400' : 'text-amber-400'}`} />
              <span className={results.passed_validation ? 'text-emerald-400' : 'text-amber-400'}>
                {results.passed_validation ? 'Kalite Kapısı: ONAYLANDI' : 'Kalite Kapısı: İNCELEME GEREKLİ'}
              </span>
            </div>
          </div>

          {/* KPI metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs font-mono">
            <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800">
              <span className="text-[10px] text-zinc-400 block uppercase">Ortalama ΔE00</span>
              <span className="text-base font-bold text-emerald-400 mt-0.5 block">
                {results.mean_delta_e00.toFixed(3)}
              </span>
              <span className="text-[10px] text-zinc-400">Self-Fit &lt; 0.300</span>
            </div>
            <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800">
              <span className="text-[10px] text-zinc-400 block uppercase">Maksimum ΔE00</span>
              <span className="text-base font-bold text-zinc-100 mt-0.5 block">
                {results.max_delta_e00.toFixed(3)}
              </span>
              <span className="text-[10px] text-zinc-400">En Büyük Sapma</span>
            </div>
            <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800">
              <span className="text-[10px] text-zinc-400 block uppercase">Korelasyon (R²)</span>
              <span className="text-base font-bold text-zinc-100 mt-0.5 block">
                {(results.r_squared * 100).toFixed(2)}%
              </span>
              <span className="text-[10px] text-zinc-400">Uyum Oranı</span>
            </div>
            <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800">
              <span className="text-[10px] text-zinc-400 block uppercase">LOOCV (Ort / Max)</span>
              <span className={`text-base font-bold mt-0.5 block ${
                results.loocv?.status === 'LOOCV_EVALUATED'
                  ? (results.loocv.mean_delta_e00 ?? 1) <= 0.50 && (results.loocv.max_delta_e00 ?? 1) <= 1.00 ? 'text-cyan-400' : 'text-amber-400'
                  : 'text-zinc-500'
              }`}>
                {results.loocv?.status === 'LOOCV_EVALUATED' && results.loocv.mean_delta_e00 != null
                  ? `${results.loocv.mean_delta_e00.toFixed(2)} / ${results.loocv.max_delta_e00?.toFixed(2) ?? '-'}`
                  : 'N/A (n<4)'}
              </span>
              <span className="text-[10px] text-zinc-400">Eşik &le;0.50 / &le;1.00</span>
            </div>
            <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800">
              <span className="text-[10px] text-zinc-400 block uppercase">Jacobian Cond</span>
              <span className="text-xs font-bold text-zinc-200 mt-1 block truncate">
                {results.jacobian_diagnostics?.scaled_condition_status || 'WELL_CONDITIONED'}
              </span>
              <span className="text-[10px] text-zinc-400">
                {results.jacobian_diagnostics?.p95_condition_number ? `p95 ≈ ${results.jacobian_diagnostics.p95_condition_number.toFixed(1)}` : results.jacobian_condition_number ? `κ ≈ ${results.jacobian_condition_number.toFixed(1)}` : 'Identifiable'}
              </span>
            </div>
            <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800">
              <span className="text-[10px] text-zinc-400 block uppercase">Model</span>
              <span className="text-xs font-semibold text-zinc-200 mt-1 block truncate">
                {results.model_type}
              </span>
              <span className="text-[10px] text-emerald-400">ISO 18314</span>
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
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-zinc-950 text-zinc-400 text-[10px] uppercase border-b border-zinc-800">
                <tr>
                  <th className="p-2.5">Konsantrasyon</th>
                  <th className="p-2.5">Ölçülen L*a*b*</th>
                  <th className="p-2.5">Model L*a*b*</th>
                  <th className="p-2.5">ΔE00</th>
                  <th className="p-2.5 text-right">Durum</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80 bg-zinc-950/40 text-zinc-300">
                {results.back_predictions.map((bp, i) => (
                  <tr key={i}>
                    <td className="p-2.5 font-medium text-zinc-100">%{bp.concentration}</td>
                    <td className="p-2.5 text-zinc-400">
                      L:{bp.measured_lab[0].toFixed(1)} a:{bp.measured_lab[1].toFixed(1)} b:{bp.measured_lab[2].toFixed(1)}
                    </td>
                    <td className="p-2.5 text-zinc-400">
                      L:{bp.predicted_lab[0].toFixed(1)} a:{bp.predicted_lab[1].toFixed(1)} b:{bp.predicted_lab[2].toFixed(1)}
                    </td>
                    <td className="p-2.5 text-emerald-400 font-semibold">{bp.delta_e00.toFixed(3)}</td>
                    <td className="p-2.5 text-right text-emerald-400">
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
              className="px-3.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Geri Dön</span>
            </button>
            <button
              onClick={handleSaveToLibrary}
              disabled={isLoading}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
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
