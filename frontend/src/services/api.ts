import type {
  BasePaint,
  ColorantPaste,
  CharacterizationResult,
  RecipeSimulation,
  Iso18314Report,
  MatchResponse,
  OptimizationProfileInfo,
  DeviceConnectionState,
  InstrumentItem,
  ChnspecStatusInfo,
  Rm400StatusInfo,
  MeasurementRecord,
  InstrumentComparisonRequest,
  InstrumentComparisonResult
} from '../types';

const BASE_URL = '/api';

export async function fetchBases(): Promise<BasePaint[]> {
  const res = await fetch(`${BASE_URL}/bases`);
  if (!res.ok) throw new Error('Baz verileri yüklenemedi');
  return res.json();
}

export async function fetchPastes(): Promise<ColorantPaste[]> {
  const res = await fetch(`${BASE_URL}/pastes`);
  if (!res.ok) throw new Error('Renklendirici pasta verileri yüklenemedi');
  return res.json();
}

export async function deletePaste(id: number): Promise<{ success: boolean }> {
  const res = await fetch(`${BASE_URL}/pastes/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Pasta silinemedi');
  return res.json();
}

export async function calculateCharacterization(payload: {
  base_id?: number;
  base_reflectance?: number[];
  letdowns: Array<{ concentration: number; reflectance: number[] }>;
  k1?: number;
  k2?: number;
  use_two_constant?: boolean;
}): Promise<CharacterizationResult> {
  const res = await fetch(`${BASE_URL}/characterization/calculate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Karakterizasyon hesaplama hatası');
  }
  return res.json();
}

export async function importRm400(file?: File, rawText?: string): Promise<{
  samples: Array<{
    name: string;
    concentration: number | null;
    reflectance: number[];
    metadata: Record<string, any>;
  }>;
  format: string;
  warnings: string[];
}> {
  const formData = new FormData();
  if (file) {
    formData.append('file', file);
  }
  if (rawText) {
    formData.append('raw_text', rawText);
  }

  const res = await fetch(`${BASE_URL}/characterization/import-rm400`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error('X-Rite RM400 verisi içe aktarılamadı');
  return res.json();
}

export async function fetchSampleDatasets(): Promise<{
  base: { name: string; code: string; opacity: number; reflectance: number[] };
  samples: Array<{
    key: string;
    name: string;
    code: string;
    color_hex: string;
    density: number;
    letdowns_count: number;
    concentrations: number[];
  }>;
}> {
  const res = await fetch(`${BASE_URL}/characterization/samples`);
  if (!res.ok) throw new Error('Numune veri setleri alınamadı');
  return res.json();
}

export async function fetchSampleDataset(colorantKey: string): Promise<{
  base: { name: string; code: string; opacity: number; reflectance: number[] };
  colorant: {
    name: string;
    code: string;
    color_hex: string;
    density: number;
    letdowns: Array<{ concentration: number; reflectance: number[] }>;
  };
}> {
  const res = await fetch(`${BASE_URL}/characterization/samples/${colorantKey}`);
  if (!res.ok) throw new Error('Numune detayı alınamadı');
  return res.json();
}

export async function saveCharacterization(payload: {
  name: string;
  code: string;
  color_hex?: string;
  density: number;
  base_id: number;
  k1?: number;
  k2?: number;
  instrument?: string;
  letdowns: Array<{ concentration: number; reflectance: number[] }>;
  calculation_results: CharacterizationResult;
}): Promise<{ success: boolean; paste_id: number; message: string }> {
  const res = await fetch(`${BASE_URL}/characterization/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Karakterizasyon kaydedilemedi');
  }
  return res.json();
}

export async function predictRecipe(payload: {
  base_id: number;
  pastes: Array<{
    id: number | string;
    name?: string;
    concentration: number;
    unit_k?: number[];
    unit_s?: number[];
  }>;
  k1?: number;
  k2?: number;
  target_reflectance?: number[];
  thickness?: number;
}): Promise<RecipeSimulation> {
  const res = await fetch(`${BASE_URL}/formulation/predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Reçete simülasyonu hesaplanamadı');
  }
  return res.json();
}

export async function fetchOptimizationProfiles(): Promise<OptimizationProfileInfo[]> {
  const res = await fetch(`${BASE_URL}/formulation/profiles`);
  if (!res.ok) throw new Error('Optimizasyon profilleri alınamadı');
  return res.json();
}

export async function matchColor(payload: {
  target_reflectance: number[];
  base_id: number;
  paste_ids?: number[];
  max_pastes?: number;
  max_total_load?: number;
  k1?: number;
  k2?: number;
  profile_id?: string;
}): Promise<MatchResponse> {
  const res = await fetch(`${BASE_URL}/formulation/match`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Reçete eşleştirme algoritması başarısız oldu');
  }
  return res.json();
}

export async function fetchIsoReport(charId: number): Promise<Iso18314Report> {
  const res = await fetch(`${BASE_URL}/reports/characterization/${charId}/iso18314`);
  if (!res.ok) throw new Error('ISO 18314 raporu alınamadı');
  return res.json();
}

export function getDownloadCsvUrl(charId: number): string {
  return `${BASE_URL}/reports/characterization/${charId}/csv`;
}

export async function fetchInstruments(): Promise<InstrumentItem[]> {
  const res = await fetch(`${BASE_URL}/instruments`);
  if (!res.ok) throw new Error('Cihazlar listesi alınamadı');
  return res.json();
}

export async function fetchPorts(): Promise<{
  ports: Array<{ port: string; description: string; is_recommended: boolean }>;
  active_chnspec_port: string | null;
  is_chnspec_connected: boolean;
}> {
  const res = await fetch(`${BASE_URL}/instruments/ports`);
  if (!res.ok) throw new Error('Seri port listesi alınamadı');
  return res.json();
}

export async function getChnspecStatus(): Promise<ChnspecStatusInfo> {
  const res = await fetch(`${BASE_URL}/instruments/chnspec/status`);
  if (!res.ok) throw new Error('CHNSpec durumu alınamadı');
  return res.json();
}

export async function connectChnspec(port?: string): Promise<{
  success: boolean;
  connected: boolean;
  connection_state: DeviceConnectionState;
  port: string;
  is_mock: boolean;
  message: string;
}> {
  const res = await fetch(`${BASE_URL}/instruments/chnspec/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ port }),
  });
  if (!res.ok) throw new Error('CHNSpec bağlantı hatası');
  return res.json();
}

export async function disconnectChnspec(): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${BASE_URL}/instruments/chnspec/disconnect`, { method: 'POST' });
  if (!res.ok) throw new Error('CHNSpec bağlantısı kesilemedi');
  return res.json();
}

export async function calibrateChnspec(type: 'White' | 'Black' = 'White'): Promise<{
  success: boolean;
  type: string;
  message: string;
}> {
  const res = await fetch(`${BASE_URL}/instruments/chnspec/calibrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Kalibrasyon hatası');
  }
  return res.json();
}

export async function measureChnspec(
  mode: 'SCI' | 'SCE' | 'SCI_SCE' = 'SCI',
  sampleName: string = 'Lab Sample'
): Promise<MeasurementRecord> {
  const res = await fetch(`${BASE_URL}/instruments/chnspec/measure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, sample_name: sampleName, save_to_archive: true }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'CHNSpec ölçüm hatası');
  }
  return res.json();
}

