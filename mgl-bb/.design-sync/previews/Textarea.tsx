import type { ReactNode } from 'react';
import { Textarea } from 'mgl-ui';

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

export const Empty = () => (
  <Frame>
    <Textarea
      placeholder="Тайлбар оруулна уу…"
      rows={3}
      style={{ maxWidth: 360 }}
    />
  </Frame>
);

export const Filled = () => (
  <Frame>
    <Textarea
      defaultValue={`Энэхүү төслийн хүрээнд Улаанбаатар хотын төвийн дэд бүтцийн шинэчлэл хийгдэх бөгөөд нийт 12 барилгын засвар үйлчилгээ хийгдэнэ.

Ажлын хугацаа: 2025 оны 3–9 дүгээр сар.`}
      rows={5}
      style={{ maxWidth: 360 }}
    />
  </Frame>
);
