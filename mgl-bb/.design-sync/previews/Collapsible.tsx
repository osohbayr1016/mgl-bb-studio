import type { ReactNode } from 'react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent, Button } from 'mgl-ui';

const Frame = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      background: 'hsl(var(--background))',
      color: 'hsl(var(--foreground))',
      padding: 24,
      borderRadius: 12,
      maxWidth: 480,
    }}
  >
    {children}
  </div>
);

const Row = ({ label, value }: { label: string; value: string }) => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'space-between',
      padding: '8px 0',
      borderBottom: '1px solid hsl(var(--border))',
      fontSize: 13,
    }}
  >
    <span style={{ color: 'hsl(var(--muted-foreground))' }}>{label}</span>
    <span>{value}</span>
  </div>
);

export const TeamMembers = () => (
  <Frame>
    <Collapsible defaultOpen>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <p style={{ fontWeight: 600, fontSize: 14 }}>Архитектурын баг · 5 гишүүн</p>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm">Нуух</Button>
        </CollapsibleTrigger>
      </div>
      <Row label="Б. Анандэрдэнэ" value="Ахлах архитектор" />
      <CollapsibleContent>
        <Row label="Д. Мөнхцэцэг" value="Архитектор" />
        <Row label="Г. Болд" value="Архитектор" />
        <Row label="Н. Сарнай" value="Туслах" />
        <Row label="Э. Батбаяр" value="Дадлагажигч" />
      </CollapsibleContent>
    </Collapsible>
  </Frame>
);

export const ProgressDetails = () => (
  <Frame>
    <Collapsible defaultOpen>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <p style={{ fontWeight: 600, fontSize: 14 }}>Гүйцэтгэлийн дэлгэрэнгүй</p>
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm">▲ Хаах</Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[
            { label: 'Суурь', pct: 100 },
            { label: 'Хүрээ', pct: 85 },
            { label: 'Фасад', pct: 60 },
            { label: 'Дотор засал', pct: 20 },
          ].map(({ label, pct }) => (
            <div key={label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                <span>{label}</span>
                <span style={{ color: 'hsl(var(--muted-foreground))' }}>{pct}%</span>
              </div>
              <div style={{ height: 4, background: 'hsl(var(--muted))', borderRadius: 99 }}>
                <div style={{ width: `${pct}%`, height: '100%', background: 'hsl(var(--primary))', borderRadius: 99 }} />
              </div>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  </Frame>
);
