import { Scatter } from 'recharts';

import { BENCHMARK_DASH, useSeriesColors } from '../lib/chartSeries';
import type { SideKey } from '../lib/scatterSeriesHighlight';
import { seriesStrokeWidth, seriesVisualOpacity } from '../lib/scatterSeriesHighlight';

interface Point {
  x: number;
  y: number;
}

interface SeriesProps {
  side: SideKey;
  name: string;
  data: Point[];
  hovered: SideKey | null;
  onHover: (side: SideKey | null) => void;
}

export function VisibleScatterSeries({ side, name, data, hovered }: SeriesProps) {
  const color = useSeriesColors()[side];
  const opacity = seriesVisualOpacity(side, hovered);
  const width = seriesStrokeWidth(side, hovered);
  const dash = side === 'benchmark' ? BENCHMARK_DASH : undefined;

  return (
    <Scatter
      name={name}
      data={data}
      fill={color}
      fillOpacity={opacity}
      shape="circle"
      line={{
        stroke: color,
        strokeWidth: width,
        strokeOpacity: opacity,
        strokeDasharray: dash,
      }}
      lineType="joint"
      isAnimationActive={false}
    />
  );
}

/** Бүх visible дээр байрлуулна — өргөн ил тод шугам + том цэг hitbox. */
export function HitScatterSeries({
  side,
  data,
  onHover,
}: {
  side: SideKey;
  data: Point[];
  onHover: (side: SideKey | null) => void;
}) {
  return (
    <Scatter
      data={data}
      fill="transparent"
      shape={(props) => {
        const cx = props.cx;
        const cy = props.cy;
        if (cx == null || cy == null) return <g />;
        return (
          <circle
            cx={cx}
            cy={cy}
            r={12}
            fill="rgba(0,0,0,0.001)"
            onMouseEnter={() => onHover(side)}
            onMouseLeave={() => onHover(null)}
          />
        );
      }}
      line={{
        stroke: 'rgba(0,0,0,0.001)',
        strokeWidth: 22,
      }}
      lineType="joint"
      isAnimationActive={false}
      legendType="none"
      tooltipType="none"
    />
  );
}
