import type { ReactNode } from 'react';
import { ResponsiveTable, Badge } from 'mgl-ui';
import type { ResponsiveColumn } from 'mgl-ui';

const Frame = ({ children }: { children: ReactNode }) => (
  <div style={{ background: 'hsl(var(--background))', padding: 24, borderRadius: 12, width: '100%' }}>
    {children}
  </div>
);

type AttendanceRow = {
  id: string;
  name: string;
  role: string;
  checkIn: string;
  checkOut: string;
  status: 'present' | 'late' | 'absent';
};

const rows: AttendanceRow[] = [
  { id: '1', name: 'Б. Дорждагва', role: 'Ахлах инженер', checkIn: '08:02', checkOut: '17:15', status: 'present' },
  { id: '2', name: 'О. Мөнхбаяр', role: 'Архитектор', checkIn: '08:45', checkOut: '17:00', status: 'late' },
  { id: '3', name: 'Д. Энхтуяа', role: 'Инженер', checkIn: '08:00', checkOut: '17:30', status: 'present' },
  { id: '4', name: 'Г. Батболд', role: 'Ахлах архитектор', checkIn: '—', checkOut: '—', status: 'absent' },
  { id: '5', name: 'Т. Наранцэцэг', role: 'Инженер', checkIn: '07:58', checkOut: '17:10', status: 'present' },
];

const statusLabel: Record<AttendanceRow['status'], string> = {
  present: 'Ирсэн',
  late: 'Хоцорсон',
  absent: 'Ирээгүй',
};

const statusVariant: Record<AttendanceRow['status'], 'default' | 'secondary' | 'destructive'> = {
  present: 'default',
  late: 'secondary',
  absent: 'destructive',
};

const columns: ResponsiveColumn<AttendanceRow>[] = [
  {
    id: 'name',
    header: 'Нэр',
    cell: (r) => <span style={{ fontWeight: 500 }}>{r.name}</span>,
  },
  {
    id: 'role',
    header: 'Албан тушаал',
    cell: (r) => <span style={{ color: 'hsl(var(--muted-foreground))', fontSize: 13 }}>{r.role}</span>,
    hideOnMobile: true,
  },
  {
    id: 'checkIn',
    header: 'Ирсэн',
    cell: (r) => r.checkIn,
    align: 'center',
  },
  {
    id: 'checkOut',
    header: 'Явсан',
    cell: (r) => r.checkOut,
    align: 'center',
    hideOnMobile: true,
  },
  {
    id: 'status',
    header: 'Төлөв',
    cell: (r) => <Badge variant={statusVariant[r.status]}>{statusLabel[r.status]}</Badge>,
    align: 'right',
  },
];

export const AttendanceTable = () => (
  <Frame>
    <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'hsl(var(--muted-foreground))', marginBottom: 12 }}>
      Өнөөдрийн ирц — 2026.06.18
    </p>
    <ResponsiveTable<AttendanceRow>
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
    />
  </Frame>
);
