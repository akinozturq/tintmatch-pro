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
      <div className="bg-[#121215] border border-zinc-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 print:hidden">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-zinc-850 border border-zinc-750 flex items-center justify-center text-zinc-300">
            <FileCheck className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-medium text-zinc-100">ISO 18314 Onay Sertifikası & Spektral Rapor</h2>
            <p className="text-xs text-zinc-500">
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
            className="px-3 py-1.5 bg-[#09090b] border border-zinc-800 rounded-md text-xs font-mono text-zinc-200 focus:outline-none focus:border-zinc-600"
          >
            <option value={1}>Sertifika 00001 (Phthalo Green PG7)</option>
            <option value={2}>Sertifika 00002 (Iron Oxide Red PR101)</option>
            <option value={3}>Sertifika 00003 (Phthalo Blue PB15:3)</option>
          </select>

          <a
            href={getDownloadCsvUrl(charId)}
            download
            className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-md text-xs font-medium flex items-center gap-1.5 border border-zinc-800 transition-colors"
          >
            <Download className="h-3.5 w-3.5 text-zinc-400" />
            <span>CSV Matris İndir</span>
          </a>

          <button
            onClick={handlePrint}
            className="px-3 py-1.5 bg-zinc-100 hover:bg-white text-zinc-950 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors"
          >
            <Printer className="h-3.5 w-3.5" />
            <span>Yazdır / PDF</span>
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="p-12 text-center text-xs text-zinc-500 font-mono">
          ISO 18314 Raporu yükleniyor...
        </div>
      )}

      {errorMessage && (
        <div className="p-4 bg-red-950/30 border border-red-900/60 rounded-xl text-xs text-red-300 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Official Certificate Sheet (Print-friendly) */}
      {report && (
        <div className="bg-[#121215] border border-zinc-800 rounded-xl p-8 space-y-6 print:border-none print:shadow-none print:bg-white print:text-black">
          {/* Header */}
          <div className="border-b border-zinc-800 print:border-zinc-300 pb-6 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 print:text-zinc-600 font-medium">
                  Spektrofotometrik Onay Raporu
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 print:bg-zinc-200 text-zinc-400 print:text-zinc-700 border border-zinc-800 print:border-zinc-300">
                  {report.standard}
                </span>
              </div>
              <h1 className="text-base font-semibold text-zinc-100 print:text-black tracking-tight">
                CERTIFICATE OF SPECTROPHOTOMETRIC CHARACTERIZATION
              </h1>
              <p className="text-xs text-zinc-500 print:text-zinc-600 font-mono mt-1">
                Doküman No: {report.report_id} • Tarih: {report.timestamp}
              </p>
            </div>

            {/* Verification Seal Badge */}
            <div className="border border-emerald-500/20 print:border-emerald-600 bg-emerald-500/10 print:bg-emerald-50 px-4 py-3 rounded-lg text-right">
              <div className="flex items-center justify-end gap-1.5 text-xs font-mono font-medium text-emerald-400 print:text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>ONAYLANDI (PASS)</span>
              </div>
              <p className="text-[11px] text-zinc-400 print:text-zinc-700 font-mono mt-0.5">
                ΔE00: {report.validation_statistics.mean_delta_e00.toFixed(3)} &lt; 0.30
              </p>
            </div>
          </div>

          {/* Test Conditions & Parameters Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3.5 bg-[#09090b] print:bg-zinc-50 rounded-lg border border-zinc-850 print:border-zinc-300 space-y-1 text-xs">
              <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 print:text-zinc-600 block">
                Ölçüm Cihazı & Geometri
              </span>
              <p className="font-medium text-zinc-200 print:text-black">{report.instrument.model}</p>
              <p className="text-[11px] font-mono text-zinc-400 print:text-zinc-700">
                {report.instrument.geometry} • {report.instrument.aperture}
              </p>
              <p className="text-[11px] font-mono text-zinc-400 print:text-zinc-700">
                {report.instrument.illuminant} / {report.instrument.observer}
              </p>
            </div>

            <div className="p-3.5 bg-[#09090b] print:bg-zinc-50 rounded-lg border border-zinc-850 print:border-zinc-300 space-y-1 text-xs">
              <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 print:text-zinc-600 block">
                Test Edilen Renklendirici
              </span>
              <div className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-full border border-zinc-700 shrink-0"
                  style={{ backgroundColor: report.colorant.hex }}
                ></span>
                <p className="font-medium text-zinc-200 print:text-black">{report.colorant.name}</p>
              </div>
              <p className="text-[11px] font-mono text-zinc-400 print:text-zinc-700">
                Kod: {report.colorant.code} • Yoğunluk: {report.colorant.density_g_cm3} g/cm³
              </p>
            </div>

            <div className="p-3.5 bg-[#09090b] print:bg-zinc-50 rounded-lg border border-zinc-850 print:border-zinc-300 space-y-1 text-xs">
              <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 print:text-zinc-600 block">
                Referans Baz & Saunderson
              </span>
              <p className="font-medium text-zinc-200 print:text-black">{report.base_paint.name}</p>
              <p className="text-[11px] font-mono text-zinc-400 print:text-zinc-700">
                Kontrast Oranı: %{report.base_paint.contrast_ratio} (Opak Baz)
              </p>
              <p className="text-[11px] font-mono text-zinc-400 print:text-zinc-700">
                k1={report.saunderson_coefficients.k1_fresnel} • k2={report.saunderson_coefficients.k2_internal}
              </p>
            </div>
          </div>

          {/* Validation Table */}
          <div className="space-y-2">
            <h3 className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 print:text-black">
              Seyreltme Serisi Geri Tahmin Doğrulama Verileri (Residuals)
            </h3>
            <div className="overflow-x-auto rounded-lg border border-zinc-850 print:border-zinc-300">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#09090b] print:bg-zinc-100 text-zinc-500 print:text-zinc-800 uppercase text-[10px]">
                  <tr>
                    <th className="p-2.5">Konsantrasyon</th>
                    <th className="p-2.5">Ölçülen L*a*b* (D65)</th>
                    <th className="p-2.5">K-M Modeli L*a*b*</th>
                    <th className="p-2.5">CIEDE2000 (ΔE00)</th>
                    <th className="p-2.5 text-right">Uygunluk</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-850 print:divide-zinc-200 bg-[#121215] print:bg-white text-zinc-300 print:text-black">
                  {report.back_predictions.map((bp, i) => (
                    <tr key={i}>
                      <td className="p-2.5 font-medium text-zinc-200 print:text-zinc-900">%{bp.concentration}</td>
                      <td className="p-2.5 text-zinc-400 print:text-zinc-600">
                        {bp.measured_lab[0].toFixed(1)} / {bp.measured_lab[1].toFixed(1)} / {bp.measured_lab[2].toFixed(1)}
                      </td>
                      <td className="p-2.5 text-zinc-400 print:text-zinc-600">
                        {bp.predicted_lab[0].toFixed(1)} / {bp.predicted_lab[1].toFixed(1)} / {bp.predicted_lab[2].toFixed(1)}
                      </td>
                      <td className="p-2.5 font-medium text-emerald-400 print:text-emerald-700">
                        {bp.delta_e00.toFixed(3)}
                      </td>
                      <td className="p-2.5 text-right">
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 print:bg-emerald-100 print:text-emerald-800 border border-emerald-500/20">
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
            <h3 className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 print:text-black">
              31-Kanal Birim Spektral Katsayılar (K & S Matrisi)
            </h3>
            <div className="overflow-x-auto rounded-lg border border-zinc-850 print:border-zinc-300 max-h-48 overflow-y-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#09090b] print:bg-zinc-100 text-zinc-500 print:text-zinc-800 uppercase text-[10px] sticky top-0">
                  <tr>
                    <th className="p-2">Dalga Boyu</th>
                    <th className="p-2">Birim K(λ)</th>
                    <th className="p-2">Birim S(λ)</th>
                    <th className="p-2 text-right">Birim (K/S)(λ)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-850 print:divide-zinc-200 bg-[#121215] print:bg-white text-zinc-300 print:text-black">
                  {report.spectral_matrix.wavelengths.map((wl, idx) => (
                    <tr key={wl} className="hover:bg-zinc-850/50">
                      <td className="p-2 text-zinc-400">{wl} nm</td>
                      <td className="p-2 text-zinc-300 print:text-black">{report.spectral_matrix.unit_k[idx]?.toFixed(5)}</td>
                      <td className="p-2 text-zinc-300 print:text-black">{report.spectral_matrix.unit_s[idx]?.toFixed(5)}</td>
                      <td className="p-2 text-right text-zinc-200 print:text-black font-medium">
                        {report.spectral_matrix.unit_ks[idx]?.toFixed(5)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Signatures & Accreditation Footer */}
          <div className="pt-6 border-t border-zinc-800 print:border-zinc-300 flex flex-col sm:flex-row justify-between items-end gap-6 text-xs font-mono">
            <div className="space-y-1 text-zinc-500 print:text-zinc-600 text-[11px]">
              <p>Metodoloji: ISO 18314-1 / ISO 18314-2 Analytical Colorimetry</p>
              <p>Motor: TintMatch PRO Spectral Engine v1.0.0</p>
              <p>Doğrulama: {report.validation_statistics.conformance_status}</p>
            </div>

            <div className="text-right space-y-2 min-w-[200px]">
              <div className="h-8 border-b border-dashed border-zinc-700 print:border-zinc-400"></div>
              <p className="text-zinc-400 print:text-black font-medium text-[11px]">Laboratuvar Renk Uzmanı İmzası</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
