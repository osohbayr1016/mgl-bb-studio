import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

import { Button } from '@/ui/button';
import { PageHeader } from '@/shared/components/PageHeader';
import { cn } from '@/shared/lib/utils';

export interface SettingsSection {
  /** Тогтвортой id — засварын холбоос (`#id`) болон scroll-spy-д ашиглагдана. */
  id: string;
  /** Хажуугийн замд гарах богино нэр. Дуудагч орчуулна. */
  label: string;
  icon?: LucideIcon;
  content: ReactNode;
}

interface SettingsShellProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  sections: SettingsSection[];
  className?: string;
}

/**
 * Тохиргооны маягийн хуудасны бүрхүүл: наалдамхай хэсгийн зам + агуулга.
 *
 * Байрлалын санааг shadcnblocks-ийн `settings-profile4`-ээс авсан (өргөн
 * `lg:w-56` зүүн зам, түүний хажуугийн хэсэгчилсэн агуулга). Блокийг өөрийг
 * нь суулгаагүй — түүний `registryDependencies` нь diceui-гийн
 * `file-upload`-оос хамаардаг ба энэ репод тэр реестр бүртгэлгүй
 * (`shadcn add` нь 526-аар уначихдаг). Дээрх хоёр зөрүү ч бас байсан:
 *
 *   1. ⚠️ БЛОКИЙН ЗАН ТӨЛВИЙГ ЗОРИУДААР АВААГҮЙ. Эх блок нь `activeSection`
 *      state-ээр идэвхгүй хэсгийг UNMOUNT хийдэг. Энэ хуудсанд тэр нь
 *      регресс болно: `HolidaysCard` нь `/holidays`-г дахин татаад
 *      хэрэглэгчийн бөглөж буй огноо/нэрийн НООРОГИЙГ чимээгүй устгана,
 *      `BrandLogoCard` нь `/settings/branding`-г дахин татна,
 *      `PushNotificationsCard` нь зөвшөөрлийн төлөвийг дахин шалгаж
 *      буруу CTA анивчина. Тиймээс энд БҮХ хэсэг ҮРГЭЛЖ mount-той —
 *      зам нь зөвхөн гүйлгэдэг, идэвхийг нь `IntersectionObserver` мэднэ.
 *      Ерөнхий дүрэм: блок бол БАЙРЛАЛЫН хандивлагч, ЗАН ТӨЛВИЙН биш.
 *
 *   2. Типографи/примитив нь төслийнх: `text-*` шатлал, `@/ui/button`
 *      (түүхий `<button>` нь `eslint.tokens`-д хориотой), `PageHeader`
 *      (хуудсанд ЯГ нэг `<h1>`).
 */
export function SettingsShell({
  title,
  description,
  icon,
  sections,
  className,
}: SettingsShellProps) {
  const [activeId, setActiveId] = useState(sections[0]?.id ?? '');
  const contentRef = useRef<HTMLDivElement | null>(null);

  // Хамаарлын түлхүүр нь id-уудын мөр — массивын ИЖ БҮРДЭЛ биш. Дуудагч
  // `sections`-ийг рендэр бүрт шинээр үүсгэдэг (нууц үгийн талбарт үсэг
  // бичих болгонд), тиймээс массивыг шууд хамааралд өгвөл observer
  // товчлуур дарах бүрд салж дахин холбогдоно.
  const sectionKey = sections.map((s) => s.id).join('|');

  // Хэрэглэгч гараар гүйлгэхэд идэвхтэй хэсгийг дагана. `rootMargin`-ийн дээд
  // хэсэг сөрөг тул «идэвхтэй» гэдэг нь дэлгэцийн ДЭЭД хэсэгт байгааг
  // хэлнэ — эс бөгөөс сүүлийн хэсэг рүү гүйлгэхэд өмнөх нь идэвхтэй хэвээр
  // үлддэг.
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;

    const nodes = sectionKey
      .split('|')
      .map((id) => root.querySelector<HTMLElement>(`#${CSS.escape(id)}`))
      .filter((n): n is HTMLElement => n !== null);
    if (nodes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const first = visible[0];
        if (first) setActiveId(first.target.id);
      },
      { rootMargin: '-88px 0px -55% 0px', threshold: 0 },
    );

    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [sectionKey]);

  const goTo = (id: string) => {
    setActiveId(id);
    contentRef.current?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

  return (
    <div className={cn('animate-in fade-in space-y-6 duration-500', className)}>
      <PageHeader icon={icon} title={title} description={description} />

      <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
        {/* Зам. lg-ээс доош хэвтээ чипийн мөр болно — ProfilePage-ийн
            `-mx-1 overflow-x-auto pb-1` хэмнэлийг дагасан. */}
        <nav aria-label={title} className="lg:w-56 lg:shrink-0">
          <div className="lg:sticky lg:top-4">
            <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
              {sections.map((s) => {
                const Icon = s.icon;
                const active = s.id === activeId;
                return (
                  <Button
                    key={s.id}
                    type="button"
                    variant={active ? 'secondary' : 'ghost'}
                    size="sm"
                    aria-current={active ? 'true' : undefined}
                    onClick={() => goTo(s.id)}
                    className={cn(
                      'shrink-0 justify-start gap-2 lg:w-full',
                      !active && 'text-muted-foreground',
                    )}
                  >
                    {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden />}
                    {s.label}
                  </Button>
                );
              })}
            </div>
          </div>
        </nav>

        {/* Агуулга — хэсэг бүр ҮРГЭЛЖ рендэрлэгдэнэ (дээрх тайлбарыг үз). */}
        <div ref={contentRef} className="min-w-0 flex-1 space-y-6">
          {sections.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-20">
              {s.content}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
