import type { ReactNode } from 'react';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from 'mgl-ui';
import type { ChartConfig } from 'mgl-ui';
import { Bar, BarChart, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts';

const Frame = ({ children }: { children: ReactNode }) => (
  <div style={{ background: 'hsl(var(--background))', padding: 24, borderRadius: 12, width: '100%' }}>
    {children}
  </div>
);

const data = [
  { month: '1-р', progress: 12 },
  { month: '2-р', progress: 28 },
  { month: '3-р', progress: 41 },
  { month: '4-р', progress: 55 },
  { month: '5-р', progress: 68 },
  { month: '6-р', progress: 72 },
];

const chartConfig: ChartConfig = {
  progress: {
    label: 'Явц (%)',
    color: '#3b82f6',
  },
};

export const MonthlyProgress = () => (
  <Frame>
    <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'hsl(var(--muted-foreground))', marginBottom: 12 }}>
      Согоот Residence · Сарын гүйцэтгэл
    </p>
    {/* Use a fixed-height div so ResponsiveContainer can measure */}
    <div style={{ width: '100%', height: 200 }}>
      <ChartContainer config={chartConfig} style={{ height: '100%', width: '100%' }} initialDimension={{ width: 520, height: 200 }}>
        <BarChart data={data} width={500} height={190} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
          <CartesianGrid vertical={false} strokeOpacity={0.3} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'hsl(215 20% 65%)' }} />
          <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'hsl(215 20% 65%)' }} domain={[0, 100]} unit="%" width={32} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="progress" fill="#3b82f6" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartContainer>
    </div>
  </Frame>
);
