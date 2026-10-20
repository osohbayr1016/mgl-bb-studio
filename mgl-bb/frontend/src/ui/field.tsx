import * as React from 'react';

import { Label } from '@/ui/label';
import { cn } from '@/shared/lib/utils';

/**
 * Standard form field: a label stacked over a control, with an optional
 * hint or error line below. Centralises the `space-y-1.5` + <Label> pattern
 * that was being hand-rolled on every form. `error` takes precedence over
 * `hint` when both are present.
 *
 * Accessibility: the single control child is auto-wired to the label
 * (`htmlFor`/`id`) and to the hint/error line (`aria-describedby`), and
 * `aria-invalid` is set whenever `error` is present — so screen readers
 * announce the validation message against the right control. Pass an
 * explicit `htmlFor`/`id` to override the generated one; a child's own
 * `id`/`aria-*` always win.
 */
type FieldProps = {
  label?: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
};

type ControlProps = {
  id?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  'aria-describedby'?: string;
};

function Field({ label, htmlFor, hint, error, required, className, children }: FieldProps) {
  const generatedId = React.useId();
  const controlId = htmlFor ?? generatedId;
  const messageId = `${controlId}-msg`;
  const hasMessage = error != null || hint != null;

  let control = children;
  if (React.isValidElement(children)) {
    const child = children as React.ReactElement<ControlProps>;
    const childProps = child.props;
    const describedBy = [hasMessage ? messageId : null, childProps['aria-describedby']]
      .filter(Boolean)
      .join(' ');
    control = React.cloneElement(child, {
      id: childProps.id ?? controlId,
      'aria-invalid': error != null ? true : childProps['aria-invalid'],
      'aria-describedby': describedBy.length > 0 ? describedBy : undefined,
    });
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      {label != null && (
        <Label htmlFor={controlId}>
          {label}
          {required && <span className="text-destructive"> *</span>}
        </Label>
      )}
      {control}
      {error != null ? (
        // `text-destructive` нь харанхуй горимд 4.04:1 — алдааны мессеж
        // яг тэр газар уншигдах ёстой тул `-ink` хувилбар.
        <p id={messageId} role="alert" className="text-micro text-destructive-ink">
          {error}
        </p>
      ) : hint != null ? (
        <p id={messageId} className="text-micro text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Хэд хэдэн `Field`-ийн хариултат сүлжээ — маягтуудад гараар бичигддэг
 * `grid grid-cols-2 gap-3` хэв маягийг орлоно. `MeetingMetaForm` мэт
 * responsive prefix огт байхгүй байсан хоёр баганат маягтууд 360px дээр
 * шахагдаж байсан; энд `sm:` хүртэл нэг багана.
 */
function FieldGroup({
  columns = 2,
  className,
  children,
}: {
  columns?: 1 | 2 | 3;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'grid gap-3',
        columns === 1 && 'grid-cols-1',
        columns === 2 && 'grid-cols-1 sm:grid-cols-2',
        columns === 3 && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
        className,
      )}
    >
      {children}
    </div>
  );
}

export { Field, FieldGroup };
