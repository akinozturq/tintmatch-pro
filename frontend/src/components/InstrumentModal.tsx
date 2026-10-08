import React, { useState, useEffect } from 'react';
import {
  X,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Play,
  Clock,
  Radio,
  Sliders,
  Sparkles,
  Zap,
  HelpCircle,
  Cpu
} from 'lucide-react';
import {
  listSerialPorts,
  getChnspecStatus,
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

interface InstrumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMeasurementComplete?: (record: MeasurementRecord) => void;
}

export const InstrumentModal: React.FC<InstrumentModalProps> = ({
  isOpen,
  onClose,
  onMeasurementComplete
}) => {
  // CHNSpec state
  const [chnspecStatus, setChnspecStatus] = useState<ChnspecStatusInfo | null>(null);
  const [chnspecHealth, setChnspecHealth] = useState<CalibrationHealthInfo | null>(null);
  const [availablePorts, setAvailablePorts] = useState<Array<{ port: string; description: string; is_recommended: boolean }>>([]);
  const [selectedPort, setSelectedPort] = useState<string>('');

  // Action states
  const [isConnecting, setIsConnecting] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState<string | null>(null);
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Measurement options
  const [sampleName, setSampleName] = useState('Numune 01');
  const [measureMode, setMeasureMode] = useState<'SCI' | 'SCE' | 'SCI_SCE'>('SCI');
  const [latestMeasurement, setLatestMeasurement] = useState<MeasurementRecord | null>(null);

  const refreshAll = async () => {
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
    } catch {
      // Ignore background errors
    }
  };

  useEffect(() => {
    if (isOpen) {
      setFeedback(null);
      refreshAll();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Handle CHNSpec Connect
  const handleConnectChnspec = async () => {
    setIsConnecting(true);
    setFeedback(null);
    try {
      const res = await connectChnspec(selectedPort || undefined);
      if (res.connected) {
        setFeedback({
          type: 'success',
          message: `CHNSpec DS-36D başarıyla bağlandı (${res.port} - ${res.is_mock ? 'Simülasyon' : 'Gerçek Donanım'})`
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
      setFeedback({ type: 'success', message: 'CHNSpec bağlantısı sonlandırıldı.' });
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
    setFeedback(null);
    try {
      const res = await calibrateChnspec(type);
      if (res.success) {
        setFeedback({
          type: 'success',
          message: `${type === 'White' ? 'Beyaz Karo' : 'Siyah Tuzak'} kalibrasyonu başarıyla tamamlandı.`
        });
      } else {
        setFeedback({
          type: 'error',
          message: `${type === 'White' ? 'Beyaz Karo' : 'Siyah Tuzak'} kalibrasyonu başarısız: ${res.message || 'Cihaz yanıt vermedi.'}`
        });
      }
      refreshAll();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Kalibrasyon hatası' });
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
        message: `Ölçüm başarıyla tamamlandı (${record.sample_name || 'Numune'}). Veritabanına kaydedildi.`
      });
      if (onMeasurementComplete) {
        onMeasurementComplete(record);
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Ölçüm alınamadı.' });
    } finally {
      setIsMeasuring(false);
    }
  };

  const isConnected = chnspecStatus?.connected ?? false;
  const isReal = isConnected && !chnspecStatus?.is_mock;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden font-sans">
        {/* Header */}
        <div className="p-4 px-6 border-b border-[var(--border)] flex items-center justify-between bg-[var(--surface-1)]">
          <div className="flex items-center gap-2.5">
            <Cpu className="h-5 w-5 text-[var(--brand-blue)]" />
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <span>CHNSpec DS-36D Spektrofotometre Masası</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--surface-0)] border border-[var(--border)] text-[var(--text-muted)]">
                  d/8° Difüz Entegre Küre
                </span>
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                Laboratuvar karakterizasyonu ve renk eşleme için spektrofotometre yönetimi ve kalibrasyonu
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-1.5 rounded-lg hover:bg-[var(--surface-0)] transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Status Alert Banner */}
          {feedback && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-center justify-between gap-3 ${
                feedback.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                  : 'bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400'
              }`}
            >
              <div className="flex items-center gap-2">
                {feedback.type === 'success' ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                ) : (
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                )}
                <span>{feedback.message}</span>
              </div>
              <button
                onClick={() => setFeedback(null)}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-1 cursor-pointer"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          {/* CHNSpec DS-36D Management Block */}
          <div className="space-y-4">
            {/* Connection Card */}
            <div className="bg-[var(--surface-1)] border border-[var(--border)] rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Radio className="h-4 w-4 text-[var(--brand-blue)]" />
                  <h3 className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wider font-mono">
                    Seri Port & Donanım Bağlantısı
                  </h3>
                </div>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-mono font-medium flex items-center gap-1.5 ${
                    isConnected
                      ? isReal
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                        : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                      : 'bg-[var(--surface-0)] text-[var(--text-muted)] border border-[var(--border)]'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      isConnected ? (isReal ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500') : 'bg-zinc-500'
                    }`}
                  />
                  {isConnected ? (isReal ? 'GERÇEK DONANIM BAĞLI' : 'MOCK / SİMÜLASYON') : 'BAĞLI DEĞİL'}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                <div className="md:col-span-2">
                  <label className="text-[11px] font-mono text-[var(--text-muted)] block mb-1">
                    Aktif Seri Port (COM):
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={selectedPort}
                      onChange={(e) => setSelectedPort(e.target.value)}
                      disabled={isConnected || isConnecting}
                      className="flex-1 bg-[var(--surface-0)] border border-[var(--border)] text-[var(--text-primary)] rounded-lg px-3 py-1.5 text-xs font-mono focus:border-[var(--brand-clay)] focus:outline-none disabled:opacity-50"
                    >
                      {availablePorts.map((p) => (
                        <option key={p.port} value={p.port}>
                          {p.port} {p.description ? `- ${p.description}` : ''} {p.is_recommended ? '★ (CHNSpec)' : ''}
                        </option>
                      ))}
                      {availablePorts.length === 0 && (
                        <option value="">Port Bulunamadı (Mock modunda başlatılacak)</option>
                      )}
                    </select>
                    <button
                      onClick={refreshAll}
                      disabled={isConnecting}
                      title="Portları Yenile"
                      className="p-2 border border-[var(--border)] rounded-lg hover:bg-[var(--surface-0)] text-[var(--text-secondary)] transition-colors cursor-pointer"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex items-end">
                  {isConnected ? (
                    <button
                      onClick={handleDisconnectChnspec}
                      disabled={isConnecting}
                      className="w-full py-1.5 px-3 bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30 rounded-lg text-xs font-medium transition-colors cursor-pointer"
                    >
                      {isConnecting ? 'Kesiliyor...' : 'Bağlantıyı Kes'}
                    </button>
                  ) : (
                    <button
                      onClick={handleConnectChnspec}
                      disabled={isConnecting}
                      className="w-full py-1.5 px-3 bg-[var(--brand-clay)] hover:opacity-90 text-white rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      {isConnecting ? (
                        <>
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          <span>Bağlanıyor...</span>
                        </>
                      ) : (
                        <>
                          <Zap className="h-3.5 w-3.5" />
                          <span>Cihaza Bağlan</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Calibration Health & Dual Step Card */}
            <div className="bg-[var(--surface-1)] border border-[var(--border)] rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-[var(--brand-clay)]" />
                  <h3 className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wider font-mono">
                    Kalibrasyon Durumu (8 Saatlik Güvenlik Kapısı)
                  </h3>
                </div>
                {chnspecHealth && (
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-mono ${
                      chnspecHealth.status === 'VALID'
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                        : chnspecHealth.status === 'EXPIRING_SOON'
                        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                        : 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/30'
                    }`}
                  >
                    {chnspecHealth.status === 'VALID'
                      ? 'GEÇERLİ'
                      : chnspecHealth.status === 'EXPIRING_SOON'
                      ? 'SÜRESİ YAKLAŞIYOR'
                      : 'SÜRESİ DOLDU'}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs font-mono text-[var(--text-muted)] bg-[var(--surface-0)] p-3 rounded-lg border border-[var(--border)]">
                <div>
                  <span className="text-[var(--text-muted)] block text-[10px]">Son Kalibrasyon:</span>
                  <span className="text-[var(--text-primary)]">
                    {chnspecHealth?.last_calibrated_at
                      ? new Date(chnspecHealth.last_calibrated_at * 1000).toLocaleTimeString()
                      : 'Henüz yapılmadı'}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--text-muted)] block text-[10px]">Kalan Süre:</span>
                  <span className="text-[var(--text-primary)]">
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
                  disabled={!isConnected || isCalibrating !== null}
                  className="py-2 px-3 bg-[var(--surface-0)] hover:bg-[var(--surface-neutral)] text-[var(--text-primary)] border border-[var(--border)] rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                  <span>{isCalibrating === 'White' ? 'Kalibre Ediliyor...' : '1. Beyaz Karo Kalibrasyonu'}</span>
                </button>
                <button
                  onClick={() => handleCalibrateChnspec('Black')}
                  disabled={!isConnected || isCalibrating !== null}
                  className="py-2 px-3 bg-[var(--surface-0)] hover:bg-[var(--surface-neutral)] text-[var(--text-primary)] border border-[var(--border)] rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-zinc-950 border border-zinc-700" />
                  <span>{isCalibrating === 'Black' ? 'Kalibre Ediliyor...' : '2. Siyah Tuzak Kalibrasyonu'}</span>
                </button>
              </div>
            </div>

            {/* Live Measurement Card */}
            <div className="bg-[var(--surface-1)] border border-[var(--border)] rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Play className="h-4 w-4 text-[var(--brand-blue)]" />
                  <h3 className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wider font-mono">
                    Canlı Spektral Ölçüm
                  </h3>
                </div>
                <span className="text-[10px] font-mono text-[var(--text-muted)]">
                  31 Dalga Boyu (400 - 700 nm @ 10 nm)
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2 space-y-2">
                  <div>
                    <label className="text-[11px] font-mono text-[var(--text-muted)] block mb-1">
                      Numune Adı / Etiketi:
                    </label>
                    <input
                      type="text"
                      value={sampleName}
                      onChange={(e) => setSampleName(e.target.value)}
                      placeholder="Örn: Master Batch 01"
                      className="w-full bg-[var(--surface-0)] border border-[var(--border)] text-[var(--text-primary)] rounded-lg px-3 py-1.5 text-xs font-mono focus:border-[var(--brand-clay)] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-mono text-[var(--text-muted)] block mb-1">
                      Optik Geometri Modu:
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['SCI', 'SCE', 'SCI_SCE'] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setMeasureMode(m)}
                          className={`py-1 text-[11px] font-mono rounded-lg border transition-colors cursor-pointer ${
                            measureMode === m
                              ? 'bg-[var(--brand-blue)]/15 border-[var(--brand-blue)] text-[var(--brand-blue)] font-semibold'
                              : 'bg-[var(--surface-0)] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                          }`}
                        >
                          {m === 'SCI' ? 'SCI (Parlaklık Dahil)' : m === 'SCE' ? 'SCE (Parlaklık Hariç)' : 'SCI + SCE'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex items-end">
                  <button
                    onClick={handleMeasureChnspec}
                    disabled={!isConnected || isMeasuring}
                    className="w-full h-16 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-medium text-xs flex flex-col items-center justify-center gap-1 shadow-lg shadow-emerald-950/20 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isMeasuring ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        <span>Ölçülüyor...</span>
                      </>
                    ) : (
                      <>
                        <Play className="h-5 w-5 fill-current" />
                        <span>Tetikle ve Oku</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {latestMeasurement && (
                <div className="mt-3 p-3 bg-[var(--surface-0)] border border-[var(--border)] rounded-lg space-y-2 animate-in fade-in duration-150">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-[var(--text-secondary)] font-semibold">
                      Son Ölçüm: {latestMeasurement.sample_name || 'Numune'}
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {latestMeasurement.mode} | {latestMeasurement.geometry}
                    </span>
                  </div>
                  {(() => {
                    const labObj = latestMeasurement.lab
                      ? (Array.isArray(latestMeasurement.lab)
                          ? { L: latestMeasurement.lab[0], a: latestMeasurement.lab[1], b: latestMeasurement.lab[2] }
                          : latestMeasurement.lab)
                      : null;
                    return (
                      <div className="grid grid-cols-4 gap-2 text-xs font-mono bg-[var(--surface-1)] p-2 rounded">
                        <div>
                          <span className="text-[var(--text-muted)] block text-[10px]">L*:</span>
                          <span className="text-[var(--text-primary)] font-semibold">
                            {labObj ? labObj.L.toFixed(2) : '-'}
                          </span>
                        </div>
                        <div>
                          <span className="text-[var(--text-muted)] block text-[10px]">a*:</span>
                          <span className="text-[var(--text-primary)] font-semibold">
                            {labObj ? labObj.a.toFixed(2) : '-'}
                          </span>
                        </div>
                        <div>
                          <span className="text-[var(--text-muted)] block text-[10px]">b*:</span>
                          <span className="text-[var(--text-primary)] font-semibold">
                            {labObj ? labObj.b.toFixed(2) : '-'}
                          </span>
                        </div>
                        <div>
                          <span className="text-[var(--text-muted)] block text-[10px]">HEX:</span>
                          <span className="text-[var(--text-primary)] font-semibold">{latestMeasurement.hex || '-'}</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 px-6 border-t border-[var(--border)] bg-[var(--surface-1)] flex items-center justify-between text-xs font-mono text-[var(--text-muted)]">
          <div>
            ISO 18314-1 & ASTM E1331 d/8° Difüz Entegre Küre Spektrofotometri
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-[var(--surface-0)] hover:bg-[var(--surface-neutral)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border)] rounded-lg text-xs font-medium transition-colors cursor-pointer"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
};
