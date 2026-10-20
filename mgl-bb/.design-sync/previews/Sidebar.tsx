import type { ReactNode } from 'react';
import { Badge, Button } from 'mgl-ui';
import { LayoutDashboard, FolderKanban, FileText, Users, Settings, LogOut } from 'lucide-react';

const Frame = ({ children }: { children: ReactNode }) => (
  <div style={{
    background: 'hsl(var(--background))',
    borderRadius: 12,
    overflow: 'hidden',
    width: '100%',
    height: 380,
    display: 'flex',
    border: '1px solid hsl(var(--border))',
  }}>
    {children}
  </div>
);

type NavItem = {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  label: string;
  active?: boolean;
  badge?: string;
};

const navItems: NavItem[] = [
  { icon: LayoutDashboard, label: 'Хяналт', active: true },
  { icon: FolderKanban, label: 'Төслүүд', badge: '14' },
  { icon: FileText, label: 'Баримт' },
  { icon: Users, label: 'Баг' },
  { icon: Settings, label: 'Тохиргоо' },
];

export const AppSidebar = () => (
  <Frame>
    {/* Sidebar panel rendered directly — avoids Sidebar component's mobile/lg CSS hide logic */}
    <div style={{
      width: 220,
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      background: 'hsl(240 6% 12%)',
      borderRight: '1px solid hsl(var(--border))',
      padding: '8px 0',
    }}>
      {/* Header */}
      <div style={{ padding: '8px 12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: 'hsl(var(--primary))', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span style={{ color: 'hsl(var(--primary-foreground))', fontWeight: 700, fontSize: 14 }}>М</span>
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.2, color: '#fff' }}>MGL</div>
          <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))' }}>Барилгын явц</div>
        </div>
      </div>
      {/* Nav */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, padding: '0 8px' }}>
        {navItems.map((item) => (
          <button key={item.label} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            width: '100%',
            padding: '8px 10px',
            borderRadius: 7,
            border: 'none',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: item.active ? 600 : 400,
            background: item.active ? 'hsl(var(--accent))' : 'transparent',
            color: item.active ? '#fff' : 'hsl(220 15% 70%)',
            textAlign: 'left',
          }}>
            <item.icon size={15} strokeWidth={1.75} />
            <span style={{ flex: 1 }}>{item.label}</span>
            {item.badge && (
              <Badge variant="secondary" style={{ fontSize: 10, height: 16, padding: '0 5px' }}>
                {item.badge}
              </Badge>
            )}
          </button>
        ))}
      </div>
      {/* Footer */}
      <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid hsl(var(--border))', marginTop: 8 }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'hsl(var(--muted))', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Б. Дорждагва</div>
          <div style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))' }}>Ахлах инженер</div>
        </div>
        <Button variant="ghost" size="icon" style={{ flexShrink: 0, width: 28, height: 28 }}>
          <LogOut size={13} />
        </Button>
      </div>
    </div>
    {/* Main content area */}
    <main style={{ flex: 1, padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'hsl(var(--muted-foreground))', fontSize: 13 }}>
      Хяналтын самбар
    </main>
  </Frame>
);
