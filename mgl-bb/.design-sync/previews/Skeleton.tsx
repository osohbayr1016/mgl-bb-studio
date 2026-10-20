import type { ReactNode } from 'react';
import { Skeleton } from 'mgl-ui';

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

export const CardLoading = () => (
  <Frame>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 320 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Skeleton style={{ width: 40, height: 40, borderRadius: '50%' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
          <Skeleton style={{ height: 14, width: '60%' }} />
          <Skeleton style={{ height: 12, width: '40%' }} />
        </div>
      </div>
      <Skeleton style={{ height: 12, width: '100%' }} />
      <Skeleton style={{ height: 12, width: '85%' }} />
      <Skeleton style={{ height: 12, width: '70%' }} />
    </div>
  </Frame>
);

export const ListLoading = () => (
  <Frame>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 380 }}>
      {[1, 2, 3].map((i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Skeleton style={{ width: 32, height: 32, borderRadius: '50%' }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <Skeleton style={{ height: 13, width: `${70 - i * 10}%` }} />
            <Skeleton style={{ height: 11, width: `${50 - i * 5}%` }} />
          </div>
          <Skeleton style={{ height: 20, width: 60, borderRadius: 9999 }} />
        </div>
      ))}
    </div>
  </Frame>
);
