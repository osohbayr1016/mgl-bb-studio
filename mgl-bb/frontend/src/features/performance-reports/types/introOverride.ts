/* =============================================================
 * «1. Төслийн танилцуулга» блокийн засварлагдах агуулга.
 * -------------------------------------------------------------
 * `project-intro` блок урьд нь бүрэн авто (Record<string, never>)
 * байсан тул редактор дээр юу ч бичсэн Урьдчилан харах хэсэгт
 * тусдаггүй байв.  Одоо блокийн `content_json` дотор override
 * хадгална — DB migration шаардлагагүй (backend `content` талбарыг
 * opaque JSON-оор дамжуулдаг).
 *
 * ЧУХАЛ: override-ийн талбар `undefined` бол авто утга ялна.
 * Хоосон мөр ('') нь ХЭРЭГЛЭГЧИЙН утга — «цэвэрлэсэн» гэсэн үг тул
 * авто утгаар дүүргэхгүй.  Тиймээс бүх шалгалт `=== undefined`.
 * ============================================================= */

/** Тогтмол дараалалтай дисциплинүүд — 1.1-ийн ■ мөр ба 1.2-ын хүснэгт
 *  хоёулаа үүнээс уншина (жишиг тайлантай ижил дараалал). */
export const INTRO_DISCIPLINES: ReadonlyArray<{ code: string; mn: string; label: string }> = [
  { code: 'EZ', mn: 'Эскиз зураг', label: 'ЭЗ' },
  { code: 'ET', mn: 'Орчны ЕТ, өндөржилт', label: 'ЕТ' },
  { code: 'BA', mn: 'Барилга архитектур', label: 'БА' },
  { code: 'BB', mn: 'Барилга бүтээц', label: 'ББ' },
  { code: 'HAS', mn: 'Халаалт агаар сэлгэлт', label: 'ХАС' },
  { code: 'TSBU', mn: 'Дотор цэвэр бохир ус', label: 'ЦБУ' },
  { code: 'TSAH', mn: 'Дотор цахилгаан', label: 'ЦАХ' },
  { code: 'HD', mn: 'Дотор холбоо дохиолол', label: 'ХД' },
  { code: 'AU', mn: 'Автоматжуулалт', label: 'АУ' },
  { code: 'IZ', mn: 'Интерьер зураг', label: 'ИЗ' },
  { code: 'GT', mn: 'Гадна тохижилт', label: 'ГТ' },
];

export const DISCIPLINE_LABEL: Record<string, string> = Object.fromEntries(
  INTRO_DISCIPLINES.map((d) => [d.code, d.label]),
);
export const DISCIPLINE_MN: Record<string, string> = Object.fromEntries(
  INTRO_DISCIPLINES.map((d) => [d.code, d.mn]),
);

/* ---------- мөрийн төрлүүд ---------- */

/** 1.1-ийн доорх «Documents / Бичиг баримт» хүснэгтийн мөр. */
export interface IntroDocRow {
  id: string;
  name: string;
  no: string;
  date: string;
  description: string;
}

/** 1.2 «Scope of work» хүснэгтийн мөр. */
export interface IntroScopeRow {
  id: string;
  /** Дисциплины код (BA, BB…) — шошгыг DISCIPLINE_LABEL-аас гаргана. */
  code: string;
  /** Гараар давхар бичих боломжтой шошго. Хоосон бол code-оос гарна. */
  codeLabel: string;
  identification: string;
  /** «Team leader» — багийн ахлах. */
  leader: string;
  /** «Хариуцсан мэргэжилтэн» — жишиг Word баримтын 2 дахь нэрийн багана.
   *  Багана нь ЗӨВХӨН аль нэг мөрөнд утга байвал л гарна (`ProjectIntroPage`
   *  дэх `hasSpecialist`) — хуучин тайлангийн байрлал хөдлөхгүй. */
  specialist: string;
  fileName: string;
}

/** 1.3 зүүн талын хугацааны мөр. */
export interface IntroTimelineRow {
  id: string;
  labelEn: string;
  labelMn: string;
  date: string;
}

/** 1.3 баруун талын «Meeting schedule» мөр. */
export interface IntroMeetingRow {
  id: string;
  label: string;
  date: string;
}

/** «Зургийн файл хадгалах загвар» тайлбарын хайрцаг. */
export interface IntroFileNamingNote {
  title: string;
  pattern: string;
  lines: string[];
}

/* ---------- override / model ---------- */

export interface IntroOverride {
  projectTitle?: string;
  clientName?: string;
  drawingNo?: string;
  /** «Doc. No.» — паспортын `doc_no`-оос автоматаар ирнэ (миграц 0246). */
  docNo?: string;
  scope?: string;
  location?: string;
  director?: string;
  ceo?: string;
  disciplines?: string[];
  documents?: IntroDocRow[];
  scopeRows?: IntroScopeRow[];
  timeline?: IntroTimelineRow[];
  meetings?: IntroMeetingRow[];
  fileNamingNote?: IntroFileNamingNote;
  /** Тайлбарын хайрцгийг нуух (анхдагч: харагдана). */
  hideFileNamingNote?: boolean;
}

/** Авто эх сурвалж (passport + project + teams) — override байхгүй үед ялна. */
export interface IntroAuto {
  projectTitle: string;
  clientName: string;
  drawingNo: string;
  docNo: string;
  scope: string;
  location: string;
  director: string;
  ceo: string;
  disciplines: string[];
  documents: IntroDocRow[];
  scopeRows: IntroScopeRow[];
  timeline: IntroTimelineRow[];
  meetings: IntroMeetingRow[];
}

