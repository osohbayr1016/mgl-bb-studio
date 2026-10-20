/**
 * Ажилтны ур чадварууд — түвшин, өөрийн хувь, дараагийн түвшин хүртэлх зөрүү.
 *
 * ЭРЭМБЭ НЬ АГУУЛГЫН НЭГ ХЭСЭГ: «дараагийн түвшинд хамгийн ойр» нь дээрээ
 * (`sortByNextLevelProximity`).  Шүүлтүүр, эрэмбийн сонголт ЗОРИУДААР
 * байхгүй — ажилтан «аль чадвараа хамгийн бага хүчээр ахиулах вэ» гэдгээ
 * НЭГ харцаар харах ёстой.
 *
 * ⚠️ ЗӨВХӨН ӨӨРИЙН ӨГӨГДӨЛ.  Энд `/assessments/my/results`-ээс ирсэн
 *    (`subject_user_id = user.sub`-т хатуу bind хийгдсэн) утга л орно.
 *    Бусад ажилтны хувь, эрэмбэ (rank/percentile), багийн дундаж
 *    (`benchmark`) энд ХЭЗЭЭ Ч ГАРАХГҮЙ — админы (`/rounds/:id/results`)
 *    өгөгдлийг энэ компонентод дамжуулж БОЛОХГҮЙ (spec §3, I1–I5).
 *
 * ⚠️ НИЙТ хувь / НИЙТ түвшин энд байхгүй нь САНААТАЙ (2026-08-12, эзний
 *    шийдвэр).  Түвшин нь чадвар ТУС БҮРД утгатай; нэг дундаж тоо нь юуг
 *    засахаа хэлдэггүй тул хасагдсан.  Буцааж нэмэхгүй.
 */
import { useMemo } from 'react';

import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { Progress } from '@/ui/progress';

import type { MyResultSection } from '../api';
import type { AssessmentLevelBand } from '../types';
import { bandFloorPct, fmtPct, sortByNextLevelProximity } from '../lib/selfResult';
import { LevelBadge } from './LevelBadge';

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));

/** Нэг ур чадварын мөр. */
function SkillRow({
  section: s,
  bands,
}: {
  section: MyResultSection;
  bands: AssessmentLevelBand[];
}) {
  const { t } = useLanguage();

  // Явцын шугам нь 0-ээс биш, ОДООГИЙН band-ийн ёроолоос дараагийн band-ийн
  // доод хязгаар хүртэл — «хэр ойрхон» нь мэдрэгдэнэ (MIDDLE 84.2% нь
  // SENIOR-т бараг хүрсэн, гэтэл 0-100 шугам дээр энэ нь харагдахгүй).
  const floor = bandFloorPct(bands, s.level_code);
  const nextMin = s.next_level_min_pct;
  const span = nextMin === null ? 0 : nextMin - floor;
  const fill =
    s.pct === null || nextMin === null ? 0 : span > 0 ? clamp(((s.pct - floor) / span) * 100) : 100;

  // Дараагийн түвшний нэр нь схемээс ирнэ — хоосон шошготой band-д код руу
  // унана (`LevelBadge`-ийн ижил зарчим), эс тэгвээс « түвшинд хүрэхэд» гэсэн
  // толгойгүй мөр гарна.
  const nextLabel = s.next_level_label || s.next_level_code || '';
  const climbing = s.pct !== null && s.pct_to_next !== null && nextMin !== null;

  return (
    <li className="px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{s.title}</span>
        <div className="flex shrink-0 items-center gap-2">
          <LevelBadge
            size="sm"
            level={{ code: s.level_code, label: s.level_label, color: s.level_color }}
          />
          <span className="w-14 text-right text-sm font-semibold tabular-nums text-foreground">
            {fmtPct(s.pct)}
          </span>
        </div>
      </div>

      {climbing ? (
        <div className="mt-1.5 space-y-1">
          <Progress value={fill} className="h-1.5" />
          <p className="text-micro text-muted-foreground">
            {t('assessments.toNextLevel', {
              level: nextLabel,
              pct: (s.pct_to_next ?? 0).toFixed(1),
            })}
          </p>
        </div>
      ) : s.pct !== null ? (
        // Дээд түвшинд хүрсэн — «0% дутуу» гэж БИЧИХГҮЙ (тэр нь ахих зүйл
        // үлдсэн мэт уншигдана).
        <p className="mt-1 text-micro font-medium text-success">{t('assessments.atTopLevel')}</p>
      ) : null}
    </li>
  );
}

export function SkillLevelList({
  sections,
  bands,
  className,
}: {
  sections: MyResultSection[];
  bands: AssessmentLevelBand[];
  className?: string;
}) {
  const ordered = useMemo(() => sortByNextLevelProximity(sections), [sections]);
  if (ordered.length === 0) return null;

  return (
    <ul className={cn('divide-y divide-border/60 rounded-lg border border-border', className)}>
      {ordered.map((s) => (
        <SkillRow key={s.section_id} section={s} bands={bands} />
      ))}
    </ul>
  );
}

export default SkillLevelList;
