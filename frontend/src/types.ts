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
  geometry?: string;
  characterization_version?: number;
  active_characterization_id?: number | null;
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

export type DeviceConnectionState = 'CONNECTED_REAL' | 'CONNECTED_MOCK' | 'DISCONNECTED' | 'ERROR';

export interface InstrumentItem {
  id: number;
  model: string;
  serial_number: string;
  port: string | null;
  is_connected: boolean;
  geometry: string;
  aperture: string;
  standard_observer: string;
  standard_illuminant: string;
  created_at: string;
}

export interface ChnspecStatusInfo {
  instrument: string;
  connected: boolean;
  connection_state: DeviceConnectionState;
  port: string | null;
  is_mock: boolean;
  geometry: string;
  measurement_modes: string[];
  native_channels: number;
  native_range_nm: [number, number];
  canonical_channels: number;
  canonical_range_nm: [number, number];
  available_ports?: Array<{
    port: string;
    description: string;
    is_recommended: boolean;
  }>;
}

export interface Rm400StatusInfo {
  instrument: string;
  driver_available: boolean;
  is_mock: boolean;
  connection_state: DeviceConnectionState;
  dll_path: string;
  interface_version: string;
  connected: boolean;
  serial_number: string;
  calibration: {
    calibrated: boolean;
    timestamp?: string;
  } | null;
}

export interface MeasurementRecord {
  id?: number;
  measurement_id?: number;
  instrument?: string;
  mode?: string;
  geometry?: string;
  wavelengths: number[];
  reflectance: number[];
  raw_reflectance?: number[];
  lab: { L: number; a: number; b: number } | [number, number, number];
  hex: string;
  sci_spectrum?: number[];
  sce_spectrum?: number[];
  sample_name?: string;
  timestamp?: string;
}

export interface InstrumentComparisonRequest {
  ref_reflectance: number[];
  target_reflectance: number[];
  ref_geometry?: string;
  target_geometry?: string;
  ref_name?: string;
  target_name?: string;
  ref_mode?: string;
  target_mode?: string;
  illuminant?: string;
  observer?: string;
}

export interface InstrumentComparisonResult {
  success: boolean;
  reference: {
    instrument: string;
    geometry: string;
    mode: string;
    reflectance: number[];
    lab: { L: number; a: number; b: number };
    hex: string;
  };
  target: {
    instrument: string;
    geometry: string;
    mode: string;
    reflectance: number[];
    lab: { L: number; a: number; b: number };
    hex: string;
  };
  wavelengths: number[];
  delta_reflectance: number[];
  statistics: {
    mean_spectral_bias: number;
    spectral_rmse: number;
    max_absolute_difference: number;
    max_difference_wavelength_nm: number;
    pearson_r: number;
    r_squared: number;
  };
  colorimetric_difference: {
    delta_e00: number;
    delta_L: number;
    delta_a: number;
    delta_b: number;
    delta_C: number;
    delta_H: number;
    illuminant: string;
    observer: string;
  };
  diagnostics: {
    same_geometry: boolean;
    comparison_status?: 'PASS' | 'WARN' | 'FAIL' | string;
    agreement_classification: string;
    notes: string[];
  };
}

export interface LoocvFoldResult {
  omitted_index: number;
  omitted_concentration: number;
  delta_e00: number;
  predicted_lab: [number, number, number];
  measured_lab: [number, number, number];
}

export interface LoocvResult {
  status: 'LOOCV_EVALUATED' | 'SKIPPED_INSUFFICIENT_LETDOWNS' | 'FAILED' | string;
  n_folds: number;
  mean_delta_e00: number | null;
  max_delta_e00: number | null;
  p95_delta_e00?: number | null;
  fold_results?: LoocvFoldResult[];
  message?: string;
  passed?: boolean;
}

export interface QualityGateCheck {
  metric: string;
  label: string;
  actual: number | string | null;
  limit: number | string;
  operator: string;
  status: 'PASS' | 'WARN' | 'FAIL' | 'PARTIAL';
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
}