/** Render-д бэлэн, бүх талбар дүүрсэн загвар. */
export interface IntroModel extends IntroAuto {
  fileNamingNote: IntroFileNamingNote;
  hideFileNamingNote: boolean;
}

export const DEFAULT_FILE_NAMING_NOTE: IntroFileNamingNote = {
  title: 'Зургийн файл хадгалах загвар',
  pattern: 'YYMMDD_PROJECT ID_DISCIPLINE_REVISION NO*.',
  lines: [
    '*A,B,C… -Revision for review-Ажлын явцын өөрчлөлт',
    '01,02,03..-Revision for expertise-Экспертизийн өөрчлөлт',
  ],
};

export const DEFAULT_TIMELINE: IntroTimelineRow[] = [
  { id: 'tl-start', labelEn: 'Start', labelMn: 'Эхлэх', date: '' },
  { id: 'tl-finish', labelEn: 'Finish', labelMn: 'Дуусах', date: '' },
  { id: 'tl-ext', labelEn: 'Extension', labelMn: 'Сунгалт', date: '' },
];

/* Богино id — React key ба мөр нэмэх/хасахад л хэрэгтэй. */
export function rowId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Runtime parser — буруу төрөлтэй талбарыг чимээгүй хаяна (undefined болгоно),
 *  ингэснээр авто утга ялж, preview хэзээ ч хоосорохгүй. */
export function parseIntroOverride(raw: unknown): IntroOverride | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const out: IntroOverride = {
    projectTitle: str(r.projectTitle),
    clientName: str(r.clientName),
    drawingNo: str(r.drawingNo),
    docNo: str(r.docNo),
    scope: str(r.scope),
    location: str(r.location),
    director: str(r.director),
    ceo: str(r.ceo),
  };
  if (Array.isArray(r.disciplines)) {
    out.disciplines = r.disciplines.filter((x): x is string => typeof x === 'string');
  }
  if (Array.isArray(r.documents)) {
    out.documents = r.documents.map((x, i) => {
      const d = (x ?? {}) as Record<string, unknown>;
      return {
        id: str(d.id) ?? `doc-${i}`,
        name: str(d.name) ?? '',
        no: str(d.no) ?? '',
        date: str(d.date) ?? '',
        description: str(d.description) ?? '',
      };
    });
  }
  if (Array.isArray(r.scopeRows)) {
    out.scopeRows = r.scopeRows.map((x, i) => {
      const s = (x ?? {}) as Record<string, unknown>;
      return {
        id: str(s.id) ?? `sc-${i}`,
        code: str(s.code) ?? '',
        codeLabel: str(s.codeLabel) ?? '',
        identification: str(s.identification) ?? '',
        leader: str(s.leader) ?? '',
        specialist: str(s.specialist) ?? '',
        fileName: str(s.fileName) ?? '',
      };
    });
  }
  if (Array.isArray(r.timeline)) {
    out.timeline = r.timeline.map((x, i) => {
      const t = (x ?? {}) as Record<string, unknown>;
      return {
        id: str(t.id) ?? `tl-${i}`,
        labelEn: str(t.labelEn) ?? '',
        labelMn: str(t.labelMn) ?? '',
        date: str(t.date) ?? '',
      };
    });
  }
  if (Array.isArray(r.meetings)) {
    out.meetings = r.meetings.map((x, i) => {
      const m = (x ?? {}) as Record<string, unknown>;
      return {
        id: str(m.id) ?? `mt-${i}`,
        label: str(m.label) ?? '',
        date: str(m.date) ?? '',
      };
    });
  }
  if (r.fileNamingNote && typeof r.fileNamingNote === 'object') {
    const n = r.fileNamingNote as Record<string, unknown>;
    out.fileNamingNote = {
      title: str(n.title) ?? DEFAULT_FILE_NAMING_NOTE.title,
      pattern: str(n.pattern) ?? DEFAULT_FILE_NAMING_NOTE.pattern,
      lines: Array.isArray(n.lines)
        ? n.lines.filter((x): x is string => typeof x === 'string')
        : DEFAULT_FILE_NAMING_NOTE.lines,
    };
  }
  if (typeof r.hideFileNamingNote === 'boolean') out.hideFileNamingNote = r.hideFileNamingNote;

  // undefined-ээр дүүрсэн талбаруудыг арилгаж цэвэр объект буцаана.
  for (const k of Object.keys(out)) {
    if ((out as Record<string, unknown>)[k] === undefined) {
      delete (out as Record<string, unknown>)[k];
    }
  }
  return out;
}

/** override ⊕ auto → render-д бэлэн загвар.  `undefined` л авто утга авна. */
export function resolveIntroModel(
  override: IntroOverride | null | undefined,
  auto: IntroAuto,
): IntroModel {
  const o = override ?? {};
  function pick<T>(a: T | undefined, b: T): T {
    return a === undefined ? b : a;
  }
  return {
    projectTitle: pick(o.projectTitle, auto.projectTitle),
    clientName: pick(o.clientName, auto.clientName),
    drawingNo: pick(o.drawingNo, auto.drawingNo),
    docNo: pick(o.docNo, auto.docNo),
    scope: pick(o.scope, auto.scope),
    location: pick(o.location, auto.location),
    director: pick(o.director, auto.director),
    ceo: pick(o.ceo, auto.ceo),
    disciplines: pick(o.disciplines, auto.disciplines),
    documents: pick(o.documents, auto.documents),
    scopeRows: pick(o.scopeRows, auto.scopeRows),
    timeline: pick(o.timeline, auto.timeline),
    meetings: pick(o.meetings, auto.meetings),
    fileNamingNote: pick(o.fileNamingNote, DEFAULT_FILE_NAMING_NOTE),
    hideFileNamingNote: pick(o.hideFileNamingNote, false),
  };
}
