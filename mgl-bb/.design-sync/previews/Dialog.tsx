import type { ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
} from 'mgl-ui';

const Frame = ({ children }: { children: ReactNode }) => (
  <div style={{ background: 'hsl(var(--background))', padding: 24, borderRadius: 12, minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    {children}
  </div>
);

export const DeleteProject = () => (
  <Frame>
    <Dialog open>
      <DialogContent mobileFullScreen={false}>
        <DialogHeader>
          <DialogTitle>Төсөл устгах</DialogTitle>
          <DialogDescription>
            "Согоот Residence — 3-р блок" төслийг устгахдаа итгэлтэй байна уу? Энэ үйлдлийг буцаах боломжгүй бөгөөд бүх холбогдох мэдээлэл устана.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline">Болих</Button>
          <Button variant="destructive">Устгах</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </Frame>
);
