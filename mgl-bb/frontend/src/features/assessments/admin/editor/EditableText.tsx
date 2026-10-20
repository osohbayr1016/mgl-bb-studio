/**
 * Байрандаа засагддаг текст — ажилтны харагдацтай ЯГ ижил харагдаж, дарахад
 * засагдана.
 *
 * Яагаад `contentEditable` БИШ вэ: кирилл/IME оруулга дээр `contentEditable`
 * нь курсорын байрлалыг React-ийн re-render бүрт алдаж, монгол бичихэд үсэг
 * ураг тескэрч эргэдэг.  Тунгалаг `<textarea>` нь энгийн controlled input
 * тул тэр асуудал огт үүсэхгүй — харагдац нь л текст мэт.
 *
 * Өндөр нь агуулгаараа автоматаар өснө (`scrollHeight`), тиймээс гүйлгэгч
 * хэзээ ч гарахгүй бөгөөд эргэн тойрны байрлал ажилтны хуудастай таарна.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';

import { cn } from '@/shared/lib/utils';

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** blur дээр autosave-ийг шууд flush хийх. */
  onCommit?: () => void;
  placeholder?: string;
  /** Дэлгэц уншигчид зориулсан нэр (харагдах label байхгүй тул заавал). */
  ariaLabel: string;
  className?: string;
  /** true — Enter шинэ мөр нэмнэ. false (өгөгдмөл) — Enter фокусыг гаргана. */
  multiline?: boolean;
}

export function EditableText({
  value,
  onChange,
  onCommit,
  placeholder,
  ariaLabel,
  className,
  multiline = false,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Агуулгын өндөрт тааруулах.  `useLayoutEffect` — paint-ээс ӨМНӨ хийхгүй бол
  // хуудас солигдох болгонд нэг фрэйм үсэрч харагдана.
  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  useLayoutEffect(resize, [value]);
  // Цонхны өргөн өөрчлөгдөхөд мөрийн тоо өөрчлөгдөнө.
  useEffect(() => {
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      aria-label={ariaLabel}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (!multiline && e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      className={cn(
        // Анхдагчаар «текст» — хүрээ, дэвсгэргүй.  Hover/focus дээр л
        // засварлагдахаа мэдэгдэнэ (ажилтны харагдац эвдрэхгүй).
        'block w-full resize-none overflow-hidden rounded-md border border-transparent',
        'bg-transparent px-1.5 py-0.5 outline-none transition-colors',
        'hover:border-border hover:bg-muted/40',
        'focus:border-primary focus:bg-background focus:ring-[3px] focus:ring-ring/30',
        'placeholder:text-muted-foreground/60',
        className,
      )}
    />
  );
}

export default EditableText;
