import React from 'react';
import type { RecipeMatch } from '../../types';
import { Layers, CheckCircle2, AlertTriangle, ArrowRight, ShieldCheck, Zap } from 'lucide-react';

interface RecipeComparisonMatrixProps {
  allRecipes: {
    recipe_a?: RecipeMatch;
    recipe_b?: RecipeMatch;
    recipe_c?: RecipeMatch;
  } | null;
  activeRecipeKey: 'recipe_a' | 'recipe_b' | 'recipe_c';
  onSelectRecipe: (key: 'recipe_a' | 'recipe_b' | 'recipe_c') => void;
}

export const RecipeComparisonMatrix: React.FC<RecipeComparisonMatrixProps> = ({
  allRecipes,
  activeRecipeKey,
  onSelectRecipe,
}) => {
  if (!allRecipes || (!allRecipes.recipe_a && !allRecipes.recipe_b && !allRecipes.recipe_c)) {
    return null;
  }

  const columns: Array<{
    key: 'recipe_a' | 'recipe_b' | 'recipe_c';
    label: string;
    sublabel: string;
    color: string;
    borderActive: string;
    data?: RecipeMatch;
  }> = [
    {
      key: 'recipe_a',
      label: 'Reçete A',
      sublabel: 'Color Match (D65)',
      color: 'text-sky-400',
      borderActive: 'border-sky-500 bg-sky-950/20',
      data: allRecipes.recipe_a,
    },
    {
      key: 'recipe_b',
      label: 'Reçete B',
      sublabel: 'Light Stability (Metamerizm)',
      color: 'text-amber-400',
      borderActive: 'border-amber-500 bg-amber-950/20',
      data: allRecipes.recipe_b,
    },
    {
      key: 'recipe_c',
      label: 'Reçete C',
      sublabel: 'Ekonomi (Düşük Yük)',
      color: 'text-emerald-400',
      borderActive: 'border-emerald-500 bg-emerald-950/20',
      data: allRecipes.recipe_c,
    },
  ];

  // Collect union of all pigments across recipes
  const allPasteIds = new Set<string | number>();
  const pasteInfoMap = new Map<string | number, { name: string; hex: string }>();

  columns.forEach((col) => {
    col.data?.matched_pastes.forEach((p) => {
      allPasteIds.add(p.id);
      if (!pasteInfoMap.has(p.id)) {
        pasteInfoMap.set(p.id, { name: p.name, hex: p.hex || '#777777' });
      }
    });
  });

  return (
    <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2.5">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-sky-400" />
          <h4 className="text-xs font-semibold text-zinc-100 uppercase tracking-wide">
            Çoklu Reçete Karşılaştırma Matrisi (Recipe A vs B vs C)
          </h4>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-400">
          <span>DIN 6172 / ASTM E805</span>
          {allRecipes.recipe_a?.engine_version && (
            <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
              v{allRecipes.recipe_a.engine_version}
            </span>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono text-left border-collapse">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-400 text-[11px]">
              <th className="py-2 px-2.5 w-1/4 font-medium">Metrik / Parametre</th>
              {columns.map((col) => {
                const isActive = activeRecipeKey === col.key;
                return (
                  <th
                    key={col.key}
                    className={`py-2 px-2.5 w-1/4 text-center transition-colors rounded-t-lg ${
                      isActive ? `${col.borderActive} border-t-2 border-x-2` : 'bg-zinc-950/40'
                    }`}
                  >
                    <div className={`font-bold ${col.color}`}>{col.label}</div>
                    <div className="text-[9px] text-zinc-400 font-normal">{col.sublabel}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/50 text-[11px]">
            {/* Primary ΔE00 */}
            <tr>
              <td className="py-2 px-2.5 text-zinc-300 font-medium flex items-center gap-1.5">
                <span>D65 Renk Farkı (ΔE00)</span>
              </td>
              {columns.map((col) => {
                const de = col.data?.delta_e00;
                const isGood = de !== undefined && de < 0.50;
                const isActive = activeRecipeKey === col.key;
                return (
                  <td
                    key={col.key}
                    className={`py-2 px-2.5 text-center font-bold text-sm ${
                      isActive ? col.borderActive : ''
                    } ${isGood ? 'text-emerald-400' : 'text-amber-400'}`}
                  >
                    {de !== undefined ? de.toFixed(2) : '-'}
                  </td>
                );
              })}
            </tr>

            {/* Composite Metamerism Index */}
            <tr>
              <td className="py-2 px-2.5 text-zinc-300 font-medium">
                Metamerizm İndeksi (MI_comp)
              </td>
              {columns.map((col) => {
                const mi = col.data?.composite_mi;
                const isActive = activeRecipeKey === col.key;
                return (
                  <td
                    key={col.key}
                    className={`py-2 px-2.5 text-center font-semibold ${
                      isActive ? col.borderActive : ''
                    } ${mi !== undefined && mi < 0.30 ? 'text-emerald-400' : 'text-amber-300'}`}
                  >
                    {mi !== undefined ? mi.toFixed(2) : '-'}
                  </td>
                );
              })}
            </tr>

            {/* Total Load */}
            <tr>
              <td className="py-2 px-2.5 text-zinc-300 font-medium">Toplam Boyar Madde (%wt)</td>
              {columns.map((col) => {
                const load = col.data?.total_load;
                const isActive = activeRecipeKey === col.key;
                return (
                  <td
                    key={col.key}
                    className={`py-2 px-2.5 text-center font-semibold text-zinc-200 ${
                      isActive ? col.borderActive : ''
                    }`}
                  >
                    {load !== undefined ? `%${load.toFixed(2)}` : '-'}
                  </td>
                );
              })}
            </tr>

            {/* Active Pigment Count */}
            <tr>
              <td className="py-2 px-2.5 text-zinc-300 font-medium">Pasta Sayısı</td>
              {columns.map((col) => {
                const count = col.data?.matched_pastes?.length || 0;
                const isActive = activeRecipeKey === col.key;
                return (
                  <td
                    key={col.key}
                    className={`py-2 px-2.5 text-center text-zinc-300 ${
                      isActive ? col.borderActive : ''
                    }`}
                  >
                    {count} Renklendirici
                  </td>
                );
              })}
            </tr>

            {/* Quality Gate Status */}
            <tr>
              <td className="py-2 px-2.5 text-zinc-300 font-medium">Kalite Kapısı (Gate)</td>
              {columns.map((col) => {
                const isActive = activeRecipeKey === col.key;
                const status = col.data?.status || 'OPTIMAL_CONVERGED';
                const isOptimal = status === 'OPTIMAL_CONVERGED';
                return (
                  <td
                    key={col.key}
                    className={`py-2 px-2.5 text-center ${isActive ? col.borderActive : ''}`}
                  >
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${
                        isOptimal
                          ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800'
                          : 'bg-amber-950/80 text-amber-300 border border-amber-800'
                      }`}
                    >
                      {isOptimal ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : (
                        <AlertTriangle className="h-3 w-3" />
                      )}
                      <span>{status}</span>
                    </span>
                  </td>
                );
              })}
            </tr>

            {/* Pigment Breakdown Header */}
            <tr className="bg-zinc-950/70 text-zinc-400 text-[10px]">
              <td colSpan={4} className="py-1 px-2.5 font-bold uppercase tracking-wider">
                Pigment Pasta Dağılımı (%wt)
              </td>
            </tr>

            {/* Individual Pigments */}
            {Array.from(allPasteIds).map((pasteId) => {
              const pInfo = pasteInfoMap.get(pasteId);
              return (
                <tr key={pasteId}>
                  <td className="py-1.5 px-2.5 text-zinc-300 flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full border border-zinc-700 flex-shrink-0"
                      style={{ backgroundColor: pInfo?.hex || '#777777' }}
                    />
                    <span className="truncate">{pInfo?.name || `Pigment #${pasteId}`}</span>
                  </td>
                  {columns.map((col) => {
                    const match = col.data?.matched_pastes?.find((p) => p.id === pasteId);
                    const isActive = activeRecipeKey === col.key;
                    return (
                      <td
                        key={col.key}
                        className={`py-1.5 px-2.5 text-center ${
                          isActive ? col.borderActive : ''
                        } ${match ? 'text-zinc-200 font-semibold' : 'text-zinc-600'}`}
                      >
                        {match ? `%${match.concentration.toFixed(2)}` : '—'}
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            {/* Selection Buttons */}
            <tr>
              <td className="py-2.5 px-2.5 text-zinc-400 text-[10px]">Aksiyon</td>
              {columns.map((col) => {
                const isActive = activeRecipeKey === col.key;
                return (
                  <td
                    key={col.key}
                    className={`py-2.5 px-2.5 text-center ${
                      isActive ? `${col.borderActive} border-b-2 border-x-2 rounded-b-lg` : ''
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectRecipe(col.key)}
                      className={`w-full py-1.5 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                        isActive
                          ? 'bg-zinc-100 text-zinc-900 shadow-sm font-bold'
                          : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                      }`}
                    >
                      {isActive ? (
                        <>
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                          <span>Seçili Reçete</span>
                        </>
                      ) : (
                        <>
                          <span>Bu Reçeteyi Seç</span>
                          <ArrowRight className="h-3 w-3" />
                        </>
                      )}
                    </button>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};
