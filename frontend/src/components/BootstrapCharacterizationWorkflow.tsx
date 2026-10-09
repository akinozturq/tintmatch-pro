import React, { useState, useEffect } from 'react';
import type {
  BasePaint,
  ColorantPaste,
  BootstrapSystemStatus,
  CharacterizeBaseResponse,
  ChnspecStatusInfo,
  CalibrationHealthInfo,
  MixtureTemplateItem,
  BootstrapCalibrationResult
} from '../types';
import {
  fetchBootstrapStatus,
  setupBootstrapSystem,
  characterizeBaseFromBootstrap,
  getChnspecStatus,
  getChnspecCalibrationHealth,
  measureChnspec,
  fetchMixtureTemplates,
  createMixtureTemplate,
  updateMixtureTemplate,
  deleteMixtureTemplate,
  resetMixtureTemplates,
  calculateBootstrapCalibration
} from '../services/api';
import { SpectralChart } from './SpectralChart';
import {
  Layers,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  Zap,
  RefreshCw,
  Plus,
  Trash2,
  Sparkles,
  Info,
  Scale,
  Award,
  ChevronRight,
  Sliders,
  Edit2,
  RotateCcw,
  X,
  Save,
  Check,
  Download
} from 'lucide-react';

// Recommended BW ladder fallback if server is offline
const FALLBACK_BW_LADDER: MixtureTemplateItem[] = [
  { series_type: 'BW', name: 'Masstone (Saf Beyaz Referans)', concentration_pct: 0.0, colorant_ratio: 0.0, base_ratio: 1.0, is_masstone: true, description: 'Saf beyaz baz/pasta yansıma referansı' },
  { series_type: 'BW', name: 'Siyah Kademesi 1 (Hafif Gri)', concentration_pct: 0.15, colorant_ratio: 0.0015, base_ratio: 0.9985, is_masstone: false, description: 'Hassas absorpsiyon başlangıç eşiği' },
  { series_type: 'BW', name: 'Siyah Kademesi 2 (Açık Gri)', concentration_pct: 0.45, colorant_ratio: 0.0045, base_ratio: 0.9955, is_masstone: false, description: 'Açık gri skala referansı' },
  { series_type: 'BW', name: 'Siyah Kademesi 3 (Orta Gri)', concentration_pct: 1.18, colorant_ratio: 0.0118, base_ratio: 0.9882, is_masstone: false, description: 'Orta gri skala referansı' },
  { series_type: 'BW', name: 'Siyah Kademesi 4 (Koyu Gri)', concentration_pct: 2.34, colorant_ratio: 0.0234, base_ratio: 0.9766, is_masstone: false, description: 'Koyu gri skala referansı' },
  { series_type: 'BW', name: 'Siyah Kademesi 5 (Derin Gri)', concentration_pct: 7.00, colorant_ratio: 0.0700, base_ratio: 0.9300, is_masstone: false, description: 'Doygun siyah absorpsiyon kalibrasyonu' },
];

interface BootstrapWorkflowProps {
  bases: BasePaint[];
  pastes: ColorantPaste[];
  onOpenSinglePasteWizard?: (baseId: number) => void;
  onRefreshData?: () => void;
}

