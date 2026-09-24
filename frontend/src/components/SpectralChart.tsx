import React, { useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';

interface SpectralSeries {
  id: string;
  name: string;
  color: string;
  data: number[];
  strokeWidth?: number;
  strokeDasharray?: string;
}

interface SpectralChartProps {
  series: SpectralSeries[];
  title?: string;
  subtitle?: string;
  height?: number;
}

export const SpectralChart: React.FC<SpectralChartProps> = ({
  series,
  title = "400 - 700 nm Spektral Analiz",
  subtitle = "10 nm Çözünürlüklü X-Rite RM400 Yansıma ve K/S Eğrileri",
  height = 340,
}) => {
  const [viewMode, setViewMode] = useState<'reflectance' | 'ks'>('reflectance');

  const wavelengths = Array.from({ length: 31 }, (_, i) => 400 + i * 10);

  const chartData = wavelengths.map((wl, idx) => {
    const point: Record<string, any> = { wavelength: `${wl}`, wlNum: wl };
    series.forEach((s) => {
      const val = s.data && s.data[idx] !== undefined ? s.data[idx] : 0;
      if (viewMode === 'reflectance') {
        point[s.id] = parseFloat((val > 1.5 ? val : val * 100).toFixed(2));
      } else {
        const r_safe = Math.max(0.001, Math.min(0.999, val > 1.5 ? val / 100 : val));
        const ks = Math.pow(1 - r_safe, 2) / (2 * r_safe);
        point[s.id] = parseFloat(ks.toFixed(4));
      }
    });
    return point;
  });

  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-5 shadow-sm">
      {/* Chart Header */}
      <div className="flex items-center justify-between gap-4 mb-5">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 font-mono">
            {title}
          </h3>
          <p className="text-[11px] text-zinc-500 mt-0.5">{subtitle}</p>
        </div>

        {/* Minimal segmented toggle */}
        <div className="flex items-center bg-zinc-950 p-1 rounded-md border border-zinc-800 text-[11px] font-mono">
          <button
            onClick={() => setViewMode('reflectance')}
            className={`px-2.5 py-1 rounded transition-colors ${
              viewMode === 'reflectance'
                ? 'bg-zinc-800 text-zinc-100 font-medium'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            R% (Yansıma)
          </button>
          <button
            onClick={() => setViewMode('ks')}
            className={`px-2.5 py-1 rounded transition-colors ${
              viewMode === 'ks'
                ? 'bg-zinc-800 text-zinc-100 font-medium'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            K/S
          </button>
        </div>
      </div>

      {/* Chart Canvas */}
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: -15, bottom: 5 }}>
            <CartesianGrid strokeDasharray="2 2" stroke="#27272a" vertical={false} />
            <XAxis
              dataKey="wavelength"
              stroke="#52525b"
              fontSize={10}
              tickLine={false}
              interval={2}
              dy={5}
            />
            <YAxis
              stroke="#52525b"
              fontSize={10}
              tickLine={false}
              domain={viewMode === 'reflectance' ? [0, 100] : ['auto', 'auto']}
              unit={viewMode === 'reflectance' ? '%' : ''}
              dx={-5}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#18181b',
                borderColor: '#27272a',
                borderRadius: '6px',
                fontSize: '11px',
                color: '#f4f4f5',
                padding: '8px 12px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
              }}
              formatter={(val: any, name: any) => [
                viewMode === 'reflectance' ? `${val}%` : val,
                series.find((s) => s.id === name)?.name || String(name || ''),
              ]}
              labelFormatter={(label) => `${label} nm`}
            />
            <Legend
              verticalAlign="bottom"
              height={30}
              iconType="plainline"
              wrapperStyle={{ paddingTop: '8px', fontSize: '11px', color: '#a1a1aa' }}
              formatter={(value) => {
                const s = series.find((item) => item.id === value);
                return s ? s.name : value;
              }}
            />
            {series.map((s) => (
              <Line
                key={s.id}
                type="monotone"
                dataKey={s.id}
                name={s.id}
                stroke={s.color}
                strokeWidth={s.strokeWidth || 1.8}
                strokeDasharray={s.strokeDasharray}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 1 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Wavelength Spectrum Bar */}
      <div className="mt-3 pt-3 border-t border-zinc-800/60 flex items-center justify-between text-[10px] text-zinc-500 font-mono">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
            400-440 nm
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
            450-490 nm
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            500-560 nm
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            570-590 nm
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
            600-700 nm
          </span>
        </div>
        <span>31 Kanal (10 nm)</span>
      </div>
    </div>
  );
};
