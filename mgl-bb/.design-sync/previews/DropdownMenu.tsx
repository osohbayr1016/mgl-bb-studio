import type { ReactNode } from 'react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  Button,
} from 'mgl-ui';

const Frame = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      background: 'hsl(var(--background))',
      color: 'hsl(var(--foreground))',
      padding: 40,
      borderRadius: 12,
      minWidth: 400,
      minHeight: 300,
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
    }}
  >
    {children}
  </div>
);

export const ProjectActions = () => (
  <Frame>
    <DropdownMenu open>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Үйлдэл ···</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Төслийн үйлдэл</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <span>✏</span> Засах
        </DropdownMenuItem>
        <DropdownMenuItem>
          <span>⧉</span> Хувилах
        </DropdownMenuItem>
        <DropdownMenuItem>
          <span>⬇</span> PDF татах
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">
          <span>✕</span> Устгах
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </Frame>
);
