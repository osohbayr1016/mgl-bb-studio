import type { ReactNode } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  Button,
  Label,
  Input,
} from 'mgl-ui';

const Frame = ({ children }: { children: ReactNode }) => (
  <div style={{ background: 'hsl(var(--background))', padding: 0, borderRadius: 12, minHeight: 380, position: 'relative', overflow: 'hidden' }}>
    {children}
  </div>
);

export const FilterSheet = () => (
  <Frame>
    <Sheet open>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Шүүлтүүр</SheetTitle>
          <SheetDescription>Төслийн жагсаалтыг шүүх тохиргоо</SheetDescription>
        </SheetHeader>
        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Label>Төслийн нэр</Label>
            <Input placeholder="Жишээ: Согоот..." />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Label>Баг</Label>
            <Input placeholder="Архитектурын баг..." />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Label>Явцын доод хувь (%)</Label>
            <Input type="number" placeholder="0" />
          </div>
        </div>
        <SheetFooter>
          <Button variant="outline" style={{ flex: 1 }}>Арилгах</Button>
          <Button style={{ flex: 1 }}>Хэрэглэх</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  </Frame>
);
