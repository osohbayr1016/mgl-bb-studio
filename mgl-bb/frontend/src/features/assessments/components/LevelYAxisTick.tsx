interface LevelYAxisTickProps {
  x?: number;
  y?: number;
  payload?: { value?: number };
  ticks: { value: number; label: string }[];
}

/** Scatter Y тэнхлэг — хувь биш, level нэр (Intern, Junior, …). */
export function LevelYAxisTick({ x = 0, y = 0, payload, ticks }: LevelYAxisTickProps) {
  const value = Number(payload?.value);
  const tick = ticks.find((t) => Math.abs(t.value - value) < 0.01);
  if (!tick) return null;
  return (
    <text x={x} y={y} dy="0.32em" textAnchor="end" fontSize={10} fill="currentColor">
      {tick.label}
    </text>
  );
}
