import type { ReactNode } from 'react';
import { Checkbox } from 'mgl-ui';

const Frame = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      background: 'hsl(var(--background))',
      color: 'hsl(var(--foreground))',
      padding: 24,
      borderRadius: 12,
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      fontSize: 14,
    }}
  >
    {children}
  </div>
);

const Row = ({ children }: { children: ReactNode }) => (
  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>{children}</label>
);

export const States = () => (
  <Frame>
    <Row>
      <Checkbox /> Зөвшөөрөөгүй
    </Row>
    <Row>
      <Checkbox checked /> Зөвшөөрсөн
    </Row>
    <Row>
      <Checkbox checked="indeterminate" /> Хэсэгчилсэн
    </Row>
    <Row>
      <Checkbox disabled /> Идэвхгүй
    </Row>
    <Row>
      <Checkbox checked disabled /> Идэвхгүй (сонгосон)
    </Row>
  </Frame>
);
