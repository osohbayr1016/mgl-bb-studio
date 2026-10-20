import type { ReactNode } from 'react';
import { Label, Input, Checkbox } from 'mgl-ui';

const Frame = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      background: 'hsl(var(--background))',
      color: 'hsl(var(--foreground))',
      padding: 24,
      borderRadius: 12,
      display: 'flex',
      flexDirection: 'column',
      gap: 20,
      minHeight: 72,
    }}
  >
    {children}
  </div>
);

export const WithInput = () => (
  <Frame>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 320 }}>
      <Label htmlFor="project-name">Төслийн нэр</Label>
      <Input id="project-name" placeholder="Согоот Residence" />
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 320 }}>
      <Label htmlFor="engineer-name">Инженерийн нэр</Label>
      <Input id="engineer-name" placeholder="Баярсайхан Д." />
    </div>
  </Frame>
);

export const WithCheckbox = () => (
  <Frame>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Checkbox id="terms" />
      <Label htmlFor="terms">Үйлчилгээний нөхцөлийг зөвшөөрөх</Label>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Checkbox id="notify" defaultChecked />
      <Label htmlFor="notify">Мэдэгдэл авах</Label>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Checkbox id="disabled-check" disabled />
      <Label htmlFor="disabled-check">Идэвхгүй сонголт</Label>
    </div>
  </Frame>
);
