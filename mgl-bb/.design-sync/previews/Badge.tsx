import type { ReactNode } from 'react';
import { Badge } from 'mgl-ui';

const Frame = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      background: 'hsl(var(--background))',
      color: 'hsl(var(--foreground))',
      padding: 24,
      borderRadius: 12,
      display: 'flex',
      flexWrap: 'wrap',
      gap: 8,
      alignItems: 'center',
      minHeight: 72,
    }}
  >
    {children}
  </div>
);

export const Variants = () => (
  <Frame>
    <Badge variant="default">Дууссан</Badge>
    <Badge variant="secondary">Хийгдэж буй</Badge>
    <Badge variant="destructive">Цуцлагдсан</Badge>
    <Badge variant="outline">Хүлээгдэж буй</Badge>
  </Frame>
);

export const StatusLabels = () => (
  <Frame>
    <Badge variant="default">Баталгаажсан</Badge>
    <Badge variant="secondary">Шалгагдаж байна</Badge>
    <Badge variant="outline">Төлөвлөсөн</Badge>
    <Badge variant="destructive">Хугацаа хэтэрсэн</Badge>
    <Badge variant="ghost">Архивласан</Badge>
  </Frame>
);
