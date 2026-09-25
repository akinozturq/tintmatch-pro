import React, { useState, useEffect } from 'react';
import {
  X,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Clock,
  Radio,
  Cpu,
  Layers,
  Sparkles,
  ShieldCheck,
  ShieldAlert,
  Play,
  Zap,
  Sliders
} from 'lucide-react';
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
  const [activeDevice, setActiveDevice] = useState<'chnspec' | 'rm400'>('chnspec');

  // CHNSpec state
  const [chnspecStatus, setChnspecStatus] = useState<ChnspecStatusInfo | null>(null);
  const [chnspecHealth, setChnspecHealth] = useState<CalibrationHealthInfo | null>(null);
  const [availablePorts, setAvailablePorts] = useState<Array<{ port: string; description: string; is_recommended: boolean }>>([]);
  const [selectedPort, setSelectedPort] = useState<string>('');

  // RM400 state
  const [rm400Status, setRm400Status] = useState<Rm400StatusInfo | null>(null);

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
      setFeedback({
        type: 'success',
        message: `${type === 'White' ? 'Beyaz Karo' : 'Siyah Tuzak'} kalibrasyonu tamamlandı: ${res.message}`
      });
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-[#121215] border border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden font-sans">
        {/* Header */}
        <div className="p-4 px-6 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/60">
          <div className="flex items-center gap-2.5">
            <Cpu className="h-5 w-5 text-blue-400" />
            <div>
              <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <span>Spektrofotometre Donanım Masası</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400">
                  d/8° & 45°/0°
                </span>
              </h2>
              <p className="text-xs text-zinc-500">
                CHNSpec DS-36D ve X-Rite RM400 cihaz bağlantısı, kalibrasyon ve test ölçümleri
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200 p-1.5 rounded-lg hover:bg-zinc-800/60 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Device Selector Tabs */}
        <div className="flex border-b border-zinc-800 bg-[#0c0c0e] px-6 pt-2">
          <button
            onClick={() => setActiveDevice('chnspec')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
              activeDevice === 'chnspec'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Radio className="h-3.5 w-3.5" />
            <span>CHNSpec DS-36D (d/8° Küre)</span>
            {isConnected && (
              <span className={`w-2 h-2 rounded-full ${isReal ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            )}
          </button>
          <button
            onClick={() => setActiveDevice('rm400')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
              activeDevice === 'rm400'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Sliders className="h-3.5 w-3.5" />
            <span>X-Rite RM400 (45°:0°)</span>
            {rm400Status?.connected && (
              <span className="w-2 h-2 rounded-full bg-blue-400" />
            )}
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Status Alert Banner */}
          {feedback && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-center justify-between gap-3 ${
                feedback.type === 'success'
                  ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                  : 'bg-red-950/40 border-red-800/60 text-red-300'
              }`}
            >
              <div className="flex items-center gap-2">
                {feedback.type === 'success' ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                ) : (
                  <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
                )}
                <span>{feedback.message}</span>
              </div>
              <button
                onClick={() => setFeedback(null)}
                className="text-zinc-400 hover:text-zinc-200 text-xs shrink-0"
              >
                Kapat
              </button>
            </div>
          )}

          {activeDevice === 'chnspec' ? (
            <div className="space-y-5">
              {/* 1. Connection Card */}
              <div className="bg-[#09090b] border border-zinc-800 rounded-xl p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-blue-400" />
                    <h3 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider font-mono">
                      1. Seri Port & Donanım Bağlantısı
                    </h3>
                  </div>
                  <div className="flex items-center gap-2">
                    {isConnected ? (
                      <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-medium ${
                        isReal
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : 'bg-amber-950 text-amber-400 border border-amber-800'
                      }`}>
                        <span className="w-2 h-2 rounded-full bg-current animate-pulse" />
                        {isReal ? `BAĞLI (GERÇEK - ${chnspecStatus?.port})` : 'BAĞLI (SİMÜLASYON)'}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono text-zinc-400 bg-zinc-900 border border-zinc-800">
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                        BAĞLI DEĞİL
                      </span>
                    )}
                  </div>
                </div>

                {/* Port Selection & Buttons */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  <div className="flex-1">
                    <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                      Algılanan Seri Port (USB CDC):
                    </label>
                    <select
                      value={selectedPort}
                      onChange={(e) => setSelectedPort(e.target.value)}
                      disabled={isConnected}
                      className="w-full bg-[#121215] border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600 font-mono disabled:opacity-60"
                    >
                      {availablePorts.length === 0 ? (
                        <option value="">Otomatik Algıla (Auto-Detect)</option>
                      ) : (
                        availablePorts.map((p) => (
                          <option key={p.port} value={p.port}>
                            {p.port} {p.description ? `- ${p.description}` : ''} {p.is_recommended ? '★ (Önerilen DS-36D)' : ''}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div className="flex items-end gap-2 pt-1 sm:pt-4">
                    <button
                      onClick={refreshAll}
                      title="Portları Yenile"
                      className="p-2 bg-zinc-900 hover:bg-zinc-850 text-zinc-400 hover:text-zinc-200 border border-zinc-800 rounded-lg transition-colors"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </button>

                    {isConnected ? (
                      <button
                        onClick={handleDisconnectChnspec}
                        disabled={isConnecting}
                        className="px-4 py-2 bg-red-950/40 hover:bg-red-950/70 border border-red-800/80 text-red-300 rounded-lg text-xs font-medium transition-colors"
                      >
                        {isConnecting ? 'Kesiliyor...' : 'Bağlantıyı Kes'}
                      </button>
                    ) : (
                      <button
                        onClick={handleConnectChnspec}
                        disabled={isConnecting}
                        className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 shadow-lg shadow-blue-900/30"
                      >
                        {isConnecting ? (
                          <>
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            <span>Bağlanılıyor...</span>
                          </>
                        ) : (
                          <>
                            <Zap className="h-3.5 w-3.5" />
                            <span>Bağlan</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {/* Device Specifications badge */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-zinc-850 text-[11px] font-mono text-zinc-400">
                  <div>
                    <span className="text-zinc-600 block">Geometri:</span>
                    <span className="text-zinc-300">d/8° Entegre Küre</span>
                  </div>
                  <div>
                    <span className="text-zinc-600 block">Ölçüm Modu:</span>
                    <span className="text-zinc-300">SCI / SCE Çift Mod</span>
                  </div>
                  <div>
                    <span className="text-zinc-600 block">Aralık & Kanal:</span>
                    <span className="text-zinc-300">400–700 nm (31 Kanal)</span>
                  </div>
                  <div>
                    <span className="text-zinc-600 block">Sürücü Mimarisi:</span>
                    <span className="text-zinc-300">clr / Win32 SDK</span>
                  </div>
                </div>
              </div>

              {/* 2. Calibration Section */}
              <div className="bg-[#09090b] border border-zinc-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-emerald-400" />
                    <h3 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider font-mono">
                      2. İki Noktalı Fiziksel Kalibrasyon
                    </h3>
                  </div>

                  {chnspecHealth && (
                    <div className="flex items-center gap-1.5 font-mono text-xs">
                      {chnspecHealth.status === 'VALID' && (
                        <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 text-[10px]">
                          GEÇERLİ ({chnspecHealth.remaining_hours.toFixed(1)} saat kaldı)
                        </span>
                      )}
                      {chnspecHealth.status === 'EXPIRING_SOON' && (
                        <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-400 border border-amber-800 text-[10px]">
                          VARDİYA DOLUYOR ({chnspecHealth.remaining_hours.toFixed(1)} saat)
                        </span>
                      )}
                      {chnspecHealth.status === 'EXPIRED' && (
                        <span className="px-2 py-0.5 rounded bg-red-950 text-red-400 border border-red-800 text-[10px]">
                          SÜRE DOLDU (HTTP 428 Kilidi)
                        </span>
                      )}
                      {chnspecHealth.status === 'UNCALIBRATED' && (
                        <span className="px-2 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800 text-[10px]">
                          KALİBRE DEĞİL
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <p className="text-xs text-zinc-400">
                  Optik sıcaklık sürüklenmesini önlemek için her 8 saatlik vardiyada beyaz karo ve siyah tuzak kalibrasyonu zorunludur.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div className="p-3 bg-[#121215] border border-zinc-850 rounded-lg flex flex-col justify-between space-y-2">
                    <div>
                      <div className="text-xs font-medium text-zinc-200">Beyaz Karo Kalibrasyonu</div>
                      <div className="text-[11px] text-zinc-500 mt-0.5">
                        Sertifikalı beyaz seramik karoyu optik yuvaya yerleştirin.
                      </div>
                    </div>
                    <button
                      onClick={() => handleCalibrateChnspec('White')}
                      disabled={!isConnected || isCalibrating !== null}
                      className="w-full py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-100 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
                    >
                      {isCalibrating === 'White' ? (
                        <>
                          <RefreshCw className="h-3 w-3 animate-spin" />
                          <span>Kalibre Ediliyor...</span>
                        </>
                      ) : (
                        <span>Beyazı Kalibre Et</span>
                      )}
                    </button>
                  </div>

                  <div className="p-3 bg-[#121215] border border-zinc-850 rounded-lg flex flex-col justify-between space-y-2">
                    <div>
                      <div className="text-xs font-medium text-zinc-200">Siyah Tuzak Kalibrasyonu</div>
                      <div className="text-[11px] text-zinc-500 mt-0.5">
                        Optik kuyu kapağını (siyah boşluk) optik yuvaya yerleştirin.
                      </div>
                    </div>
                    <button
                      onClick={() => handleCalibrateChnspec('Black')}
                      disabled={!isConnected || isCalibrating !== null}
                      className="w-full py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-100 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
                    >
                      {isCalibrating === 'Black' ? (
                        <>
                          <RefreshCw className="h-3 w-3 animate-spin" />
                          <span>Kalibre Ediliyor...</span>
                        </>
                      ) : (
                        <span>Siyahı Kalibre Et</span>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* 3. Live Test Measurement */}
              <div className="bg-[#09090b] border border-zinc-800 rounded-xl p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Play className="h-4 w-4 text-cyan-400" />
                    <h3 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider font-mono">
                      3. Canlı Test Ölçümü (Live Acquisition)
                    </h3>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                      Numune Kimliği / Açıklaması:
                    </label>
                    <input
                      type="text"
                      value={sampleName}
                      onChange={(e) => setSampleName(e.target.value)}
                      placeholder="Örn: Mavi Baz Letdown %1.0"
                      className="w-full bg-[#121215] border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                      Optik Mod:
                    </label>
                    <select
                      value={measureMode}
                      onChange={(e) => setMeasureMode(e.target.value as any)}
                      className="w-full bg-[#121215] border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600 font-mono"
                    >
                      <option value="SCI">SCI (Speküler Dahil - CCM)</option>
                      <option value="SCE">SCE (Speküler Hariç - QC)</option>
                      <option value="SCI_SCE">SCI + SCE (Çift Mod)</option>
                    </select>
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    onClick={handleMeasureChnspec}
                    disabled={!isConnected || isMeasuring}
                    className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-2 shadow-lg shadow-emerald-900/30"
                  >
                    {isMeasuring ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        <span>Spektrum Alınıyor...</span>
                      </>
                    ) : (
                      <>
                        <Play className="h-3.5 w-3.5 fill-current" />
                        <span>Spektrum Ölç (Tetikle)</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Measurement Swatch & Results */}
                {latestMeasurement && (
                  <div className="p-3 bg-[#121215] border border-zinc-850 rounded-lg flex items-center justify-between gap-4 font-mono text-xs">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-8 h-8 rounded-md border border-zinc-700 shadow-inner"
                        style={{ backgroundColor: latestMeasurement.hex }}
                      />
                      <div>
                        <div className="text-zinc-200 font-medium text-xs">
                          {latestMeasurement.sample_name || 'Ölçülen Numune'}
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          {latestMeasurement.geometry || 'd/8°'} | {latestMeasurement.mode || 'SCI'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-xs">
                      <div>
                        <span className="text-zinc-500 block text-[10px]">CIE L*a*b* (D65/10°):</span>
                        <span className="text-zinc-200">
                          {Array.isArray(latestMeasurement.lab)
                            ? `L:${latestMeasurement.lab[0]?.toFixed(1)} a:${latestMeasurement.lab[1]?.toFixed(1)} b:${latestMeasurement.lab[2]?.toFixed(1)}`
                            : `L:${latestMeasurement.lab?.L?.toFixed(1)} a:${latestMeasurement.lab?.a?.toFixed(1)} b:${latestMeasurement.lab?.b?.toFixed(1)}`}
                        </span>
                      </div>
                      <div>
                        <span className="text-zinc-500 block text-[10px]">HEX:</span>
                        <span className="text-zinc-300 font-semibold">{latestMeasurement.hex}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* RM400 Section */
            <div className="space-y-4">
              <div className="bg-[#09090b] border border-zinc-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sliders className="h-4 w-4 text-blue-400" />
                    <h3 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider font-mono">
                      X-Rite RM400 (45°:0° Taşınabilir Spektrofotometre)
                    </h3>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-mono ${
                    rm400Status?.connected ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-zinc-900 text-zinc-400 border border-zinc-800'
                  }`}>
                    {rm400Status?.connected ? 'BAĞLI' : 'BAĞLI DEĞİL'}
                  </span>
                </div>

                <p className="text-xs text-zinc-400">
                  RM400.dll 64-bit Windows kütüphanesi üzerinden dairesel 45° aydınlatma ve dik gözlem (SPEX) geometrisinde spektral alım yapar.
                </p>

                <div className="grid grid-cols-2 gap-3 text-xs font-mono text-zinc-400 pt-1">
                  <div>
                    <span className="text-zinc-600 block">Sürücü Durumu:</span>
                    <span className="text-zinc-300">{rm400Status?.driver_available ? 'DLL Yüklendi' : 'DLL Bulunamadı'}</span>
                  </div>
                  <div>
                    <span className="text-zinc-600 block">Seri Numarası:</span>
                    <span className="text-zinc-300">{rm400Status?.serial_number || 'Bilinmiyor'}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 px-6 border-t border-zinc-800 bg-[#0c0c0e] flex items-center justify-between text-xs font-mono text-zinc-500">
          <div>
            ISO 18314-1/2 & ASTM E1331 Spektrofotometri Standartları
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-medium transition-colors"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
};
