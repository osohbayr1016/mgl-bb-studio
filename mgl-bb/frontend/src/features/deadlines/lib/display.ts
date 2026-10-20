/**
 * Мөрийг ХҮНД УНШИГДАХ хэлбэрт буулгах ЦОР ГАНЦ дүрэм.
 *
 * Hero, самбарын мөр, даралтын зурвас гурвуулаа үүнийг дуудна — эс бөгөөс
 * нэг мөр гурван газар гурван янзаар харагдана (2026-08-нд яг тийм болж
 * hero дээр төслийн нэр ХОЁР УДАА давтагдаж байсан).
 *
 * ГОЛ АСУУДАЛ, ЯАГААД ЭНЭ ФАЙЛ ХЭРЭГТЭЙ БОЛОВ:
 * `kind === 'project'` мөрийн `title` нь ТӨСЛИЙН НЭР өөрөө байдаг
 * (`MGL-240904_ХӨШИГТИЙН ХӨНДИЙ_Захиргааны барилга`).  Тиймээс «гарчиг +
 * доор нь төслийн нэр» гэсэн ерөнхий загварыг сохроор хэрэглэвэл ижил
 * мөр хоёр удаа гарна.  Доорх `describeDeadline` энэ тохиолдлыг тусад нь
 * шийднэ: төслийн мөрийн ГАРЧИГ нь «Төсөл дуусах», төслийн нэр нь
 * контекст болно.
 */
import type { TranslationKey } from '@/shared/i18n';
import { formatDisplayName, formatProjectShortName } from '@/shared/lib/formatting';

import type { DeadlineItem, DeadlineKind } from '../types';

/** Төслийн ангиллын кодууд (`lib/projectCategories.ts`-ийн ижил олонлог). */
const CATEGORY_SUFFIX = /_(AZ|ZA|ET|EZ|IZ)$/i;

/**
 * Жагсаалтад тохирох төслийн нэр.
 *
 * `formatProjectShortName` нь `MGL-YYMMDD_` угтварыг хасдаг ч ангиллын
 * сүүл (`_ZA`, `_AZ`) үлддэг — тэр нь мөрөнд аль хэдийн өөр газар
 * харагддаг тул давхардал.  Энд түүнийг мөн хасна:
 *   MGL-251006_EVERGREEN_ZA  →  EVERGREEN
 *   MGL-260226_MITIC_AZ      →  MITIC
 *   MGL-240506_FURNITURE LAND_ZA → FURNITURE LAND
 * Ангиллын сүүлгүй нэр (жнь «ХӨШИГТИЙН ХӨНДИЙ_Захиргааны барилга») хэвээр
 * үлдэнэ — тэр хоёр хэсэг нь хоёулаа утгатай (талбай + барилга).
 */
export function deadlineProjectName(raw: string | null | undefined): string {
  const short = formatProjectShortName(raw);
  return short.replace(CATEGORY_SUFFIX, '');
}

const KIND_LABEL: Record<DeadlineKind, TranslationKey> = {
  project: 'deadlines.kindProject',
  milestone: 'deadlines.kindMilestone',
  block: 'deadlines.kindBlock',
  task: 'deadlines.kindTask',
  sub: 'deadlines.kindSub',
};

export function kindLabelKey(kind: DeadlineKind): TranslationKey {
  return KIND_LABEL[kind] ?? 'deadlines.kindTask';
}

type TFn = (key: TranslationKey, params?: Record<string, string | number>) => string;

export interface DeadlineDescription {
  /** Мөрийн ТӨРӨЛ («Төсөл» / «Эцсийн хугацаа» / «Дэд хугацаа» …). */
  kindLabel: string;
  /** Хамгийн том бичигдэх мөр — «энэ юу вэ». */
  main: string;
  /** Аль төсөлд харьяалагдах.  Хоосон бол `main` нь өөрөө төслийн нэр
   *  (давтахгүй).  Товчилсон хэлбэр. */
  project: string;
  /** Бүтэн төслийн нэр — `title=` атрибутад (код нь ажлын харилцаанд
   *  хэрэглэгддэг тул алдагдаж болохгүй). */
  projectFull: string;
  /** Нэмэлт баримтууд — эцэг таск, даалгаврын тоо, дэд тоо, хариуцагчид. */
  meta: string[];
}

export function describeDeadline(item: DeadlineItem, t: TFn): DeadlineDescription {
  const isProjectRow = item.kind === 'project';
  const rawProject = isProjectRow ? item.title : (item.project_title ?? '');
  const shortProject = deadlineProjectName(rawProject);

  const meta: string[] = [];
  // Дэд хугацаа нь эцэг таскаа заавал харуулна — ганцаараа утгагүй.
  if (item.kind === 'sub' && item.task_name) meta.push(item.task_name);
  if (item.task_count) meta.push(t('deadlines.rowTasks', { n: item.task_count }));
  if (item.sub_count) meta.push(t('deadlines.rowSubs', { n: item.sub_count }));
  if (item.people.length > 0) {
    meta.push(item.people.map((p) => formatDisplayName(p.full_name)).join(', '));
  }

  return {
    kindLabel: t(kindLabelKey(item.kind)),
    // ⚠️ Төслийн мөрийн гарчиг НЬ төслийн нэр тул давтахгүйн тулд
    //    богиносгосон нэрийг гол мөр болгоно.
    main: isProjectRow ? shortProject : item.title,
    project: isProjectRow ? '' : shortProject,
    projectFull: rawProject,
    meta,
  };
}
