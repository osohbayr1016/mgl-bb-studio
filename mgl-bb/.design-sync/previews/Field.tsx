import type { ReactNode } from 'react';
import { Field, Input } from 'mgl-ui';

const Frame = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      background: 'hsl(var(--background))',
      color: 'hsl(var(--foreground))',
      padding: 24,
      borderRadius: 12,
      display: 'flex',
      flexDirection: 'column',
      gap: 20,
      fontSize: 14,
    }}
  >
    {children}
  </div>
);

export const Normal = () => (
  <Frame>
    <Field
      label="И-мэйл хаяг"
      hint="Бүртгэлтэй и-мэйлийг оруулна уу"
    >
      <Input placeholder="nэр@company.mn" style={{ maxWidth: 300 }} />
    </Field>
  </Frame>
);

export const WithError = () => (
  <Frame>
    <Field
      label="И-мэйл хаяг"
      required
      error="Буруу и-мэйл хаяг байна. Дахин шалгана уу."
    >
      <Input
        defaultValue="буруу-хаяг@@"
        aria-invalid
        style={{ maxWidth: 300 }}
      />
    </Field>
  </Frame>
);
