import React, { useState, useEffect } from 'react';
import {
  Cpu,
  Radio,
  Zap,
  CheckCircle2,
  AlertCircle,
  Clock,
  RefreshCw,
  Play,
  Sliders,
  ShieldCheck,
  ShieldAlert,
  Copy,
  Check,
  Layers,
  Activity,
  ArrowRight
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';
import {
  getChnspecStatus,
  listSerialPorts,
  connectChnspec,
  disconnectChnspec,
  calibrateChnspec,
  measureChnspec,
  getChnspecCalibrationHealth,
  getRm400Status,
  connectRm400,
  disconnectRm400,
  calibrateRm400,
  measureRm400
} from '../services/api';
import type {
  ChnspecStatusInfo,
  Rm400StatusInfo,
  MeasurementRecord,
  CalibrationHealthInfo
} from '../types';

interface SpectroSettingsViewProps {
  onNavigateToWizard?: () => void;
  onNavigateToFormulation?: () => void;
}

export const SpectroSettingsView: React.FC<SpectroSettingsViewProps> = ({
  onNavigateToWizard,
  onNavigateToFormulation
}) => {
  const [activeDevice, setActiveDevice] = useState<'chnspec' | 'rm400'>('chnspec');

  // CHNSpec state
  const [chnspecStatus, setChnspecStatus] = useState<ChnspecStatusInfo | null>(null);
  const [chnspecHealth, setChnspecHealth] = useState<CalibrationHealthInfo | null>(null);
  const [availablePorts, setAvailablePorts] = useState<Array<{ port: string; description: string; is_recommended: boolean }>>([]);
  const [selectedPort, setSelectedPort] = useState<string>('');

  // RM400 state
  const [rm400Status, setRm400Status] = useState<Rm400StatusInfo | null>(null);

  // Actions state
  const [isLoading, setIsLoading] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState<'White' | 'Black' | null>(null);
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // Measurement options
  const [sampleName, setSampleName] = useState('Numune 01');
  const [measureMode, setMeasureMode] = useState<'SCI' | 'SCE' | 'SCI_SCE'>('SCI');
  const [latestMeasurement, setLatestMeasurement] = useState<MeasurementRecord | null>(null);
  const [copiedCsv, setCopiedCsv] = useState(false);

  const refreshAll = async () => {
    setIsLoading(true);
    try {
      const [portsData, chnStatus, chnCal, rmStatus] = await Promise.all([
        listSerialPorts().catch(() => ({ ports: [], active_chnspec_port: null, is_chnspec_connected: false })),
        getChnspecStatus().catch(() => null),
        getChnspecCalibrationHealth().catch(() => null),
        getRm400Status().catch(() => null)
      ]);

      setAvailablePorts(portsData.ports || []);
      if (portsData.active_chnspec_port) {
        setSelectedPort(portsData.active_chnspec_port);
      } else if (portsData.ports && portsData.ports.length > 0) {
        const rec = portsData.ports.find((p: { is_recommended: boolean; port: string }) => p.is_recommended);
        setSelectedPort(rec ? rec.port : portsData.ports[0].port);
      }

      setChnspecStatus(chnStatus);
      setChnspecHealth(chnCal);
      setRm400Status(rmStatus);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Cihaz bilgileri güncellenemedi.' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshAll();
    const interval = setInterval(refreshAll, 12000);
    return () => clearInterval(interval);
  }, []);

  // Handle CHNSpec Connect
  const handleConnectChnspec = async () => {
    setIsConnecting(true);
    setFeedback(null);
    try {
      const res = await connectChnspec(selectedPort || undefined);
      if (res.connected) {
        setFeedback({
          type: 'success',
          message: `CHNSpec DS-36D başarıyla bağlandı (${res.port} - ${res.is_mock ? 'Simülasyon Modu' : 'Canlı Donanım'})`
        });
      } else {
        setFeedback({
          type: 'error',
          message: res.message || 'Cihaza bağlanılamadı. Portu ve USB kablosunu kontrol edin.'
        });
      }
      refreshAll();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Bağlantı hatası' });
    } finally {
      setIsConnecting(false);
    }
  };

  // Handle CHNSpec Disconnect
  const handleDisconnectChnspec = async () => {
    setIsConnecting(true);
    setFeedback(null);
    try {
      await disconnectChnspec();
      setFeedback({ type: 'info', message: 'CHNSpec bağlantısı sonlandırıldı.' });
      refreshAll();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Bağlantı kesilemedi.' });
    } finally {
      setIsConnecting(false);
    }
  };

  // Handle CHNSpec Calibrate
  const handleCalibrateChnspec = async (type: 'White' | 'Black') => {
    setIsCalibrating(type);
    setFeedback({
      type: 'info',
      message: `${type === 'White' ? 'Beyaz Karo' : 'Siyah Tuzak'} kalibrasyonu başladı. Lütfen cihaz flaşları tamamlanana kadar bekleyin...`
    });
    try {
      const res = await calibrateChnspec(type);
      if (res.success) {
        setFeedback({
          type: 'success',
          message: `${type === 'White' ? 'Beyaz Karo' : 'Siyah Tuzak'} kalibrasyonu başarıyla tamamlandı. Optik referans kaydedildi.`
        });
      } else {
        setFeedback({
          type: 'error',
          message: `${type === 'White' ? 'Beyaz Karo' : 'Siyah Tuzak'} kalibrasyonu başarısız: ${res.message || 'Cihaz yanıt vermedi.'}`
        });
      }
      refreshAll();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Kalibrasyon hatası oluştu.' });
    } finally {
      setIsCalibrating(null);
    }
  };

  // Handle CHNSpec Measure
  const handleMeasureChnspec = async () => {
    setIsMeasuring(true);
    setFeedback(null);
    try {
      const record = await measureChnspec(measureMode, sampleName);
      setLatestMeasurement(record);
      setFeedback({
        type: 'success',
        message: `Ölçüm başarıyla tamamlandı (${record.sample_name || sampleName}). 31-Kanal spektral veri güncellendi.`
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Ölçüm alınamadı.' });
    } finally {
      setIsMeasuring(false);
    }
  };

  // Handle RM400 Connect
  const handleConnectRm400 = async () => {
    setIsConnecting(true);
    setFeedback(null);
    try {
      const res = await connectRm400();
      if (res.connected) {
        setFeedback({
          type: 'success',
          message: `X-Rite RM400 başarıyla bağlandı (${res.is_mock ? 'Simülasyon' : 'Gerçek Cihaz'})`
        });
      } else {
        setFeedback({
          type: 'error',
          message: res.message || 'RM400 cihazına bağlanılamadı.'
        });
      }
      refreshAll();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'RM400 bağlantı hatası' });
    } finally {
      setIsConnecting(false);
    }
  };

  // Handle RM400 Disconnect
  const handleDisconnectRm400 = async () => {
    setIsConnecting(true);
    setFeedback(null);
    try {
      await disconnectRm400();
      setFeedback({ type: 'info', message: 'RM400 bağlantısı kesildi.' });
      refreshAll();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Bağlantı kesilemedi.' });
    } finally {
      setIsConnecting(false);
    }
  };

  // Handle RM400 Calibrate
  const handleCalibrateRm400 = async () => {
    setIsCalibrating('White');
    setFeedback(null);
    try {
      const res = await calibrateRm400();
      if (res.success) {
        setFeedback({ type: 'success', message: 'RM400 kalibrasyonu başarıyla tamamlandı.' });
      } else {
        setFeedback({ type: 'error', message: res.message || 'RM400 kalibrasyonu başarısız.' });
      }
      refreshAll();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'RM400 kalibrasyon hatası' });
    } finally {
      setIsCalibrating(null);
    }
  };

  // Handle RM400 Measure
  const handleMeasureRm400 = async () => {
    setIsMeasuring(true);
    setFeedback(null);
    try {
      const record = await measureRm400(sampleName);
      setLatestMeasurement(record);
      setFeedback({
        type: 'success',
        message: `RM400 ölçümü tamamlandı (${record.sample_name || sampleName}).`
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'RM400 ölçümü alınamadı.' });
    } finally {
      setIsMeasuring(false);
    }
  };

  const handleCopyCsv = () => {
    if (!latestMeasurement) return;
    const wls = latestMeasurement.wavelengths || Array.from({ length: 31 }, (_, i) => 400 + i * 10);
    const r = latestMeasurement.reflectance || [];
    const lines = ['Wavelength_nm,Reflectance'];
    wls.forEach((wl, idx) => {
      lines.push(`${wl},${r[idx] !== undefined ? r[idx] : ''}`);
    });
    navigator.clipboard.writeText(lines.join('\n'));
    setCopiedCsv(true);
    setTimeout(() => setCopiedCsv(false), 2000);
  };

  const isChnConnected = chnspecStatus?.connected ?? false;
  const isChnReal = isChnConnected && !chnspecStatus?.is_mock;
  const isRmConnected = rm400Status?.connected ?? false;
  const isRmReal = isRmConnected && !rm400Status?.is_mock;

  const calStatus = chnspecHealth?.status || 'UNCALIBRATED';
  const isCalValid = calStatus === 'VALID';
  const isCalExpiring = calStatus === 'EXPIRING_SOON';

  // Prepare chart series from latest measurement
  const chartData = latestMeasurement?.wavelengths
    ? latestMeasurement.wavelengths.map((wl, i) => {
        const item: any = { wl };
        if (latestMeasurement.reflectance && latestMeasurement.reflectance[i] !== undefined) {
          item.reflectance = Number((latestMeasurement.reflectance[i] * 100).toFixed(2));
        }
        if (latestMeasurement.sci_spectrum && latestMeasurement.sci_spectrum[i] !== undefined) {
          item.sci = Number((latestMeasurement.sci_spectrum[i] * 100).toFixed(2));
        }
        if (latestMeasurement.sce_spectrum && latestMeasurement.sce_spectrum[i] !== undefined) {
          item.sce = Number((latestMeasurement.sce_spectrum[i] * 100).toFixed(2));
        }
        return item;
      })
    : [];

  const rawLab = latestMeasurement?.lab;
  const labObj = Array.isArray(rawLab)
    ? { L: rawLab[0], a: rawLab[1], b: rawLab[2] }
    : rawLab || { L: 0, a: 0, b: 0 };

  return (
    <div className="max-w-7xl mx-auto px-6 py-6 w-full space-y-6">
      {/* Top Banner & Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[var(--border)]">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-[var(--radius-lg)] bg-[var(--surface-0)] border border-[var(--border)] flex items-center justify-center text-[var(--accent)] shadow-sm">
              <Cpu className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2.5">
                <span>Spektrofotometre Yönetim & Kalibrasyon Masası</span>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-[var(--radius-xs)] bg-[var(--surface-0)] border border-[var(--border)] text-[var(--text-secondary)]">
                  CHNSpec DS-36D & X-Rite RM400
                </span>
              </h1>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Donanım bağlantısı, optik karo kalibrasyonu, vardiya denetimi ve anlık canlı reflektans ölçümü
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 self-start md:self-auto font-mono">
          <button
            onClick={refreshAll}
            disabled={isLoading}
            className="px-3 py-1.5 rounded-[var(--radius)] bg-[var(--surface-0)] hover:bg-[var(--surface-3)] border border-[var(--border)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin text-[var(--accent)]' : ''}`} />
            <span>Yenile</span>
          </button>

          {onNavigateToWizard && (
            <button
              onClick={onNavigateToWizard}
              className="px-3 py-1.5 rounded-[var(--radius)] bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
            >
              <span>Karakterizasyona Git</span>
              <ArrowRight className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Notifications / Feedback Bar */}
      {feedback && (
        <div
          className={`p-3.5 rounded-[var(--radius-lg)] border text-xs flex items-center justify-between gap-3 shadow-sm ${
            feedback.type === 'success'
              ? 'bg-[var(--surface-3)] border-[var(--success)] text-[var(--success-text)]'
              : feedback.type === 'error'
              ? 'bg-[var(--surface-3)] border-[var(--danger)] text-[var(--danger-text)]'
              : 'bg-[var(--surface-3)] border-[var(--accent)] text-[var(--accent-text)]'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--success)]" />
            ) : feedback.type === 'error' ? (
              <AlertCircle className="h-4 w-4 shrink-0 text-[var(--danger)]" />
            ) : (
              <Activity className="h-4 w-4 shrink-0 animate-pulse text-[var(--accent)]" />
            )}
            <span className="font-medium text-[var(--text-primary)]">{feedback.message}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-[11px] font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] uppercase"
          >
            Kapat
          </button>
        </div>
      )}

      {/* Device Selector Tabs */}
      <div className="flex border-b border-[var(--border)] bg-[var(--surface-0)] px-2 rounded-[var(--radius-lg)]">
        <button
          onClick={() => setActiveDevice('chnspec')}
          className={`flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all ${
            activeDevice === 'chnspec'
              ? 'border-[var(--brand-clay)] text-[var(--brand-clay)] bg-[var(--surface-3)]/60'
              : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          <Radio className="h-4 w-4" />
          <span>CHNSpec DS-36D (d/8° Küre Geometrisi)</span>
          {isChnConnected && (
            <span
              className={`w-2 h-2 rounded-full ${
                isChnReal ? 'bg-[var(--success)] animate-pulse' : 'bg-[var(--warning)]'
              }`}
            />
          )}
        </button>

        <button
          onClick={() => setActiveDevice('rm400')}
          className={`flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition-all ${
            activeDevice === 'rm400'
              ? 'border-[var(--brand-clay)] text-[var(--brand-clay)] bg-[var(--surface-3)]/60'
              : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          <Sliders className="h-4 w-4" />
          <span>X-Rite RM400 (45°:0° Dairesel Algılama)</span>
          {isRmConnected && (
            <span className="w-2 h-2 rounded-full bg-[var(--success)] animate-pulse" />
          )}
        </button>
      </div>

      {/* Main Grid Content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* SOL: Cihaz Bağlantı & Kalibrasyon (5 Cols) */}
        <div className="lg:col-span-5 space-y-5">
          {/* ======================================================== */}
          {/* 1. BAĞLANTI & PORT PANELİ */}
          {/* ======================================================== */}
          <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-5 space-y-4 shadow-[var(--shadow-sm)] transition-colors">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <div className="flex items-center gap-2">
                <Radio className="h-4 w-4 text-[var(--brand-clay)]" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)] font-mono">
                  1. Cihaz Bağlantı Portu
                </h3>
              </div>
              <span
                className={`px-2 py-0.5 rounded-[var(--radius-xs)] text-[10px] font-mono font-medium border ${
                  activeDevice === 'chnspec'
                    ? isChnReal
                      ? 'bg-[var(--surface-0)] border-[var(--border)] text-[var(--success-text)] font-semibold'
                      : isChnConnected
                      ? 'bg-[var(--surface-0)] border-[var(--border)] text-[var(--warning-text)]'
                      : 'bg-[var(--surface-0)] border-[var(--border)] text-[var(--text-muted)]'
                    : isRmReal
                    ? 'bg-[var(--surface-0)] border-[var(--border)] text-[var(--success-text)] font-semibold'
                    : 'bg-[var(--surface-0)] border-[var(--border)] text-[var(--text-muted)]'
                }`}
              >
                {activeDevice === 'chnspec'
                  ? isChnReal
                    ? 'DONANIM BAĞLI'
                    : isChnConnected
                    ? 'SİMÜLASYON'
                    : 'BAĞLI DEĞİL'
                  : isRmConnected
                  ? 'RM400 BAĞLI'
                  : 'BAĞLI DEĞİL'}
              </span>
            </div>

            {activeDevice === 'chnspec' ? (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-[var(--text-secondary)] block mb-1.5 font-medium">
                    Seri COM Portu Seçimi:
                  </label>
                  <select
                    value={selectedPort}
                    onChange={(e) => setSelectedPort(e.target.value)}
                    disabled={isConnecting || isChnConnected}
                    className="w-full bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] font-mono disabled:opacity-50"
                  >
                    {availablePorts.length === 0 ? (
                      <option value="">Port bulunamadı</option>
                    ) : (
                      availablePorts.map((p) => (
                        <option key={p.port} value={p.port}>
                          {p.port} • {p.description || 'Seri Port'} {p.is_recommended ? '(ÖNERİLEN DS-36D)' : ''}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div className="pt-2 flex items-center gap-2">
                  {!isChnConnected ? (
                    <button
                      onClick={handleConnectChnspec}
                      disabled={isConnecting}
                      className="flex-1 py-2.5 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white rounded-[var(--radius)] text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 shadow-sm"
                    >
                      <Zap className="h-4 w-4 fill-current" />
                      <span>{isConnecting ? 'Bağlanıyor...' : 'DS-36D Cihaza Bağlan'}</span>
                    </button>
                  ) : (
                    <button
                      onClick={handleDisconnectChnspec}
                      disabled={isConnecting}
                      className="flex-1 py-2.5 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] border border-[var(--danger)] text-[var(--danger-text)] rounded-[var(--radius)] text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                    >
                      <span>{isConnecting ? 'Ayrılıyor...' : 'Bağlantıyı Kes'}</span>
                    </button>
                  )}
                  <button
                    onClick={refreshAll}
                    title="Portları Yeniden Tara"
                    className="p-2.5 bg-[var(--surface-0)] border border-[var(--border)] hover:bg-[var(--surface-1)] rounded-[var(--radius)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                </div>

                <div className="p-3 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] text-[11px] font-mono text-[var(--text-secondary)] space-y-1">
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">Cihaz Modeli:</span>
                    <span className="text-[var(--text-primary)]">CHNSpec DS-36D</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">Optik Geometri:</span>
                    <span className="text-[var(--text-primary)]">d/8° Difüz Entegre Küre</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">Kanal Sayısı:</span>
                    <span className="text-[var(--text-primary)]">400-700 nm @ 10 nm (31 Kanal)</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  X-Rite RM400 cihazı 45°:0° optik geometriye sahip olup `RM400.dll` sürücüsü üzerinden USB ile kontrol edilir.
                </p>

                <div className="pt-2">
                  {!isRmConnected ? (
                    <button
                      onClick={handleConnectRm400}
                      disabled={isConnecting}
                      className="w-full py-2.5 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white rounded-[var(--radius)] text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 shadow-sm"
                    >
                      <Zap className="h-4 w-4 fill-current" />
                      <span>{isConnecting ? 'Bağlanıyor...' : 'RM400 Cihaza Bağlan'}</span>
                    </button>
                  ) : (
                    <button
                      onClick={handleDisconnectRm400}
                      disabled={isConnecting}
                      className="w-full py-2.5 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] border border-[var(--danger)] text-[var(--danger-text)] rounded-[var(--radius)] text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                    >
                      <span>Bağlantıyı Kes</span>
                    </button>
                  )}
                </div>

                <div className="p-3 bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] text-[11px] font-mono text-[var(--text-secondary)] space-y-1">
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">Model:</span>
                    <span className="text-[var(--text-primary)]">X-Rite RM400</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">Geometri:</span>
                    <span className="text-[var(--text-primary)]">45°/0° SPEX</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">Sürücü Durumu:</span>
                    <span className={rm400Status?.driver_available ? 'text-[var(--success-text)] font-semibold' : 'text-[var(--text-muted)]'}>
                      {rm400Status?.driver_available ? 'DLL Hazır' : 'Sürücü Yok (Simülasyon)'}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ======================================================== */}
          {/* 2. KALİBRASYON MASASI */}
          {/* ======================================================== */}
          <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-5 space-y-4 shadow-[var(--shadow-sm)] transition-colors">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-[var(--success-text)]" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)] font-mono">
                  2. Kalibrasyon Masası
                </h3>
              </div>
              <span
                className={`px-2 py-0.5 rounded-[var(--radius-xs)] text-[10px] font-mono font-medium border ${
                  isCalValid
                    ? 'bg-[var(--surface-0)] border-[var(--border)] text-[var(--success-text)] font-semibold'
                    : isCalExpiring
                    ? 'bg-[var(--surface-0)] border-[var(--border)] text-[var(--warning-text)]'
                    : 'bg-[var(--surface-0)] border-[var(--border)] text-[var(--danger-text)]'
                }`}
              >
                {isCalValid
                  ? 'KALİBRASYON GEÇERLİ'
                  : isCalExpiring
                  ? 'SÜRESİ YAKLAŞIYOR'
                  : 'KALİBRASYON GEREKLİ'}
              </span>
            </div>

            {/* Health Info Card */}
            <div className="p-3 rounded-[var(--radius)] bg-[var(--surface-0)] border border-[var(--border)] text-xs font-mono space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-secondary)] flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                  Vardiya Sayacı (8 Saat ISO):
                </span>
                <span className="text-[var(--text-primary)] font-semibold">
                  {chnspecHealth?.remaining_hours !== undefined
                    ? `${chnspecHealth.remaining_hours.toFixed(1)} saat kaldı`
                    : 'Kalibrasyon yapılmadı'}
                </span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                {chnspecHealth?.message || 'Cihazla doğru ölçüm almak için beyaz ve siyah kalibrasyonu yapınız.'}
              </p>
            </div>

            {activeDevice === 'chnspec' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                {/* Beyaz Karo Kalibrasyonu */}
                <div className="p-3.5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-0)] flex flex-col justify-between space-y-3">
                  <div>
                    <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase block mb-1">Adım 1</span>
                    <h4 className="text-xs font-semibold text-[var(--text-primary)]">Beyaz Karo</h4>
                    <p className="text-[11px] text-[var(--text-secondary)] mt-1 leading-relaxed">
                      Beyaz seramik kalibrasyon karosunu açıklığa kilitleyin.
                    </p>
                  </div>
                  <button
                    onClick={() => handleCalibrateChnspec('White')}
                    disabled={isCalibrating !== null}
                    className="w-full py-2 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white rounded-[var(--radius)] text-xs font-semibold transition-all disabled:opacity-50 shadow-sm flex items-center justify-center gap-1.5"
                  >
                    {isCalibrating === 'White' ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin text-white" />
                        <span>Flaş Patlıyor...</span>
                      </>
                    ) : (
                      <>
                        <Zap className="h-3.5 w-3.5 fill-current" />
                        <span>Beyazı Kalibre Et</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Siyah Tuzak Kalibrasyonu */}
                <div className="p-3.5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-0)] flex flex-col justify-between space-y-3">
                  <div>
                    <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase block mb-1">Adım 2</span>
                    <h4 className="text-xs font-semibold text-[var(--text-primary)]">Siyah Tuzak</h4>
                    <p className="text-[11px] text-[var(--text-secondary)] mt-1 leading-relaxed">
                      Siyah ışık tuzağını (Black Cavity) açıklığa yerleştirin.
                    </p>
                  </div>
                  <button
                    onClick={() => handleCalibrateChnspec('Black')}
                    disabled={isCalibrating !== null}
                    className="w-full py-2 bg-[var(--surface-1)] hover:bg-[var(--surface-3)] text-[var(--text-primary)] border border-[var(--border)] rounded-[var(--radius)] text-xs font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    {isCalibrating === 'Black' ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin text-[var(--text-primary)]" />
                        <span>Flaş Patlıyor...</span>
                      </>
                    ) : (
                      <>
                        <Zap className="h-3.5 w-3.5 fill-current text-[var(--text-muted)]" />
                        <span>Siyahı Kalibre Et</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <div className="pt-2">
                <button
                  onClick={handleCalibrateRm400}
                  disabled={isCalibrating !== null}
                  className="w-full py-2.5 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white rounded-[var(--radius)] text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 shadow-sm"
                >
                  <Zap className="h-4 w-4 fill-current" />
                  <span>{isCalibrating ? 'RM400 Kalibre Ediliyor...' : 'RM400 Standart Kalibrasyonu Yap'}</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* SAĞ: Canlı Ölçüm İstasyonu & Spektrum (7 Cols) */}
        <div className="lg:col-span-7 space-y-5">
          {/* ======================================================== */}
          {/* 3. CANLI ÖLÇÜM MASASI */}
          {/* ======================================================== */}
          <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-5 space-y-4 shadow-[var(--shadow-sm)] transition-colors">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <div className="flex items-center gap-2">
                <Play className="h-4 w-4 text-[var(--brand-clay)] fill-current" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)] font-mono">
                  3. Canlı Test Ölçüm Masası
                </h3>
              </div>
              <span className="text-[11px] font-mono text-[var(--text-muted)]">
                Tek Tıkla Spektrum Okuma
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-5">
                <label className="text-xs text-[var(--text-secondary)] block mb-1 font-medium">
                  Numune Adı / Seri No:
                </label>
                <input
                  type="text"
                  value={sampleName}
                  onChange={(e) => setSampleName(e.target.value)}
                  placeholder="Numune 01"
                  className="w-full bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] font-mono"
                />
              </div>

              {activeDevice === 'chnspec' && (
                <div className="sm:col-span-4">
                  <label className="text-xs text-[var(--text-secondary)] block mb-1 font-medium">
                    Optik Mod:
                  </label>
                  <select
                    value={measureMode}
                    onChange={(e: any) => setMeasureMode(e.target.value)}
                    className="w-full bg-[var(--surface-0)] border border-[var(--border)] rounded-[var(--radius)] px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] font-mono"
                  >
                    <option value="SCI">SCI (Speküler Dahil - Toplam)</option>
                    <option value="SCE">SCE (Speküler Hariç - Doku)</option>
                    <option value="SCI_SCE">SCI + SCE (Eşzamanlı Çift Işın)</option>
                  </select>
                </div>
              )}

              <div className={activeDevice === 'chnspec' ? 'sm:col-span-3' : 'sm:col-span-7'}>
                <button
                  onClick={activeDevice === 'chnspec' ? handleMeasureChnspec : handleMeasureRm400}
                  disabled={isMeasuring}
                  className="w-full py-2.5 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white rounded-[var(--radius)] text-xs font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 shadow-sm"
                >
                  <Play className={`h-3.5 w-3.5 fill-current ${isMeasuring ? 'animate-ping' : ''}`} />
                  <span>{isMeasuring ? 'Flaş Patlıyor...' : 'Canlı Ölçüm Al'}</span>
                </button>
              </div>
            </div>

            {/* Quick Result Preview Card */}
            {latestMeasurement && (
              <div className="p-4 rounded-[var(--radius)] bg-[var(--surface-0)] border border-[var(--border)] flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div
                    className="w-12 h-12 rounded-[var(--radius)] border border-[var(--border-strong)] shadow-md flex-shrink-0"
                    style={{ backgroundColor: latestMeasurement.hex || '#777777' }}
                  />
                  <div>
                    <h4 className="text-xs font-bold text-[var(--text-primary)] font-mono">
                      {latestMeasurement.sample_name || sampleName}
                    </h4>
                    <p className="text-[11px] font-mono text-[var(--text-muted)] mt-0.5">
                      {latestMeasurement.instrument || 'Spektrofotometre'} • {latestMeasurement.geometry || 'd/8°'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-xs font-mono">
                  <div className="text-center">
                    <span className="text-[10px] text-[var(--text-muted)] block">L*</span>
                    <span className="text-[var(--text-primary)] font-bold">{labObj.L.toFixed(2)}</span>
                  </div>
                  <div className="text-center">
                    <span className="text-[10px] text-[var(--text-muted)] block">a*</span>
                    <span className={`font-bold ${labObj.a >= 0 ? 'text-[var(--danger-text)]' : 'text-[var(--success-text)]'}`}>
                      {labObj.a.toFixed(2)}
                    </span>
                  </div>
                  <div className="text-center">
                    <span className="text-[10px] text-[var(--text-muted)] block">b*</span>
                    <span className={`font-bold ${labObj.b >= 0 ? 'text-[var(--warning-text)]' : 'text-[var(--accent-text)]'}`}>
                      {labObj.b.toFixed(2)}
                    </span>
                  </div>
                  <div className="text-center pl-2 border-l border-[var(--border)]">
                    <span className="text-[10px] text-[var(--text-muted)] block">HEX</span>
                    <span className="text-[var(--text-primary)] font-bold">{latestMeasurement.hex || '#---'}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ======================================================== */}
          {/* 4. SPEKTRAL GRAFİK & REFLEKTANS EĞRİSİ */}
          {/* ======================================================== */}
          <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-5 space-y-4 shadow-[var(--shadow-sm)] transition-colors">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-[var(--brand-clay)]" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)] font-mono">
                  4. Canlı Spektral Yansıma Eğrisi (400 - 700 nm)
                </h3>
              </div>
              {latestMeasurement && (
                <button
                  onClick={handleCopyCsv}
                  className="px-2.5 py-1 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] border border-[var(--border)] text-[11px] font-mono text-[var(--text-primary)] rounded-[var(--radius-xs)] flex items-center gap-1.5 transition-colors shadow-sm"
                >
                  {copiedCsv ? <Check className="h-3 w-3 text-[var(--success-text)]" /> : <Copy className="h-3 w-3" />}
                  <span>{copiedCsv ? 'Kopyalandı' : 'CSV Kopyala'}</span>
                </button>
              )}
            </div>

            <div className="h-64 w-full">
              {chartData.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-[var(--text-muted)] gap-2 border border-dashed border-[var(--border)] rounded-[var(--radius-lg)] bg-[var(--surface-0)]">
                  <Radio className="h-6 w-6 opacity-40" />
                  <p className="text-xs font-mono">Henüz ölçüm alınmadı. 'Canlı Ölçüm Al' düğmesine basınız.</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="wl" stroke="var(--text-muted)" fontSize={10} tickLine={false} />
                    <YAxis stroke="var(--text-muted)" fontSize={10} domain={[0, 100]} tickLine={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--surface-3)',
                        borderColor: 'var(--border-strong)',
                        borderRadius: '0.5rem',
                        fontSize: '11px',
                        fontFamily: 'monospace',
                        color: 'var(--text-primary)'
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px', fontFamily: 'monospace' }} />
                    {latestMeasurement?.sci_spectrum && (
                      <Line
                        type="monotone"
                        dataKey="sci"
                        name="SCI (Speküler Dahil)"
                        stroke="#38bdf8"
                        strokeWidth={2}
                        dot={false}
                      />
                    )}
                    {latestMeasurement?.sce_spectrum && (
                      <Line
                        type="monotone"
                        dataKey="sce"
                        name="SCE (Speküler Hariç)"
                        stroke="#f43f5e"
                        strokeWidth={2}
                        strokeDasharray="4 4"
                        dot={false}
                      />
                    )}
                    {!latestMeasurement?.sci_spectrum && !latestMeasurement?.sce_spectrum && (
                      <Line
                        type="monotone"
                        dataKey="reflectance"
                        name="Yansıma R(λ) %"
                        stroke="#10b981"
                        strokeWidth={2.2}
                        dot={{ r: 2 }}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
