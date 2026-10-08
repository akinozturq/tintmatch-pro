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
  getChnspecCalibrationHealth
} from '../services/api';
import type {
  ChnspecStatusInfo,
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
  // CHNSpec state
  const [chnspecStatus, setChnspecStatus] = useState<ChnspecStatusInfo | null>(null);
  const [chnspecHealth, setChnspecHealth] = useState<CalibrationHealthInfo | null>(null);
  const [availablePorts, setAvailablePorts] = useState<Array<{ port: string; description: string; is_recommended: boolean }>>([]);
  const [selectedPort, setSelectedPort] = useState<string>('');

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
      const [portsData, chnStatus, chnCal] = await Promise.all([
        listSerialPorts().catch(() => ({ ports: [], active_chnspec_port: null, is_chnspec_connected: false })),
        getChnspecStatus().catch(() => null),
        getChnspecCalibrationHealth().catch(() => null)
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
    } catch (err: any) {
      console.error('Donanım durumu yenilenirken hata:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshAll();
    const interval = setInterval(refreshAll, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleConnectChnspec = async () => {
    setIsConnecting(true);
    setFeedback(null);
    try {
      const res = await connectChnspec(selectedPort || undefined);
      if (res.connected) {
        setFeedback({
          type: 'success',
          message: `CHNSpec DS-36D spektrofotometresi başarıyla bağlandı (${res.port} - ${
            res.is_mock ? 'Simülasyon Modu' : 'Gerçek Donanım'
          })`
        });
      } else {
        setFeedback({
          type: 'error',
          message: res.message || 'Cihaza bağlanılamadı. Portu ve USB kablosunu kontrol ediniz.'
        });
      }
      refreshAll();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Bağlantı hatası oluştu' });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnectChnspec = async () => {
    setIsConnecting(true);
    setFeedback(null);
    try {
      await disconnectChnspec();
      setFeedback({ type: 'info', message: 'CHNSpec DS-36D bağlantısı sonlandırıldı.' });
      refreshAll();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Bağlantı kesilemedi' });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleCalibrateChnspec = async (type: 'White' | 'Black') => {
    setIsCalibrating(type);
    setFeedback(null);
    try {
      const res = await calibrateChnspec(type);
      if (res.success) {
        setFeedback({
          type: 'success',
          message: `${type === 'White' ? 'Beyaz Standart Karo' : 'Siyah Boşluk Tuzağı'} kalibrasyonu onaylandı.`
        });
      } else {
        setFeedback({
          type: 'error',
          message: `${type === 'White' ? 'Beyaz' : 'Siyah'} kalibrasyonu başarısız: ${res.message || 'Cihaz yanıt vermedi'}`
        });
      }
      refreshAll();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Kalibrasyon hatası' });
    } finally {
      setIsCalibrating(null);
    }
  };

  const handleMeasureChnspec = async () => {
    setIsMeasuring(true);
    setFeedback(null);
    try {
      const record = await measureChnspec(measureMode, sampleName);
      setLatestMeasurement(record);
      setFeedback({
        type: 'success',
        message: `Ölçüm tamamlandı (${record.sample_name || sampleName}) - ${measureMode} modu veritabanına işlendi.`
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Ölçüm alınamadı' });
    } finally {
      setIsMeasuring(false);
    }
  };

  const handleCopyCsv = () => {
    if (!latestMeasurement) return;
    const wls = latestMeasurement.wavelengths || Array.from({ length: 31 }, (_, i) => 400 + i * 10);
    const refl = latestMeasurement.reflectance || [];
    const rows = ['Wavelength;Reflectance'];
    wls.forEach((wl, idx) => {
      rows.push(`${wl};${(refl[idx] ?? 0).toFixed(4)}`);
    });
    navigator.clipboard.writeText(rows.join('\n'));
    setCopiedCsv(true);
    setTimeout(() => setCopiedCsv(false), 2000);
  };

  const isChnConnected = chnspecStatus?.connected ?? false;
  const isChnReal = isChnConnected && !chnspecStatus?.is_mock;

  // Chart preparation
  const wavelengths = latestMeasurement?.wavelengths || Array.from({ length: 31 }, (_, i) => 400 + i * 10);
  const chartData = wavelengths.map((wl, idx) => {
    const dataObj: any = { wl: `${wl}nm` };
    if (latestMeasurement?.reflectance) {
      dataObj.reflectance = Number(((latestMeasurement.reflectance[idx] ?? 0) * 100).toFixed(2));
    }
    if (latestMeasurement?.sci_spectrum) {
      dataObj.sci = Number(((latestMeasurement.sci_spectrum[idx] ?? 0) * 100).toFixed(2));
    }
    if (latestMeasurement?.sce_spectrum) {
      dataObj.sce = Number(((latestMeasurement.sce_spectrum[idx] ?? 0) * 100).toFixed(2));
    }
    return dataObj;
  });

  const labObj = latestMeasurement?.lab
    ? (Array.isArray(latestMeasurement.lab)
        ? { L: latestMeasurement.lab[0] ?? 0, a: latestMeasurement.lab[1] ?? 0, b: latestMeasurement.lab[2] ?? 0 }
        : { L: latestMeasurement.lab.L ?? 0, a: latestMeasurement.lab.a ?? 0, b: latestMeasurement.lab.b ?? 0 })
    : { L: 0, a: 0, b: 0 };

  return (
    <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
      {/* Title & Top Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[var(--border)]">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)] flex items-center gap-2.5">
            <Cpu className="h-6 w-6 text-[var(--brand-clay)]" />
            <span>CHNSpec DS-36D Spektrofotometre Masası</span>
          </h1>
          <p className="text-xs text-[var(--text-secondary)] mt-1 font-mono">
            d/8° Difüz Entegre Küre Geometrisi • SCI (Parlaklık Dahil) & SCE (Parlaklık Hariç) • 31 Kanal (400-700 nm)
          </p>
        </div>

        <div className="flex items-center gap-3">
          {onNavigateToWizard && (
            <button
              onClick={onNavigateToWizard}
              className="px-3.5 py-1.5 bg-[var(--surface-3)] hover:bg-[var(--surface-0)] border border-[var(--border)] text-xs font-medium rounded-[var(--radius)] text-[var(--text-primary)] flex items-center gap-2 transition-colors cursor-pointer shadow-xs"
            >
              <Layers className="h-4 w-4 text-[var(--brand-clay)]" />
              <span>K-M Karakterizasyona Git</span>
            </button>
          )}

          {onNavigateToFormulation && (
            <button
              onClick={onNavigateToFormulation}
              className="px-3.5 py-1.5 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white text-xs font-semibold rounded-[var(--radius)] flex items-center gap-2 transition-colors cursor-pointer shadow-sm"
            >
              <span>CCM Reçete Eşlemeye Git</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Alert Banner */}
      {feedback && (
        <div
          className={`p-3.5 rounded-[var(--radius-lg)] border text-xs flex items-center justify-between gap-3 animate-in fade-in duration-150 ${
            feedback.type === 'success'
              ? 'bg-[var(--surface-3)] border-[var(--success)] text-[var(--success-text)]'
              : feedback.type === 'error'
              ? 'bg-[var(--surface-3)] border-[var(--danger)] text-[var(--danger-text)]'
              : 'bg-[var(--surface-3)] border-[var(--brand-clay)] text-[var(--text-primary)]'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 text-[var(--success)] shrink-0" />
            ) : feedback.type === 'error' ? (
              <AlertCircle className="h-4 w-4 text-[var(--danger)] shrink-0" />
            ) : (
              <Activity className="h-4 w-4 text-[var(--brand-clay)] shrink-0" />
            )}
            <span className="font-medium">{feedback.message}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Grid Content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* SOL: Cihaz Bağlantı & Kalibrasyon (5 Cols) */}
        <div className="lg:col-span-5 space-y-5">
          {/* 1. BAĞLANTI & PORT PANELİ */}
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
                  isChnReal
                    ? 'bg-[var(--surface-0)] border-[var(--border)] text-[var(--success-text)] font-semibold'
                    : isChnConnected
                    ? 'bg-[var(--surface-0)] border-[var(--border)] text-[var(--warning-text)]'
                    : 'bg-[var(--surface-0)] border-[var(--border)] text-[var(--text-muted)]'
                }`}
              >
                {isChnReal ? 'GERÇEK DONANIM BAĞLI' : isChnConnected ? 'MOCK / SİMÜLASYON' : 'BAĞLI DEĞİL'}
              </span>
            </div>

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
                    <option value="">Port bulunamadı (Mock başlatılacak)</option>
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
                  className="p-2.5 bg-[var(--surface-0)] border border-[var(--border)] hover:bg-[var(--surface-1)] rounded-[var(--radius)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                >
                  <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
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
          </div>

          {/* 2. KALİBRASYON PANELİ */}
          <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-5 space-y-4 shadow-[var(--shadow-sm)] transition-colors">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-[var(--brand-clay)]" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)] font-mono">
                  2. Kalibrasyon Güvenliği (8 Saat)
                </h3>
              </div>
              <span
                className={`px-2 py-0.5 rounded-[var(--radius-xs)] text-[10px] font-mono font-medium border ${
                  chnspecHealth?.status === 'VALID'
                    ? 'bg-[var(--surface-0)] border-[var(--border)] text-[var(--success-text)] font-semibold'
                    : chnspecHealth?.status === 'EXPIRING_SOON'
                    ? 'bg-[var(--surface-0)] border-[var(--border)] text-[var(--warning-text)]'
                    : 'bg-[var(--surface-0)] border-[var(--border)] text-[var(--danger-text)]'
                }`}
              >
                {chnspecHealth?.status === 'VALID'
                  ? 'KALİBRASYON GEÇERLİ'
                  : chnspecHealth?.status === 'EXPIRING_SOON'
                  ? 'SÜRESİ YAKLAŞTI'
                  : 'SÜRESİ DOLDU'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-[11px] font-mono bg-[var(--surface-0)] p-3 rounded-[var(--radius)] border border-[var(--border)]">
              <div>
                <span className="text-[var(--text-muted)] block text-[10px]">Son Kalibrasyon:</span>
                <span className="text-[var(--text-primary)] font-semibold">
                  {chnspecHealth?.last_calibrated_at
                    ? new Date(chnspecHealth.last_calibrated_at * 1000).toLocaleTimeString()
                    : 'Henüz Yapılmadı'}
                </span>
              </div>
              <div>
                <span className="text-[var(--text-muted)] block text-[10px]">Kalan Güvenlik Süresi:</span>
                <span className="text-[var(--text-primary)] font-semibold">
                  {chnspecHealth?.remaining_hours !== undefined
                    ? `${Math.max(0, chnspecHealth.remaining_hours).toFixed(1)} Saat`
                    : (chnspecHealth?.hours_remaining !== undefined
                      ? `${Math.max(0, chnspecHealth.hours_remaining).toFixed(1)} Saat`
                      : '0 Saat')}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <button
                onClick={() => handleCalibrateChnspec('White')}
                disabled={isCalibrating !== null}
                className="py-2 px-3 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] border border-[var(--border)] rounded-[var(--radius)] text-xs font-semibold text-[var(--text-primary)] flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
              >
                {isCalibrating === 'White' ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin text-[var(--brand-clay)]" />
                    <span>Kalibre Ediliyor...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-3.5 w-3.5 text-[var(--success-text)]" />
                    <span>1. Beyaz Karo</span>
                  </>
                )}
              </button>

              <button
                onClick={() => handleCalibrateChnspec('Black')}
                disabled={isCalibrating !== null}
                className="py-2 px-3 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] border border-[var(--border)] rounded-[var(--radius)] text-xs font-semibold text-[var(--text-primary)] flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
              >
                {isCalibrating === 'Black' ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin text-[var(--text-primary)]" />
                    <span>Kalibre Ediliyor...</span>
                  </>
                ) : (
                  <>
                    <Zap className="h-3.5 w-3.5 fill-current text-[var(--text-muted)]" />
                    <span>2. Siyah Tuzak</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* SAĞ: Canlı Ölçüm İstasyonu & Spektrum (7 Cols) */}
        <div className="lg:col-span-7 space-y-5">
          {/* 3. CANLI ÖLÇÜM MASASI */}
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

              <div className="sm:col-span-3">
                <button
                  onClick={handleMeasureChnspec}
                  disabled={isMeasuring}
                  className="w-full py-2.5 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white rounded-[var(--radius)] text-xs font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 shadow-sm cursor-pointer"
                >
                  <Play className={`h-3.5 w-3.5 fill-current ${isMeasuring ? 'animate-ping' : ''}`} />
                  <span>{isMeasuring ? 'Okunuyor...' : 'Canlı Ölçüm Al'}</span>
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
                      CHNSpec DS-36D • {latestMeasurement.geometry || 'd/8°'} • {latestMeasurement.mode || measureMode}
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

          {/* 4. SPEKTRAL GRAFİK & REFLEKTANS EĞRİSİ */}
          <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-5 space-y-4 shadow-[var(--shadow-sm)] transition-colors">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-[var(--brand-clay)]" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)] font-mono">
                  4. Spektral Yansıma Eğrisi (400 - 700 nm @ 10 nm)
                </h3>
              </div>
              {latestMeasurement && (
                <button
                  onClick={handleCopyCsv}
                  className="px-2.5 py-1 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] border border-[var(--border)] text-[11px] font-mono text-[var(--text-primary)] rounded-[var(--radius-xs)] flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer"
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