export const BootstrapCharacterizationWorkflow: React.FC<BootstrapWorkflowProps> = ({
  bases,
  pastes,
  onOpenSinglePasteWizard,
  onRefreshData
}) => {
  const [activeStage, setActiveStage] = useState<1 | 2 | 3>(1);
  const [statusData, setStatusData] = useState<BootstrapSystemStatus | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Hardware Status
  const [deviceStatus, setDeviceStatus] = useState<ChnspecStatusInfo | null>(null);
  const [calHealth, setCalHealth] = useState<CalibrationHealthInfo | null>(null);

  // Stage 1 Material Selection State
  const [clearBaseId, setClearBaseId] = useState<number>(0);
  const [blackPasteId, setBlackPasteId] = useState<number>(0);
  const [whitePasteId, setWhitePasteId] = useState<number>(0);
  const [isSavingStage1, setIsSavingStage1] = useState<boolean>(false);

  // Stage 1 BW Dilution Ladder & Measurements State
  const [bwTemplates, setBwTemplates] = useState<MixtureTemplateItem[]>(FALLBACK_BW_LADDER);
  const [bwBatchWeight, setBwBatchWeight] = useState<number>(100.0);
  const [bwMeasurements, setBwMeasurements] = useState<
    Record<
      number,
      {
        reflectance_white?: number[];
        reflectance_black?: number[];
        actual_base_g?: number;
        actual_black_g?: number;
      }
    >
  >({});
  const [measuringBwKey, setMeasuringBwKey] = useState<string | null>(null);
  const [isCalculatingBw, setIsCalculatingBw] = useState<boolean>(false);
  const [bwCalibrationResult, setBwCalibrationResult] = useState<BootstrapCalibrationResult | null>(null);

  // Stage 1 BW Template Manager Modal State
  const [isBwTemplateModalOpen, setIsBwTemplateModalOpen] = useState<boolean>(false);
  const [editingBwTemplate, setEditingBwTemplate] = useState<MixtureTemplateItem | null>(null);
  const [bwFormName, setBwFormName] = useState<string>('');
  const [bwFormConc, setBwFormConc] = useState<number>(1.0);
  const [bwFormDesc, setBwFormDesc] = useState<string>('');
  const [bwFormIsMasstone, setBwFormIsMasstone] = useState<boolean>(false);

  // Stage 3 Base Characterization State
  const [baseName, setBaseName] = useState<string>('Baz A (Süper Opak Beyaz)');
  const [baseCode, setBaseCode] = useState<string>('BASE-A');
  const [baseType, setBaseType] = useState<'white_a' | 'medium_b' | 'deep_c'>('white_a');
  const [baseDensity, setBaseDensity] = useState<number>(1.45);
  const [baseBatchWeight, setBaseBatchWeight] = useState<number>(100.0);

  // Stage 3 Measurements
  const [unTintedReflectance, setUnTintedReflectance] = useState<number[] | null>(null);
  const [blackLetdowns, setBlackLetdowns] = useState<Array<{ concentration: number; reflectance: number[] }>>([
    { concentration: 0.5, reflectance: [] },
    { concentration: 1.0, reflectance: [] },
    { concentration: 2.5, reflectance: [] },
    { concentration: 5.0, reflectance: [] },
  ]);
  const [customConc, setCustomConc] = useState<string>('');
  const [measuringKey, setMeasuringKey] = useState<string | null>(null);
  const [isCalculatingBase, setIsCalculatingBase] = useState<boolean>(false);
  const [stage3Result, setStage3Result] = useState<CharacterizeBaseResponse | null>(null);

  useEffect(() => {
    loadStatus();
    loadBwTemplates();
    refreshHardware();
  }, []);

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

  const loadBwTemplates = async () => {
    try {
      const tpls = await fetchMixtureTemplates('BW');
      if (tpls && tpls.length > 0) {
        setBwTemplates(tpls);
      }
    } catch {
      // Fallback is already initialized
    }
  };

  const loadStatus = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await fetchBootstrapStatus();
      setStatusData(data);

      // Pre-populate Stage 1 selections if available
      if (data.stages.stage1.clear_base) {
        setClearBaseId(data.stages.stage1.clear_base.id);
      } else {
        const transBase = bases.find((b) => b.base_type === 'transparent_d') || bases[0];
        if (transBase) setClearBaseId(transBase.id);
      }

      if (data.stages.stage1.black_paste) {
        setBlackPasteId(data.stages.stage1.black_paste.id);
      } else {
        const blk = pastes.find((p) => p.code.toLowerCase().includes('pbk') || p.name.toLowerCase().includes('siyah')) || pastes[0];
        if (blk) setBlackPasteId(blk.id);
      }

      if (data.stages.stage1.white_paste) {
        setWhitePasteId(data.stages.stage1.white_paste.id);
      } else {
        const wht = pastes.find((p) => p.code.toLowerCase().includes('pw') || p.name.toLowerCase().includes('beyaz')) || pastes[1] || pastes[0];
        if (wht) setWhitePasteId(wht.id);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Bootstrap durum bilgisi alınamadı');
    } finally {
      setIsLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Stage 1 BW Dilution Ladder Actions
  // ---------------------------------------------------------------------------

  const handleMeasureBwWhite = async (conc: number, name: string) => {
    setMeasuringBwKey(`bw_w_${conc}`);
    setErrorMessage(null);
    try {
      const record = await measureChnspec('SCI', `${name} - Leneta Beyaz (Rw)`);
      setBwMeasurements((prev) => ({
        ...prev,
        [conc]: {
          ...prev[conc],
          reflectance_white: record.reflectance
        }
      }));
      setSuccessMessage(`${name} Leneta Beyaz (Rw) okundu.`);
    } catch (err: any) {
      setErrorMessage(err.message || 'Ölçüm alınamadı. Spektrofotometre bağlantısını kontrol edin.');
    } finally {
      setMeasuringBwKey(null);
    }
  };

  const handleMeasureBwBlack = async (conc: number, name: string) => {
    setMeasuringBwKey(`bw_b_${conc}`);
    setErrorMessage(null);
    try {
      const record = await measureChnspec('SCI', `${name} - Leneta Siyah (Rb)`);
      setBwMeasurements((prev) => ({
        ...prev,
        [conc]: {
          ...prev[conc],
          reflectance_black: record.reflectance
        }
      }));
      setSuccessMessage(`${name} Leneta Siyah (Rb) okundu.`);
    } catch (err: any) {
      setErrorMessage(err.message || 'Ölçüm alınamadı. Spektrofotometre bağlantısını kontrol edin.');
    } finally {
      setMeasuringBwKey(null);
    }
  };

  const handleBwWeightChange = (conc: number, field: 'base' | 'black', val: number) => {
    setBwMeasurements((prev) => ({
      ...prev,
      [conc]: {
        ...prev[conc],
        [field === 'base' ? 'actual_base_g' : 'actual_black_g']: val
      }
    }));
  };

  const handleLoadDemoBwData = () => {
    // Realistic Titanium Dioxide (PW6) masstone curve ~ 86-90%
    const whiteRw = [
      0.824, 0.851, 0.869, 0.881, 0.887, 0.891,
      0.894, 0.896, 0.897, 0.898, 0.897, 0.896,
      0.895, 0.894, 0.892, 0.891, 0.889, 0.888,
      0.886, 0.884, 0.883, 0.881, 0.879, 0.877,
      0.876, 0.874, 0.872, 0.870, 0.868, 0.866, 0.863
    ];
    const whiteRb = whiteRw.map((v) => Math.max(0.04, Number((v * 0.985).toFixed(4))));

    const newMeasures: Record<number, any> = {};
    bwTemplates.forEach((item) => {
      const c = item.concentration_pct;
      const targetBaseG = Number((bwBatchWeight * Math.max(0, 1.0 - c / 100.0)).toFixed(2));
      const targetBlackG = Number((bwBatchWeight * (c / 100.0)).toFixed(2));

      if (c <= 0.001) {
        newMeasures[c] = {
          reflectance_white: whiteRw,
          reflectance_black: whiteRb,
          actual_base_g: targetBaseG,
          actual_black_g: targetBlackG
        };
      } else {
        const drop = 1.0 / (1.0 + (c / 100.0) * 85.0);
        const rw = whiteRw.map((v) => Math.max(0.04, Number((v * drop).toFixed(4))));
        const rb = rw.map((v) => Math.max(0.035, Number((v * 0.97).toFixed(4))));
        newMeasures[c] = {
          reflectance_white: rw,
          reflectance_black: rb,
          actual_base_g: targetBaseG,
          actual_black_g: targetBlackG
        };
      }
    });

    setBwMeasurements(newMeasures);
    setSuccessMessage('Demo spektrofotometrik BW seyreltme serisi (Rw/Rb) başarıyla yüklendi.');
  };

  const handleCalculateBw = async () => {
    const measuredItems = bwTemplates.filter(
      (item) => bwMeasurements[item.concentration_pct]?.reflectance_white?.length === 31
    );

    if (measuredItems.length < 2) {
      setErrorMessage('Bootstrap kalibrasyonu için en az 1 Saf Beyaz ve 1 adet Siyah seyreltme ölçümü gereklidir.');
      return;
    }

    setIsCalculatingBw(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const payload = {
        clear_base_id: clearBaseId,
        black_paste_id: blackPasteId,
        white_paste_id: whitePasteId,
        k1: 0.04,
        k2: 0.60,
        thickness: 100.0,
        bw_letdowns: measuredItems.map((item) => {
          const m = bwMeasurements[item.concentration_pct];
          return {
            concentration: item.concentration_pct,
            reflectance: m.reflectance_white!,
            reflectance_black: m.reflectance_black,
            actual_base_g: m.actual_base_g,
            actual_colorant_g: m.actual_black_g
          };
        })
      };

      const res = await calculateBootstrapCalibration(payload);
      setBwCalibrationResult(res);
      setSuccessMessage(`Bootstrap kalibrasyon eğrileri çözüldü! Ortalama ΔE00: ${res.mean_delta_e00} (R²: ${res.r_squared})`);
    } catch (err: any) {
      setErrorMessage(err.message || 'Bootstrap kalibrasyonu hesaplanamadı.');
    } finally {
      setIsCalculatingBw(false);
    }
  };

  const handleLockStage1WithCalibration = async () => {
    if (!clearBaseId || !blackPasteId || !whitePasteId) {
      setErrorMessage('Lütfen Şeffaf Baz, Referans Siyah Pasta ve Referans Beyaz Pasta seçimlerini tamamlayın.');
      return;
    }

    setIsSavingStage1(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const measuredItems = bwTemplates.filter(
      (item) => bwMeasurements[item.concentration_pct]?.reflectance_white?.length === 31
    );

    try {
      const payload: any = {
        clear_base_id: clearBaseId,
        black_paste_id: blackPasteId,
        white_paste_id: whitePasteId,
        optical_system: 'bootstrap_v1',
        k1: 0.04,
        k2: 0.60,
        thickness: 100.0,
        bw_letdowns: measuredItems.map((item) => {
          const m = bwMeasurements[item.concentration_pct];
          return {
            concentration: item.concentration_pct,
            reflectance: m.reflectance_white!,
            reflectance_black: m.reflectance_black,
            actual_base_g: m.actual_base_g,
            actual_colorant_g: m.actual_black_g
          };
        })
      };

      const res = await setupBootstrapSystem(payload);
      if (res.calculation) {
        setBwCalibrationResult(res.calculation);
      }
      setSuccessMessage(res.message || 'Bootstrap referans üçlüsü ve kalibrasyonu başarıyla kilitlendi.');
      await loadStatus();
      if (onRefreshData) onRefreshData();
    } catch (err: any) {
      setErrorMessage(err.message || 'Bootstrap sistemi kaydedilemedi.');
    } finally {
      setIsSavingStage1(false);
    }
  };

  // Template Manager Handlers for BW series
  const handleOpenAddBwTemplate = () => {
    setEditingBwTemplate(null);
    setBwFormName('Yeni Siyah Kademesi');
    setBwFormConc(3.5);
    setBwFormDesc('Özel siyah seyreltme kademesi');
    setBwFormIsMasstone(false);
    setIsBwTemplateModalOpen(true);
  };

  const handleOpenEditBwTemplate = (item: MixtureTemplateItem) => {
    setEditingBwTemplate(item);
    setBwFormName(item.name);
    setBwFormConc(item.concentration_pct);
    setBwFormDesc(item.description || '');
    setBwFormIsMasstone(!!item.is_masstone);
    setIsBwTemplateModalOpen(true);
  };

  const handleSaveBwTemplate = async () => {
    if (!bwFormName.trim()) {
      alert('Lütfen kademe adını girin.');
      return;
    }
    try {
      const colorantRatio = bwFormConc / 100.0;
      const baseRatio = Math.max(0, 1.0 - colorantRatio);
      if (editingBwTemplate && editingBwTemplate.id) {
        await updateMixtureTemplate(editingBwTemplate.id, {
          name: bwFormName,
          concentration_pct: bwFormConc,
          colorant_ratio: colorantRatio,
          base_ratio: baseRatio,
          is_masstone: bwFormIsMasstone,
          description: bwFormDesc,
          series_type: 'BW'
        });
      } else {
        await createMixtureTemplate({
          series_type: 'BW',
          name: bwFormName,
          concentration_pct: bwFormConc,
          colorant_ratio: colorantRatio,
          base_ratio: baseRatio,
          is_masstone: bwFormIsMasstone,
          description: bwFormDesc
        });
      }
      setIsBwTemplateModalOpen(false);
      await loadBwTemplates();
    } catch (err: any) {
      alert(err.message || 'Şablon kaydedilemedi');
    }
  };

  const handleDeleteBwTemplate = async (id?: number) => {
    if (!id) return;
    if (!window.confirm('Bu karışım kademesini silmek istediğinize emin misiniz?')) return;
    try {
      await deleteMixtureTemplate(id);
      await loadBwTemplates();
    } catch (err: any) {
      alert(err.message || 'Silinemedi');
    }
  };

  const handleResetBwTemplates = async () => {
    if (!window.confirm('Önerilen BW karışım serisini fabrika varsayılanlarına sıfırlamak istediğinize emin misiniz?')) return;
    try {
      await resetMixtureTemplates('BW');
      await loadBwTemplates();
      setSuccessMessage('BW serisi fabrika standartlarına sıfırlandı.');
    } catch (err: any) {
      alert(err.message || 'Sıfırlanamadı');
    }
  };


  // Stage 3: Measure un-tinted base
  const handleMeasureUnTintedBase = async () => {
    setMeasuringKey('un_tinted');
    setErrorMessage(null);
    try {
      const record = await measureChnspec('SCI', `${baseName} Saf Baz`);
      setUnTintedReflectance(record.reflectance);
      setSuccessMessage(`${baseName} saf baz reflektansı CHNSpec DS-36D ile okundu.`);
    } catch (err: any) {
      setErrorMessage(err.message || 'Saf baz ölçülemedi. Spektrofotometre bağlantısını kontrol edin.');
    } finally {
      setMeasuringKey(null);
    }
  };

  // Stage 3: Measure specific black letdown
  const handleMeasureLetdown = async (conc: number) => {
    setMeasuringKey(`conc_${conc}`);
    setErrorMessage(null);
    try {
      const record = await measureChnspec('SCI', `${baseName} + %${conc} Siyah`);
      setBlackLetdowns((prev) =>
        prev.map((item) => (Math.abs(item.concentration - conc) < 0.001 ? { ...item, reflectance: record.reflectance } : item))
      );
      setSuccessMessage(`%${conc} siyah açması başarıyla okundu.`);
    } catch (err: any) {
      setErrorMessage(err.message || `%${conc} seyreltmesi ölçülemedi.`);
    } finally {
      setMeasuringKey(null);
    }
  };

  // Stage 3: Load sample / simulation data for quick testing
  const handleLoadDemoBaseData = () => {
    // Generate realistic white base reflectance (high R ~ 85-90%)
    const unTinted = Array.from({ length: 31 }, (_, i) => 0.85 + Math.sin(i * 0.1) * 0.03);
    setUnTintedReflectance(unTinted);

    // Realistic black letdowns
    const sampleConcs = [0.5, 1.0, 2.5, 5.0];
    const newLetdowns = sampleConcs.map((c) => {
      const dropFactor = 1.0 / (1.0 + c * 1.8);
      return {
        concentration: c,
        reflectance: unTinted.map((r) => Math.max(0.04, r * dropFactor))
      };
    });
    setBlackLetdowns(newLetdowns);
    setSuccessMessage('Demo üretim bazı ve siyah açma verileri yüklendi.');
  };

  // Stage 3: Calculate & Save Base
  const handleCalculateBase = async () => {
    if (!unTintedReflectance || unTintedReflectance.length !== 31) {
      setErrorMessage('Lütfen önce saf baz ölçümünü gerçekleştirin.');
      return;
    }

    const measuredLetdowns = blackLetdowns.filter((l) => l.reflectance && l.reflectance.length === 31);
    if (measuredLetdowns.length < 1) {
      setErrorMessage('En az 1 adet siyah seyreltme ölçümü tamamlanmış olmalıdır.');
      return;
    }

    setIsCalculatingBase(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const payload = {
        name: baseName,
        code: baseCode,
        base_type: baseType,
        density: baseDensity,
        un_tinted_reflectance: unTintedReflectance,
        black_letdowns: measuredLetdowns,
        k1: 0.04,
        k2: 0.60,
        thickness: 0.1
      };

      const res = await characterizeBaseFromBootstrap(payload);
      setStage3Result(res);
      setSuccessMessage(`"${res.name}" üretim bazı başarıyla karakterize edildi ve kütüphaneye eklendi! (Ortalama ΔE00: ${res.mean_delta_e00})`);
      await loadStatus();
      if (onRefreshData) onRefreshData();
    } catch (err: any) {
      setErrorMessage(err.message || 'Baz karakterizasyonu hesaplanamadı.');
    } finally {
      setIsCalculatingBase(false);
    }
  };

  const isChnspecReal = (deviceStatus?.connected ?? false) && !deviceStatus?.is_mock;

  return (
    <div className="max-w-6xl mx-auto px-6 py-6 w-full space-y-6">
      {/* Header and Industrial Workflow Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[var(--border)]">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-[var(--radius-md)] bg-[var(--brand-clay)]/10 text-[var(--brand-clay)] flex items-center justify-center font-bold">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-[var(--text-primary)] tracking-tight">
                  3-Aşamalı Optik Karakterizasyon İş Akışı
                </h1>
                <span className="px-2 py-0.5 rounded-[var(--radius-xs)] bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[10px] font-mono font-semibold border border-blue-500/20">
                  Endüstriyel CCM Standardı
                </span>
              </div>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                Şeffaf Baz + Siyah + Beyaz bootstrap referansı ile tüm pastaları ve üretim bazlarını bağdaştıran kalibrasyon mimarisi
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isChnspecReal ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius)] bg-[var(--success-subtle)] border border-[var(--success-border)] text-[var(--success-text)] text-xs font-mono font-medium">
              <span className="w-2 h-2 rounded-full bg-[var(--success)] animate-pulse" />
              CHNSpec DS-36D: {deviceStatus?.port || 'COM4'}
            </span>
          ) : (
            <span className="px-2.5 py-1 rounded-[var(--radius)] bg-[var(--surface-0)] border border-[var(--border)] text-[var(--text-muted)] text-xs font-mono">
              DS-36D {deviceStatus?.connected ? '(Simülatör)' : '(Çevrimdışı)'}
            </span>
          )}

          <button
            onClick={() => {
              loadStatus();
              refreshHardware();
            }}
            className="p-1.5 rounded-[var(--radius)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-0)] transition-colors border border-[var(--border)]"
            title="Durumu Yenile"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Messages */}
      {errorMessage && (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/60 rounded-[var(--radius)] p-3.5 text-xs text-red-700 dark:text-red-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
            <span>{errorMessage}</span>
          </div>
          <button onClick={() => setErrorMessage(null)} className="text-red-500 hover:text-red-700 font-bold ml-2">
            ×
          </button>
        </div>
      )}

      {successMessage && (
        <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/60 rounded-[var(--radius)] p-3.5 text-xs text-emerald-800 dark:text-emerald-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
            <span>{successMessage}</span>
          </div>
          <button onClick={() => setSuccessMessage(null)} className="text-emerald-500 hover:text-emerald-700 font-bold ml-2">
            ×
          </button>
        </div>
      )}

      {/* 3-Stage Progress Pipeline Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Stage 1 Card */}
        <div
          onClick={() => setActiveStage(1)}
          className={`cursor-pointer p-4 rounded-[var(--radius-lg)] border transition-all ${
            activeStage === 1
              ? 'bg-[var(--surface-3)] border-[var(--brand-clay)] shadow-[var(--shadow-md)] ring-1 ring-[var(--brand-clay)]/30'
              : 'bg-[var(--surface-3)]/60 border-[var(--border)] hover:border-[var(--border-strong)]'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-mono uppercase tracking-wider font-bold text-[var(--text-muted)]">
              Aşama 1
            </span>
            {statusData?.stages.stage1.status === 'COMPLETED' ? (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                <CheckCircle2 className="h-3 w-3" /> Hazır
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                Beklemede
              </span>
            )}
          </div>
          <h3 className="text-sm font-bold text-[var(--text-primary)]">Çekirdek Bootstrap Referansı</h3>
          <p className="text-[11px] text-[var(--text-secondary)] mt-1 line-clamp-2">
            Şeffaf Baz + Referans Siyah Pasta + Referans Beyaz Pasta koordinat triadını kilitler.
          </p>
          <div className="mt-3 pt-2.5 border-t border-[var(--border)] flex items-center justify-between text-[11px] font-mono text-[var(--text-muted)]">
            <span>Referans Triad</span>
            <span className="font-semibold text-[var(--text-primary)]">
              {statusData?.stages.stage1.clear_base ? 'Kilitli (3/3)' : 'Tanımlanmadı'}
            </span>
          </div>
        </div>

        {/* Stage 2 Card */}
        <div
          onClick={() => setActiveStage(2)}
          className={`cursor-pointer p-4 rounded-[var(--radius-lg)] border transition-all ${
            activeStage === 2
              ? 'bg-[var(--surface-3)] border-[var(--brand-clay)] shadow-[var(--shadow-md)] ring-1 ring-[var(--brand-clay)]/30'
              : 'bg-[var(--surface-3)]/60 border-[var(--border)] hover:border-[var(--border-strong)]'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-mono uppercase tracking-wider font-bold text-[var(--text-muted)]">
              Aşama 2
            </span>
            {statusData?.stages.stage2.status === 'COMPLETED' ? (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                <CheckCircle2 className="h-3 w-3" /> {statusData.stages.stage2.count} Pasta
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full border border-blue-500/20">
                {statusData?.stages.stage2.count || 0} Aktif
              </span>
            )}
          </div>
          <h3 className="text-sm font-bold text-[var(--text-primary)]">Renklendirici Kütüphanesi</h3>
          <p className="text-[11px] text-[var(--text-secondary)] mt-1 line-clamp-2">
            Tüm renkli pastalar Şeffaf Baz, Siyah ve Beyaz referansı ile karakterize edilir.
          </p>
          <div className="mt-3 pt-2.5 border-t border-[var(--border)] flex items-center justify-between text-[11px] font-mono text-[var(--text-muted)]">
            <span>Karakterize Pastalar</span>
            <span className="font-semibold text-[var(--text-primary)]">
              {statusData?.stages.stage2.count || 0} Adet
            </span>
          </div>
        </div>

        {/* Stage 3 Card */}
        <div
          onClick={() => setActiveStage(3)}
          className={`cursor-pointer p-4 rounded-[var(--radius-lg)] border transition-all ${
            activeStage === 3
              ? 'bg-[var(--surface-3)] border-[var(--brand-clay)] shadow-[var(--shadow-md)] ring-1 ring-[var(--brand-clay)]/30'
              : 'bg-[var(--surface-3)]/60 border-[var(--border)] hover:border-[var(--border-strong)]'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-mono uppercase tracking-wider font-bold text-[var(--text-muted)]">
              Aşama 3
            </span>
            {statusData?.stages.stage3.status === 'COMPLETED' ? (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                <CheckCircle2 className="h-3 w-3" /> {statusData.stages.stage3.count} Baz
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full border border-blue-500/20">
                {statusData?.stages.stage3.count || 0} Baz Hazır
              </span>
            )}
          </div>
          <h3 className="text-sm font-bold text-[var(--text-primary)]">Üretim Bazları (S_base / K_base)</h3>
          <p className="text-[11px] text-[var(--text-secondary)] mt-1 line-clamp-2">
            Fabrika üretim bazları bootstrap siyah pasta açmalarıyla çözülür (Şeffaf baz hariç!).
          </p>
          <div className="mt-3 pt-2.5 border-t border-[var(--border)] flex items-center justify-between text-[11px] font-mono text-[var(--text-muted)]">
            <span>Karakterize Bazlar</span>
            <span className="font-semibold text-[var(--text-primary)]">
              {statusData?.stages.stage3.count || 0} Adet
            </span>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* STAGE 1 VIEW: Core Bootstrap Triplet Setup */}
      {/* ------------------------------------------------------------- */}
      {activeStage === 1 && (
        <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-6 space-y-6 shadow-[var(--shadow-sm)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-[var(--brand-clay)]" />
                <h2 className="text-base font-bold text-[var(--text-primary)]">
                  Aşama 1: Çekirdek Bootstrap Referansı Kilitleme
                </h2>
              </div>
              <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-2xl">
                Endüstride Kubelka-Munk iki-sabiti modelinin mutlak koordinat sistemini kurmak için bir şeffaf baz, bir
                referans siyah pasta ve bir referans beyaz pasta optik omurga olarak belirlenir.
              </p>
            </div>
            {statusData?.stages.stage1.status === 'COMPLETED' && (
              <div className="px-3 py-1 rounded-[var(--radius-sm)] bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-semibold flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" />
                <span>Kilitli ve Doğrulanmış</span>
              </div>
            )}
          </div>

          {/* Triplet Selection Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            {/* Clear Base Selection */}
            <div className="p-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-0)] space-y-2">
              <label className="text-xs font-bold text-[var(--text-primary)] flex items-center justify-between">
                <span>1. Şeffaf Baz (Clear Base)</span>
                <span className="text-[10px] text-blue-600 dark:text-blue-400 font-mono font-normal">K=0, S=0 Ref</span>
              </label>
              <select
                value={clearBaseId}
                onChange={(e) => setClearBaseId(Number(e.target.value))}
                className="w-full text-xs bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-sm)] p-2 text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-clay)]"
              >
                <option value={0}>-- Şeffaf Baz Seçin --</option>
                {bases.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.code}) - {b.base_type === 'transparent_d' ? 'Şeffaf (D)' : b.base_type}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-[var(--text-muted)]">
                Pigmentsiz, reçine/bağlayıcı taşıyıcı. Genellikle Base D olarak etiketlenir.
              </p>
            </div>

            {/* Bootstrap Black Paste */}
            <div className="p-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-0)] space-y-2">
              <label className="text-xs font-bold text-[var(--text-primary)] flex items-center justify-between">
                <span>2. Referans Siyah Pasta</span>
                <span className="text-[10px] text-slate-800 dark:text-slate-200 font-mono font-normal">K_abs Ref</span>
              </label>
              <select
                value={blackPasteId}
                onChange={(e) => setBlackPasteId(Number(e.target.value))}
                className="w-full text-xs bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-sm)] p-2 text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-clay)]"
              >
                <option value={0}>-- Referans Siyah Seçin --</option>
                {pastes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code})
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-[var(--text-muted)]">
                Yüksek absorpsiyonlu karbon siyahı (örn. PBk7). Aşama 3'te baz saçılmasını (S_base) hesaplamak için kullanılır.
              </p>
            </div>

            {/* Bootstrap White Paste */}
            <div className="p-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-0)] space-y-2">
              <label className="text-xs font-bold text-[var(--text-primary)] flex items-center justify-between">
                <span>3. Referans Beyaz Pasta</span>
                <span className="text-[10px] text-amber-700 dark:text-amber-400 font-mono font-normal">S_scat Ref</span>
              </label>
              <select
                value={whitePasteId}
                onChange={(e) => setWhitePasteId(Number(e.target.value))}
                className="w-full text-xs bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-sm)] p-2 text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-clay)]"
              >
                <option value={0}>-- Referans Beyaz Seçin --</option>
                {pastes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code})
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-[var(--text-muted)]">
                Yüksek saçılmalı rutil titanyum dioksit (örn. PW6). Aşama 2'de renkli pastaların absorpsiyon/saçılmasını ölçekler.
              </p>
            </div>
          </div>

          {/* ----------------------------------------------------------- */}
          {/* STAGE 1: DILUTION LADDER & MEASUREMENT TABLE (BW SERIES)     */}
          {/* ----------------------------------------------------------- */}
          <div className="pt-4 border-t border-[var(--border)] space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Scale className="h-4 w-4 text-[var(--brand-clay)]" />
                  <h3 className="text-sm font-bold text-[var(--text-primary)]">
                    Bootstrap Karışım ve Seyreltme Masası (BW Serisi)
                  </h3>
                  <span className="px-2 py-0.5 rounded-[var(--radius-xs)] bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[10px] font-mono font-semibold border border-blue-500/20">
                    Leneta Çift Yüzey (Rw / Rb)
                  </span>
                </div>
                <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                  Referans Beyaz (PW6) içerisine Referans Siyah (PBk7) seyreltilerek K_siyah ve S_beyaz çift-sabitli omurgası türetilir.
                </p>
              </div>

              {/* Table Toolbar */}
              <div className="flex items-center flex-wrap gap-2">
                {/* Batch Size Selector */}
                <div className="flex items-center gap-1.5 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius-sm)] px-2 py-1 text-xs">
                  <span className="text-[10px] uppercase font-bold text-[var(--text-muted)]">Kutu / Numune:</span>
                  <select
                    value={bwBatchWeight}
                    onChange={(e) => setBwBatchWeight(Number(e.target.value))}
                    className="bg-transparent text-[var(--text-primary)] font-mono font-semibold focus:outline-none cursor-pointer"
                  >
                    <option value={50.0}>50.0 g</option>
                    <option value={100.0}>100.0 g</option>
                    <option value={200.0}>200.0 g</option>
                    <option value={250.0}>250.0 g</option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={handleLoadDemoBwData}
                  className="px-2.5 py-1 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-[var(--radius-sm)] text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer"
                  title="Spektrofotometre olmadan tam simülasyon verisi yükler"
                >
                  <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                  <span>Demo Veri Yükle</span>
                </button>

                <button
                  type="button"
                  onClick={handleOpenAddBwTemplate}
                  className="px-2.5 py-1 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] border border-[var(--border)] text-[var(--text-primary)] rounded-[var(--radius-sm)] text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer shadow-xs"
                >
                  <Plus className="h-3.5 w-3.5 text-[var(--brand-clay)]" />
                  <span>Karışım Ekle</span>
                </button>

                <button
                  type="button"
                  onClick={handleResetBwTemplates}
                  className="p-1 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-[var(--radius-sm)] transition-colors cursor-pointer"
                  title="Varsayılan BW serisine sıfırla"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Dilution Ladder Table */}
            <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-0)]">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[var(--surface-1)] text-[var(--text-secondary)] text-[10px] uppercase border-b border-[var(--border)]">
                  <tr>
                    <th className="p-2.5 w-10 text-center">Ton</th>
                    <th className="p-2.5">Kademe / Açıklama</th>
                    <th className="p-2.5 w-24">Kons. (%)</th>
                    <th className="p-2.5">Hedef Tartım (Öneri)</th>
                    <th className="p-2.5">Fiili Terazi Gramajı (g)</th>
                    <th className="p-2.5 text-center">Leneta Beyaz (Rw)</th>
                    <th className="p-2.5 text-center">Leneta Siyah (Rb)</th>
                    <th className="p-2.5 text-center">Kontrast / Opaklık</th>
                    <th className="p-2.5 text-right w-16">İşlem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {bwTemplates.map((item) => {
                    const c = item.concentration_pct;
                    const m = bwMeasurements[c];
                    const targetBaseG = Number((bwBatchWeight * Math.max(0, 1.0 - c / 100.0)).toFixed(2));
                    const targetBlackG = Number((bwBatchWeight * (c / 100.0)).toFixed(2));

                    const actualBaseG = m?.actual_base_g ?? targetBaseG;
                    const actualBlackG = m?.actual_black_g ?? targetBlackG;

                    const hasRw = m?.reflectance_white && m.reflectance_white.length === 31;
                    const hasRb = m?.reflectance_black && m.reflectance_black.length === 31;

                    // Swatch color estimation
                    let swatchColor = '#f8fafc';
                    if (hasRw) {
                      const avg = m!.reflectance_white!.reduce((a, b) => a + b, 0) / 31;
                      const val = Math.round(Math.min(255, Math.max(15, avg * 255)));
                      swatchColor = `rgb(${val}, ${val}, ${val})`;
                    } else if (c <= 0.001) {
                      swatchColor = '#f8fafc';
                    } else if (c <= 0.2) {
                      swatchColor = '#e2e8f0';
                    } else if (c <= 0.5) {
                      swatchColor = '#cbd5e1';
                    } else if (c <= 1.5) {
                      swatchColor = '#94a3b8';
                    } else if (c <= 3.0) {
                      swatchColor = '#64748b';
                    } else {
                      swatchColor = '#1e293b';
                    }

                    // Contrast ratio
                    let crText = '-';
                    if (hasRw && hasRb) {
                      const avgW = m!.reflectance_white!.reduce((a, b) => a + b, 0) / 31;
                      const avgB = m!.reflectance_black!.reduce((a, b) => a + b, 0) / 31;
                      const cr = Math.min(100.0, (avgB / Math.max(avgW, 0.001)) * 100.0);
                      crText = `%${cr.toFixed(1)}`;
                    }

                    return (
                      <tr key={item.id || c} className="hover:bg-[var(--surface-1)]/50 transition-colors">
                        {/* Swatch */}
                        <td className="p-2.5 text-center">
                          <div
                            className="w-5 h-5 rounded-full mx-auto border border-black/20 shadow-xs"
                            style={{ backgroundColor: swatchColor }}
                          />
                        </td>

                        {/* Name & Role */}
                        <td className="p-2.5">
                          <div className="font-semibold text-[var(--text-primary)]">{item.name}</div>
                          <div className="text-[10px] text-[var(--text-muted)] line-clamp-1">
                            {item.description || (item.is_masstone ? 'Saf beyaz yansıma omurgası' : 'Siyah seyreltme basamağı')}
                          </div>
                        </td>

                        {/* Concentration */}
                        <td className="p-2.5">
                          <span className="px-2 py-0.5 rounded bg-[var(--surface-2)] text-[var(--text-primary)] font-bold">
                            %{c.toFixed(2)}
                          </span>
                        </td>

                        {/* Target weights */}
                        <td className="p-2.5 text-[11px] text-[var(--text-secondary)]">
                          <div>
                            Beyaz: <span className="font-bold text-[var(--text-primary)]">{targetBaseG.toFixed(2)}g</span>
                          </div>
                          <div>
                            Siyah: <span className="font-bold text-[var(--text-primary)]">{targetBlackG.toFixed(2)}g</span>
                          </div>
                        </td>

                        {/* Actual Scale Weights */}
                        <td className="p-2.5">
                          <div className="flex items-center gap-1.5">
                            <div>
                              <span className="text-[9px] text-[var(--text-muted)] block">Beyaz(g)</span>
                              <input
                                type="number"
                                step="0.01"
                                value={actualBaseG}
                                onChange={(e) => handleBwWeightChange(c, 'base', parseFloat(e.target.value) || 0)}
                                className="w-16 px-1.5 py-0.5 bg-[var(--surface-1)] border border-[var(--border)] rounded text-[11px] font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand-clay)]"
                              />
                            </div>
                            <div>
                              <span className="text-[9px] text-[var(--text-muted)] block">Siyah(g)</span>
                              <input
                                type="number"
                                step="0.01"
                                value={actualBlackG}
                                onChange={(e) => handleBwWeightChange(c, 'black', parseFloat(e.target.value) || 0)}
                                className="w-16 px-1.5 py-0.5 bg-[var(--surface-1)] border border-[var(--border)] rounded text-[11px] font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand-clay)]"
                              />
                            </div>
                          </div>
                        </td>

                        {/* Leneta Rw */}
                        <td className="p-2.5 text-center">
                          <button
                            type="button"
                            onClick={() => handleMeasureBwWhite(c, item.name)}
                            disabled={measuringBwKey !== null}
                            className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center justify-center gap-1 mx-auto transition-colors cursor-pointer ${
                              hasRw
                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20'
                                : 'bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white shadow-xs'
                            }`}
                          >
                            {measuringBwKey === `bw_w_${c}` ? (
                              <RefreshCw className="h-3 w-3 animate-spin" />
                            ) : hasRw ? (
                              <>
                                <Check className="h-3 w-3" />
                                <span>31λ Okundu</span>
                              </>
                            ) : (
                              <>
                                <Zap className="h-3 w-3" />
                                <span>Rw Oku</span>
                              </>
                            )}
                          </button>
                        </td>

                        {/* Leneta Rb */}
                        <td className="p-2.5 text-center">
                          <button
                            type="button"
                            onClick={() => handleMeasureBwBlack(c, item.name)}
                            disabled={measuringBwKey !== null}
                            className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center justify-center gap-1 mx-auto transition-colors cursor-pointer ${
                              hasRb
                                ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 hover:bg-blue-500/20'
                                : 'bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-secondary)] border border-[var(--border)]'
                            }`}
                          >
                            {measuringBwKey === `bw_b_${c}` ? (
                              <RefreshCw className="h-3 w-3 animate-spin" />
                            ) : hasRb ? (
                              <>
                                <Check className="h-3 w-3" />
                                <span>31λ Okundu</span>
                              </>
                            ) : (
                              <>
                                <Layers className="h-3 w-3" />
                                <span>Rb Oku</span>
                              </>
                            )}
                          </button>
                        </td>

                        {/* Contrast Ratio */}
                        <td className="p-2.5 text-center font-bold text-[var(--text-secondary)]">
                          {crText}
                        </td>

                        {/* Actions */}
                        <td className="p-2.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => handleOpenEditBwTemplate(item)}
                              className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded hover:bg-[var(--surface-1)] transition-colors cursor-pointer"
                              title="Kademeyi Düzenle"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteBwTemplate(item.id)}
                              className="p-1 text-[var(--text-muted)] hover:text-red-500 rounded hover:bg-[var(--surface-1)] transition-colors cursor-pointer"
                              title="Kademeyi Sil"
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
          </div>

          {/* ----------------------------------------------------------- */}
          {/* STAGE 1: CALIBRATION RESULTS & SPECTRAL CHART               */}
          {/* ----------------------------------------------------------- */}
          {bwCalibrationResult && (
            <div className="p-5 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-0)] space-y-4 shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--border)]">
                <div>
                  <h4 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                    <Award className="h-4 w-4 text-[var(--brand-clay)]" />
                    <span>Bootstrap Kalibrasyon Çözümü & Optik Eğriler</span>
                  </h4>
                  <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                    {bwCalibrationResult.summary}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`px-3 py-1 rounded-[var(--radius-sm)] text-xs font-bold font-mono border ${
                      bwCalibrationResult.passed_validation
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                        : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                    }`}
                  >
                    {bwCalibrationResult.passed_validation ? 'DOĞRULAMA: GEÇTİ' : 'DOĞRULAMA: UYARI'}
                  </span>
                </div>
              </div>

              {/* Scorecards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
                <div className="p-3 rounded bg-[var(--surface-1)] border border-[var(--border)]">
                  <span className="text-[10px] uppercase text-[var(--text-muted)] block">Ortalama ΔE00</span>
                  <span className="text-base font-bold text-emerald-600 dark:text-emerald-400">
                    {bwCalibrationResult.mean_delta_e00.toFixed(3)}
                  </span>
                </div>

                <div className="p-3 rounded bg-[var(--surface-1)] border border-[var(--border)]">
                  <span className="text-[10px] uppercase text-[var(--text-muted)] block">Maksimum ΔE00</span>
                  <span className="text-base font-bold text-[var(--text-primary)]">
                    {bwCalibrationResult.max_delta_e00.toFixed(3)}
                  </span>
                </div>

                <div className="p-3 rounded bg-[var(--surface-1)] border border-[var(--border)]">
                  <span className="text-[10px] uppercase text-[var(--text-muted)] block">Doğrusallık (R²)</span>
                  <span className="text-base font-bold text-[var(--text-primary)]">
                    {bwCalibrationResult.r_squared.toFixed(4)}
                  </span>
                </div>

                <div className="p-3 rounded bg-[var(--surface-1)] border border-[var(--border)]">
                  <span className="text-[10px] uppercase text-[var(--text-muted)] block">Spektral RMSE</span>
                  <span className="text-base font-bold text-[var(--text-primary)]">
                    {bwCalibrationResult.spectral_rmse.toFixed(4)}
                  </span>
                </div>
              </div>

              {/* Spectral Chart */}
              <div className="h-64 border border-[var(--border)] rounded-[var(--radius)] overflow-hidden bg-[var(--surface-1)] p-3">
                <SpectralChart
                  series={[
                    {
                      id: 'k-black',
                      name: 'K_siyah(λ) [PBk7 Absorpsiyon]',
                      color: '#0f172a',
                      data: bwCalibrationResult.unit_k_black,
                      strokeWidth: 2.2
                    },
                    {
                      id: 's-white',
                      name: 'S_beyaz(λ) [PW6 Saçılma ≡ 1.0]',
                      color: '#2563eb',
                      data: bwCalibrationResult.unit_s_white,
                      strokeWidth: 2.0,
                      strokeDasharray: '4 4'
                    },
                    {
                      id: 'k-white',
                      name: 'K_beyaz(λ) [PW6 Absorpsiyon]',
                      color: '#d97706',
                      data: bwCalibrationResult.unit_k_white,
                      strokeWidth: 1.8
                    }
                  ]}
                  title="Bootstrap Kalibrasyon Eğrileri (K_black & S_white)"
                  subtitle="Türetilen temel optik absorpsiyon ve saçılma katsayıları"
                  height={240}
                />
              </div>

              {/* Back predictions table */}
              <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-[var(--surface-1)] text-[var(--text-secondary)] text-[10px] uppercase border-b border-[var(--border)]">
                    <tr>
                      <th className="p-2">Kademe</th>
                      <th className="p-2">Kons. (%)</th>
                      <th className="p-2">Ölçülen Lab (D65/10°)</th>
                      <th className="p-2">Tahmin Lab (K-M)</th>
                      <th className="p-2">ΔE00 Residual</th>
                      <th className="p-2 text-right">Durum</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {bwCalibrationResult.back_predictions.map((bp, idx) => (
                      <tr key={idx} className="hover:bg-[var(--surface-1)]/50">
                        <td className="p-2 font-semibold text-[var(--text-primary)]">{bp.name}</td>
                        <td className="p-2">%{bp.concentration.toFixed(2)}</td>
                        <td className="p-2 text-[var(--text-secondary)]">
                          L:{bp.measured_lab[0].toFixed(1)} a:{bp.measured_lab[1].toFixed(1)} b:{bp.measured_lab[2].toFixed(1)}
                        </td>
                        <td className="p-2 text-[var(--text-secondary)]">
                          L:{bp.predicted_lab[0].toFixed(1)} a:{bp.predicted_lab[1].toFixed(1)} b:{bp.predicted_lab[2].toFixed(1)}
                        </td>
                        <td className="p-2 font-bold text-emerald-600 dark:text-emerald-400">
                          {bp.delta_e00.toFixed(3)}
                        </td>
                        <td className="p-2 text-right font-medium">
                          {bp.passed ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                              <Check className="h-3 w-3" /> Geçti (&lt;0.40)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-amber-500">
                              Uyarı
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Action Button & Guidance */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-4 border-t border-[var(--border)]">
            <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
              <Info className="h-4 w-4 text-[var(--brand-clay)] shrink-0" />
              <span>
                Kilitleme işlemi türetilen <code className="font-mono text-[11px]">K_black</code> ve <code className="font-mono text-[11px]">S_white</code> eğrilerini kütüphaneye yazar.
              </span>
            </div>

            <div className="flex items-center flex-wrap gap-3">
              <button
                type="button"
                onClick={handleCalculateBw}
                disabled={isCalculatingBw}
                className="px-4 py-2 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] border border-[var(--border)] text-[var(--text-primary)] font-semibold text-xs rounded-[var(--radius)] flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs disabled:opacity-50"
              >
                <Zap className="h-3.5 w-3.5 text-amber-500" />
                <span>{isCalculatingBw ? 'Hesaplanıyor...' : 'Kalibrasyonu Hesapla & Önizle'}</span>
              </button>

              <button
                type="button"
                onClick={handleLockStage1WithCalibration}
                disabled={isSavingStage1 || !clearBaseId || !blackPasteId || !whitePasteId}
                className="px-4 py-2 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] disabled:opacity-50 text-white font-medium text-xs rounded-[var(--radius)] flex items-center gap-2 transition-colors cursor-pointer shadow-sm"
              >
                <ShieldCheck className="h-4 w-4" />
                <span>{isSavingStage1 ? 'Kilitleniyor...' : 'Bootstrap Referansını Çöz ve Kilitle'}</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveStage(2)}
                className="px-3 py-2 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] text-[var(--text-primary)] border border-[var(--border)] font-medium text-xs rounded-[var(--radius)] flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <span>Aşama 2'ye Geç</span>
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* STAGE 2 VIEW: Colorant Pastes Library */}
      {/* ------------------------------------------------------------- */}
      {activeStage === 2 && (
        <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-6 space-y-6 shadow-[var(--shadow-sm)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-[var(--brand-clay)]" />
                <h2 className="text-base font-bold text-[var(--text-primary)]">
                  Aşama 2: Renklendirici Pastalar Kütüphanesi
                </h2>
              </div>
              <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-2xl">
                Tüm renklendirici pastalar (Sarı, Kırmızı, Mavi vb.), Aşama 1'de kilitlenen <strong>Şeffaf Baz</strong>{' '}
                içerisinde seyreltilerek ve Referans Beyaz Pasta desteğiyle optik absorpsiyon ($K$) ve saçılma ($S$)
                eğrileri çıkarılır.
              </p>
            </div>

            <button
              onClick={() => {
                if (onOpenSinglePasteWizard && clearBaseId) {
                  onOpenSinglePasteWizard(clearBaseId);
                }
              }}
              className="px-3.5 py-1.5 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white font-medium text-xs rounded-[var(--radius)] flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Yeni Renklendirici Karakterize Et</span>
            </button>
          </div>

          {/* Pastes Table */}
          <div className="overflow-x-auto border border-[var(--border)] rounded-[var(--radius)]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--surface-0)] border-b border-[var(--border)] text-[var(--text-secondary)] font-mono">
                <tr>
                  <th className="px-4 py-2.5">Renk</th>
                  <th className="px-4 py-2.5">Pasta Adı</th>
                  <th className="px-4 py-2.5">Kod</th>
                  <th className="px-4 py-2.5">Bootstrap Durumu</th>
                  <th className="px-4 py-2.5">Doğrulama (ΔE00)</th>
                  <th className="px-4 py-2.5 text-right">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {pastes.map((p) => {
                  const isBootstrapRole =
                    p.id === statusData?.stages.stage1.black_paste?.id
                      ? 'Referans Siyah'
                      : p.id === statusData?.stages.stage1.white_paste?.id
                      ? 'Referans Beyaz'
                      : null;

                  return (
                    <tr key={p.id} className="hover:bg-[var(--surface-0)]/50 transition-colors">
                      <td className="px-4 py-3">
                        <div
                          className="w-5 h-5 rounded-full border border-black/20 shadow-xs"
                          style={{ backgroundColor: p.color_hex || '#cbd5e1' }}
                        />
                      </td>
                      <td className="px-4 py-3 font-semibold text-[var(--text-primary)]">
                        <div className="flex items-center gap-2">
                          <span>{p.name}</span>
                          {isBootstrapRole && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-900 text-white font-mono">
                              {isBootstrapRole}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-[var(--text-secondary)]">{p.code}</td>
                      <td className="px-4 py-3">
                        {p.status === 'ACTIVE' ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium text-[11px]">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Karakterize Edildi
                          </span>
                        ) : (
                          <span className="text-[var(--text-muted)] text-[11px]">Beklemede</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-[var(--text-secondary)]">
                        {p.mean_delta_e00 !== undefined && p.mean_delta_e00 !== null ? (
                          <span className={p.mean_delta_e00 <= 0.4 ? 'text-emerald-600 font-semibold' : 'text-amber-600'}>
                            {p.mean_delta_e00.toFixed(2)}
                          </span>
                        ) : (
                          '--'
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => {
                            if (onOpenSinglePasteWizard) {
                              onOpenSinglePasteWizard(clearBaseId || bases[0]?.id || 1);
                            }
                          }}
                          className="text-[11px] font-medium text-[var(--brand-clay)] hover:underline cursor-pointer"
                        >
                          Masada Aç
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-[var(--border)]">
            <button
              onClick={() => setActiveStage(1)}
              className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-medium"
            >
              ← Aşama 1: Bootstrap Referansı
            </button>

            <button
              onClick={() => setActiveStage(3)}
              className="px-4 py-2 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white font-medium text-xs rounded-[var(--radius)] flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
            >
              <span>Aşama 3: Üretim Bazları Karakterizasyonuna Geç</span>
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* STAGE 3 VIEW: Production Bases Optical Characterization */}
      {/* ------------------------------------------------------------- */}
      {activeStage === 3 && (
        <div className="space-y-6">
          {/* Industrial Notice Card */}
          <div className="bg-blue-50/70 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/50 rounded-[var(--radius-lg)] p-4 flex items-start gap-3">
            <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
            <div className="text-xs text-blue-900 dark:text-blue-200 space-y-1">
              <p className="font-semibold">
                Fabrika Üretim Bazları (Baz A Opak Beyaz, Baz B Yarı Opak, Baz C Derin vb.) Karakterizasyon Kuralı:
              </p>
              <p className="text-[11px] leading-relaxed">
                Tüm üretim bazları Aşama 1'de kilitlenen <strong>Referans Siyah Pasta (PBk7)</strong> seyreltmeleriyle
                ölçülür. Saf bazın reflektansı ve siyah açmalarındaki yansıma düşüşünden bazın saçılma ($S_{'{'}base{'}'}$) ve
                soğurma ($K_{'{'}base{'}'}$) matrisleri analitik olarak çözülür.{' '}
                <span className="font-semibold underline">
                  Şeffaf baz (Aşama 1) optik referans koordinatı olduğu için burada tekrar karakterize edilmez.
                </span>
              </p>
            </div>
          </div>

          {/* Base Setup & Measurement Workspace */}
          <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-6 space-y-6 shadow-[var(--shadow-sm)]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--border)]">
              <div>
                <h2 className="text-base font-bold text-[var(--text-primary)]">
                  Yeni Üretim Bazı Karakterize Et
                </h2>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  1 Saf Baz Ölçümü + Siyah Seyreltme Merdiveni ile Kubelka-Munk Optik Sabitlerinin Türetimi
                </p>
              </div>

              <button
                type="button"
                onClick={handleLoadDemoBaseData}
                className="px-3 py-1.5 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] border border-[var(--border)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-[var(--radius)] flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                <span>Demo Ölçüm Verilerini Yükle</span>
              </button>
            </div>

            {/* Base Metadata Inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
                  Baz Adı
                </label>
                <input
                  type="text"
                  value={baseName}
                  onChange={(e) => setBaseName(e.target.value)}
                  className="w-full text-xs bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius-sm)] p-2 text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-clay)]"
                  placeholder="örn. Baz A (Opak Beyaz)"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
                  Baz Kodu
                </label>
                <input
                  type="text"
                  value={baseCode}
                  onChange={(e) => setBaseCode(e.target.value)}
                  className="w-full text-xs font-mono bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius-sm)] p-2 text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-clay)]"
                  placeholder="örn. BASE-A"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
                  Baz Tipi
                </label>
                <select
                  value={baseType}
                  onChange={(e) => setBaseType(e.target.value as any)}
                  className="w-full text-xs bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius-sm)] p-2 text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-clay)]"
                >
                  <option value="white_a">Beyaz Baz (Baz A - Yüksek Opaklık)</option>
                  <option value="medium_b">Orta Baz (Baz B - Yarı Opak)</option>
                  <option value="deep_c">Derin Baz (Baz C - Düşük Opaklık)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
                  Yoğunluk (g/cm³)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={baseDensity}
                  onChange={(e) => setBaseDensity(parseFloat(e.target.value) || 1.45)}
                  className="w-full text-xs font-mono bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius-sm)] p-2 text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-clay)]"
                />
              </div>
            </div>

            {/* Step 1: Un-tinted Base Reflectance Measurement */}
            <div className="p-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-0)] space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[var(--brand-clay)] text-white text-[11px] flex items-center justify-center font-mono">
                      1
                    </span>
                    <span>Saf Baz Ölçümü (Un-tinted Base Reflectance)</span>
                  </h3>
                  <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                    Renklendirici eklenmemiş, saf baz çekim kartını spektrofotometre ile okuyun.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {unTintedReflectance ? (
                    <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-semibold px-2.5 py-1 bg-emerald-500/10 rounded-[var(--radius-sm)] border border-emerald-500/20">
                      <CheckCircle2 className="h-4 w-4" /> Saf Baz Okundu (31 λ)
                    </span>
                  ) : (
                    <span className="text-xs text-amber-600 dark:text-amber-400 font-medium px-2 py-0.5 bg-amber-500/10 rounded">
                      Ölçüm Bekliyor
                    </span>
                  )}

                  <button
                    onClick={handleMeasureUnTintedBase}
                    disabled={measuringKey === 'un_tinted'}
                    className="px-3.5 py-1.5 bg-[var(--surface-3)] hover:bg-[var(--surface-1)] text-[var(--text-primary)] border border-[var(--border)] hover:border-[var(--brand-clay)] text-xs font-semibold rounded-[var(--radius-sm)] flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                  >
                    <Zap className={`h-3.5 w-3.5 text-amber-500 ${measuringKey === 'un_tinted' ? 'animate-bounce' : ''}`} />
                    <span>{measuringKey === 'un_tinted' ? 'Ölçülüyor...' : 'DS-36D ile Saf Bazı Oku'}</span>
                  </button>
                </div>
              </div>

              {unTintedReflectance && (
                <div className="pt-2 border-t border-[var(--border)] flex items-center gap-4 text-[11px] font-mono text-[var(--text-muted)]">
                  <span>Ortalama Yansıma (R_avg): {(unTintedReflectance.reduce((a, b) => a + b, 0) / 31 * 100).toFixed(1)}%</span>
                  <span>Min R: {(Math.min(...unTintedReflectance) * 100).toFixed(1)}%</span>
                  <span>Maks R: {(Math.max(...unTintedReflectance) * 100).toFixed(1)}%</span>
                </div>
              )}
            </div>

            {/* Step 2: Black Letdown Dilution Ladder */}
            <div className="p-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-0)] space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[var(--brand-clay)] text-white text-[11px] flex items-center justify-center font-mono">
                      2
                    </span>
                    <span>Referans Siyah Pasta Seyreltme Merdiveni (Black Letdowns)</span>
                  </h3>
                  <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                    Seçili Referans Siyah Pasta ({statusData?.stages.stage1.black_paste?.name || 'PBk7 Karbon Siyahı'}) ile
                    hazırlanan açma kartlarını sırasıyla okutun.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-[var(--text-secondary)]">Tartım Bazı:</span>
                  <select
                    value={baseBatchWeight}
                    onChange={(e) => setBaseBatchWeight(Number(e.target.value))}
                    className="text-xs bg-[var(--surface-3)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text-primary)] font-mono"
                  >
                    <option value={50}>50 g</option>
                    <option value={100}>100 g (Standart)</option>
                    <option value={200}>200 g</option>
                  </select>
                </div>
              </div>

              {/* Ladder Table */}
              <div className="overflow-x-auto border border-[var(--border)] rounded-[var(--radius)] bg-[var(--surface-3)]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[var(--surface-0)] border-b border-[var(--border)] text-[var(--text-secondary)] font-mono">
                    <tr>
                      <th className="px-3.5 py-2">Konsantrasyon (%)</th>
                      <th className="px-3.5 py-2">Terazi Tartım Kılavuzu</th>
                      <th className="px-3.5 py-2">Spektral Durum</th>
                      <th className="px-3.5 py-2 text-right">İşlem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)] font-mono">
                    {blackLetdowns.map((row) => {
                      const isMeasured = row.reflectance && row.reflectance.length === 31;
                      const pasteWeightG = ((baseBatchWeight * row.concentration) / 100.0).toFixed(2);
                      const isMeasuringThis = measuringKey === `conc_${row.concentration}`;

                      return (
                        <tr key={row.concentration} className="hover:bg-[var(--surface-0)]/50 transition-colors">
                          <td className="px-3.5 py-2.5 font-bold text-[var(--text-primary)]">
                            %{row.concentration.toFixed(1)}
                          </td>
                          <td className="px-3.5 py-2.5 text-[var(--text-secondary)] font-sans">
                            <span className="font-mono font-semibold text-[var(--text-primary)]">{pasteWeightG} g</span> Siyah Pasta +{' '}
                            <span className="font-mono">{baseBatchWeight} g</span> Baz
                          </td>
                          <td className="px-3.5 py-2.5">
                            {isMeasured ? (
                              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold text-[11px]">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Okundu
                              </span>
                            ) : (
                              <span className="text-[var(--text-muted)] text-[11px]">Ölçüm Bekliyor</span>
                            )}
                          </td>
                          <td className="px-3.5 py-2.5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => handleMeasureLetdown(row.concentration)}
                                disabled={isMeasuringThis}
                                className={`px-2.5 py-1 text-xs rounded font-medium flex items-center gap-1 cursor-pointer transition-colors ${
                                  isMeasured
                                    ? 'bg-[var(--surface-0)] hover:bg-[var(--surface-1)] text-[var(--text-primary)] border border-[var(--border)]'
                                    : 'bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white shadow-xs'
                                }`}
                              >
                                <Zap className={`h-3 w-3 ${isMeasuringThis ? 'animate-bounce' : ''}`} />
                                <span>{isMeasuringThis ? 'Ölçülüyor...' : isMeasured ? 'Tekrar Oku' : 'DS-36D Oku'}</span>
                              </button>

                              {blackLetdowns.length > 2 && (
                                <button
                                  onClick={() =>
                                    setBlackLetdowns((prev) =>
                                      prev.filter((l) => Math.abs(l.concentration - row.concentration) > 0.001)
                                    )
                                  }
                                  className="p-1 text-[var(--text-muted)] hover:text-red-500 transition-colors"
                                  title="Satırı Sil"
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

              {/* Add Custom Concentration */}
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="number"
                  step="0.1"
                  min="0.05"
                  max="50"
                  value={customConc}
                  onChange={(e) => setCustomConc(e.target.value)}
                  placeholder="Özel Seyreltme % (örn. 0.2)"
                  className="w-44 text-xs font-mono bg-[var(--surface-3)] border border-[var(--border)] rounded px-2.5 py-1.5 text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-clay)]"
                />
                <button
                  type="button"
                  onClick={() => {
                    const c = parseFloat(customConc);
                    if (isNaN(c) || c <= 0) return;
                    if (blackLetdowns.some((l) => Math.abs(l.concentration - c) < 0.001)) return;
                    setBlackLetdowns((prev) => [...prev, { concentration: c, reflectance: [] }].sort((a, b) => a.concentration - b.concentration));
                    setCustomConc('');
                  }}
                  className="px-3 py-1.5 bg-[var(--surface-3)] hover:bg-[var(--surface-1)] border border-[var(--border)] text-xs text-[var(--text-primary)] font-medium rounded flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Seyreltme Ekle</span>
                </button>
              </div>
            </div>

            {/* Solve & Save Base Button */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-4 border-t border-[var(--border)]">
              <div className="text-xs text-[var(--text-secondary)]">
                Ölçülen Seyreltmeler: {blackLetdowns.filter((l) => l.reflectance?.length === 31).length} / {blackLetdowns.length}
              </div>

              <button
                onClick={handleCalculateBase}
                disabled={
                  isCalculatingBase ||
                  !unTintedReflectance ||
                  blackLetdowns.filter((l) => l.reflectance?.length === 31).length === 0
                }
                className="px-5 py-2.5 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] disabled:opacity-50 text-white font-semibold text-xs rounded-[var(--radius)] flex items-center gap-2 transition-colors cursor-pointer shadow-md"
              >
                <Award className="h-4 w-4" />
                <span>
                  {isCalculatingBase
                    ? 'K-M Matrisleri Hesaplanıyor...'
                    : 'Kubelka-Munk S_base(λ) ve K_base(λ) Matrisini Hesapla ve Kaydet'}
                </span>
              </button>
            </div>
          </div>

          {/* Stage 3 Results Card & Spectral Chart */}
          {stage3Result && (
            <div className="bg-[var(--surface-3)] border border-emerald-500/30 rounded-[var(--radius-lg)] p-6 space-y-6 shadow-[var(--shadow-md)]">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--border)]">
                <div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    <h3 className="text-base font-bold text-[var(--text-primary)]">
                      Karakterizasyon Başarılı: {stage3Result.name} ({stage3Result.code})
                    </h3>
                  </div>
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                    {stage3Result.summary}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span className="px-3 py-1 rounded-[var(--radius-sm)] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-mono text-xs font-bold border border-emerald-500/20">
                    CR: {(stage3Result.contrast_ratio * 100).toFixed(1)}% ({stage3Result.is_opaque ? 'Opak' : 'Yarı Saydam'})
                  </span>
                  <span className="px-3 py-1 rounded-[var(--radius-sm)] bg-blue-500/10 text-blue-600 dark:text-blue-400 font-mono text-xs font-bold border border-blue-500/20">
                    Ort. ΔE00: {stage3Result.mean_delta_e00.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Solved Optical Constants Chart */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SpectralChart
                  title={`${stage3Result.code} - Saçılma Katsayısı S_base(λ)`}
                  subtitle="Bootstrap Siyah açmalarıyla türetilen baz saçılma spektrumu"
                  series={[
                    {
                      id: 's_base',
                      name: 'S_base (Saçılma)',
                      color: '#2563eb',
                      data: stage3Result.scattering_s,
                      strokeWidth: 2
                    }
                  ]}
                  height={260}
                />

                <SpectralChart
                  title={`${stage3Result.code} - Soğurma Katsayısı K_base(λ)`}
                  subtitle="Türetilen baz absorpsiyon spektrumu (K_base = θ_base · S_base)"
                  series={[
                    {
                      id: 'k_base',
                      name: 'K_base (Soğurma)',
                      color: '#d97706',
                      data: stage3Result.absorption_k,
                      strokeWidth: 2
                    }
                  ]}
                  height={260}
                />
              </div>
            </div>
          )}

          {/* List of Already Characterized Production Bases */}
          <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-5 space-y-4 shadow-[var(--shadow-sm)]">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)] font-mono">
                Üretim Bazları Kütüphanesi ({statusData?.stages.stage3.count || 0})
              </h3>
              <span className="text-[11px] text-[var(--text-muted)] font-mono">
                Şeffaf Baz hariç tutulmuştur
              </span>
            </div>

            <div className="overflow-x-auto border border-[var(--border)] rounded-[var(--radius)]">
              <table className="w-full text-left text-xs">
                <thead className="bg-[var(--surface-0)] border-b border-[var(--border)] text-[var(--text-secondary)] font-mono">
                  <tr>
                    <th className="px-4 py-2.5">Baz Adı</th>
                    <th className="px-4 py-2.5">Kod</th>
                    <th className="px-4 py-2.5">Tip</th>
                    <th className="px-4 py-2.5">Kontrast Oranı</th>
                    <th className="px-4 py-2.5">Opaklık Durumu</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {statusData?.stages.stage3.bases && statusData.stages.stage3.bases.length > 0 ? (
                    statusData.stages.stage3.bases.map((b) => (
                      <tr key={b.id} className="hover:bg-[var(--surface-0)]/50 transition-colors">
                        <td className="px-4 py-3 font-semibold text-[var(--text-primary)]">{b.name}</td>
                        <td className="px-4 py-3 font-mono text-[var(--text-secondary)]">{b.code}</td>
                        <td className="px-4 py-3 font-mono text-[var(--text-secondary)]">{b.base_type}</td>
                        <td className="px-4 py-3 font-mono text-[var(--text-secondary)]">
                          {(b.contrast_ratio * 100).toFixed(1)}%
                        </td>
                        <td className="px-4 py-3">
                          {b.is_opaque ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold text-[11px]">
                              <CheckCircle2 className="h-3.5 w-3.5" /> Opak Baz
                            </span>
                          ) : (
                            <span className="text-blue-600 dark:text-blue-400 font-medium text-[11px]">
                              Yarı Saydam / Derin
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-[var(--text-muted)] italic">
                        Henüz karakterize edilmiş üretim bazı bulunmuyor. Yukarıdaki form ile ilk bazınızı karakterize edin.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: BW ÖNERİLEN KARIŞIM ŞABLONU EKLE / DÜZENLE         */}
      {/* ======================================================== */}
      {isBwTemplateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius-lg)] p-5 max-w-md w-full shadow-xl space-y-4 font-mono text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <h3 className="font-bold text-[var(--text-primary)] text-sm flex items-center gap-2">
                <Scale className="h-4 w-4 text-[var(--brand-clay)]" />
                <span>{editingBwTemplate ? 'BW Karışımını Düzenle' : 'Yeni BW Karışım Kademesi Ekle'}</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsBwTemplateModalOpen(false)}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] uppercase text-[var(--text-secondary)] mb-1">
                  Kademe Adı
                </label>
                <input
                  type="text"
                  value={bwFormName}
                  onChange={(e) => setBwFormName(e.target.value)}
                  placeholder="Örn: Siyah Kademesi 6 (%10.0)"
                  className="w-full px-2.5 py-1.5 bg-[var(--surface-1)] border border-[var(--border)] rounded text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand-clay)]"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase text-[var(--text-secondary)] mb-1">
                  Siyah Konsantrasyonu (%)
                </label>
                <input
                  type="number"
                  step="0.05"
                  min="0.0"
                  max="100.0"
                  value={bwFormConc}
                  onChange={(e) => setBwFormConc(parseFloat(e.target.value) || 0)}
                  className="w-full px-2.5 py-1.5 bg-[var(--surface-1)] border border-[var(--border)] rounded text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand-clay)]"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase text-[var(--text-secondary)] mb-1">
                  Açıklama / Kalibrasyon Rolü
                </label>
                <input
                  type="text"
                  value={bwFormDesc}
                  onChange={(e) => setBwFormDesc(e.target.value)}
                  placeholder="Örn: Yüksek absorpsiyon kontrol noktası"
                  className="w-full px-2.5 py-1.5 bg-[var(--surface-1)] border border-[var(--border)] rounded text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand-clay)]"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="bw_masstone_cb"
                  checked={bwFormIsMasstone}
                  onChange={(e) => setBwFormIsMasstone(e.target.checked)}
                  className="rounded border-[var(--border)] text-[var(--brand-clay)] focus:ring-0 cursor-pointer"
                />
                <label htmlFor="bw_masstone_cb" className="text-xs text-[var(--text-primary)] cursor-pointer select-none">
                  Saf Beyaz Masstone (%0 Siyah Katkısı)
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
              <button
                type="button"
                onClick={() => setIsBwTemplateModalOpen(false)}
                className="px-3 py-1.5 bg-[var(--surface-1)] hover:bg-[var(--surface-2)] border border-[var(--border)] rounded text-xs text-[var(--text-secondary)] cursor-pointer"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={handleSaveBwTemplate}
                className="px-4 py-1.5 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white rounded text-xs font-bold transition-all shadow-xs cursor-pointer"
              >
                {editingBwTemplate ? 'Güncelle' : 'Kaydet'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

