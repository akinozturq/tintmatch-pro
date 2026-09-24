export interface BasePaint {
  id: number;
  name: string;
  code: string;
  base_type: 'white_a' | 'medium_b' | 'deep_c' | 'transparent_d';
  density: number;
  contrast_ratio: number;
  is_opaque: boolean;
  reflectance: number[];
  absorption_k: number[];
  scattering_s: number[];
  hex: string;
  lab: { L: number; a: number; b: number };
  created_at: string;
}

export interface ColorantPaste {
  id: number;
  name: string;
  code: string;
  color_hex: string;
  density: number;
  unit_k: number[];
  unit_s: number[];
  unit_ks: number[];
  mean_delta_e00: number;
  passed_validation: boolean;
  characterization_base_id?: number | null;
  created_at?: string;
}

export interface Letdown {
  concentration: number;
  reflectance: number[];
}

export interface BackPrediction {
  concentration: number;
  measured_reflectance: number[];
  predicted_reflectance: number[];
  measured_lab: number[];
  predicted_lab: number[];
  delta_e00: number;
  passed: boolean;
  status: string;
}

export interface CharacterizationResult {
  unit_k: number[];
  unit_s: number[];
  unit_ks: number[];
  wavelengths: number[];
  back_predictions: BackPrediction[];
  mean_delta_e00: number;
  max_delta_e00: number;
  passed_validation: boolean;
  r_squared: number;
  validation_threshold: number;
  model_type: string;
  summary: string;
}

export interface MetamerismData {
  dE00_D65: number;
  dE00_A: number;
  dE00_F11: number;
  dE00_F2: number;
  MI_A: number;
  MI_F11: number;
  MI_F2: number;
  rating: string;
}

export interface RecipeComparison {
  target_lab: { L: number; a: number; b: number };
  target_hex: string;
  delta_e00: number;
  delta_L: number;
  delta_a: number;
  delta_b: number;
  delta_C: number;
  delta_H: number;
  passed: boolean;
  metamerism: MetamerismData;
}

export interface RecipeSimulation {
  reflectance: number[];
  reflectance_internal: number[];
  ks: number[];
  lab: { L: number; a: number; b: number };
  hex: string;
  total_colorant_load: number;
  contrast_ratio: number;
  is_opaque: boolean;
  wavelengths: number[];
  recipe_breakdown: Array<{
    id: number | string;
    name: string;
    concentration: number;
  }>;
  comparison?: RecipeComparison;
}

export interface Iso18314Report {
  report_id: string;
  standard: string;
  timestamp: string;
  instrument: {
    model: string;
    geometry: string;
    aperture: string;
    illuminant: string;
    observer: string;
    spectral_range: string;
  };
  saunderson_coefficients: {
    k1_fresnel: number;
    k2_internal: number;
  };
  colorant: {
    name: string;
    code: string;
    hex: string;
    density_g_cm3: number;
  };
  base_paint: {
    name: string;
    code: string;
    density_g_cm3: number;
    contrast_ratio: number;
  };
  validation_statistics: {
    mean_delta_e00: number;
    max_delta_e00: number;
    r_squared: number;
    threshold: number;
    passed: boolean;
    conformance_status: string;
  };
  back_predictions: BackPrediction[];
  spectral_matrix: {
    wavelengths: number[];
    unit_k: number[];
    unit_s: number[];
    unit_ks: number[];
  };
}
