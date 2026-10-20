import type { ReactNode } from 'react';
import { Separator } from 'mgl-ui';

const Frame = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      background: 'hsl(var(--background))',
      color: 'hsl(var(--foreground))',
      padding: 24,
      borderRadius: 12,
      minHeight: 72,
    }}
  >
    {children}
  </div>
);

export const Horizontal = () => (
  <Frame>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 380 }}>
      <div>
        <p style={{ fontSize: 14, fontWeight: 600 }}>Барилгын явц</p>
        <p style={{ fontSize: 13, color: 'hsl(var(--muted-foreground))' }}>
          3-р блок · Дотор засал
        </p>
      </div>
      <Separator />
      <div>
        <p style={{ fontSize: 14, fontWeight: 600 }}>Баг</p>
        <p style={{ fontSize: 13, color: 'hsl(var(--muted-foreground))' }}>
          Архитектор, Инженер, Дизайнер
        </p>
      </div>
      <Separator />
      <div>
        <p style={{ fontSize: 14, fontWeight: 600 }}>Хугацаа</p>
        <p style={{ fontSize: 13, color: 'hsl(var(--muted-foreground))' }}>
          2026 оны 9-р сар хүртэл
        </p>
      </div>
    </div>
  </Frame>
);

export const Vertical = () => (
  <Frame>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: 24 }}>
      <span style={{ fontSize: 14, color: 'hsl(var(--foreground))' }}>Засвар</span>
      <Separator orientation="vertical" />
      <span style={{ fontSize: 14, color: 'hsl(var(--foreground))' }}>Үзэх</span>
      <Separator orientation="vertical" />
      <span style={{ fontSize: 14, color: 'hsl(var(--destructive))' }}>Устгах</span>
    </div>
  </Frame>
);
