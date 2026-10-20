import type { ReactNode } from 'react';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Badge,
} from 'mgl-ui';

const Frame = ({ children }: { children: ReactNode }) => (
  <div style={{ background: 'hsl(var(--background))', padding: 24, borderRadius: 12, width: '100%' }}>
    {children}
  </div>
);

const projects = [
  { name: 'Согоот Residence', team: 'Архитектурын баг', progress: 72, status: 'active' },
  { name: 'Хан-Уул Оффис Төв', team: 'Бүтцийн баг', progress: 45, status: 'active' },
  { name: 'Налайх Сургууль', team: 'Иж бүрдэл баг', progress: 91, status: 'review' },
  { name: 'Баянзүрх Орон Сууц', team: 'Архитектурын баг', progress: 18, status: 'active' },
  { name: 'Сонгинохайрхан Захиргаа', team: 'Бүтцийн баг', progress: 100, status: 'done' },
];

const statusLabel: Record<string, string> = {
  active: 'Идэвхтэй',
  review: 'Хянагдаж байна',
  done: 'Дууссан',
};

const statusVariant: Record<string, 'default' | 'secondary' | 'outline'> = {
  active: 'default',
  review: 'secondary',
  done: 'outline',
};

export const ProjectTable = () => (
  <Frame>
    <div style={{ width: '100%' }}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Төсөл</TableHead>
            <TableHead>Баг</TableHead>
            <TableHead>Явц</TableHead>
            <TableHead>Төлөв</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {projects.map((p) => (
            <TableRow key={p.name}>
              <TableCell style={{ fontWeight: 500 }}>{p.name}</TableCell>
              <TableCell style={{ color: 'hsl(var(--muted-foreground))' }}>{p.team}</TableCell>
              <TableCell>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, height: 6, background: 'hsl(var(--muted))', borderRadius: 3, minWidth: 60 }}>
                    <div style={{ width: `${p.progress}%`, height: '100%', background: 'hsl(var(--primary))', borderRadius: 3 }} />
                  </div>
                  <span style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', minWidth: 30 }}>{p.progress}%</span>
                </div>
              </TableCell>
              <TableCell>
                <Badge variant={statusVariant[p.status]}>{statusLabel[p.status]}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  </Frame>
);
