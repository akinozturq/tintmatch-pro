import React, { useState, useEffect } from 'react';
import {
  Layers,
  Wand2,
  Sliders,
  FileCheck,
  BookOpen,
  Cpu,
  Settings2,
  Sun,
  Moon,
  Monitor,
  Maximize2,
  Minimize2
} from 'lucide-react';
import { getChnspecStatus } from '../services/api';
import type { ChnspecStatusInfo, DeviceConnectionState } from '../types';
import { useTheme } from '../context/ThemeContext';

export type MainTabType = 'formulation' | 'wizard' | 'library' | 'spectro';

interface HeaderProps {
  activeTab: MainTabType;
  setActiveTab: (tab: MainTabType) => void;
  onOpenInstruments?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ activeTab, setActiveTab, onOpenInstruments }) => {
  const [deviceStatus, setDeviceStatus] = useState<ChnspecStatusInfo | null>(null);
  const { mode, setMode, density, setDensity } = useTheme();

  useEffect(() => {
    let isMounted = true;
    const checkStatus = async () => {
      try {
        const info = await getChnspecStatus();
        if (isMounted) setDeviceStatus(info);
      } catch {
        if (isMounted) setDeviceStatus(null);
      }
    };
    checkStatus();
    const interval = setInterval(checkStatus, 8000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const tabs = [
    { id: 'formulation', label: 'CCM Reçete', icon: Sliders },
    { id: 'wizard', label: 'K-M Karakterizasyon', icon: Wand2 },
    { id: 'library', label: 'Kütüphane & Kartela', icon: Layers },
    { id: 'spectro', label: 'Spektrofotometre', icon: Cpu },
  ] as const;

  const renderChnspecBadge = () => {
    const connState: DeviceConnectionState =
      deviceStatus?.connection_state ||
      (deviceStatus?.connected
        ? (deviceStatus?.is_mock ? 'CONNECTED_MOCK' : 'CONNECTED_REAL')
        : 'DISCONNECTED');

    if (connState === 'CONNECTED_REAL') {
      return (
        <button
          onClick={() => setActiveTab('spectro')}
          title="DS-36D Bağlı - Spektrofotometre Yönetimi & Kalibrasyon için tıklayın"
          className="flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--radius-xs)] bg-[var(--surface-3)] border border-[var(--border)] text-[var(--success-text)] transition-colors cursor-pointer text-left shadow-[var(--shadow-sm)]"
        >
          <span className="w-2 h-2 rounded-full bg-[var(--success)] shadow-[0_0_8px_var(--success)] animate-pulse" />
          <span className="font-semibold text-[10px]">CHNSpec:</span>
          <span className="text-[10px] text-[var(--text-secondary)]">{deviceStatus?.port || 'COM4'} (GERÇEK)</span>
        </button>
      );
    }
    if (connState === 'CONNECTED_MOCK') {
      return (
        <button
          onClick={() => setActiveTab('spectro')}
          title="Simülasyon Modu - Spektrofotometre Yönetimi & Port Seçimi için tıklayın"
          className="flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--radius-xs)] bg-[var(--surface-3)] border border-[var(--border)] text-[var(--warning-text)] transition-colors cursor-pointer text-left shadow-[var(--shadow-sm)]"
        >
          <span className="w-2 h-2 rounded-full bg-[var(--warning)] shadow-[0_0_6px_var(--warning)]" />
          <span className="font-semibold text-[10px]">CHNSpec:</span>
          <span className="text-[10px] text-[var(--text-secondary)]">SİMÜLASYON</span>
        </button>
      );
    }
    return (
      <button
        onClick={() => setActiveTab('spectro')}
        title="CHNSpec Bağlı Değil - Bağlanmak ve kalibre etmek için tıklayın"
        className="flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--radius-xs)] bg-[var(--surface-0)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors cursor-pointer text-left"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)]" />
        <span className="text-[10px]">CHNSpec: BAĞLI DEĞİL</span>
      </button>
    );
  };

  return (
    <header className="border-b border-[var(--border)] bg-[var(--surface-1)]/90 backdrop-blur sticky top-0 z-50 transition-colors">
      <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
        {/* Brand & Hardware status badges */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-[var(--brand-clay)] shadow-[0_0_8px_rgba(217,119,87,0.7)]" />
            <span className="font-semibold text-sm tracking-tight text-[var(--text-primary)]">
              TintMatch <span className="text-[var(--text-secondary)] font-normal">Pro</span>
            </span>
          </div>

          <div className="hidden sm:flex items-center gap-2 pl-3 border-l border-[var(--border)] font-mono">
            {renderChnspecBadge()}
          </div>
        </div>

        {/* Navigation Segmented Control */}
        <nav className="flex items-center bg-[var(--surface-0)] border border-[var(--border)] p-1 rounded-[var(--radius-lg)]">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-[var(--radius)] text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-[var(--surface-3)] text-[var(--text-primary)] shadow-[var(--shadow-sm)] [box-shadow:var(--ring-outer)] font-semibold'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)]/60'
                }`}
              >
                <Icon className="h-3.5 w-3.5 opacity-80" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Right Controls: Tolerances + Density + Theme Switcher */}
        <div className="flex items-center gap-2.5">
          {/* Laboratory Tolerance Badges */}
          <div className="hidden xl:flex items-center gap-2 text-xs font-mono text-[var(--text-secondary)]">
            <span className="text-[11px] text-[var(--text-muted)]">Tolerans</span>
            <span className="px-2 py-0.5 rounded-[var(--radius-xs)] bg-[var(--surface-0)] border border-[var(--border)] text-[var(--success-text)] font-medium">
              ΔE00 &lt; 0.30
            </span>
            <span className="px-2 py-0.5 rounded-[var(--radius-xs)] bg-[var(--surface-0)] border border-[var(--border)] text-[var(--accent-text)] font-medium text-[11px]" title="Leave-One-Out Cross-Validation Out-Of-Sample Prediction Limit">
              LOOCV &le; 0.50
            </span>
          </div>

          {/* Density Toggle (Compact vs Comfortable) */}
          <button
            onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')}
            title={`Yoğunluk Modu: ${density === 'compact' ? 'Kompakt (Endüstriyel)' : 'Geniş (Rahat Okuma)'}. Değiştirmek için tıklayın.`}
            className="p-1.5 rounded-[var(--radius-sm)] bg-[var(--surface-0)] hover:bg-[var(--surface-3)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors text-xs flex items-center gap-1 font-mono"
          >
            {density === 'compact' ? (
              <>
                <Minimize2 className="h-3.5 w-3.5" />
                <span className="text-[10px] hidden md:inline">Kompakt</span>
              </>
            ) : (
              <>
                <Maximize2 className="h-3.5 w-3.5" />
                <span className="text-[10px] hidden md:inline">Geniş</span>
              </>
            )}
          </button>

          {/* Theme Mode Segmented Switcher (Light / Dark / System) */}
          <div className="flex items-center bg-[var(--surface-0)] border border-[var(--border)] p-0.5 rounded-[var(--radius-sm)]">
            <button
              type="button"
              onClick={() => setMode('light')}
              title="Açık Tema (Light Mode)"
              className={`p-1.5 rounded-[var(--radius-xs)] transition-colors ${
                mode === 'light'
                  ? 'bg-[var(--surface-3)] text-[var(--brand-clay)] shadow-sm [box-shadow:var(--ring-outer)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              <Sun className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setMode('dark')}
              title="Koyu Tema (Dark Mode)"
              className={`p-1.5 rounded-[var(--radius-xs)] transition-colors ${
                mode === 'dark'
                  ? 'bg-[var(--surface-3)] text-[var(--brand-clay)] shadow-sm [box-shadow:var(--ring-outer)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              <Moon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setMode('system')}
              title="Sistem Teması (Auto)"
              className={`p-1.5 rounded-[var(--radius-xs)] transition-colors ${
                mode === 'system'
                  ? 'bg-[var(--surface-3)] text-[var(--brand-clay)] shadow-sm [box-shadow:var(--ring-outer)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              <Monitor className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
