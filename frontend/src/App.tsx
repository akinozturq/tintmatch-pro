import React, { useState, useEffect } from 'react';
import type { BasePaint, ColorantPaste } from './types';
import { fetchBases, fetchPastes } from './services/api';
import { Header } from './components/Header';
import { Dashboard } from './components/Dashboard';
import { CharacterizationWizard } from './components/CharacterizationWizard';
import { FormulationSimulator } from './components/FormulationSimulator';
import { Glossary } from './components/Glossary';
import { IsoReportView } from './components/IsoReportView';
import { AlertCircle, RefreshCw } from 'lucide-react';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'wizard' | 'formulation' | 'glossary' | 'report'>('dashboard');
  const [bases, setBases] = useState<BasePaint[]>([]);
  const [pastes, setPastes] = useState<ColorantPaste[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Cross-component states
  const [simPaste, setSimPaste] = useState<ColorantPaste | null>(null);
  const [reportId, setReportId] = useState<number>(1);

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

  const handleOpenReport = (id: number) => {
    setReportId(id);
    setActiveTab('report');
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col font-sans selection:bg-zinc-800">
      {/* Top Header */}
      <Header activeTab={activeTab} setActiveTab={setActiveTab} />

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
          <div className="h-[60vh] flex flex-col items-center justify-center gap-3 text-zinc-500">
            <div className="w-6 h-6 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-xs font-mono text-zinc-400">TintMatch PRO motoru başlatılıyor...</p>
          </div>
        ) : (
          <>
            {activeTab === 'dashboard' && (
              <Dashboard
                bases={bases}
                pastes={pastes}
                onSelectPasteForSim={handleSelectPasteForSim}
                onOpenWizard={() => setActiveTab('wizard')}
                onOpenReport={handleOpenReport}
              />
            )}

            {activeTab === 'wizard' && (
              <CharacterizationWizard
                bases={bases}
                onComplete={() => {
                  loadData();
                  setActiveTab('dashboard');
                }}
              />
            )}

            {activeTab === 'formulation' && (
              <FormulationSimulator
                bases={bases}
                pastes={pastes}
                initialPaste={simPaste}
              />
            )}

            {activeTab === 'report' && (
              <IsoReportView initialCharId={reportId} />
            )}

            {activeTab === 'glossary' && <Glossary />}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800/80 bg-[#09090b] px-6 py-4 text-xs font-mono text-zinc-500 print:hidden">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>TintMatch PRO • Endüstriyel Spektrofotometrik Renklendirici Karakterizasyonu ve CCM</span>
          <span className="text-zinc-600">ISO 18314-1 / ISO 18314-2 • D65/10° • X-Rite RM400</span>
        </div>
      </footer>
    </div>
  );
};

export default App;
