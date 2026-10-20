import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, CheckCircle2, Loader2, TrendingUp } from 'lucide-react';

import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage, pickLocalized } from '@/shared/i18n';
import { canTakeAssessments } from '@/shared/lib/roles';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Badge } from '@/ui/badge';
import { assessmentKeys, fetchMyResults } from '@/features/assessments/api';

import { Markdown } from './markdown';
import { fetchHandbook, handbookKeys, HANDBOOK_ANY, HANDBOOK_LEVELS } from './api';
import type { HandbookEntry } from './api';

/**
 * Гарын авлага (уншигчийн хуудас) — `/app/handbook`.
 *
 * Ажилтан «миний албан тушаалд, миний түвшинд юу шаардагдах вэ» гэдгээ
 * ЭНД уншина.  Сервер тал аль хэдийн role + `published`-оор шүүсэн бичлэг
 * буцаадаг тул энд зөвхөн БҮЛЭГЛЭЛТ, эрэмбэ, онцлолт л үлдэнэ:
 *
 *   1. `'*'` (бүх түвшинд) бүлэг ХАМГИЙН ЭХЭНД — ерөнхий заавар.
 *   2. Дараа нь шатлалын дарааллаар INTERN → JUNIOR → MIDDLE → SENIOR → EXPERT.
 *   3. Ажилтны ОДООГИЙН түвшин «Таны түвшин» шошготой,
 *      ДАРААГИЙН түвшин нүдэнд тод (primary хүрээ) — учир нь энэ хуудасны
 *      гол зорилго бол «Ахлах болоход надаас юу шаардах вэ» гэдгийг
 *      харуулах явдал.
 *
 * Одоогийн/дараагийн түвшнийг үнэлгээний `/assessments/my/results`-аас авна.
 * Үнэлгээнд оролцох эрхгүй role (client / worker) -д тэр хүсэлт огт явахгүй
 * (`canTakeAssessments` хамгаалалт) — бүлгүүд зүгээр л онцлолгүй харагдана.
 */

/** Шатлалын дараалал — `'*'` үргэлж хамгийн түрүүнд. */
const LEVEL_ORDER: readonly string[] = [HANDBOOK_ANY, ...HANDBOOK_LEVELS];

/**
 * Band кодын СТАТИК орчуулга — `/assessments/my/results` хоосон байхад л
 * хэрэглэнэ.
 *
 * ⚠️ Хараахан үнэлгээ ӨГӨӨГҮЙ ажилтанд сервер раунд буцаадаггүй тул схемийн
 *    `levels[].label` (тухайн раундын жинхэнэ шошго) байхгүй.  Fallback
 *    байхгүй бол гарчиг «SENIOR түвшинд» гэж түүхий англи кодоор гарна —
 *    яг гарын авлага хамгийн их хэрэгтэй хүмүүст.  Схемээс шошго ирвэл
 *    ҮРГЭЛЖ тэр нь давамгайлна (админ өөрөө нэрлэсэн байж болно).
 */
const STATIC_LEVEL_KEY: Record<string, string> = {
  INTERN: 'handbook.levelIntern',
  JUNIOR: 'handbook.levelJunior',
  MIDDLE: 'handbook.levelMiddle',
  SENIOR: 'handbook.levelSenior',
  EXPERT: 'handbook.levelExpert',
};

interface LevelGroup {
  code: string;
  entries: HandbookEntry[];
}

