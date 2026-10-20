import type { ReactNode } from 'react';
import { PolishableTextarea } from 'mgl-ui';

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
      fontSize: 14,
    }}
  >
    {children}
  </div>
);

export const WithContent = () => (
  <Frame>
    <PolishableTextarea
      value="Энэ обьектын ажил дуусч байна. засвар хийх шаардлагатаи хэсгүүдийг тодорхойлж  тайлагнасан болно."
      rows={3}
      style={{ maxWidth: 380 }}
      onChange={() => {}}
    />
  </Frame>
);

export const Disabled = () => (
  <Frame>
    <PolishableTextarea
      value="Идэвхгүй горимд байгаа текст. AI товч харагдахгүй."
      disabled
      aiPolish={false}
      rows={3}
      style={{ maxWidth: 380 }}
      onChange={() => {}}
    />
  </Frame>
);
