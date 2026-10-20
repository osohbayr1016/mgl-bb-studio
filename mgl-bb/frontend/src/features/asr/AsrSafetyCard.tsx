import {
  BookOpenCheck,
  ClipboardList,
  HardHat,
  ShieldCheck,
  Smartphone,
  UserCheck,
  type LucideIcon,
} from 'lucide-react';
import { PANEL, SectionHead } from '@/shared/components/DashboardPanel';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';

/**
 * «Талбайд гарахын өмнө» — СТАТИК сануулга.
 *
 * ⚠️ Энэ бол статистик БИШ.  Системд ХАБЭА-н (осол, PPE, зааварчилгаа)
 *    хүснэгт байхгүй тул аюулгүй байдлын ТОО энд гарахгүй; зөвхөн талбайд
 *    очих бүрд бэлдэх ёстой зүйлсийн жагсаалт.  Талбай бүрийн өөрийн
 *    дүрэм давуу — хөлийн мөр үүнийг хэлдэг.
 */
const ITEMS: { icon: LucideIcon; key: string; accent?: boolean }[] = [
  { icon: HardHat, key: 'asr.safetyPpe', accent: true },
  { icon: UserCheck, key: 'asr.safetySite' },
  { icon: ClipboardList, key: 'asr.safetyDocs' },
  { icon: BookOpenCheck, key: 'asr.safetyRedBook' },
  { icon: Smartphone, key: 'asr.safetyPhone' },
];

export function AsrSafetyCard({ className }: { className?: string }) {
  const { t } = useLanguage();
  return (
    <section
      id="sec-asr-safety"
      className={cn(PANEL, 'scroll-mt-24 border-warning/40 bg-warning/[0.04]', className)}
    >
      <SectionHead icon={ShieldCheck} iconClassName="text-warning" title={t('asr.safetyTitle')} />
      <div className="px-4 pb-4 sm:px-5 sm:pb-5">
        <p className="text-xs text-muted-foreground">{t('asr.safetyIntro')}</p>
        <ul className="mt-3 space-y-2.5">
          {ITEMS.map((it) => (
            <li key={it.key} className="flex items-start gap-2.5 text-sm">
              <span
                className={cn(
                  'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
                  it.accent ? 'bg-warning/15 text-warning' : 'bg-muted text-muted-foreground',
                )}
              >
                <it.icon className="h-3.5 w-3.5" />
              </span>
              <span className={cn('leading-snug', it.accent && 'font-medium')}>{t(it.key)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-micro text-muted-foreground">{t('asr.safetyFooter')}</p>
      </div>
    </section>
  );
}
