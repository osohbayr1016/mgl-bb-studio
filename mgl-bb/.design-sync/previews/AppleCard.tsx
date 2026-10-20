import type { ReactNode } from 'react';
import { AppleCard, AppleCardHeader, AppleCardTitle, AppleCardContent, Badge, Button } from 'mgl-ui';

const Frame = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      background: 'hsl(var(--background))',
      color: 'hsl(var(--foreground))',
      padding: 24,
      borderRadius: 12,
      display: 'flex',
      flexWrap: 'wrap',
      gap: 16,
      alignItems: 'flex-start',
    }}
  >
    {children}
  </div>
);

export const ProjectSummary = () => (
  <Frame>
    <AppleCard style={{ maxWidth: 360 }}>
      <AppleCardHeader>
        <div>
          <AppleCardTitle>Согоот Residence</AppleCardTitle>
          <p style={{ fontSize: 13, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>
            Улаанбаатар · 3-р блок
          </p>
        </div>
        <Badge variant="secondary">Хийгдэж буй</Badge>
      </AppleCardHeader>
      <AppleCardContent>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 13,
              color: 'hsl(var(--muted-foreground))',
            }}
          >
            <span>Нийт гүйцэтгэл</span>
            <span style={{ fontWeight: 600, color: 'hsl(var(--foreground))' }}>72%</span>
          </div>
          <div
            style={{
              height: 6,
              borderRadius: 9999,
              background: 'hsl(var(--muted))',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: '72%',
                borderRadius: 9999,
                background: 'hsl(var(--primary))',
              }}
            />
          </div>
          <p style={{ fontSize: 13, color: 'hsl(var(--muted-foreground))' }}>
            Дараагийн шат: Цахилгаан угсралт болон дотор засал. Эцсийн хугацаа 2026/09.
          </p>
        </div>
      </AppleCardContent>
    </AppleCard>
  </Frame>
);

export const StatCard = () => (
  <Frame>
    <AppleCard style={{ maxWidth: 220 }}>
      <AppleCardHeader>
        <div>
          <AppleCardTitle>Идэвхтэй ажилчид</AppleCardTitle>
          <p style={{ fontSize: 13, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>
            Энэ сард
          </p>
        </div>
      </AppleCardHeader>
      <AppleCardContent>
        <p style={{ fontSize: 40, fontWeight: 700, lineHeight: 1 }}>47</p>
        <p style={{ fontSize: 13, color: 'hsl(var(--muted-foreground))', marginTop: 8 }}>
          Өнгөрсөн сараас +6
        </p>
      </AppleCardContent>
    </AppleCard>
    <AppleCard style={{ maxWidth: 220 }}>
      <AppleCardHeader>
        <div>
          <AppleCardTitle>Хүлээгдэж буй зөвшөөрөл</AppleCardTitle>
          <p style={{ fontSize: 13, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>
            Нийт хүсэлт
          </p>
        </div>
      </AppleCardHeader>
      <AppleCardContent>
        <p style={{ fontSize: 40, fontWeight: 700, lineHeight: 1 }}>12</p>
        <Button size="sm" variant="secondary" style={{ marginTop: 12 }}>
          Шалгах
        </Button>
      </AppleCardContent>
    </AppleCard>
  </Frame>
);
