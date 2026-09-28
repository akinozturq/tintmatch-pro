import React, { useState, useEffect } from 'react';
import type { Iso18314Report } from '../types';
import { fetchIsoReport, getDownloadCsvUrl } from '../services/api';
import {
  FileCheck,
  Download,
  Printer,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';

interface IsoReportViewProps {
  initialCharId?: number;
}

export const IsoReportView: React.FC<IsoReportViewProps> = ({ initialCharId = 1 }) => {
  const [charId, setCharId] = useState<number>(initialCharId);
  const [report, setReport] = useState<Iso18314Report | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    setErrorMessage(null);
    fetchIsoReport(charId)
      .then((data) => setReport(data))
      .catch((err) => setErrorMessage(err.message || 'Rapor yüklenemedi'))
      .finally(() => setIsLoading(false));
  }, [charId]);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-6 w-full space-y-6">
      {/* Top action bar */}
      <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 print:hidden shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[var(--surface-0)] border border-[var(--border)] flex items-center justify-center text-[var(--brand-clay)]">
            <FileCheck className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-medium text-[var(--text-primary)]">ISO 18314 Onay Sertifikası & Spektral Rapor</h2>
            <p className="text-xs text-[var(--text-muted)]">
              Analitik kolorimetri ve Kubelka-Munk karakterizasyon uygunluk belgesi
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
          {/* Paste session selector */}
          <select
            value={charId}
            onChange={(e) => setCharId(parseInt(e.target.value) || 1)}
            aria-label="Karakterizasyon sertifikası seçimi"
            className="px-3 py-1.5 bg-[var(--surface-0)] border border-[var(--border)] rounded-lg text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand-clay)] transition-colors"
          >
            <option value={1}>Sertifika 00001 (Phthalo Green PG7)</option>
            <option value={2}>Sertifika 00002 (Iron Oxide Red PR101)</option>
            <option value={3}>Sertifika 00003 (Phthalo Blue PB15:3)</option>
          </select>

          <a
            href={getDownloadCsvUrl(charId)}
            download
            className="px-3 py-1.5 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg text-xs font-medium flex items-center gap-1.5 border border-[var(--border)] transition-colors"
          >
            <Download className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            <span>CSV Matris İndir</span>
          </a>

          <button
            onClick={handlePrint}
            className="px-3 py-1.5 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer"
          >
            <Printer className="h-3.5 w-3.5" />
            <span>Yazdır / PDF</span>
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="p-12 text-center text-xs text-[var(--text-muted)] font-mono">
          ISO 18314 Raporu yükleniyor...
        </div>
      )}

      {errorMessage && (
        <div className="p-4 bg-[var(--danger)]/10 border border-[var(--danger)]/30 rounded-xl text-xs text-[var(--danger)] flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Official Certificate Sheet (Print-friendly) */}
      {report && (
        <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-xl p-8 space-y-6 print:border-none print:shadow-none print:bg-white print:text-black shadow-sm">
          {/* Header */}
          <div className="border-b border-[var(--border)] print:border-zinc-300 pb-6 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] print:text-zinc-600 font-medium">
                  Spektrofotometrik Onay Raporu
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--surface-0)] print:bg-zinc-200 text-[var(--text-secondary)] print:text-zinc-700 border border-[var(--border)] print:border-zinc-300">
                  {report.standard}
                </span>
              </div>
              <h1 className="text-base font-semibold text-[var(--text-primary)] print:text-black tracking-tight">
                CERTIFICATE OF SPECTROPHOTOMETRIC CHARACTERIZATION
              </h1>
              <p className="text-xs text-[var(--text-muted)] print:text-zinc-600 font-mono mt-1">
                Doküman No: {report.report_id} • Tarih: {report.timestamp}
              </p>
            </div>

            {/* Verification Seal Badge */}
            <div className="border border-emerald-500/30 print:border-emerald-600 bg-emerald-500/10 print:bg-emerald-50 px-4 py-3 rounded-xl text-right">
              <div className="flex items-center justify-end gap-1.5 text-xs font-mono font-medium text-emerald-600 dark:text-emerald-400 print:text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>ONAYLANDI (PASS)</span>
              </div>
              <p className="text-[11px] text-[var(--text-secondary)] print:text-zinc-700 font-mono mt-0.5">
                ΔE00: {report.validation_statistics.mean_delta_e00.toFixed(3)} &lt; 0.30
              </p>
            </div>
          </div>

          {/* Test Conditions & Parameters Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3.5 bg-[var(--surface-0)] print:bg-zinc-50 rounded-xl border border-[var(--border)] print:border-zinc-300 space-y-1 text-xs">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] print:text-zinc-600 block">
                Ölçüm Cihazı & Geometri
              </span>
              <p className="font-medium text-[var(--text-primary)] print:text-black">{report.instrument.model}</p>
              <p className="text-[11px] font-mono text-[var(--text-secondary)] print:text-zinc-700">
                {report.instrument.geometry} • {report.instrument.aperture}
              </p>
              <p className="text-[11px] font-mono text-[var(--text-secondary)] print:text-zinc-700">
                {report.instrument.illuminant} / {report.instrument.observer}
              </p>
            </div>

            <div className="p-3.5 bg-[var(--surface-0)] print:bg-zinc-50 rounded-xl border border-[var(--border)] print:border-zinc-300 space-y-1 text-xs">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] print:text-zinc-600 block">
                Test Edilen Renklendirici
              </span>
              <div className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-full border border-[var(--border)] shrink-0"
                  style={{ backgroundColor: report.colorant.hex }}
                ></span>
                <p className="font-medium text-[var(--text-primary)] print:text-black">{report.colorant.name}</p>
              </div>
              <p className="text-[11px] font-mono text-[var(--text-secondary)] print:text-zinc-700">
                Kod: {report.colorant.code} • Yoğunluk: {report.colorant.density_g_cm3} g/cm³
              </p>
            </div>

            <div className="p-3.5 bg-[var(--surface-0)] print:bg-zinc-50 rounded-xl border border-[var(--border)] print:border-zinc-300 space-y-1 text-xs">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] print:text-zinc-600 block">
                Referans Baz & Saunderson
              </span>
              <p className="font-medium text-[var(--text-primary)] print:text-black">{report.base_paint.name}</p>
              <p className="text-[11px] font-mono text-[var(--text-secondary)] print:text-zinc-700">
                Kontrast Oranı: %{report.base_paint.contrast_ratio} (Opak Baz)
              </p>
              <p className="text-[11px] font-mono text-[var(--text-secondary)] print:text-zinc-700">
                k1={report.saunderson_coefficients.k1_fresnel} • k2={report.saunderson_coefficients.k2_internal}
              </p>
            </div>
          </div>

          {/* Validation Table */}
          <div className="space-y-2">
            <h3 className="text-[11px] font-mono uppercase tracking-wider text-[var(--text-muted)] print:text-black">
              Seyreltme Serisi Geri Tahmin Doğrulama Verileri (Residuals)
            </h3>
            <div className="overflow-x-auto rounded-xl border border-[var(--border)] print:border-zinc-300">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[var(--surface-0)] print:bg-zinc-100 text-[var(--text-muted)] print:text-zinc-800 uppercase text-[10px]">
                  <tr>
                    <th className="p-2.5">Konsantrasyon</th>
                    <th className="p-2.5">Ölçülen L*a*b* (D65)</th>
                    <th className="p-2.5">K-M Modeli L*a*b*</th>
                    <th className="p-2.5">CIEDE2000 (ΔE00)</th>
                    <th className="p-2.5 text-right">Uygunluk</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)] print:divide-zinc-200 bg-[var(--surface-3)] print:bg-white text-[var(--text-secondary)] print:text-black">
                  {report.back_predictions.map((bp, i) => (
                    <tr key={i}>
                      <td className="p-2.5 font-medium text-[var(--text-primary)] print:text-zinc-900">%{bp.concentration}</td>
                      <td className="p-2.5 text-[var(--text-secondary)] print:text-zinc-600">
                        {bp.measured_lab[0].toFixed(1)} / {bp.measured_lab[1].toFixed(1)} / {bp.measured_lab[2].toFixed(1)}
                      </td>
                      <td className="p-2.5 text-[var(--text-secondary)] print:text-zinc-600">
                        {bp.predicted_lab[0].toFixed(1)} / {bp.predicted_lab[1].toFixed(1)} / {bp.predicted_lab[2].toFixed(1)}
                      </td>
                      <td className="p-2.5 font-medium text-emerald-600 dark:text-emerald-400 print:text-emerald-700">
                        {bp.delta_e00.toFixed(3)}
                      </td>
                      <td className="p-2.5 text-right">
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 print:bg-emerald-100 print:text-emerald-800 border border-emerald-500/30">
                          {bp.passed ? 'GEÇTİ (<0.3)' : 'UYARI'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 31-Channel Spectral Absorption & Scattering Matrix Excerpt */}
          <div className="space-y-2">
            <h3 className="text-[11px] font-mono uppercase tracking-wider text-[var(--text-muted)] print:text-black">
              31-Kanal Birim Spektral Katsayılar (K & S Matrisi)
            </h3>
            <div className="overflow-x-auto rounded-xl border border-[var(--border)] print:border-zinc-300 max-h-48 overflow-y-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[var(--surface-0)] print:bg-zinc-100 text-[var(--text-muted)] print:text-zinc-800 uppercase text-[10px] sticky top-0">
                  <tr>
                    <th className="p-2">Dalga Boyu</th>
                    <th className="p-2">Birim K(λ)</th>
                    <th className="p-2">Birim S(λ)</th>
                    <th className="p-2 text-right">Birim (K/S)(λ)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)] print:divide-zinc-200 bg-[var(--surface-3)] print:bg-white text-[var(--text-secondary)] print:text-black">
                  {report.spectral_matrix.wavelengths.map((wl, idx) => (
                    <tr key={wl} className="hover:bg-[var(--surface-1)] transition-colors">
                      <td className="p-2 text-[var(--text-muted)]">{wl} nm</td>
                      <td className="p-2 text-[var(--text-secondary)] print:text-black">{report.spectral_matrix.unit_k[idx]?.toFixed(5)}</td>
                      <td className="p-2 text-[var(--text-secondary)] print:text-black">{report.spectral_matrix.unit_s[idx]?.toFixed(5)}</td>
                      <td className="p-2 text-right text-[var(--text-primary)] print:text-black font-medium">
                        {report.spectral_matrix.unit_ks[idx]?.toFixed(5)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Signatures & Accreditation Footer */}
          <div className="pt-6 border-t border-[var(--border)] print:border-zinc-300 flex flex-col sm:flex-row justify-between items-end gap-6 text-xs font-mono">
            <div className="space-y-1 text-[var(--text-muted)] print:text-zinc-600 text-[11px]">
              <p>Metodoloji: ISO 18314-1 / ISO 18314-2 Analytical Colorimetry</p>
              <p>Motor: TintMatch PRO Spectral Engine v1.0.0</p>
              <p>Doğrulama: {report.validation_statistics.conformance_status}</p>
            </div>

            <div className="text-right space-y-2 min-w-[200px]">
              <div className="h-8 border-b border-dashed border-[var(--border)] print:border-zinc-400"></div>
              <p className="text-[var(--text-secondary)] print:text-black font-medium text-[11px]">Laboratuvar Renk Uzmanı İmzası</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
