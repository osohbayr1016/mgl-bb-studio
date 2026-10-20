import * as React from 'react';

import { cn } from '@/shared/lib/utils';

/**
 * Textarea styled to match our Input component. Supports an `autoGrow` flag
 * that sizes the element to its content as the user types — useful for long
 * task names on the admin setup page.
 */
type TextareaProps = React.ComponentProps<'textarea'> & { autoGrow?: boolean };

function Textarea({ className, autoGrow = false, onInput, ...props }: TextareaProps) {
  const ref = React.useRef<HTMLTextAreaElement | null>(null);

  const resize = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  React.useEffect(() => {
    if (autoGrow) resize();
    // Re-measure when the `value` prop changes from the outside.
  }, [autoGrow, resize, props.value, props.defaultValue]);

  return (
    <textarea
      ref={ref}
      data-slot="textarea"
      rows={autoGrow ? 1 : props.rows}
      onInput={(e) => {
        if (autoGrow) resize();
        onInput?.(e);
      }}
      className={cn(
        // `text-base` (16px) утсанд ЗААВАЛ: iOS Safari 16px-ээс жижиг
        // талбар дээр дарахад хуудсыг автоматаар томруулдаг (мөн буцааж
        // жижигрүүлдэггүй).  `ui/input.tsx` аль хэдийн ийм байсан —
        // textarea л ганцаараа `text-sm` хэвээр үлдсэн байв.
        'flex w-full min-h-[2.25rem] rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
        autoGrow ? 'resize-none overflow-hidden leading-snug' : 'resize-y',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
