import type { ReactNode } from 'react';
import { KeepAliveTabs, KeepAliveTabsPanel, TabsList, TabsTrigger } from 'mgl-ui';

const Frame = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      background: 'hsl(var(--background))',
      color: 'hsl(var(--foreground))',
      padding: 24,
      borderRadius: 12,
      minWidth: 480,
    }}
  >
    {children}
  </div>
);

export const ProjectTabs = () => (
  <Frame>
    <KeepAliveTabs defaultValue="overview">
      <TabsList>
        <TabsTrigger value="overview">Тоймлол</TabsTrigger>
        <TabsTrigger value="qto">Тоо хэмжээ</TabsTrigger>
        <TabsTrigger value="photos">Зураг</TabsTrigger>
      </TabsList>

      <KeepAliveTabsPanel value="overview">
        <div style={{ padding: '16px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 16 }}>
            {[
              { label: 'Нийт гүйцэтгэл', val: '72%' },
              { label: 'Үлдсэн хоног', val: '89' },
              { label: 'Идэвхтэй даалгавар', val: '14' },
            ].map(({ label, val }) => (
              <div key={label} style={{ flex: 1, padding: '12px 14px', background: 'hsl(var(--card))', borderRadius: 8, border: '1px solid hsl(var(--border))' }}>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{val}</div>
                <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      </KeepAliveTabsPanel>

      <KeepAliveTabsPanel value="qto">
        <div style={{ padding: '16px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'hsl(var(--muted-foreground))', marginBottom: 4 }}>IFC тоо хэмжээ</p>
          {[
            { item: 'Хана', qty: '1 248 м²' },
            { item: 'Шал', qty: '640 м²' },
            { item: 'Таазны хавтан', qty: '640 м²' },
            { item: 'Цонх', qty: '128 ширхэг' },
          ].map(({ item, qty }) => (
            <div key={item} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 0', borderBottom: '1px solid hsl(var(--border))' }}>
              <span>{item}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{qty}</span>
            </div>
          ))}
        </div>
      </KeepAliveTabsPanel>

      <KeepAliveTabsPanel value="photos">
        <div style={{ padding: '16px 0', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              style={{
                aspectRatio: '4/3',
                background: `hsl(var(--muted))`,
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                color: 'hsl(var(--muted-foreground))',
              }}
            >
              Зураг {i + 1}
            </div>
          ))}
        </div>
      </KeepAliveTabsPanel>
    </KeepAliveTabs>
  </Frame>
);
