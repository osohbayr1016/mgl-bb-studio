import type { ReactNode } from 'react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
  Button,
} from 'mgl-ui';

const Frame = ({ children }: { children: ReactNode }) => (
  <div style={{ background: 'hsl(var(--background))', padding: 24, borderRadius: 12 }}>{children}</div>
);

export const ProjectCard = () => (
  <Frame>
    <Card style={{ maxWidth: 380 }}>
      <CardHeader>
        <CardTitle>Согоот Residence</CardTitle>
        <CardDescription>Барилгын явц · 3-р блок</CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm">
            Засах
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p style={{ fontSize: 14, lineHeight: 1.5 }}>
          Нийт гүйцэтгэл 72%-д хүрсэн. Дараагийн шатанд цахилгаан угсралт болон дотор
          заслын ажил эхэлнэ. Эцсийн хугацаа: 2026 оны 9-р сар.
        </p>
      </CardContent>
      <CardFooter style={{ gap: 8 }}>
        <Button size="sm">Тайлан үзэх</Button>
        <Button size="sm" variant="outline">
          Хуваалцах
        </Button>
      </CardFooter>
    </Card>
  </Frame>
);

export const Stat = () => (
  <Frame>
    <Card style={{ maxWidth: 240 }}>
      <CardHeader>
        <CardDescription>Идэвхтэй төсөл</CardDescription>
        <CardTitle style={{ fontSize: 32 }}>14</CardTitle>
      </CardHeader>
      <CardContent>
        <p style={{ fontSize: 13, color: 'hsl(var(--muted-foreground))' }}>Өнгөрсөн сараас +3</p>
      </CardContent>
    </Card>
  </Frame>
);
