import React from 'react';
import {
  Layers,
  Wand2,
  Sliders,
  FileCheck,
  BookOpen
} from 'lucide-react';

interface HeaderProps {
  activeTab: 'dashboard' | 'wizard' | 'formulation' | 'glossary' | 'report';
  setActiveTab: (tab: 'dashboard' | 'wizard' | 'formulation' | 'glossary' | 'report') => void;
}

export const Header: React.FC<HeaderProps> = ({ activeTab, setActiveTab }) => {
  const tabs = [
    { id: 'dashboard', label: 'Laboratuvar', icon: Layers },
    { id: 'wizard', label: 'RM400 Karakterizasyon', icon: Wand2 },
    { id: 'formulation', label: 'CCM Reçete', icon: Sliders },
    { id: 'report', label: 'ISO 18314 Rapor', icon: FileCheck },
    { id: 'glossary', label: 'Sözlük', icon: BookOpen },
  ] as const;

  return (
    <header className="border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between gap-6">
        {/* Brand & Hardware minimal badge */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]" />
            <span className="font-semibold text-sm tracking-tight text-zinc-100">
              TintMatch <span className="text-zinc-400 font-normal">Pro</span>
            </span>
          </div>

          <div className="hidden sm:flex items-center gap-2 pl-4 border-l border-zinc-800 text-[11px] font-mono text-zinc-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span>X-Rite RM400 (45°:0° D65/10°)</span>
          </div>
        </div>

        {/* Minimal Navigation Segmented Control */}
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

        {/* Minimal Tolerance Badge */}
        <div className="hidden md:flex items-center gap-2 text-xs font-mono text-zinc-400">
          <span className="text-[11px] text-zinc-500">Tolerans</span>
          <span className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-emerald-400 font-medium">
            ΔE00 &lt; 0.30
          </span>
        </div>
      </div>
    </header>
  );
};
