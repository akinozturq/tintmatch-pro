import React from 'react';
import type { RecipeMatch } from '../../types';

interface RecipeCardsProps {
  allRecipes: {
    recipe_a?: RecipeMatch;
    recipe_b?: RecipeMatch;
    recipe_c?: RecipeMatch;
  } | null;
  activeRecipeKey: 'recipe_a' | 'recipe_b' | 'recipe_c';
  onSelectRecipe: (key: 'recipe_a' | 'recipe_b' | 'recipe_c') => void;
}

export const RecipeCards: React.FC<RecipeCardsProps> = ({
  allRecipes,
  activeRecipeKey,
  onSelectRecipe,
}) => {
  if (!allRecipes) return null;

  return (
    <div className="space-y-2 pt-2 border-t border-zinc-800">
      <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400">
        <span>CCM OPTİMİZASYON PROFİLLERİ</span>
        <span>Aktif: {activeRecipeKey.toUpperCase()}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {/* Recipe A Card */}
        <button
          type="button"
          onClick={() => onSelectRecipe('recipe_a')}
          className={`p-2 rounded-lg border text-left transition-all ${
            activeRecipeKey === 'recipe_a'
              ? 'bg-zinc-800 border-sky-500 shadow-sm shadow-sky-950 text-zinc-100'
              : 'bg-zinc-950/70 border-zinc-800 hover:border-zinc-700 text-zinc-400'
          }`}
        >
          <div className="text-[10px] font-semibold text-zinc-200 truncate">Reçete A</div>
          <div className="text-[9px] text-zinc-400">Color Match</div>
          <div className="mt-1 font-mono text-[11px] font-bold text-sky-400">
            ΔE {allRecipes.recipe_a?.delta_e00?.toFixed(2) || '0.00'}
          </div>
          <div className="text-[9px] font-mono text-zinc-400">
            %{allRecipes.recipe_a?.total_load?.toFixed(1) || '0.0'} yük
          </div>
        </button>

        {/* Recipe B Card */}
        <button
          type="button"
          onClick={() => onSelectRecipe('recipe_b')}
          className={`p-2 rounded-lg border text-left transition-all ${
            activeRecipeKey === 'recipe_b'
              ? 'bg-zinc-800 border-amber-500 shadow-sm shadow-amber-950 text-zinc-100'
              : 'bg-zinc-950/70 border-zinc-800 hover:border-zinc-700 text-zinc-400'
          }`}
        >
          <div className="text-[10px] font-semibold text-zinc-200 truncate">Reçete B</div>
          <div className="text-[9px] text-zinc-400">Light Stability</div>
          <div className="mt-1 font-mono text-[11px] font-bold text-amber-400">
            MI {allRecipes.recipe_b?.composite_mi?.toFixed(2) || '0.00'}
          </div>
          <div className="text-[9px] font-mono text-zinc-400">
            ΔE {allRecipes.recipe_b?.delta_e00?.toFixed(2) || '0.00'}
          </div>
        </button>

        {/* Recipe C Card */}
        <button
          type="button"
          onClick={() => onSelectRecipe('recipe_c')}
          className={`p-2 rounded-lg border text-left transition-all ${
            activeRecipeKey === 'recipe_c'
              ? 'bg-zinc-800 border-emerald-500 shadow-sm shadow-emerald-950 text-zinc-100'
              : 'bg-zinc-950/70 border-zinc-800 hover:border-zinc-700 text-zinc-400'
          }`}
        >
          <div className="text-[10px] font-semibold text-zinc-200 truncate">Reçete C</div>
          <div className="text-[9px] text-zinc-400">Ekonomi / Yük</div>
          <div className="mt-1 font-mono text-[11px] font-bold text-emerald-400">
            %{allRecipes.recipe_c?.total_load?.toFixed(1) || '0.0'}
          </div>
          <div className="text-[9px] font-mono text-zinc-400">
            ΔE {allRecipes.recipe_c?.delta_e00?.toFixed(2) || '0.00'}
          </div>
        </button>
      </div>
    </div>
  );
};
