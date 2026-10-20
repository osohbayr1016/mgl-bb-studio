import type { ReactNode } from 'react';
import { Progress } from 'mgl-ui';

const Frame = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      background: 'hsl(var(--background))',
      color: 'hsl(var(--foreground))',
      padding: 24,
      borderRadius: 12,
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      fontSize: 13,
    }}
  >
    {children}
  </div>
);

const Row = ({ label, value }: { label: string; value: number }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'hsl(var(--muted-foreground))' }}>
      <span>{label}</span>
      <span>{value}%</span>
    </div>
    <Progress value={value} style={{ width: 280 }} />
  </div>
);

export const Bars = () => (
  <Frame>
    <Row label="Суурь ажил" value={25} />
    <Row label="Барилгын бүтэц" value={60} />
    <Row label="Дотоод засал" value={100} />
  </Frame>
);
