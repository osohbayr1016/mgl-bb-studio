import type { ReactNode } from 'react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, Button } from 'mgl-ui';

const Frame = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      background: 'hsl(var(--background))',
      color: 'hsl(var(--foreground))',
      padding: 40,
      borderRadius: 12,
      display: 'flex',
      flexDirection: 'column',
      gap: 32,
      alignItems: 'flex-start',
      fontSize: 14,
    }}
  >
    {children}
  </div>
);

export const Open = () => (
  <Frame>
    <TooltipProvider>
      <Tooltip open>
        <TooltipTrigger asChild>
          <Button variant="outline">Мэдээлэл</Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Энэ талбар заавал бөглөнө
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
    <TooltipProvider>
      <Tooltip open>
        <TooltipTrigger asChild>
          <Button variant="secondary">Хадгалах</Button>
        </TooltipTrigger>
        <TooltipContent side="right">
          Өөрчлөлтийг хадгалах
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </Frame>
);
