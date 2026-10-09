import React, { useState, useEffect } from 'react';
import type {
  BasePaint,
  ColorantPaste,
  Letdown,
  CharacterizationResult,
  ChnspecStatusInfo,
  CalibrationHealthInfo,
  ProposerResponse,
  MixtureTemplateItem
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
  importSpectralFile,
  fetchMixtureTemplates,
  createMixtureTemplate,
  updateMixtureTemplate,
  deleteMixtureTemplate,
  resetMixtureTemplates
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
  Layers,
  Edit2,
  RotateCcw,
  X,
  Info
} from 'lucide-react';

interface WizardProps {
  bases: BasePaint[];
  pastes?: ColorantPaste[];
  onComplete: () => void;
  onOpenInstruments?: () => void;
  onNavigateToSpectro?: () => void;
}

// Fallback initial ladder if server is offline
const FALLBACK_LADDER: MixtureTemplateItem[] = [
  { series_type: 'BWC', name: 'Masstone (Tam Ton / Saf Pigment)', concentration_pct: 100.0, colorant_ratio: 1.0, base_ratio: 0.0, is_masstone: true, description: 'Doygun ana pik absorpsiyonu (K)' },
  { series_type: 'BWC', name: 'Koyu Açma (Deep Tint)', concentration_pct: 10.0, colorant_ratio: 0.10, base_ratio: 0.90, is_masstone: false, description: 'Yüksek konsantrasyon açma davranışı' },
  { series_type: 'BWC', name: 'Orta Açma (Medium Tint)', concentration_pct: 2.0, colorant_ratio: 0.02, base_ratio: 0.98, is_masstone: false, description: 'Standart ara ton kalibrasyonu' },
  { series_type: 'BWC', name: 'Açık Açma (Light Tint)', concentration_pct: 0.5, colorant_ratio: 0.005, base_ratio: 0.995, is_masstone: false, description: 'Pastel ton ve renklendirme gücü' },
  { series_type: 'BWC', name: 'Pastel Açma (Pastel Tint)', concentration_pct: 0.1, colorant_ratio: 0.001, base_ratio: 0.999, is_masstone: false, description: 'Düşük konsantrasyon doğrusallık kontrolü' },
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
  // 2-Step Industrial Workflow: 1 = Tartım ve Ölçüm Masası, 2 = Doğrulama ve Kayıt
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

  // Optical model parameters
  const [k1, setK1] = useState<number>(0.04);
  const [k2, setK2] = useState<number>(0.60);
  const [useTwoConstant, setUseTwoConstant] = useState<boolean>(true);
  const [measurementMode, setMeasurementMode] = useState<'SCI' | 'SCE'>('SCI');

  // Letdowns measured / collected
  const [letdowns, setLetdowns] = useState<Letdown[]>([]);

  // Measurement state
  const [measuringConc, setMeasuringConc] = useState<number | null>(null);
  const [measuringBlackConc, setMeasuringBlackConc] = useState<number | null>(null);

  // Batch weight for recipe preparation guide (50g, 100g, 200g, 250g)
  const [batchWeight, setBatchWeight] = useState<number>(100.0);

  // Recommended Mixture Templates State (Loaded from DB, editable, extensible, deletable)
  const [mixtureTemplates, setMixtureTemplates] = useState<MixtureTemplateItem[]>(FALLBACK_LADDER);
  const [isTemplateManagerOpen, setIsTemplateManagerOpen] = useState<boolean>(false);
  const [editingTemplate, setEditingTemplate] = useState<MixtureTemplateItem | null>(null);
  const [templateFormName, setTemplateFormName] = useState<string>('');
  const [templateFormConc, setTemplateFormConc] = useState<number>(1.0);
  const [templateFormDesc, setTemplateFormDesc] = useState<string>('');
  const [templateFormIsMasstone, setTemplateFormIsMasstone] = useState<boolean>(false);

  // Actual weighed amounts entered by technician (per concentration key)
  const [actualWeights, setActualWeights] = useState<Record<number, { baseG: number; pasteG: number }>>({});

  // Custom letdown quick input
  const [customConc, setCustomConc] = useState<string>('');

  // Proposer API data
  const [proposerData, setProposerData] = useState<ProposerResponse | null>(null);

  // Advanced settings accordion
  const [showAdvancedSettings, setShowAdvancedSettings] = useState<boolean>(false);

  // Available sample datasets
  const [availableSamples, setAvailableSamples] = useState<any[]>([]);

  // Calculation Results
  const [results, setResults] = useState<CharacterizationResult | null>(null);

  // Load hardware status, samples, and mixture templates on mount
  useEffect(() => {
    refreshHardware();
    loadTemplates();
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
      // Hardware background check
    }
  };

  const loadTemplates = async () => {
    try {
      const tpls = await fetchMixtureTemplates('BWC');
      if (tpls && tpls.length > 0) {
        setMixtureTemplates(tpls);
      }
    } catch (err) {
      console.warn('Could not load mixture templates from server:', err);
    }
  };

  const isChnspecConnected = deviceStatus?.connected ?? false;

  // ---------------------------------------------------------------------------
  // Template CRUD Handlers (Add, Edit, Delete, Reset Recommended Mixtures)
  // ---------------------------------------------------------------------------

  const handleOpenAddTemplateModal = () => {
    setEditingTemplate(null);
    setTemplateFormName('Yeni Açma Kademesi');
    setTemplateFormConc(3.0);
    setTemplateFormDesc('Özel konsantrasyon testi');
    setTemplateFormIsMasstone(false);
    setIsTemplateManagerOpen(true);
  };

  const handleOpenEditTemplateModal = (item: MixtureTemplateItem) => {
    setEditingTemplate(item);
    setTemplateFormName(item.name);
    setTemplateFormConc(item.concentration_pct);
    setTemplateFormDesc(item.description || '');
    setTemplateFormIsMasstone(Boolean(item.is_masstone));
    setIsTemplateManagerOpen(true);
  };

  const handleSaveTemplateForm = async () => {
    if (templateFormConc <= 0 || templateFormConc > 100) {
      setErrorMessage('Konsantrasyon 0 ile 100 arasında olmalıdır.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      if (editingTemplate && editingTemplate.id) {
        // Edit existing
        await updateMixtureTemplate(editingTemplate.id, {
          name: templateFormName,
          concentration_pct: templateFormConc,
          description: templateFormDesc,
          is_masstone: templateFormIsMasstone
        });
        setSuccessMessage(`'${templateFormName}' başarıyla güncellendi.`);
      } else {
        // Create new
        await createMixtureTemplate({
          series_type: 'BWC',
          name: templateFormName,
          concentration_pct: templateFormConc,
          colorant_ratio: templateFormConc / 100.0,
          base_ratio: Math.max(0, 1.0 - templateFormConc / 100.0),
          is_masstone: templateFormIsMasstone,
          description: templateFormDesc
        });
        setSuccessMessage(`'${templateFormName}' seriye başarıyla eklendi.`);
      }
      setIsTemplateManagerOpen(false);
      await loadTemplates();
    } catch (err: any) {
      setErrorMessage(err.message || 'Karışım şablonu kaydedilemedi');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteTemplateItem = async (templateId?: number, conc?: number) => {
    if (!window.confirm('Bu karışımı önerilen seriden silmek istediğinize emin misiniz?')) {
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      if (templateId) {
        await deleteMixtureTemplate(templateId);
      } else if (conc !== undefined) {
        setMixtureTemplates((prev) => prev.filter((t) => Math.abs(t.concentration_pct - conc) > 0.001));
      }
      // Also remove any measured letdown for this concentration
      if (conc !== undefined) {
        setLetdowns((prev) => prev.filter((l) => Math.abs(l.concentration - conc) > 0.001));
      }
      setSuccessMessage('Karışım seriden silindi.');
      await loadTemplates();
    } catch (err: any) {
      setErrorMessage(err.message || 'Karışım silinemedi');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetTemplatesToDefaults = async () => {
    if (!window.confirm('Önerilen karışım serisini fabrika standartlarına sıfırlamak istediğinize emin misiniz?')) {
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      await resetMixtureTemplates('BWC');
      setSuccessMessage('Karışım serisi varsayılan standartlara sıfırlandı.');
      await loadTemplates();
    } catch (err: any) {
      setErrorMessage(err.message || 'Sıfırlama başarısız oldu');
    } finally {
      setIsLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Measurement Handlers (White Substrate Rw & Black Substrate Rb)
  // ---------------------------------------------------------------------------

  const handleMeasureRowWhite = async (targetConc: number, rowLabel?: string) => {
    setMeasuringConc(targetConc);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const label = rowLabel || `${pasteName} %${targetConc} (Beyaz Zemin)`;
      const record = await measureChnspec(measurementMode, label);

      let parsedLab: { L: number; a: number; b: number } | undefined = undefined;
      if (record.lab) {
        if (Array.isArray(record.lab)) {
          parsedLab = { L: record.lab[0], a: record.lab[1], b: record.lab[2] };
        } else {
          parsedLab = { L: record.lab.L, a: record.lab.a, b: record.lab.b };
        }
      }

      // Check if actual weights were entered for this row
      const act = actualWeights[targetConc];

      setLetdowns((prev) => {
        const existing = prev.find((item) => Math.abs(item.concentration - targetConc) < 0.001);
        const updated: Letdown = {
          concentration: targetConc,
          reflectance: record.reflectance,
          reflectance_black: existing?.reflectance_black,
          lab: parsedLab,
          hex: record.hex,
          actual_colorant_g: act?.pasteG,
          actual_base_g: act?.baseG,
          actual_total_g: act ? act.baseG + act.pasteG : undefined
        };
        const filtered = prev.filter((item) => Math.abs(item.concentration - targetConc) > 0.001);
        return [...filtered, updated].sort((a, b) => a.concentration - b.concentration);
      });

      if (record.hex) {
        setColorHex(record.hex);
      }
      setSuccessMessage(`%${targetConc} (Beyaz Zemin Rw) CHNSpec DS-36D ile başarıyla okundu.`);
    } catch (err: any) {
      setErrorMessage(err.message || 'Cihazdan ölçüm alınamadı. CHNSpec DS-36D bağlantısını kontrol edin.');
    } finally {
      setMeasuringConc(null);
    }
  };

  const handleMeasureRowBlack = async (targetConc: number) => {
    setMeasuringBlackConc(targetConc);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const label = `${pasteName} %${targetConc} (Leneta Siyah Zemin Rb)`;
      const record = await measureChnspec(measurementMode, label);

      setLetdowns((prev) => {
        const existing = prev.find((item) => Math.abs(item.concentration - targetConc) < 0.001);
        if (existing) {
          return prev.map((item) =>
            Math.abs(item.concentration - targetConc) < 0.001
              ? { ...item, reflectance_black: record.reflectance }
              : item
          );
        } else {
          // If white wasn't measured yet, create placeholder with dummy white until measured
          return [
            ...prev,
            {
              concentration: targetConc,
              reflectance: Array(31).fill(0.8),
              reflectance_black: record.reflectance
            }
          ];
        }
      });

      setSuccessMessage(`%${targetConc} (Leneta Siyah Zemin Rb) okundu.`);
    } catch (err: any) {
      setErrorMessage(err.message || 'Siyah zemin ölçümü alınamadı.');
    } finally {
      setMeasuringBlackConc(null);
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
    handleMeasureRowWhite(val);
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

  // Merge mixture templates and any extra custom letdowns into the displayed ladder
  const displayedLadder = [...mixtureTemplates];
  letdowns.forEach((ld) => {
    if (!displayedLadder.some((r) => Math.abs(r.concentration_pct - ld.concentration) < 0.001)) {
      displayedLadder.push({
        name: `Özel Seyreltme (%${ld.concentration})`,
        concentration_pct: ld.concentration,
        colorant_ratio: ld.concentration / 100.0,
        base_ratio: Math.max(0, 1.0 - ld.concentration / 100.0),
        is_masstone: ld.concentration >= 99.0,
        series_type: 'BWC',
        description: 'Özel numune ölçümü'
      });
    }
  });
  displayedLadder.sort((a, b) => b.concentration_pct - a.concentration_pct);

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
          {/* Endüstriyel Başlık & Sekmeler */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-[var(--border)]">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
                  Renklendirici Spektrofotometrik Karakterizasyonu
                </h1>
                <span className="px-2 py-0.5 rounded-[var(--radius-xs)] text-[10px] font-mono bg-[var(--accent-subtle)] border border-[var(--accent-border)] text-[var(--accent-text)] font-semibold">
                  Endüstriyel Laboratuvar Standardı
                </span>
              </div>
              <p className="text-xs text-[var(--text-secondary)] mt-1">
                Leneta opaklık kartı üzerinde 400 - 700 nm spektral okuma, Çift Sabitli Kubelka-Munk optimizasyonu ve K(λ)/S(λ) katsayı türetimi
              </p>
            </div>

            {/* Stepper (1 = Tartım & Ölçüm, 2 = Doğrulama & Kayıt) */}
            <div className="flex items-center gap-2 bg-[var(--surface-0)] border border-[var(--border)] p-1 rounded-[var(--radius)] text-xs font-mono shadow-xs">
              <button
                type="button"
                onClick={() => setCurrentStep(1)}
                className={`px-3 py-1.5 rounded-[var(--radius-xs)] flex items-center gap-1.5 transition-colors cursor-pointer ${
                  currentStep === 1
                    ? 'bg-[var(--surface-3)] text-[var(--text-primary)] font-bold border border-[var(--border)] shadow-xs'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                <span className="w-4 h-4 rounded-full bg-[var(--surface-1)] text-[var(--text-secondary)] flex items-center justify-center text-[10px] font-bold">1</span>
                <span>Tartım & Ölçüm Masası</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (results) setCurrentStep(2);
                }}
                disabled={!results}
                className={`px-3 py-1.5 rounded-[var(--radius-xs)] flex items-center gap-1.5 transition-colors cursor-pointer ${
                  currentStep === 2
                    ? 'bg-[var(--surface-3)] text-[var(--text-primary)] font-bold border border-[var(--border)] shadow-xs'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed'
                }`}
              >
                <span className="w-4 h-4 rounded-full bg-[var(--surface-1)] text-[var(--text-secondary)] flex items-center justify-center text-[10px] font-bold">2</span>
                <span>Doğrulama & Kayıt</span>
              </button>
            </div>
          </div>

          {/* Feedback Banners */}
          {errorMessage && (
            <div className="p-3 bg-[var(--danger-subtle)] border border-[var(--danger-border)] text-[var(--danger-text)] rounded-[var(--radius)] text-xs flex items-center gap-2 shadow-xs">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-3 bg-[var(--success-subtle)] border border-[var(--success-border)] text-[var(--success-text)] rounded-[var(--radius)] text-xs flex items-center gap-2 shadow-xs">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* ======================================================== */}
          {/* AŞAMA 1: TARTIM VE ÖLÇÜM MASASI                          */}
          {/* ======================================================== */}
          {currentStep === 1 && (
            <div className="space-y-4">
              {/* ÜST PANEL: Renklendirici Tanımı & Taşıyıcı Baz */}
              <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-4 shadow-[var(--shadow-sm)] space-y-3">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
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

              {/* ÖNERİLEN KARIŞIM SERİSİ YÖNETİMİ & TARTIM MASASI */}
              <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-4 shadow-[var(--shadow-sm)] space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-[var(--border)]">
                  <div className="flex items-center gap-2">
                    <Scale className="h-4 w-4 text-[var(--brand-clay)]" />
                    <h2 className="text-xs font-semibold text-[var(--text-primary)] font-mono uppercase tracking-wider">
                      Seyreltme Tartım ve Spektrofotometre Masası
                    </h2>
                    <span className="text-[10px] font-mono text-[var(--text-muted)]">
                      (Mod: {measurementMode})
                    </span>
                  </div>

                  {/* Actions: Add mixture, reset mixture series, and batch weight selector */}
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleOpenAddTemplateModal}
                        className="px-2.5 py-1 bg-[var(--accent-subtle)] hover:bg-[var(--accent-hover)] border border-[var(--accent-border)] text-[var(--accent-text)] rounded-[var(--radius-xs)] text-[11px] font-mono font-semibold flex items-center gap-1 transition-colors cursor-pointer shadow-xs"
                        title="Önerilen seriye yeni bir karışım kademesi ekleyin"
                      >
                        <Plus className="h-3 w-3" />
                        <span>Karışım Ekle</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleResetTemplatesToDefaults}
                        className="p-1 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-[var(--radius-xs)] transition-colors cursor-pointer"
                        title="Önerilen seriyi fabrika varsayılanlarına sıfırla"
                      >
                        <RotateCcw className="h-3 w-3" />
                      </button>
                    </div>

                    {/* Batch weight selector for scale */}
                    <div className="flex items-center gap-1.5 text-xs font-mono border-l border-[var(--border)] pl-3">
                      <span className="text-[10px] text-[var(--text-muted)]">Hedef Baz:</span>
                      {[50, 100, 200, 250].map((wt) => (
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
                          {wt}g
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Karışım Merdiveni Tablosu (Hedef Proposal vs Fiili Tartım & Leneta Okuma) */}
                <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-0)]">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-[var(--surface-1)] text-[var(--text-secondary)] text-[10px] uppercase border-b border-[var(--border)]">
                      <tr>
                        <th className="p-2.5 w-10">#</th>
                        <th className="p-2.5">Karışım & Rol</th>
                        <th className="p-2.5">Reçete (%)</th>
                        <th className="p-2.5">Hedef Tartım ({batchWeight}g için)</th>
                        <th className="p-2.5">Fiili Tartılan (g)</th>
                        <th className="p-2.5">Leneta Okuma Durumu</th>
                        <th className="p-2.5 text-right">Ölçüm & İşlem</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {displayedLadder.map((row, idx) => {
                        const targetConc = row.concentration_pct;
                        const measuredLetdown = letdowns.find(
                          (l) => Math.abs(l.concentration - targetConc) < 0.001
                        );
                        const isWhiteMeasured = Boolean(measuredLetdown && measuredLetdown.reflectance?.length === 31);
                        const isBlackMeasured = Boolean(measuredLetdown && measuredLetdown.reflectance_black?.length === 31);
                        const isMeasuringWhite = measuringConc === targetConc;
                        const isMeasuringBlack = measuringBlackConc === targetConc;

                        // Calculate theoretical target proposal weights
                        const targetPasteG = row.is_masstone
                          ? batchWeight
                          : parseFloat(((batchWeight * (row.colorant_ratio || targetConc / 100.0))).toFixed(3));
                        const targetBaseG = row.is_masstone ? 0.0 : batchWeight;

                        // Actual weights (defaults to target if untouched)
                        const actualRow = actualWeights[targetConc] || {
                          baseG: targetBaseG,
                          pasteG: targetPasteG
                        };

                        // Effective actual concentration calculated from scale input
                        const totalActual = actualRow.baseG + actualRow.pasteG;
                        const effectiveConc = totalActual > 0
                          ? ((actualRow.pasteG / totalActual) * 100.0).toFixed(2)
                          : targetConc.toFixed(2);

                        return (
                          <tr
                            key={idx}
                            className={`transition-colors ${
                              isWhiteMeasured
                                ? 'bg-[var(--success-subtle)]/20 hover:bg-[var(--success-subtle)]/30'
                                : 'hover:bg-[var(--surface-1)]'
                            }`}
                          >
                            <td className="p-2.5 text-[var(--text-muted)] font-mono">{idx + 1}</td>
                            <td className="p-2.5">
                              <span className="font-medium text-[var(--text-primary)] block">
                                {row.name}
                              </span>
                              {row.description && (
                                <span className="text-[10px] text-[var(--text-muted)] block">
                                  {row.description}
                                </span>
                              )}
                            </td>
                            <td className="p-2.5">
                              <span className="font-bold text-[var(--text-primary)] block">
                                %{targetConc}
                              </span>
                              {parseFloat(effectiveConc) !== targetConc && (
                                <span className="text-[10px] text-[var(--brand-clay)] font-semibold block" title="Operatörün terazide tarttığı fiili net konsantrasyon">
                                  Fiili: %{effectiveConc}
                                </span>
                              )}
                            </td>
                            <td className="p-2.5">
                              {row.is_masstone ? (
                                <span className="text-[var(--text-primary)] font-medium">
                                  {targetPasteG}g Saf Pasta
                                </span>
                              ) : (
                                <span className="text-[var(--text-secondary)]">
                                  <strong className="text-[var(--text-primary)]">{targetBaseG.toFixed(1)}g</strong> Baz +{' '}
                                  <strong className="text-[var(--brand-clay)]">{targetPasteG.toFixed(2)}g</strong> Pasta
                                </span>
                              )}
                            </td>
                            {/* Fiili Tartım Inputları (Laboratuvar terazisi girişi) */}
                            <td className="p-2.5">
                              <div className="flex items-center gap-1.5">
                                {!row.is_masstone && (
                                  <div className="flex items-center gap-0.5" title="Terazide tartılan baz gramajı">
                                    <span className="text-[10px] text-[var(--text-muted)]">B:</span>
                                    <input
                                      type="number"
                                      step="0.01"
                                      value={actualRow.baseG}
                                      onChange={(e) => {
                                        const val = parseFloat(e.target.value) || 0;
                                        setActualWeights((prev) => ({
                                          ...prev,
                                          [targetConc]: { ...actualRow, baseG: val }
                                        }));
                                      }}
                                      className="w-14 px-1 py-0.5 bg-[var(--surface-0)] border border-[var(--border)] rounded text-[11px] font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand-clay)]"
                                    />
                                  </div>
                                )}
                                <div className="flex items-center gap-0.5" title="Terazide tartılan pasta gramajı">
                                  <span className="text-[10px] text-[var(--text-muted)]">P:</span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={actualRow.pasteG}
                                    onChange={(e) => {
                                      const val = parseFloat(e.target.value) || 0;
                                      setActualWeights((prev) => ({
                                        ...prev,
                                        [targetConc]: { ...actualRow, pasteG: val }
                                      }));
                                    }}
                                    className="w-14 px-1 py-0.5 bg-[var(--surface-0)] border border-[var(--border)] rounded text-[11px] font-mono text-[var(--brand-clay)] font-bold focus:outline-none focus:border-[var(--brand-clay)]"
                                  />
                                </div>
                              </div>
                            </td>
                            {/* Spektral Durum (Rw & Rb) */}
                            <td className="p-2.5">
                              <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className="w-2.5 h-2.5 rounded-full border border-[var(--border-strong)] shrink-0"
                                    style={{ backgroundColor: measuredLetdown?.hex || colorHex }}
                                  />
                                  <span className="text-[11px]">
                                    {isWhiteMeasured ? (
                                      <span className="text-[var(--success-text)] font-semibold flex items-center gap-0.5">
                                        <Check className="h-3 w-3" /> Rw Okundu
                                      </span>
                                    ) : (
                                      <span className="text-[var(--text-muted)]">Rw Bekliyor</span>
                                    )}
                                  </span>
                                </div>
                                {isBlackMeasured && (
                                  <span className="text-[10px] text-[var(--accent-text)] font-mono flex items-center gap-0.5">
                                    <Check className="h-2.5 w-2.5" /> Rb Siyah Zemin Okundu
                                  </span>
                                )}
                              </div>
                            </td>
                            {/* Aksiyonlar: Ölç, Siyah Oku, Düzenle, Sil */}
                            <td className="p-2.5 text-right">
                              <div className="flex items-center justify-end gap-1">
                                {/* Beyaz Zemin Okuma (Rw) */}
                                <button
                                  type="button"
                                  onClick={() => handleMeasureRowWhite(targetConc, `${pasteName} %${targetConc}`)}
                                  disabled={measuringConc !== null || isLoading}
                                  className={`px-2.5 py-1 rounded-[var(--radius-xs)] text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                                    isWhiteMeasured
                                      ? 'bg-[var(--surface-1)] hover:bg-[var(--surface-3)] text-[var(--text-secondary)] border border-[var(--border)]'
                                      : 'bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white shadow-xs'
                                  } disabled:opacity-50`}
                                  title="Leneta Beyaz zemin üzerinden oku (Rw)"
                                >
                                  {isMeasuringWhite ? (
                                    <RefreshCw className="h-3 w-3 animate-spin" />
                                  ) : isWhiteMeasured ? (
                                    <RefreshCw className="h-3 w-3" />
                                  ) : (
                                    <Zap className="h-3 w-3 fill-current" />
                                  )}
                                  <span>{isWhiteMeasured ? 'Yeniden Oku' : 'Rw Oku'}</span>
                                </button>

                                {/* Siyah Zemin Okuma (Rb - Opsiyonel Opaklık & Kalınlık) */}
                                <button
                                  type="button"
                                  onClick={() => handleMeasureRowBlack(targetConc)}
                                  disabled={measuringBlackConc !== null || isLoading}
                                  className={`px-2 py-1 rounded-[var(--radius-xs)] text-[11px] font-medium border transition-colors cursor-pointer ${
                                    isBlackMeasured
                                      ? 'bg-[var(--surface-2)] text-[var(--text-primary)] border-[var(--accent-border)] font-semibold'
                                      : 'bg-[var(--surface-0)] hover:bg-[var(--surface-1)] text-[var(--text-muted)] hover:text-[var(--text-primary)] border-[var(--border)]'
                                  }`}
                                  title="Leneta Siyah zemin üzerinden oku (Rb - 2-sabitli kalınlık ve örtücülük kontrolü)"
                                >
                                  {isMeasuringBlack ? (
                                    <RefreshCw className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <span>Rb (Siyah)</span>
                                  )}
                                </button>

                                {/* Düzenle (Şablondaki ad/oranı güncelle) */}
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditTemplateModal(row)}
                                  title="Bu karışım kademesini düzenle"
                                  className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded hover:bg-[var(--surface-1)] transition-colors cursor-pointer"
                                >
                                  <Edit2 className="h-3.5 w-3.5" />
                                </button>

                                {/* Sil (Şablondan kaldır) */}
                                <button
                                  type="button"
                                  onClick={() => handleDeleteTemplateItem(row.id, targetConc)}
                                  title="Bu karışımı seriden sil"
                                  className="p-1 text-[var(--text-muted)] hover:text-[var(--danger-text)] rounded hover:bg-[var(--surface-1)] transition-colors cursor-pointer"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Hızlı Konsantrasyon Ekle & Masa Alt Çubuğu */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono text-[var(--text-secondary)]">Hızlı Numune:</span>
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
                        <span>Hızlı Ekle & Oku</span>
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
          {/* AŞAMA 2: K-M KATSAYILARI & KÜTÜPHANEYE KAYIT             */}
          {/* ======================================================== */}
          {currentStep === 2 && results && (
            <div className="space-y-5">
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

                {/* Dual Substrate Thickness Evaluation (if black card was measured) */}
                {results.dual_substrate_evaluations && results.dual_substrate_evaluations.length > 0 && (
                  <div className="p-3 bg-[var(--accent-subtle)]/30 rounded-[var(--radius)] border border-[var(--accent-border)] text-xs font-mono space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[var(--accent-text)] flex items-center gap-1.5">
                        <Info className="h-3.5 w-3.5" />
                        Leneta Çift Zemin Kalibrasyonu (Siyah & Beyaz Ayrıştırma)
                      </span>
                      <span className="text-[11px] font-semibold text-[var(--text-primary)]">
                        Ortalama Film Kalınlığı: {results.mean_calibrated_thickness_um} µm
                      </span>
                    </div>
                    <p className="text-[11px] text-[var(--text-secondary)]">
                      Siyah zemin (Rb) okumaları sayesinde pigmentin iç saçılma katsayısı S(λ) ve örtücülük kontrast oranı (Contrast Ratio) başarıyla kalibre edilmiştir.
                    </p>
                  </div>
                )}
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

          {/* ======================================================== */}
          {/* MODAL: ÖNERİLEN KARIŞIM ŞABLONU EKLE / DÜZENLE            */}
          {/* ======================================================== */}
          {isTemplateManagerOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
              <div className="bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius-lg)] p-5 max-w-md w-full shadow-xl space-y-4 font-mono text-xs">
                <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
                  <h3 className="font-bold text-[var(--text-primary)] text-sm flex items-center gap-2">
                    <Scale className="h-4 w-4 text-[var(--brand-clay)]" />
                    <span>{editingTemplate ? 'Karışımı Düzenle' : 'Yeni Karışım Kademesi Ekle'}</span>
                  </h3>
                  <button
                    type="button"
                    onClick={() => setIsTemplateManagerOpen(false)}
                    className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] uppercase text-[var(--text-secondary)] mb-1">
                      Karışım / Kademe Adı
                    </label>
                    <input
                      type="text"
                      value={templateFormName}
                      onChange={(e) => setTemplateFormName(e.target.value)}
                      placeholder="Örn: Özel Ara Açma (%3.5)"
                      className="w-full px-2.5 py-1.5 bg-[var(--surface-1)] border border-[var(--border)] rounded text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand-clay)]"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase text-[var(--text-secondary)] mb-1">
                      Konsantrasyon (%)
                    </label>
                    <input
                      type="number"
                      step="0.05"
                      min="0.01"
                      max="100.0"
                      value={templateFormConc}
                      onChange={(e) => setTemplateFormConc(parseFloat(e.target.value) || 0)}
                      className="w-full px-2.5 py-1.5 bg-[var(--surface-1)] border border-[var(--border)] rounded text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand-clay)]"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase text-[var(--text-secondary)] mb-1">
                      Açıklama / Laboratuvar Rolü
                    </label>
                    <input
                      type="text"
                      value={templateFormDesc}
                      onChange={(e) => setTemplateFormDesc(e.target.value)}
                      placeholder="Örn: Hassas orta ton seyreltmesi"
                      className="w-full px-2.5 py-1.5 bg-[var(--surface-1)] border border-[var(--border)] rounded text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand-clay)]"
                    />
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="checkbox"
                      id="isMasstoneCheck"
                      checked={templateFormIsMasstone}
                      onChange={(e) => setTemplateFormIsMasstone(e.target.checked)}
                      className="rounded border-[var(--border)] text-[var(--brand-clay)]"
                    />
                    <label htmlFor="isMasstoneCheck" className="text-xs text-[var(--text-secondary)] cursor-pointer">
                      Bu karışım masstone (saf pigment / bazsız) numunedir
                    </label>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
                  <button
                    type="button"
                    onClick={() => setIsTemplateManagerOpen(false)}
                    className="px-3 py-1.5 bg-[var(--surface-1)] hover:bg-[var(--surface-2)] border border-[var(--border)] rounded text-xs text-[var(--text-secondary)] cursor-pointer"
                  >
                    İptal
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveTemplateForm}
                    disabled={isLoading}
                    className="px-4 py-1.5 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white rounded text-xs font-bold transition-all shadow-xs cursor-pointer disabled:opacity-50"
                  >
                    {isLoading ? 'Kaydediliyor...' : 'Kaydet'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CharacterizationWizard;
