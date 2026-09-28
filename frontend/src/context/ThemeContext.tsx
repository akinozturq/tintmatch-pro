import React, { createContext, useContext, useState, useEffect } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ThemeDensity = 'compact' | 'comfortable';

interface ThemeContextValue {
  mode: ThemeMode;
  density: ThemeDensity;
  setMode: (mode: ThemeMode) => void;
  setDensity: (density: ThemeDensity) => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('tintmatch_theme_mode');
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
    return 'dark'; // Varsayılan koyu tema
  });

  const [density, setDensityState] = useState<ThemeDensity>(() => {
    const saved = localStorage.getItem('tintmatch_theme_density');
    if (saved === 'compact' || saved === 'comfortable') return saved;
    return 'compact'; // Varsayılan endüstriyel yoğun mod
  });

  const [systemIsDark, setSystemIsDark] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return true;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemIsDark(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  const isDark = mode === 'dark' || (mode === 'system' && systemIsDark);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-mode', mode);
    root.setAttribute('data-density', density);
    root.classList.add('cds-root');

    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [mode, density, isDark]);

  const setMode = (newMode: ThemeMode) => {
    setModeState(newMode);
    localStorage.setItem('tintmatch_theme_mode', newMode);
  };

  const setDensity = (newDensity: ThemeDensity) => {
    setDensityState(newDensity);
    localStorage.setItem('tintmatch_theme_density', newDensity);
  };

  return (
    <ThemeContext.Provider value={{ mode, density, setMode, setDensity, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextValue => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
