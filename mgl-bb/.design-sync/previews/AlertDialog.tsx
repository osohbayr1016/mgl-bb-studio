import type { ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from 'mgl-ui';

const Frame = ({ children }: { children: ReactNode }) => (
  <div style={{ background: 'hsl(var(--background))', padding: 24, borderRadius: 12, minHeight: 280, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    {children}
  </div>
);

export const ConfirmDelete = () => (
  <Frame>
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Ажилтны бүртгэл устгах уу?</AlertDialogTitle>
          <AlertDialogDescription>
            Б. Дорждагва-гийн бүртгэлийг устгахад бүх цагийн хуваарь, ирцийн бүртгэл болон оноо устах болно. Энэ үйлдлийг буцааж болохгүй.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Болих</AlertDialogCancel>
          <AlertDialogAction>Устгах</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </Frame>
);
