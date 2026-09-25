import React, { useState, useEffect } from 'react';
import {
  Layers,
  Wand2,
  Sliders,
  FileCheck,
  BookOpen
} from 'lucide-react';
import { getChnspecStatus } from '../services/api';
import type { ChnspecStatusInfo, DeviceConnectionState } from '../types';

interface HeaderProps {
  activeTab: 'dashboard' | 'wizard' | 'formulation' | 'glossary' | 'report';
  setActiveTab: (tab: 'dashboard' | 'wizard' | 'formulation' | 'glossary' | 'report') => void;
  onOpenInstruments?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ activeTab, setActiveTab, onOpenInstruments }) => {
  const [deviceStatus, setDeviceStatus] = useState<ChnspecStatusInfo | null>(null);

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
    { id: 'dashboard', label: 'Laboratuvar', icon: Layers },
    { id: 'wizard', label: 'RM400 Karakterizasyon', icon: Wand2 },
    { id: 'formulation', label: 'CCM Reçete', icon: Sliders },
    { id: 'report', label: 'ISO 18314 Rapor', icon: FileCheck },
    { id: 'glossary', label: 'Sözlük', icon: BookOpen },
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
          onClick={onOpenInstruments}
          title="DS-36D Bağlı - Cihaz Masası & Kalibrasyon için tıklayın"
          className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-800/80 text-emerald-300 transition-colors cursor-pointer text-left"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse" />
          <span className="font-semibold text-[10px]">CHNSpec:</span>
          <span className="text-[10px] text-emerald-200">{deviceStatus?.port || 'COM4'} (GERÇEK)</span>
        </button>
      );
    }
    if (connState === 'CONNECTED_MOCK') {
      return (
        <button
          onClick={onOpenInstruments}
          title="Simülasyon Modu - Cihaz Masası & Port Seçimi için tıklayın"
          className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-950/50 hover:bg-amber-900/70 border border-amber-800/70 text-amber-300 transition-colors cursor-pointer text-left"
        >
          <span className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)]" />
          <span className="font-semibold text-[10px]">CHNSpec:</span>
          <span className="text-[10px] text-amber-200">SİMÜLASYON</span>
        </button>
      );
    }
    return (
      <button
        onClick={onOpenInstruments}
        title="CHNSpec Bağlı Değil - Bağlanmak ve kalibre etmek için tıklayın"
        className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer text-left"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
        <span className="text-[10px]">CHNSpec: BAĞLI DEĞİL</span>
      </button>
    );
  };

  return (
    <header className="border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between gap-6">
        {/* Brand & Hardware status badges */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]" />
            <span className="font-semibold text-sm tracking-tight text-zinc-100">
              TintMatch <span className="text-zinc-400 font-normal">Pro</span>
            </span>
          </div>

          <div className="hidden sm:flex items-center gap-2 pl-3 border-l border-zinc-800 font-mono">
            {renderChnspecBadge()}
            <button
              onClick={onOpenInstruments}
              title="Cihaz Masası (RM400 / DS-36D)"
              className="hidden lg:flex items-center gap-1.5 px-2 py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[10px] text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
              <span>RM400 (45°:0°)</span>
            </button>
          </div>
        </div>

        {/* Navigation Segmented Control */}
        <nav className="flex items-center bg-zinc-900 border border-zinc-800/90 p-1 rounded-lg">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
                }`}
              >
                <Icon className="h-3.5 w-3.5 opacity-80" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Laboratory Tolerance Badges */}
        <div className="hidden md:flex items-center gap-2 text-xs font-mono text-zinc-400">
          <span className="text-[11px] text-zinc-500">Tolerans</span>
          <span className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-emerald-400 font-medium">
            ΔE00 &lt; 0.30
          </span>
          <span className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-cyan-400 font-medium text-[11px]" title="Leave-One-Out Cross-Validation Out-Of-Sample Prediction Limit">
            LOOCV &le; 0.50
          </span>
        </div>
      </div>
    </header>
  );
};
