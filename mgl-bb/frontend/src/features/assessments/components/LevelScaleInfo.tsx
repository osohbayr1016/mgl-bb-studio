/**
 * «Түвшин юугаар тодорхойлогддог вэ?» — INTERN → EXPERT шатлалын ТАЙЛБАР.
 *
 * Профайлын «Ур чадварын тодорхойлолт» хэсгийн ТОЛГОЙ блок.  2026-08-12-нд
 * нийт хувь / нийт түвшин / «дараагийн түвшинд X% дутуу» гурвыг ажилтны
 * дэлгэцээс хассан (эзний шийдвэр) — тэдгээрийн оронд «би одоо хаана байна»
 * гэсэн ГАНЦ тоог биш, «түвшин гэж юу гэсэн үг вэ» гэсэн ТОДОРХОЙЛОЛТыг
 * харуулна.  Ажилтан өөрийн байрлалыг доорх ур чадвар тус бүрийн мөрөөс
 * (`SkillLevelList`) харна.
 *
 * ⚠️ Энэ блок нь ЦЭВЭР ТАЙЛБАР — ажилтны ямар ч тоо энд ОРОХГҮЙ.  Тиймээс
 *    шатлалын зурвас дээр «одоо энд байна» гэсэн ТЭМДЭГЛЭГЭЭ БАЙХГҮЙ
 *    (өмнөх `LevelProgressCard`-ийн `LevelLadder`-ээс ялгаатай нь энэ) —
 *    тэр тэмдэглэгээ нь нийт хувиас гардаг байсан, нийт хувь нь хасагдсан.
 *
 * Хувийн босго нь РАУНДЫН СХЕМЭЭС ирнэ (`round.levels`), тайлбар текст нь
 * i18n-д суусан СТАТИК мөр.  Схемд танихгүй код (жишээ нь өөр шатлалтай
 * загвар) байвал тайлбаргүйгээр зөвхөн нэр + муж гарна — түүхий түлхүүр
 * дэлгэц дээр гарахгүй.
 */
import { Info } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';

import type { AssessmentLevelBand } from '../types';

/**
 * Шатлалын код → статик тайлбарын i18n түлхүүр.
 *
 * ⚠️ `Record<string, …>` нь САНААТАЙ: схем нь админаар засагддаг тул код нь
 *    эдгээрийн аль нь ч биш байж болно.  Тэр тохиолдолд тайлбар мөр огт
 *    гарахгүй (`t()` танихгүй түлхүүрийг ТҮҮХИЙГЭЭР буцаадаг тул шууд
 *    дуудаж болохгүй).
 */
const DESCRIPTION_KEY: Record<string, string> = {
  INTERN: 'assessments.levelScaleIntern',
  JUNIOR: 'assessments.levelScaleJunior',
  MIDDLE: 'assessments.levelScaleMiddle',
  SENIOR: 'assessments.levelScaleSenior',
  EXPERT: 'assessments.levelScaleExpert',
};

/** `#rrggbb` эсэхийг шалгана — схемээс ирсэн буруу утга inline style-д орохгүй. */
function isHex(color: string | null | undefined): color is string {
  return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color);
}

/**
 * ⚠️ Энд «0–30%» маягийн ХУВИЙН МУЖ ХАРУУЛАХГҮЙ (2026-08-12, эзний шийдвэр).
 *    Энэ блок бол түвшний ЧАНАРЫН тодорхойлолт — хүн «ямар ажил хийж чаддаг
 *    хүнийг ахлах гэдэг вэ» гэдгийг унших ёстой, босго хөөх ёсгүй.  Хувь нь
 *    доорх `SkillLevelList`-д ур чадвар тус бүрээр гарсаар байгаа.
 *    `band.minPct` нь зөвхөн ЭРЭМБЭ болон зурвасын өргөнд хэрэглэгдэнэ.
 */
export function LevelScaleInfo({
  bands,
  className,
}: {
  bands: AssessmentLevelBand[];
  className?: string;
}) {
  const { t } = useLanguage();
  // Доороос дээш — «дадлагажигчаас ахлах хүртэл» гэсэн ӨСӨХ зам болж уншигдана.
  const asc = [...bands].sort((a, b) => a.minPct - b.minPct);
  if (asc.length === 0) return null;

  return (
    <section className={cn('rounded-lg border border-border bg-background/40 p-4', className)}>
      <h4 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <Info className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        {t('assessments.levelScaleTitle')}
      </h4>
      <p className="mt-1 text-micro leading-relaxed text-muted-foreground">
        {t('assessments.levelScaleHint')}
      </p>

      {/* Шатлалын зурвас — band бүр өөрийн мужаараа өргөнтэй.  Тоо агуулаагүй
          ЦЭВЭР legend тул бүх band дүүрэн өнгөтэй (хүрсэн/хүрээгүй гэж
          ялгахад ажилтны нийт хувь хэрэгтэй болно — тэр хасагдсан). */}
      <div
        aria-hidden
        className="mt-3 flex h-2 w-full overflow-hidden rounded-full border border-border/60"
      >
        {asc.map((b) => {
          const color = isHex(b.color) ? b.color : null;
          return (
            <div
              key={b.code}
              className={cn('h-full', !color && 'bg-muted')}
              style={{
                flexGrow: Math.max(1, b.maxPct - b.minPct),
                ...(color ? { backgroundColor: color } : {}),
              }}
            />
          );
        })}
      </div>

      <ul className="mt-3 space-y-2">
        {asc.map((b) => {
          const color = isHex(b.color) ? b.color : null;
          const descKey = DESCRIPTION_KEY[b.code.toUpperCase()];
          return (
            <li key={b.code} className="flex gap-2.5">
              <span
                aria-hidden
                className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', !color && 'bg-primary')}
                style={color ? { backgroundColor: color } : undefined}
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-foreground">{b.label || b.code}</p>
                {descKey && (
                  <p className="text-micro leading-relaxed text-muted-foreground">{t(descKey)}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default LevelScaleInfo;
