import React, { useRef } from 'react';
import { Printer, X, CheckSquare, ShieldCheck, Scale, Award } from 'lucide-react';
import type { RecipeMatch, BasePaint } from '../../types';

interface BatchTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  recipe: RecipeMatch;
  base: BasePaint;
  batchSizeG: number;
  scaleResolutionG: number;
}

export const BatchTicketModal: React.FC<BatchTicketModalProps> = ({
  isOpen,
  onClose,
  recipe,
  base,
  batchSizeG,
  scaleResolutionG,
}) => {
  const printRef = useRef<HTMLDivElement>(null);

  if (!isOpen) return null;

  const now = new Date();
  const dateStr = now.toLocaleDateString('tr-TR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const timeStr = now.toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const batchId = `TMP-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
    now.getDate()
  ).padStart(2, '0')}-${String(recipe.recipe_id || Math.floor(1000 + Math.random() * 9000))}`;

  const pastes = recipe.matched_pastes;
  const totalPasteG = pastes.reduce((acc, p) => {
    const g = p.amount_g ?? parseFloat(((p.concentration / 100) * batchSizeG).toFixed(2));
    return acc + g;
  }, 0);
  const baseG = recipe.base_amount_g ?? Math.max(0, parseFloat((batchSizeG - totalPasteG).toFixed(2)));

  // Calculate cumulative scale targets
  let runningTotal = baseG;
  const pasteRowsWithCumulative = pastes.map((p) => {
    const amount = p.amount_g ?? parseFloat(((p.concentration / 100) * batchSizeG).toFixed(2));
    runningTotal = parseFloat((runningTotal + amount).toFixed(2));
    return {
      ...p,
      amountG: amount,
      cumulativeG: runningTotal,
    };
  });

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs overflow-y-auto">
      {/* Modal Card */}
      <div className="bg-[var(--surface-3)] text-[var(--text-primary)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-2xl max-w-3xl w-full my-6 overflow-hidden flex flex-col">
        {/* Modal Top Actions (Hidden on Print) */}
        <div className="print:hidden p-4 bg-[var(--surface-0)] border-b border-[var(--border)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Printer className="h-5 w-5 text-[var(--brand-clay)]" />
            <h2 className="text-sm font-bold text-[var(--text-primary)]">
              Üretim Tartım İş Emri & Fişi (Batch Sheet)
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-3.5 py-1.5 bg-[var(--brand-clay)] hover:bg-[var(--brand-clay-emphasized)] text-white text-xs font-semibold rounded-[var(--radius)] flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>Yazdır / PDF Kaydet</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-[var(--radius)] cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Printable Sheet Content */}
        <div ref={printRef} className="p-8 text-black bg-white space-y-6 print:p-0 print:m-0 print:text-black">
          {/* Header */}
          <div className="flex items-start justify-between border-b-2 border-black pb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-black tracking-tight uppercase">TINTMATCH PRO</span>
                <span className="text-xs font-mono font-bold px-1.5 py-0.5 bg-black text-white">ENDÜSTRİYEL CCM</span>
              </div>
              <p className="text-xs text-gray-600 mt-0.5">Boya Üretim ve Laboratuvar Dozaj İş Emri</p>
            </div>
            <div className="text-right font-mono text-xs space-y-0.5">
              <div className="font-bold text-sm">İŞ EMRİ NO: {batchId}</div>
              <div>Tarih: {dateStr} / {timeStr}</div>
              <div>Terazi Hassasiyeti: ±{scaleResolutionG} g</div>
            </div>
          </div>

          {/* Target & Batch Metadata Grid */}
          <div className="grid grid-cols-2 gap-4 p-3 bg-gray-50 border border-gray-300 rounded text-xs">
            <div>
              <div className="font-bold text-gray-700 uppercase mb-1">Hedef & Üretim Bilgileri</div>
              <div className="space-y-0.5 font-mono">
                <div>
                  <span className="text-gray-500">Hedef Profil:</span>{' '}
                  <span className="font-bold">{recipe.profile_name || 'Standart Eşleme'}</span>
                </div>
                <div>
                  <span className="text-gray-500">Tahmin ΔE00:</span>{' '}
                  <span className="font-bold text-emerald-800">{recipe.delta_e00.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-gray-500">Optik Sistem:</span>{' '}
                  <span>bootstrap_v1 (d/8° SCI)</span>
                </div>
              </div>
            </div>

            <div>
              <div className="font-bold text-gray-700 uppercase mb-1">Parti / Tank Boyutu</div>
              <div className="space-y-0.5 font-mono">
                <div>
                  <span className="text-gray-500">Toplam Parti Ağırlığı:</span>{' '}
                  <span className="font-black text-sm">{batchSizeG.toFixed(2)} g</span>
                </div>
                <div>
                  <span className="text-gray-500">Taşıyıcı Baz:</span>{' '}
                  <span className="font-bold">{base.name} ({base.code})</span>
                </div>
                <div>
                  <span className="text-gray-500">Renklendirici Sayısı:</span>{' '}
                  <span>{pastes.length} Pasta</span>
                </div>
              </div>
            </div>
          </div>

          {/* Weighing Table (With Cumulative Target) */}
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-gray-800 mb-2 flex items-center justify-between">
              <span>Bileşen Dozaj Tablosu (Sıralı Tartım)</span>
              <span className="text-[11px] font-normal text-gray-500 font-mono">
                * Dara almadan üst üste ekleme için kümülatif hedefi takip edin
              </span>
            </div>

            <table className="w-full text-left text-xs border-collapse border border-gray-400">
              <thead>
                <tr className="bg-gray-200 border-b border-gray-400 font-mono text-[11px] uppercase">
                  <th className="p-2 border-r border-gray-400 text-center w-10">Sıra</th>
                  <th className="p-2 border-r border-gray-400">Bileşen Adı & Kodu</th>
                  <th className="p-2 border-r border-gray-400 text-center w-20">Oran %</th>
                  <th className="p-2 border-r border-gray-400 text-right w-24">Net (g)</th>
                  <th className="p-2 border-r border-gray-400 text-right w-28 bg-gray-100">Kümülatif (g)</th>
                  <th className="p-2 border-r border-gray-400 text-center w-24">Gerçekleşen</th>
                  <th className="p-2 text-center w-12">Onay</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-300 font-mono">
                {/* Carrier Base */}
                <tr className="bg-gray-50">
                  <td className="p-2 border-r border-gray-300 text-center font-bold">1</td>
                  <td className="p-2 border-r border-gray-300">
                    <span className="font-bold">{base.name}</span>{' '}
                    <span className="text-gray-500">({base.code}) - Taşıyıcı Baz</span>
                  </td>
                  <td className="p-2 border-r border-gray-300 text-center">
                    %{((baseG / batchSizeG) * 100).toFixed(2)}
                  </td>
                  <td className="p-2 border-r border-gray-300 text-right font-black text-gray-900">
                    {baseG.toFixed(2)}
                  </td>
                  <td className="p-2 border-r border-gray-300 text-right font-black text-blue-900 bg-gray-50">
                    {baseG.toFixed(2)}
                  </td>
                  <td className="p-2 border-r border-gray-300 text-center text-gray-400">
                    [ &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; ]
                  </td>
                  <td className="p-2 text-center">
                    <span className="inline-block w-4 h-4 border border-gray-400 rounded-xs" />
                  </td>
                </tr>

                {/* Colorant Pastes */}
                {pasteRowsWithCumulative.map((p, idx) => (
                  <tr key={p.id}>
                    <td className="p-2 border-r border-gray-300 text-center font-bold">{idx + 2}</td>
                    <td className="p-2 border-r border-gray-300">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-2.5 h-2.5 rounded-full border border-black/30 inline-block"
                          style={{ backgroundColor: p.color_hex || p.hex }}
                        />
                        <span className="font-bold">{p.name}</span>{' '}
                        <span className="text-gray-500">({p.code})</span>
                      </div>
                    </td>
                    <td className="p-2 border-r border-gray-300 text-center">
                      %{p.concentration.toFixed(2)}
                    </td>
                    <td className="p-2 border-r border-gray-300 text-right font-black">
                      {p.amountG.toFixed(2)}
                    </td>
                    <td className="p-2 border-r border-gray-300 text-right font-black text-blue-900 bg-gray-50">
                      {p.cumulativeG.toFixed(2)}
                    </td>
                    <td className="p-2 border-r border-gray-300 text-center text-gray-400">
                      [ &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; ]
                    </td>
                    <td className="p-2 text-center">
                      <span className="inline-block w-4 h-4 border border-gray-400 rounded-xs" />
                    </td>
                  </tr>
                ))}

                {/* Total */}
                <tr className="bg-gray-200 font-bold border-t-2 border-gray-400">
                  <td colSpan={2} className="p-2 border-r border-gray-400 text-left">
                    TOPLAM PARTİ
                  </td>
                  <td className="p-2 border-r border-gray-400 text-center">%100.00</td>
                  <td className="p-2 border-r border-gray-400 text-right">{batchSizeG.toFixed(2)} g</td>
                  <td className="p-2 border-r border-gray-400 text-right text-blue-900 font-black">
                    {batchSizeG.toFixed(2)} g
                  </td>
                  <td className="p-2 border-r border-gray-400 text-center text-gray-400">
                    [ &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; ]
                  </td>
                  <td className="p-2 text-center">
                    <CheckSquare className="w-4 h-4 mx-auto text-gray-600" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* QA & Drawdown Verification Block */}
          <div className="border border-gray-400 rounded p-4 space-y-3 bg-gray-50">
            <div className="font-bold text-xs uppercase text-gray-800 flex items-center justify-between">
              <span>Kalite Kontrol & Fiziksel Drawdown Doğrulaması</span>
              <span className="text-[11px] font-mono text-gray-500 font-normal">
                Tolerans Eşiği: ΔE00 ≤ 0.40
              </span>
            </div>

            <div className="grid grid-cols-3 gap-4 text-xs font-mono pt-1">
              <div className="p-2 bg-white border border-gray-300 rounded">
                <div className="text-gray-500 text-[10px]">DS-36D ÖLÇÜLEN ΔE00</div>
                <div className="text-base font-bold mt-1 text-gray-800">
                  [ &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; ]
                </div>
              </div>

              <div className="p-2 bg-white border border-gray-300 rounded">
                <div className="text-gray-500 text-[10px]">DOĞRULAMA KARARI</div>
                <div className="text-[11px] font-bold mt-1 space-y-0.5">
                  <div>[ ] KABUL (Golden Batch)</div>
                  <div>[ ] İLAVE GEREKLİ (Add-Back)</div>
                  <div>[ ] RED</div>
                </div>
              </div>

              <div className="p-2 bg-white border border-gray-300 rounded">
                <div className="text-gray-500 text-[10px]">OPERATÖR ONAYI</div>
                <div className="mt-2 border-b border-gray-400" />
                <div className="text-[10px] text-gray-400 mt-1">İmza & Kaşe</div>
              </div>
            </div>
          </div>

          {/* Footer Notes */}
          <div className="pt-2 border-t border-gray-300 flex items-center justify-between text-[10px] text-gray-500 font-mono">
            <span>TintMatch PRO — Endüstriyel Renk Yönetimi v2.0</span>
            <span>Girdi Hash: {recipe.input_hash ? recipe.input_hash.substring(0, 16) : 'N/A'}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
