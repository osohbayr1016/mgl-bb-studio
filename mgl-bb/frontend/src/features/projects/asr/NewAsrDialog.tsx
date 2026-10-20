import { useMemo, useState } from 'react';
import { HardHat, Loader2, Search } from 'lucide-react';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { useLanguage } from '@/shared/i18n';
import { foldSearchText } from '@/shared/lib/search/normalize';
import { cn } from '@/shared/lib/utils';
import { Badge } from '@/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Input } from '@/ui/input';
import { useAsrProjectOptions, type AsrProjectOption } from './api';
import { asrProjectName } from './asrProjectName';

/**
 * «Шинэ зохиогчийн хяналт» — ТӨСӨЛ СОНГОХ цонх.
 *
 * Яагаад энэ цонх байх ёстой вэ: ЗХ тайлан заавал нэг төсөлд харьяалагдах
 * тул (`POST /projects/:projectId`) `/app/asr` хуудсанд урьд нь бүртгэх зам
 * ОГТ БАЙГААГҮЙ — sidebar-ийн «Зохиогчийн хяналт» нь зөвхөн уншдаг жагсаалт
 * байсан бөгөөд хоосон төлөв нь «төслөөс бүртгэнэ үү» гэж бичвэрээр л
 * зөвлөдөг, товч ч, холбоос ч байхгүй.  Талбай дээрх инженер сайдбараас
 * ороод мухардаж, «ажиллахгүй байна» гэж мэдээлдэг байв.  Төслийг ЭНД
 * сонгосноор тэр харьяалал хэвээр хадгалагдана.
 *
 * ⚠️ Төслийн жагсаалт нь `GET /author-supervision/projects` — тайлантай
 *    төслүүдийн ШҮҮЛТҮҮРИЙН жагсаалт (`GET /`-ийн `projects`) БИШ.  Тэрийг
 *    хэрэглэвэл анхны тайлан хэзээ ч үүсэхгүй (api.ts-ийн тайлбарыг үз).
 */
export function NewAsrDialog({
  open,
  onOpenChange,
  onPicked,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /**
   * Төсөл сонгогдлоо — дуудагч ХАДГАЛААГҮЙ засварлагчийг нээнэ.
   *
   * ⚠️ Энэ цонх сервер рүү ЮУ Ч бичихээ болив (2026-09-04).  Урьд нь мөр
   *    дээр дарангуут `POST /projects/:id` явж жагсаалтад ноорог үүсдэг
   *    байсан тул хэрэглэгч бодлоо өөрчлөхөд хоосон бүртгэл үлддэг байв.
   */
  onPicked: (project: AsrProjectOption) => void;
}) {
  const { t } = useLanguage();
  const [q, setQ] = useState('');

  // Цонх хаалттай үед query унтарна — сайдбарын хуудас нээх бүрд
  // хэрэггүй дуудлага явуулахгүй.
  const { data, isLoading, isError, error, refetch } = useAsrProjectOptions(open);

  const projects = data?.projects ?? [];

  // Кирилл↔латин эвлүүлэлт: «Макс» ба «maks» хоёулаа олдоно
  // (`shared/lib/search/normalize.ts` — сайдбарын глобал хайлттай ижил).
  const filtered = useMemo(() => {
    const needle = foldSearchText(q.trim());
    if (!needle) return projects;
    return projects.filter((p) => foldSearchText(`${p.name} ${p.shifr ?? ''}`).includes(needle));
  }, [projects, q]);

  /**
   * Төслийг СОНГОНО — сервер рүү ЮУ Ч илгээхгүй.
   *
   * ⚠️ Урьд нь энд `POST /projects/:id` явж, буцаж ирсэн ноорог руу
   *    шилждэг байсан тул хэрэглэгч төслөө дараад бодлоо өөрчлөхөд
   *    жагсаалтад хоосон ноорог үлддэг байв.  Одоо дуудагч нь
   *    ХАДГАЛААГҮЙ засварлагчийг нээх ба бодит мөр «Хадгалах» дарах
   *    агшинд л үүснэ (эзний шийдвэр 2026-09-04).  Тиймээс энд сүлжээ,
   *    ачааллын төлөв, алдааны боловсруулалт хэрэггүй болов.
   */
  const pick = (p: AsrProjectOption) => {
    onOpenChange(false);
    setQ('');
    onPicked(p);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:flex sm:max-w-lg sm:gap-0 sm:p-0">
        <DialogHeader className="shrink-0 space-y-1 border-b px-5 py-4">
          <DialogTitle>{t('asr.new')}</DialogTitle>
          <DialogDescription>{t('asr.pickProjectHint')}</DialogDescription>
        </DialogHeader>

        <div className="shrink-0 border-b px-5 py-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('asr.searchProject')}
              className="pl-8"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <ErrorState error={error} onRetry={() => void refetch()} />
          ) : filtered.length === 0 ? (
            <EmptyState icon={HardHat} title={t('asr.noProjects')} />
          ) : (
            <ul className="space-y-0.5">
              {filtered.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => pick(p)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left transition-colors',
                      'hover:bg-muted',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{asrProjectName(p.name)}</span>
                      {p.shifr && (
                        <span className="block truncate font-mono text-xs text-muted-foreground">
                          {p.shifr}
                        </span>
                      )}
                    </span>
                    {/* Ангиллын шошго (Засвар / Интерьер зураг / ЗХ төсөл)
                        эзний хүсэлтээр хасагдсан (2026-09-28) — ЗХ-д нэг
                        барилга = нэг төсөл, нэр нь ангиллын дагаваргүй. */}
                    {p.status !== 'active' && (
                      <Badge variant="outline" className="shrink-0 text-xs">
                        {t('archived')}
                      </Badge>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