export default function HandbookPage() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();

  const handbookQuery = useQuery({
    queryKey: handbookKeys.list,
    queryFn: fetchHandbook,
    retry: false,
  });

  // Үнэлгээнд оролцдоггүй role-д хүсэлт явуулахгүй — сервер ямар ч байсан
  // хоосон/403 буцаах бөгөөд хуудас түүнгүйгээр бүрэн ажиллана.
  const resultsQuery = useQuery({
    queryKey: assessmentKeys.myResults,
    queryFn: fetchMyResults,
    retry: false,
    enabled: canTakeAssessments(user?.role),
  });

  /** Band кодын хүн уншихад ойлгомжтой нэр (схемийн `levels`-ээс). */
  const levelLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const round of resultsQuery.data?.rounds ?? []) {
      for (const band of round.levels ?? []) {
        if (!map[band.code]) map[band.code] = band.label;
      }
    }
    return map;
  }, [resultsQuery.data]);

  // Хамгийн сүүлийн онооролттой раунд (rounds нь шинэ→хуучин эрэмбэтэй).
  const latestScored = (resultsQuery.data?.rounds ?? []).find((r) => r.overall_level_code);
  const currentLevelCode = latestScored?.overall_level_code ?? null;
  const nextLevelCode = latestScored?.overall_next_level_code ?? null;

  /** level_code-оор бүлэглээд шатлалын дарааллаар эрэмбэлнэ. */
  const groups = useMemo<LevelGroup[]>(() => {
    const byLevel = new Map<string, HandbookEntry[]>();
    for (const entry of handbookQuery.data?.entries ?? []) {
      const bucket = byLevel.get(entry.level_code);
      if (bucket) bucket.push(entry);
      else byLevel.set(entry.level_code, [entry]);
    }
    const known = LEVEL_ORDER.map((code) => ({ code, entries: byLevel.get(code) ?? [] })).filter(
      (g) => g.entries.length > 0,
    );
    // Схемд шинэ band нэмэгдвэл (эсвэл хуучин код үлдвэл) бичлэг АЛГА
    // болох ёсгүй — танихгүй кодуудыг төгсгөлд нь хавсаргана.
    const extra = [...byLevel.entries()]
      .filter(([code]) => !LEVEL_ORDER.includes(code))
      .map(([code, list]) => ({ code, entries: list }));
    return [...known, ...extra];
  }, [handbookQuery.data]);

  const levelName = (code: string) => {
    if (code === HANDBOOK_ANY) return t('handbook.allLevels');
    const fromSchema = levelLabels[code];
    if (fromSchema) return fromSchema;
    const key = STATIC_LEVEL_KEY[code];
    return key ? t(key) : code;
  };

  const header = (
    <PageHeader
      icon={BookOpen}
      title={t('handbook.pageTitle')}
      description={t('handbook.pageDesc')}
    />
  );

  if (handbookQuery.isLoading) {
    return (
      <PageContainer>
        {header}
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
        </div>
      </PageContainer>
    );
  }

  if (handbookQuery.isError) {
    return (
      <PageContainer>
        {header}
        <ErrorState error={handbookQuery.error} onRetry={() => void handbookQuery.refetch()} />
      </PageContainer>
    );
  }

  if (groups.length === 0) {
    return (
      <PageContainer>
        {header}
        <EmptyState
          icon={BookOpen}
          title={t('handbook.empty')}
          description={t('handbook.emptyHint')}
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      {header}

      {groups.map((group) => {
        const isCurrent = currentLevelCode !== null && group.code === currentLevelCode;
        const isNext = nextLevelCode !== null && group.code === nextLevelCode;
        return (
          <Card
            key={group.code}
            className={
              isNext
                ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/20'
                : 'border-border bg-card/60 backdrop-blur'
            }
          >
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {isNext ? (
                  <TrendingUp className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                ) : (
                  <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span>
                  {group.code === HANDBOOK_ANY
                    ? t('handbook.allLevels')
                    : t('handbook.forLevel', { level: levelName(group.code) })}
                </span>
                {isCurrent && (
                  <Badge variant="secondary" className="gap-1 text-micro">
                    <CheckCircle2 className="h-3 w-3" aria-hidden />
                    {t('handbook.yourLevelBadge')}
                  </Badge>
                )}
                {isNext && (
                  <Badge className="gap-1 text-micro">
                    <TrendingUp className="h-3 w-3" aria-hidden />
                    {t('levelUp.toReachNext', { level: levelName(group.code) })}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-5">
              {group.entries.map((entry) => (
                <article key={entry.id} className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-section text-foreground">
                      {pickLocalized(lang, entry.title_mn, entry.title_en)}
                    </h2>
                    {entry.role === HANDBOOK_ANY && (
                      <Badge variant="outline" className="text-micro">
                        {t('handbook.allRoles')}
                      </Badge>
                    )}
                  </div>
                  <Markdown body={entry.body_md} />
                </article>
              ))}
            </CardContent>
          </Card>
        );
      })}
    </PageContainer>
  );
}
