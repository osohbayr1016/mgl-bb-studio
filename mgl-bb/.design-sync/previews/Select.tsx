import type { ReactNode } from 'react';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectGroup,
  SelectSeparator,
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

export const TeamSelect = () => (
  <Frame>
    <Select open defaultValue="arch">
      <SelectTrigger style={{ minWidth: 200 }}>
        <SelectValue placeholder="Баг сонгох" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Мэргэжлийн баг</SelectLabel>
          <SelectItem value="arch">Архитектур</SelectItem>
          <SelectItem value="struct">Бүтэц</SelectItem>
          <SelectItem value="eng">Инженер</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Дэмжлэгийн баг</SelectLabel>
          <SelectItem value="interior">Дотор засал</SelectItem>
          <SelectItem value="mep">МЭП</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  </Frame>
);
