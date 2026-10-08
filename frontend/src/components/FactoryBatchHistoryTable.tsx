import React, { useState, useEffect } from 'react';
import {
  History,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  RefreshCw,
  Scale,
  Search,
  FlaskConical,
  Award
} from 'lucide-react';
import type { FactoryBatchRecord } from '../types';
import { fetchFactoryBatches } from '../services/api';

interface FactoryBatchHistoryTableProps {
  onRefreshTrigger?: number;
}

export const FactoryBatchHistoryTable: React.FC<FactoryBatchHistoryTableProps> = ({
  onRefreshTrigger,
}) => {
  const [batches, setBatches] = useState<FactoryBatchRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState<string>('');

  const loadBatches = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchFactoryBatches(30);
      setBatches(data);
    } catch (err: any) {
      setError(err.message || 'Parti geçmişi yüklenemedi');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadBatches();
  }, [onRefreshTrigger]);

  const filtered = batches.filter(
    (b) =>
      b.recipe_name.toLowerCase().includes(filterQuery.toLowerCase()) ||
      b.base_name.toLowerCase().includes(filterQuery.toLowerCase()) ||
      b.base_code.toLowerCase().includes(filterQuery.toLowerCase())
  );

  return (
    <div className="bg-[var(--surface-3)] border border-[var(--border)] rounded-[var(--radius-lg)] p-5 space-y-4 shadow-[var(--shadow-sm)] mt-5 transition-colors">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-[var(--radius)] bg-[var(--brand-clay)]/10 text-[var(--brand-clay)]">
            <History className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wider font-mono">
                Fabrika Parti Üretim ve Kalite Arşivi (Batch History & QA Audit)
              </h3>
              <span className="px-1.5 py-0.5 rounded-[var(--radius-xs)] text-[10px] font-mono bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 font-bold">
                {batches.length} Kayıt
              </span>
            </div>
            <p className="text-[11px] text-[var(--text-secondary)]">
              Üretim tartımları, CHNSpec DS-36D drawdown ölçümleri, Golden Batch onayları ve tank add-back kayıtları
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-2 text-[var(--text-muted)]" />
            <input
              type="text"
              placeholder="Parti ara..."
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              className="w-48 pl-8 pr-2.5 py-1.5 bg-[var(--surface-0)] border border-[var(--border)] rounded text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-clay)]"
            />
          </div>

          <button
            onClick={loadBatches}
            className="p-1.5 bg-[var(--surface-0)] hover:bg-[var(--surface-1)] border border-[var(--border)] rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
            title="Geçmişi Yenile"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs rounded">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]">
        <table className="w-full text-left text-xs font-mono">
          <thead className="bg-[var(--surface-1)] text-[var(--text-secondary)] text-[10px] uppercase border-b border-[var(--border)]">
            <tr>
              <th className="p-2.5">Zaman / Tarih</th>
              <th className="p-2.5">Reçete / Hedef</th>
              <th className="p-2.5">Taşıyıcı Baz</th>
              <th className="p-2.5 text-right">Parti Boyutu</th>
              <th className="p-2.5 text-center">Deneme #</th>
              <th className="p-2.5 text-center">Ölçülen ΔE00</th>
              <th className="p-2.5 text-center">Kalite Kararı</th>
              <th className="p-2.5">Operatör Notu</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {isLoading ? (
              <tr>
                <td colSpan={8} className="p-6 text-center text-[var(--text-muted)]">
                  Parti geçmişi yükleniyor...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-6 text-center text-[var(--text-muted)] italic">
                  Henüz kaydedilmiş üretim partisi bulunmuyor. Reçete ekranından "Drawdown Doğrula" ile ilk partinizi kaydedebilirsiniz.
                </td>
              </tr>
            ) : (
              filtered.map((b) => {
                let badge = null;
                if (b.outcome === 'ACCEPTED') {
                  badge = (
                    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 font-bold">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Kabul (Golden)</span>
                    </span>
                  );
                } else if (b.outcome === 'ADDBACK_REQUIRED') {
                  badge = (
                    <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 font-bold">
                      <AlertTriangle className="w-3 h-3" />
                      <span>İlave Gerekli</span>
                    </span>
                  );
                } else if (b.outcome === 'REJECTED') {
                  badge = (
                    <span className="inline-flex items-center gap-1 text-[10px] text-rose-600 dark:text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20 font-bold">
                      <XCircle className="w-3 h-3" />
                      <span>Reddedildi</span>
                    </span>
                  );
                } else {
                  badge = (
                    <span className="inline-flex items-center gap-1 text-[10px] text-[var(--text-muted)] bg-[var(--surface-0)] px-2 py-0.5 rounded border border-[var(--border)]">
                      <Clock className="w-3 h-3" />
                      <span>Ölçüm Bekliyor</span>
                    </span>
                  );
                }

                const dateDisplay = b.created_at
                  ? new Date(b.created_at).toLocaleDateString('tr-TR', {
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : '--';

                return (
                  <tr key={b.id} className="hover:bg-[var(--surface-0)]/50 transition-colors">
                    <td className="p-2.5 text-[var(--text-muted)] whitespace-nowrap">{dateDisplay}</td>
                    <td className="p-2.5 font-bold text-[var(--text-primary)]">{b.recipe_name}</td>
                    <td className="p-2.5 text-[var(--text-secondary)]">
                      {b.base_name} <span className="text-[10px] text-[var(--text-muted)] font-mono">({b.base_code})</span>
                    </td>
                    <td className="p-2.5 text-right font-semibold text-[var(--brand-clay)]">
                      {b.batch_size_g >= 1000
                        ? `${(b.batch_size_g / 1000).toFixed(1)} kg`
                        : `${b.batch_size_g.toFixed(0)} g`}
                    </td>
                    <td className="p-2.5 text-center font-bold text-[var(--text-primary)]">
                      #{b.attempt_number}
                    </td>
                    <td className="p-2.5 text-center">
                      {b.de00_predicted_vs_measured !== undefined && b.de00_predicted_vs_measured !== null ? (
                        <span
                          className={`font-black ${
                            b.de00_predicted_vs_measured <= 0.4
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : b.de00_predicted_vs_measured <= 1.5
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {b.de00_predicted_vs_measured.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-[var(--text-muted)]">--</span>
                      )}
                    </td>
                    <td className="p-2.5 text-center">{badge}</td>
                    <td className="p-2.5 text-[var(--text-secondary)] text-[11px] truncate max-w-xs font-sans">
                      {b.operator_notes || '--'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
