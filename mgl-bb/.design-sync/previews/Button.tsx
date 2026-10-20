import type { ReactNode } from 'react';
import { Button } from 'mgl-ui';

// MGL's operational UI is dark by default (:root carries the dark token set),
// so previews render on the app's own dark surface for fidelity.
const Frame = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      background: 'hsl(var(--background))',
      color: 'hsl(var(--foreground))',
      padding: 24,
      borderRadius: 12,
      display: 'flex',
      flexWrap: 'wrap',
      gap: 12,
      alignItems: 'center',
      minHeight: 72,
    }}
  >
    {children}
  </div>
);

export const Variants = () => (
  <Frame>
    <Button>Хадгалах</Button>
    <Button variant="secondary">Цуцлах</Button>
    <Button variant="outline">Дэлгэрэнгүй</Button>
    <Button variant="ghost">Болих</Button>
    <Button variant="destructive">Устгах</Button>
    <Button variant="link">Холбоос</Button>
  </Frame>
);

export const Sizes = () => (
  <Frame>
    <Button size="sm">Жижиг</Button>
    <Button size="default">Энгийн</Button>
    <Button size="lg">Том товч</Button>
  </Frame>
);

export const Disabled = () => (
  <Frame>
    <Button disabled>Идэвхгүй</Button>
    <Button variant="secondary" disabled>
      Идэвхгүй
    </Button>
  </Frame>
);
