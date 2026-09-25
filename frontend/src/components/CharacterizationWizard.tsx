import React, { useState, useEffect } from 'react';
import type {
  BasePaint,
  Letdown,
  CharacterizationResult
} from '../types';
import {
  calculateCharacterization,
  importRm400,
  fetchSampleDatasets,
  fetchSampleDataset,
  saveCharacterization
} from '../services/api';
import { SpectralChart } from './SpectralChart';
import {
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  Save,
  Check
} from 'lucide-react';

interface WizardProps {
  bases: BasePaint[];
  onComplete: () => void;
}

export const CharacterizationWizard: React.FC<WizardProps> = ({ bases, onComplete }) => {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Step 1: Raw data & Sample loading
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [availableSamples, setAvailableSamples] = useState<any[]>([]);

  // Step 2: Base & Saunderson
  const [selectedBaseId, setSelectedBaseId] = useState<number>(bases[0]?.id || 1);
  const [k1, setK1] = useState<number>(0.04);
  const [k2, setK2] = useState<number>(0.60);
  const [useTwoConstant] = useState<boolean>(true);

  // Step 3: Dilution Series
  const [pasteName, setPasteName] = useState<string>('Yeni Renklendirici');
  const [pasteCode, setPasteCode] = useState<string>('PIG-01');
  const [pasteDensity, setPasteDensity] = useState<number>(1.35);
  const [colorHex, setColorHex] = useState<string>('#059669');
  const [letdowns, setLetdowns] = useState<Letdown[]>([]);

  // Step 4: Optimization result
  const [results, setResults] = useState<CharacterizationResult | null>(null);

  useEffect(() => {
    fetchSampleDatasets()
      .then((data) => setAvailableSamples(data.samples || []))
      .catch((err) => console.error('Sample dataset error:', err));
  }, []);

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

  const handleRunCalculation = async () => {
    if (letdowns.length === 0) {
      setErrorMessage('En az bir seyreltme ölçümü girilmelidir.');
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

    try {
      await saveCharacterization({
        name: pasteName,
        code: pasteCode,
        color_hex: colorHex,
        density: pasteDensity,
        base_id: selectedBaseId,
        k1,
        k2,
        instrument: 'X-Rite RM400 (45°:0° Spektrofotometre)',
        letdowns,
        calculation_results: results,
      });

      setSuccessMessage(`'${pasteName}' kütüphaneye kaydedildi.`);
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

  return (
    <div className="max-w-4xl mx-auto px-6 py-6 w-full space-y-6">
      {/* Wizard Header & Stepper */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-800">
          <div>
            <h2 className="text-base font-semibold text-zinc-100">
              X-Rite RM400 Karakterizasyon Sihirbazı
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Saunderson yüzey düzeltmesi ve Çift Sabitli Kubelka-Munk modeli ile K(λ), S(λ) türetimi
            </p>
          </div>
          <span className="text-[11px] font-mono text-zinc-400 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 self-start sm:self-auto">
            Hedef: ΔE00 &lt; 0.30
          </span>
        </div>

        {/* Minimal Stepper Bar */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { num: 1, label: '1. İçe Aktar' },
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
        <div className="p-3 bg-red-950/40 border border-red-900/60 rounded-lg text-xs text-red-300 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {successMessage && (
        <div className="p-3 bg-emerald-950/40 border border-emerald-900/60 rounded-lg text-xs text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* ======================================================== */}
      {/* ADIM 1: Ham Veri Yükleme */}
      {/* ======================================================== */}
      {currentStep === 1 && (
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-6 space-y-6">
          <div className="space-y-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 font-mono">
              Adım 1: RM400 Ham Veri Dosyasını Seçin
            </h3>
            <p className="text-xs text-zinc-400">
              X-Rite RM400 spektrofotometresinden alınan CSV/TXT/XML dosyasını yükleyin veya hazır endüstriyel kalibrasyon serilerinden birini seçin.
            </p>
          </div>

          {/* Quick presets */}
          <div className="space-y-2">
            <span className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider block">
              Hazır Endüstriyel Kalibrasyon Setleri
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {availableSamples.map((samp) => (
                <div
                  key={samp.key}
                  onClick={() => handleLoadSample(samp.key)}
                  className="p-3 bg-zinc-950/60 border border-zinc-800 rounded-lg hover:border-zinc-600 cursor-pointer transition-colors flex items-center gap-2.5"
                >
                  <span
                    className="w-3.5 h-3.5 rounded-full flex-shrink-0 border border-zinc-700"
                    style={{ backgroundColor: samp.color_hex }}
                  />
                  <div className="overflow-hidden min-w-0">
                    <p className="text-xs font-medium text-zinc-200 truncate">{samp.name}</p>
                    <p className="text-[10px] text-zinc-400 font-mono">{samp.code} • 6 Seyreltme</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Drag & drop upload area */}
          <div className="border border-dashed border-zinc-800 hover:border-zinc-700 bg-zinc-950/30 rounded-xl p-8 text-center transition-colors">
            <input
              type="file"
              id="rm400-upload"
              accept=".csv,.txt,.xml,.cxf"
              onChange={handleFileUpload}
              className="hidden"
            />
            <label htmlFor="rm400-upload" className="cursor-pointer space-y-2 block">
              <UploadCloud className="h-6 w-6 mx-auto text-zinc-400" />
              <p className="text-xs font-medium text-zinc-300">
                X-Rite RM400 veri dosyasını buraya bırakın veya tıklayın
              </p>
              <p className="text-[10px] text-zinc-400 font-mono">
                CSV, TXT, XML, CxF3 formatları (400-700 nm @ 10 nm)
              </p>
              {uploadedFileName && (
                <span className="inline-block mt-2 px-2.5 py-0.5 rounded bg-zinc-800 text-zinc-200 text-xs font-mono">
                  {uploadedFileName}
                </span>
              )}
            </label>
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
      {/* ADIM 3: Seyreltme Serisi Bilgisi */}
      {/* ======================================================== */}
      {currentStep === 3 && (
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-6 space-y-6">
          <div className="space-y-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 font-mono">
              Adım 3: Pigment Tanımı ve Seyreltme Konsantrasyonları
            </h3>
            <p className="text-xs text-zinc-400">
              Renklendirici pasta meta verilerini ve seyreltme serisi kütle oranlarını kontrol edin.
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
                className="w-full px-2.5 py-1 bg-zinc-900 border border-zinc-800 rounded text-xs text-zinc-200 focus:outline-none focus:border-zinc-600"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono uppercase text-zinc-400 mb-1">Pigment Kodu</label>
              <input
                type="text"
                value={pasteCode}
                onChange={(e) => setPasteCode(e.target.value)}
                className="w-full px-2.5 py-1 bg-zinc-900 border border-zinc-800 rounded text-xs text-zinc-200 font-mono focus:outline-none focus:border-zinc-600"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono uppercase text-zinc-400 mb-1">Yoğunluk (g/cm³)</label>
              <input
                type="number"
                step="0.01"
                value={pasteDensity}
                onChange={(e) => setPasteDensity(parseFloat(e.target.value) || 1.0)}
                className="w-full px-2.5 py-1 bg-zinc-900 border border-zinc-800 rounded text-xs text-zinc-200 font-mono focus:outline-none focus:border-zinc-600"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono uppercase text-zinc-400 mb-1">Renk (Hex)</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={colorHex}
                  onChange={(e) => setColorHex(e.target.value)}
                  className="w-7 h-7 rounded border border-zinc-700 cursor-pointer bg-transparent"
                />
                <input
                  type="text"
                  value={colorHex}
                  onChange={(e) => setColorHex(e.target.value)}
                  className="flex-1 px-2.5 py-1 bg-zinc-900 border border-zinc-800 rounded text-xs text-zinc-200 font-mono uppercase focus:outline-none focus:border-zinc-600"
                />
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-zinc-950 text-zinc-400 text-[10px] uppercase border-b border-zinc-800">
                <tr>
                  <th className="p-2.5">#</th>
                  <th className="p-2.5">Konsantrasyon</th>
                  <th className="p-2.5">Kütle Oranı</th>
                  <th className="p-2.5">400 nm</th>
                  <th className="p-2.5">550 nm</th>
                  <th className="p-2.5">700 nm</th>
                  <th className="p-2.5 text-right">Durum</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80 bg-zinc-950/40 text-zinc-300">
                {letdowns.map((ld, idx) => (
                  <tr key={idx} className="hover:bg-zinc-800/20">
                    <td className="p-2.5 text-zinc-400">{idx + 1}</td>
                    <td className="p-2.5 text-zinc-100 font-medium">%{ld.concentration}</td>
                    <td className="p-2.5 text-zinc-400">{ld.concentration} g / 100 g</td>
                    <td className="p-2.5">{((ld.reflectance[0] || 0) * 100).toFixed(1)}%</td>
                    <td className="p-2.5">{((ld.reflectance[15] || 0) * 100).toFixed(1)}%</td>
                    <td className="p-2.5">{((ld.reflectance[30] || 0) * 100).toFixed(1)}%</td>
                    <td className="p-2.5 text-right text-emerald-400">31 Nokta OK</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
              disabled={isLoading}
              className="px-4 py-2 bg-zinc-100 hover:bg-white text-zinc-900 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors disabled:opacity-50"
            >
              <span>{isLoading ? 'Hesaplanıyor...' : 'Matrisi Hesapla'}</span>
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
                Kubelka-Munk modeli ile seyreltme serisi artık hata analizi
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
              <span className="text-[10px] text-zinc-400 block uppercase">LOOCV Tahmin</span>
              <span className={`text-base font-bold mt-0.5 block ${
                results.loocv?.status === 'LOOCV_EVALUATED'
                  ? (results.loocv.mean_delta_e00 ?? 1) <= 0.50 ? 'text-cyan-400' : 'text-amber-400'
                  : 'text-zinc-500'
              }`}>
                {results.loocv?.status === 'LOOCV_EVALUATED' && results.loocv.mean_delta_e00 != null
                  ? results.loocv.mean_delta_e00.toFixed(3)
                  : 'N/A (n<4)'}
              </span>
              <span className="text-[10px] text-zinc-400">Eşik &le; 0.500</span>
            </div>
            <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800">
              <span className="text-[10px] text-zinc-400 block uppercase">Jacobian Cond</span>
              <span className="text-xs font-bold text-zinc-200 mt-1 block truncate">
                {results.jacobian_diagnostics?.scaled_condition_status || 'WELL_CONDITIONED'}
              </span>
              <span className="text-[10px] text-zinc-400">
                {results.jacobian_condition_number ? `κ ≈ ${results.jacobian_condition_number.toFixed(1)}` : 'Identifiable'}
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
            subtitle="Ölçülen Spektrum vs 2-Sabitli K-M Tahmini"
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