export interface QualityGateResult {
  status: 'PASS' | 'FAIL' | 'WARN';
  checks: QualityGateCheck[];
  timestamp: string;
  score: number;
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
  spectral_rmse?: number;
  max_spectral_residual?: number;
  jacobian_condition_number?: number;
  jacobian_diagnostics?: {
    raw_condition_number: number;
    scaled_condition_number: number;
    raw_condition_status: string;
    scaled_condition_status: string;
    p95_condition_number?: number;
    max_condition_number?: number;
    worst_wavelength_nm?: number | null;
    is_well_conditioned: boolean;
    message: string;
  };
  concentration_span_ratio?: number;
  condition_index?: number;
  identifiability?: string;
  loocv?: LoocvResult;
  loocv_mean_delta_e00?: number | null;
  loocv_max_delta_e00?: number | null;
  loocv_status?: string;
  characterization_gate?: QualityGateResult;
  quality_gate?: QualityGateResult;
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

export interface SensitivityItem {
  paste_id: number | string;
  name: string;
  code: string;
  concentration: number;
  d_de00_dc: number;
  d_L_dc: number;
  d_a_dc: number;
  d_b_dc: number;
  d_C_dc: number;
  d_H_dc: number;
  step_plus_010?: {
    concentration: number;
    delta_e00: number;
    delta_L: number;
    delta_a: number;
    delta_b: number;
    delta_C: number;
    delta_H: number;
  };
  step_minus_010?: {
    concentration: number;
    delta_e00: number;
    delta_L: number;
    delta_a: number;
    delta_b: number;
    delta_C: number;
    delta_H: number;
  };
  interpretation: string;
}

export interface OptimizationProfileInfo {
  id: string;
  name: string;
  description: string;
  weights: {
    d65: number;
    a: number;
    f11: number;
    metamerism: number;
    load: number;
  };
}

export interface RecipeMatch {
  profile_id: string;
  profile_name: string;
  description: string;
  calculation_id?: string;
  engine_version?: string;
  matched_pastes: Array<{
    id: number | string;
    name: string;
    code: string;
    hex: string;
    concentration: number;
    unit_k?: number[];
    unit_s?: number[];
  }>;
  prediction: RecipeSimulation;
  delta_e00: number;
  composite_mi: number;
  total_load: number;
  passed_target_threshold: boolean;
  status: string;
  diagnostics?: {
    solver: string;
    iterations: number;
    function_evaluations: number;
    success: boolean;
    message: string;
    final_loss: number;
    constraint_slack: number;
  };
  sensitivity_matrix?: SensitivityItem[];
}

export interface MatchResponse {
  calculation_id?: string;
  engine_version?: string;
  matched_pastes: Array<{
    id: number | string;
    name: string;
    code: string;
    hex: string;
    concentration: number;
    unit_k?: number[];
    unit_s?: number[];
  }>;
  prediction: RecipeSimulation;
  delta_e00: number;
  composite_mi: number;
  total_colorant_load: number;
  passed_target_threshold: boolean;
  status: string;
  diagnostics?: {
    solver: string;
    iterations: number;
    function_evaluations: number;
    success: boolean;
    message: string;
    final_loss: number;
    constraint_slack: number;
  };
  sensitivity_matrix?: SensitivityItem[];
  primary_recipe_key?: string;
  recipes?: {
    recipe_a: RecipeMatch;
    recipe_b: RecipeMatch;
    recipe_c: RecipeMatch;
  };
}

export interface CalibrationHealthInfo {
  status: 'VALID' | 'EXPIRING_SOON' | 'EXPIRED' | 'UNCALIBRATED';
  last_calibrated_at: number | null;
  elapsed_hours: number | null;
  remaining_hours: number;
  expiry_hours: number;
  message: string;
}

export interface AddBackAdditionItem {
  paste_id: number | string;
  name: string;
  code: string;
  color_hex: string;
  current_kg: number;
  addition_kg: number;
  final_kg: number;
  current_pct: number;
  final_pct: number;
}

export interface AddBackCorrectionRequest {
  tank_mass_kg: number;
  current_pastes: Array<{
    id: number | string;
    name?: string;
    concentration: number;
  }>;
  target_reflectance: number[];
  base_id: number;
  current_reflectance?: number[];
  max_addition_pct?: number;
  allow_base_addition?: boolean;
  k1?: number;
  k2?: number;
  tolerance_profile_id?: string;
}

export interface AddBackCorrectionResponse {
  is_correctable: boolean;
  initial_delta_e00: number;
  final_delta_e00: number;
  composite_metamerism_index: number;
  tank_mass_initial_kg: number;
  tank_mass_final_kg: number;
  base_addition_kg: number;
  base_addition_pct: number;
  total_pigment_addition_kg: number;
  additions: AddBackAdditionItem[];
  predicted_reflectance: number[];
  predicted_lab: [number, number, number];
  target_lab: [number, number, number];
  predicted_hex: string;
  quality_gate?: any;
  notes: string[];
  engine_version: string;
}
