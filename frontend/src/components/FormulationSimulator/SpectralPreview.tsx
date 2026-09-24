import React from 'react';
import type { RecipeSimulation } from '../../types';
import { SpectralChart } from '../SpectralChart';

interface SpectralPreviewProps {
  simulation: RecipeSimulation | null;
  targetReflectance: number[] | null;
  targetHex: string;
}

export const SpectralPreview: React.FC<SpectralPreviewProps> = ({
  simulation,
  targetReflectance,
  targetHex,
}) => {
  const chartSeries = [];

  if (simulation && simulation.reflectance) {
    chartSeries.push({
      id: 'predicted-recipe',
      name: 'Reçete Spektrumu (Composite)',
      color: simulation.hex || '#38bdf8',
      data: simulation.reflectance,
      strokeWidth: 2.2,
    });
  }

  if (targetReflectance) {
    chartSeries.push({
      id: 'target-ref',
      name: 'Hedef Standart',
      color: targetHex || '#f43f5e',
      data: targetReflectance,
      strokeWidth: 1.6,
      strokeDasharray: '3 3',
    });
  }

  return (
    <SpectralChart
      series={chartSeries}
      title="Reçete Spektral Tahmini (400 - 700 nm)"
      subtitle="Kubelka-Munk Çift Sabitli Model • Anlık Yansıma"
      height={340}
    />
  );
};
