import type { ReactNode } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent, Badge, Button } from 'mgl-ui';

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

export const ProjectDetail = () => (
  <Frame>
    <Tabs defaultValue="progress">
      <TabsList>
        <TabsTrigger value="progress">Явц</TabsTrigger>
        <TabsTrigger value="docs">Баримт</TabsTrigger>
        <TabsTrigger value="team">Баг</TabsTrigger>
      </TabsList>

      <TabsContent value="progress">
        <div style={{ padding: '16px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 13, color: 'hsl(var(--muted-foreground))' }}>Блок бүрийн явц</p>
          {[
            { name: 'Блок А · Архитектур', pct: 78 },
            { name: 'Блок Б · Бүтэц', pct: 91 },
            { name: 'Блок В · Инженер', pct: 55 },
          ].map(({ name, pct }) => (
            <div key={name}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                <span>{name}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{pct}%</span>
              </div>
              <div style={{ height: 6, background: 'hsl(var(--muted))', borderRadius: 99 }}>
                <div style={{ width: `${pct}%`, height: '100%', background: 'hsl(var(--primary))', borderRadius: 99 }} />
              </div>
            </div>
          ))}
        </div>
      </TabsContent>

      <TabsContent value="docs">
        <div style={{ padding: '16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {['Архитектурын зураг — v4.pdf', 'Бүтцийн зураг — v2.pdf', 'Инженерийн зураг — v1.pdf'].map((f) => (
            <div key={f} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'hsl(var(--muted))', borderRadius: 8, fontSize: 13 }}>
              <span>{f}</span>
              <Button size="sm" variant="ghost">Татах</Button>
            </div>
          ))}
        </div>
      </TabsContent>

      <TabsContent value="team">
        <div style={{ padding: '16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { name: 'Б. Анандэрдэнэ', role: 'Ахлах архитектор' },
            { name: 'Д. Мөнхцэцэг', role: 'Архитектор' },
            { name: 'Г. Болд', role: 'Инженер' },
          ].map(({ name, role }) => (
            <div key={name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
              <span>{name}</span>
              <span style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))' }}>{role}</span>
            </div>
          ))}
        </div>
      </TabsContent>
    </Tabs>
  </Frame>
);

export const LineVariant = () => (
  <Frame>
    <Tabs defaultValue="pending">
      <TabsList variant="line">
        <TabsTrigger value="pending">Хүлээгдэж буй</TabsTrigger>
        <TabsTrigger value="approved">Батлагдсан</TabsTrigger>
        <TabsTrigger value="rejected">Татгалзсан</TabsTrigger>
      </TabsList>
      <TabsContent value="pending">
        <div style={{ padding: '14px 0', fontSize: 13, color: 'hsl(var(--muted-foreground))' }}>
          3 орчим хүлээгдэж буй оруулга байна.
        </div>
      </TabsContent>
      <TabsContent value="approved">
        <div style={{ padding: '14px 0', fontSize: 13, color: 'hsl(var(--muted-foreground))' }}>
          28 батлагдсан оруулга.
        </div>
      </TabsContent>
      <TabsContent value="rejected">
        <div style={{ padding: '14px 0', fontSize: 13, color: 'hsl(var(--muted-foreground))' }}>
          2 татгалзсан оруулга.
        </div>
      </TabsContent>
    </Tabs>
  </Frame>
);
