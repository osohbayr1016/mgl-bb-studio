import type { ReactNode } from 'react';
import { Popover, PopoverTrigger, PopoverContent, Button } from 'mgl-ui';

const Frame = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      background: 'hsl(var(--background))',
      color: 'hsl(var(--foreground))',
      padding: 40,
      borderRadius: 12,
      minWidth: 400,
      minHeight: 260,
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
    }}
  >
    {children}
  </div>
);

export const FilterPopover = () => (
  <Frame>
    <Popover open>
      <PopoverTrigger asChild>
        <Button variant="outline">⚙ Шүүлтүүр</Button>
      </PopoverTrigger>
      <PopoverContent>
        <div style={{ padding: '4px 4px 2px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: 'hsl(var(--muted-foreground))', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Шүүлтүүр</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {['Архитектур', 'Бүтэц', 'Инженер', 'Дотор засал'].map((team) => (
              <label key={team} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" defaultChecked={team !== 'Дотор засал'} style={{ accentColor: 'hsl(var(--primary))' }} />
                {team}
              </label>
            ))}
          </div>
          <div style={{ borderTop: '1px solid hsl(var(--border))', paddingTop: 8, display: 'flex', gap: 6 }}>
            <Button size="sm" style={{ flex: 1 }}>Хэрэглэх</Button>
            <Button size="sm" variant="ghost">Цэвэрлэх</Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  </Frame>
);
