import type {
  BasePaint,
  ColorantPaste,
  CharacterizationResult,
  RecipeSimulation,
  Iso18314Report
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

export async function matchColor(payload: {
  target_reflectance: number[];
  base_id: number;
  paste_ids?: number[];
  max_pastes?: number;
  max_total_load?: number;
  k1?: number;
  k2?: number;
}): Promise<{
  matched_pastes: Array<{
    id: number;
    name: string;
    code: string;
    hex: string;
    concentration: number;
    unit_k: number[];
    unit_s: number[];
  }>;
  prediction: RecipeSimulation;
  delta_e00: number | null;
  passed_target_threshold: boolean;
  status: string;
}> {
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
