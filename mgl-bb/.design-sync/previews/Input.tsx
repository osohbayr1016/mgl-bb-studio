import type { ReactNode } from 'react';
import { Input, Label } from 'mgl-ui';

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

export const States = () => (
  <Frame>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Label htmlFor="input-default">Төслийн нэр</Label>
      <Input id="input-default" placeholder="Төслийн нэр оруулна уу" style={{ maxWidth: 320 }} />
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Label htmlFor="input-filled">Утгатай</Label>
      <Input id="input-filled" defaultValue="Улаанбаатар хотын дэд бүтэц" style={{ maxWidth: 320 }} />
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Label htmlFor="input-disabled">Идэвхгүй</Label>
      <Input id="input-disabled" placeholder="Боломжгүй талбар" disabled style={{ maxWidth: 320 }} />
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Label htmlFor="input-error">Алдаатай</Label>
      <Input
        id="input-error"
        defaultValue="буруу@"
        aria-invalid
        style={{ maxWidth: 320 }}
      />
    </div>
  </Frame>
);