export async function getRm400Status(): Promise<Rm400StatusInfo> {
  const res = await fetch(`${BASE_URL}/instruments/rm400/status`);
  if (!res.ok) throw new Error('RM400 durumu alınamadı');
  return res.json();
}

export async function connectRm400(): Promise<{
  success: boolean;
  connected: boolean;
  is_mock: boolean;
  connection_state: DeviceConnectionState;
  message: string;
}> {
  const res = await fetch(`${BASE_URL}/instruments/rm400/connect`, { method: 'POST' });
  if (!res.ok) throw new Error('RM400 bağlantı hatası');
  return res.json();
}

export async function disconnectRm400(): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${BASE_URL}/instruments/rm400/disconnect`, { method: 'POST' });
  if (!res.ok) throw new Error('RM400 bağlantısı kesilemedi');
  return res.json();
}

export async function calibrateRm400(step: 'White' | 'Black' = 'White'): Promise<{
  success: boolean;
  step: string;
  message: string;
}> {
  const res = await fetch(`${BASE_URL}/instruments/rm400/calibrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ step }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'RM400 kalibrasyon hatası');
  }
  return res.json();
}

export async function measureRm400(sampleName: string = 'Lab Sample'): Promise<MeasurementRecord> {
  const res = await fetch(`${BASE_URL}/instruments/rm400/measure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sample_name: sampleName, save_to_archive: true }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'RM400 ölçüm hatası');
  }
  return res.json();
}

export async function compareInstruments(
  payload: InstrumentComparisonRequest
): Promise<InstrumentComparisonResult> {
  const res = await fetch(`${BASE_URL}/instruments/compare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Cihaz karşılaştırma hatası');
  }
  return res.json();
}
