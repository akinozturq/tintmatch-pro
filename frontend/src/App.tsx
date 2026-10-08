import React, { useState, useEffect } from 'react';
import type { BasePaint, ColorantPaste } from './types';
import { fetchBases, fetchPastes } from './services/api';
import { Header, type MainTabType } from './components/Header';
import { CharacterizationWizard } from './components/CharacterizationWizard';
import { FormulationSimulator } from './components/FormulationSimulator';
import { InstrumentModal } from './components/InstrumentModal';
import { SpectroSettingsView } from './components/SpectroSettingsView';
import { LibraryView } from './components/LibraryView';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { ThemeProvider } from './context/ThemeContext';

const AppContent: React.FC = () => {
  const [activeTab, setActiveTab] = useState<MainTabType>('formulation');
  const [bases, setBases] = useState<BasePaint[]>([]);
  const [pastes, setPastes] = useState<ColorantPaste[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isInstrumentModalOpen, setIsInstrumentModalOpen] = useState<boolean>(false);

  // Cross-component states
  const [simPaste, setSimPaste] = useState<ColorantPaste | null>(null);
  const [externalTarget, setExternalTarget] = useState<{ reflectance: number[]; name: string; hex?: string } | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [basesData, pastesData] = await Promise.all([fetchBases(), fetchPastes()]);
      setBases(basesData);
      setPastes(pastesData);
    } catch (err: any) {
      setError(err.message || 'Veriler yüklenirken hata oluştu');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSelectPasteForSim = (paste: ColorantPaste) => {
    setSimPaste(paste);
    setActiveTab('formulation');
  };

  return (
    <div className="min-h-screen bg-[var(--surface-1)] text-[var(--text-primary)] flex flex-col font-sans transition-colors duration-150 selection:bg-[var(--accent)] selection:text-white">
      {/* Top Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenInstruments={() => setIsInstrumentModalOpen(true)}
      />

      {/* Main Content Area */}
      <main className="flex-1 pb-16">
        {error && (
          <div className="max-w-7xl mx-auto px-6 pt-4">
            <div className="bg-red-950/30 border border-red-900/60 rounded-xl p-4 text-xs text-red-300 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
                <span>{error}</span>
              </div>
              <button
                onClick={loadData}
                className="px-3 py-1 bg-red-900/40 hover:bg-red-900/60 text-red-200 rounded font-medium flex items-center gap-1.5 transition-colors"
              >
                <RefreshCw className="h-3 w-3" />
                <span>Yeniden Dene</span>
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="h-[60vh] flex flex-col items-center justify-center gap-3 text-[var(--text-muted)]">
            <div className="w-6 h-6 border-2 border-[var(--brand-clay)] border-t-transparent rounded-full animate-spin"></div>
            <p className="text-xs font-mono text-[var(--text-secondary)]">TintMatch PRO motoru başlatılıyor...</p>
          </div>
        ) : (
          <>
            {activeTab === 'formulation' && (
              <FormulationSimulator
                bases={bases}
                pastes={pastes}
                initialPaste={simPaste}
                initialTarget={externalTarget}
              />
            )}

            {activeTab === 'wizard' && (
              <CharacterizationWizard
                bases={bases}
                pastes={pastes}
                onComplete={() => {
                  loadData();
                  setActiveTab('library');
                }}
                onOpenInstruments={() => setIsInstrumentModalOpen(true)}
                onNavigateToSpectro={() => setActiveTab('spectro')}
              />
            )}

            {activeTab === 'library' && (
              <LibraryView
                bases={bases}
                pastes={pastes}
                onSelectPasteForSim={handleSelectPasteForSim}
                onNavigateToFormulationWithTarget={(refl, colorName) => {
                  setExternalTarget({ reflectance: refl, name: colorName });
                  setActiveTab('formulation');
                }}
                onRefreshData={loadData}
              />
            )}

            {activeTab === 'spectro' && (
              <SpectroSettingsView
                onNavigateToWizard={() => setActiveTab('wizard')}
                onNavigateToFormulation={() => setActiveTab('formulation')}
              />
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--border)] bg-[var(--surface-0)] px-6 py-4 text-xs font-mono text-[var(--text-muted)] print:hidden transition-colors">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>TintMatch PRO • Endüstriyel Spektrofotometrik Renklendirici Karakterizasyonu ve CCM</span>
          <span className="text-[var(--text-secondary)]">ISO 18314-1 / ISO 18314-2 • D65/10° • CHNSpec DS-36D (d/8°)</span>
        </div>
      </footer>

      {/* Industrial Spectrophotometer Modal (CHNSpec DS-36D) */}
      <InstrumentModal
        isOpen={isInstrumentModalOpen}
        onClose={() => setIsInstrumentModalOpen(false)}
      />
    </div>
  );
};

export const App: React.FC = () => (
  <ThemeProvider>
    <AppContent />
  </ThemeProvider>
);

export default App;
