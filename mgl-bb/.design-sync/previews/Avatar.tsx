import type { ReactNode } from 'react';
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
} from 'mgl-ui';

const Frame = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      background: 'hsl(var(--background))',
      color: 'hsl(var(--foreground))',
      padding: 24,
      borderRadius: 12,
      display: 'flex',
      flexWrap: 'wrap',
      gap: 16,
      alignItems: 'center',
      minHeight: 72,
    }}
  >
    {children}
  </div>
);

export const Fallbacks = () => (
  <Frame>
    <Avatar size="sm">
      <AvatarFallback>БД</AvatarFallback>
    </Avatar>
    <Avatar>
      <AvatarFallback>АН</AvatarFallback>
    </Avatar>
    <Avatar size="lg">
      <AvatarFallback>ТМ</AvatarFallback>
    </Avatar>
    <Avatar>
      <AvatarFallback>ГБ</AvatarFallback>
    </Avatar>
    <Avatar>
      <AvatarImage
        src="https://i.pravatar.cc/150?u=mn1"
        alt="Хэрэглэгч"
      />
      <AvatarFallback>ХЭ</AvatarFallback>
    </Avatar>
  </Frame>
);

export const Sizes = () => (
  <Frame>
    <Avatar size="sm">
      <AvatarFallback>ЖЖ</AvatarFallback>
    </Avatar>
    <Avatar size="default">
      <AvatarFallback>ЭЭ</AvatarFallback>
    </Avatar>
    <Avatar size="lg">
      <AvatarFallback>ТТ</AvatarFallback>
    </Avatar>
  </Frame>
);

export const Group = () => (
  <Frame>
    <AvatarGroup>
      <Avatar>
        <AvatarFallback>БД</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarFallback>АН</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarFallback>ТМ</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarFallback>ГБ</AvatarFallback>
      </Avatar>
      <AvatarGroupCount>+5</AvatarGroupCount>
    </AvatarGroup>
  </Frame>
);
