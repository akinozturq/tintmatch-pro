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
    <div className="space-y-2 pt-2 border-t border-[var(--border)]">
      <div className="flex items-center justify-between text-[10px] font-mono text-[var(--text-secondary)]">
        <span>CCM OPTİMİZASYON PROFİLLERİ</span>
        <span>Aktif: {activeRecipeKey.toUpperCase()}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {/* Recipe A Card */}
        <button
          type="button"
          onClick={() => onSelectRecipe('recipe_a')}
          className={`p-2 rounded-[var(--radius)] border text-left transition-all ${
            activeRecipeKey === 'recipe_a'
              ? 'bg-[var(--surface-1)] border-[var(--brand-clay)] ring-1 ring-[var(--brand-clay)] shadow-sm text-[var(--text-primary)]'
              : 'bg-[var(--surface-0)] border border-[var(--border)] hover:border-[var(--border-strong)] text-[var(--text-secondary)]'
          }`}
        >
          <div className="text-[10px] font-semibold text-[var(--text-primary)] truncate">Reçete A</div>
          <div className="text-[9px] text-[var(--text-muted)]">Color Match</div>
          <div className="mt-1 font-mono text-[11px] font-bold text-[var(--brand-clay)]">
            ΔE {allRecipes.recipe_a?.delta_e00?.toFixed(2) || '0.00'}
          </div>
          <div className="text-[9px] font-mono text-[var(--text-muted)]">
            %{allRecipes.recipe_a?.total_load?.toFixed(1) || '0.0'} yük
          </div>
        </button>

        {/* Recipe B Card */}
        <button
          type="button"
          onClick={() => onSelectRecipe('recipe_b')}
          className={`p-2 rounded-[var(--radius)] border text-left transition-all ${
            activeRecipeKey === 'recipe_b'
              ? 'bg-[var(--surface-1)] border-[var(--warning-border)] ring-1 ring-[var(--warning-border)] shadow-sm text-[var(--text-primary)]'
              : 'bg-[var(--surface-0)] border border-[var(--border)] hover:border-[var(--border-strong)] text-[var(--text-secondary)]'
          }`}
        >
          <div className="text-[10px] font-semibold text-[var(--text-primary)] truncate">Reçete B</div>
          <div className="text-[9px] text-[var(--text-muted)]">Light Stability</div>
          <div className="mt-1 font-mono text-[11px] font-bold text-[var(--warning-text)]">
            MI {allRecipes.recipe_b?.composite_mi?.toFixed(2) || '0.00'}
          </div>
          <div className="text-[9px] font-mono text-[var(--text-muted)]">
            ΔE {allRecipes.recipe_b?.delta_e00?.toFixed(2) || '0.00'}
          </div>
        </button>

        {/* Recipe C Card */}
        <button
          type="button"
          onClick={() => onSelectRecipe('recipe_c')}
          className={`p-2 rounded-[var(--radius)] border text-left transition-all ${
            activeRecipeKey === 'recipe_c'
              ? 'bg-[var(--surface-1)] border-[var(--success-border)] ring-1 ring-[var(--success-border)] shadow-sm text-[var(--text-primary)]'
              : 'bg-[var(--surface-0)] border border-[var(--border)] hover:border-[var(--border-strong)] text-[var(--text-secondary)]'
          }`}
        >
          <div className="text-[10px] font-semibold text-[var(--text-primary)] truncate">Reçete C</div>
          <div className="text-[9px] text-[var(--text-muted)]">Ekonomi / Yük</div>
          <div className="mt-1 font-mono text-[11px] font-bold text-[var(--success-text)]">
            %{allRecipes.recipe_c?.total_load?.toFixed(1) || '0.0'}
          </div>
          <div className="text-[9px] font-mono text-[var(--text-muted)]">
            ΔE {allRecipes.recipe_c?.delta_e00?.toFixed(2) || '0.00'}
          </div>
        </button>
      </div>
    </div>
  );
};
