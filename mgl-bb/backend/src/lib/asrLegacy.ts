/**
 * Зохиогчийн хяналт — ХУУЧИН тайлан нөхөж бүртгэх (миграц 0332): ЦЭВЭР хэсэг.
 *
 * Систем нэвтрэхээс өмнө ЗХ-ийн тайлан нь Word загвар байсан:
 *
 *     YYMMDD_<ТӨСӨЛ>_ASR_<БАГ>_<NNN>.docx      → 260519_EVGR_ASR_BB_005.pdf
 *
 * бөгөөд төслийн Google Drive хавтсанд хадгалагддаг.  Файлын НЭР л өөрөө
 * гурван баримт агуулна: очилтын огноо, баг, багийн доторх дугаар.  Энэ
 * файл тэр нэрийг задалж, docx/pdf хосыг нэг тайлан болгож бүлэглэж, зорилтот
 * төслийг санал болгож, зөөлөн давхардлыг илрүүлнэ.  D1/Drive-тай ХЭЗЭЭ Ч
 * харьцахгүй — `asrLegacy.test.ts` бүгдийг барина.
 *
 * ⚠️ Прод дээр хэмжсэн (2026-09-21) хэлбэрүүд, бүгд доорх regex-д багтана:
 *     250710_LUXWOOD_ASR_BB_001.docx           баг + дугаар
 *     260428_ТЕННИСНИЙ ОРДОН_ASR_BB.docx       дугааргүй
 *     260429_LUXWOOD_ASR_001.pdf               баггүй
 *     260911_MEC-23-09_ASR_001.docx            шифр-тэй нэр
 *     250910_PROJECT ID_ASR_TSBU_002.docx      загварын нэрийг солиогүй (гэхдээ огноотой)
 *     YYMMDD_PROJECT ID_ASR_BA_001.docx        ХООСОН ЗАГВАР — нэр дэвшигч БИШ
 *     ~$0910_PROJECT ID_ASR_TSBU_001.docx      Word-ийн түгжээний файл — БИШ
 */

/** Файлын нэрэнд гардаг багийн код → `teams.code`.  Кирилл хувилбар ч орно. */
const TEAM_ALIASES: Record<string, string> = {
  BA: 'BA',
  BB: 'BB',
  HAS: 'HAS',
  TSBU: 'TSBU',
  TSAH: 'TSAH',
  HD: 'HD',
  AU: 'AU',
  EZ: 'EZ',
  IZ: 'IZ',
  GT: 'GT',
  MGMT: 'MGMT',
  БА: 'BA',
  ББ: 'BB',
  ХАС: 'HAS',
  ЦБУ: 'TSBU',
  ЦАХ: 'TSAH',
  ХД: 'HD',
  АУ: 'AU',
  AУ: 'AU', // Word загварын мөрөнд латин A + кирилл У (asrTemplate.ts-ийн шошго)
};

export function normalizeTeamCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.trim().toUpperCase();
  return TEAM_ALIASES[key] ?? null;
}

export type LegacyFileKind =
  /** Огноо + ASR — жинхэнэ тайлангийн нэр дэвшигч. */
  | 'report'
  /** `YYMMDD_…` — бөглөөгүй загвар. */
  | 'template'
  /** `~$…` — Word-ийн түгжээний файл. */
  | 'lock'
  /** ASR/хяналт гэсэн үгтэй ч нэрээс огноо/баг гарахгүй — гараар. */
  | 'unrecognized'
  /** Огт хамааралгүй файл. */
  | 'none';

export interface LegacyFileName {
  kind: LegacyFileKind;
  /** `YYYY-MM-DD` (нэрний YYMMDD → 20YY). */
  date: string | null;
  /** «EVGR», «ТЕННИСНИЙ ОРДОН» — төслийн богино нэр (мэдээллийн зориулалттай). */
  projectTag: string | null;
  teamCode: string | null;
  seq: number | null;
  ext: 'docx' | 'doc' | 'pdf' | null;
  /** «ASR-BB-005», «ASR-001», «ASR-BB», эсвэл null. */
  legacyDocNo: string | null;
}

const REPORT_RE =
  /^(\d{6})[_ ]+(.*?)[_ ]*ASR(?:[_ \-]+([A-Za-zА-Яа-яӨөҮү]{2,5}))?(?:[_ \-]+(\d{1,3}))?(?:\s*\(\d+\))?\.(docx|doc|pdf)$/i;

function ymd(yymmdd: string): string | null {
  const yy = Number(yymmdd.slice(0, 2));
  const mm = Number(yymmdd.slice(2, 4));
  const dd = Number(yymmdd.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const year = 2000 + yy;
  const d = new Date(Date.UTC(year, mm - 1, dd));
  if (d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd) return null;
  return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

export function legacyDocNo(teamCode: string | null, seq: number | null): string | null {
  const num = seq != null ? String(seq).padStart(3, '0') : null;
  if (teamCode && num) return `ASR-${teamCode}-${num}`;
  if (num) return `ASR-${num}`;
  if (teamCode) return `ASR-${teamCode}`;
  return null;
}

export function parseLegacyAsrFileName(raw: string): LegacyFileName {
  const name = raw.trim();
  const none: LegacyFileName = {
    kind: 'none',
    date: null,
    projectTag: null,
    teamCode: null,
    seq: null,
    ext: null,
    legacyDocNo: null,
  };
  if (name.startsWith('~$')) return { ...none, kind: 'lock' };
  if (/^YYMMDD[_ ]/i.test(name)) return { ...none, kind: 'template' };

  const m = REPORT_RE.exec(name);
  if (m) {
    const date = ymd(m[1]!);
    const tag = m[2]!.replace(/_/g, ' ').replace(/\s{2,}/g, ' ').trim() || null;
    // Багийн бүлэг нь «PDF»/«docx» гэх мэт өргөтгөлтэй мөргөлдөхгүй (өргөтгөл
    // тусдаа бүлэгт); танигдаагүй үсгэн код (ж. «FINAL») баг биш — тагт үлдээнэ.
    let teamCode = normalizeTeamCode(m[3]);
    let projectTag = tag;
    if (m[3] && !teamCode) projectTag = [tag, m[3]].filter(Boolean).join(' ');
    const seq = m[4] != null ? Number(m[4]) : null;
    const ext = m[5]!.toLowerCase() as 'docx' | 'doc' | 'pdf';
    if (!date) {
      teamCode = teamCode ?? null;
      return { ...none, kind: 'unrecognized', projectTag, teamCode, seq, ext };
    }
    return {
      kind: 'report',
      date,
      projectTag,
      teamCode,
      seq: seq != null && Number.isFinite(seq) ? seq : null,
      ext,
      legacyDocNo: legacyDocNo(teamCode, seq),
    };
  }

  if (/asr/i.test(name) || /хяналт/i.test(name)) {
    const ext = /\.(docx|doc|pdf)$/i.exec(name)?.[1]?.toLowerCase() as
      | 'docx'
      | 'doc'
      | 'pdf'
      | undefined;
    return { ...none, kind: 'unrecognized', ext: ext ?? null };
  }
  return none;
}

/* ------------------------------------------------------------------ */
/*  Бүлэглэлт — docx + pdf = НЭГ тайлан                                 */
/* ------------------------------------------------------------------ */

export interface LegacyDriveFile {
  file_id: string;
  file_name: string;
  mime_type: string | null;
  /** Drive-ын `modifiedTime` (мэдээлэл — огноо биш, огноо нь нэрнээс). */
  modified_at: string | null;
  parsed: LegacyFileName;
}

export interface LegacyCandidate {
  /** `date|team|seq` — тогтвортой, клиент сонголтоо үүгээр барина. */
  key: string;
  date: string;
  team_code: string | null;
  seq: number | null;
  legacy_doc_no: string | null;
  project_tag: string | null;
  files: LegacyDriveFile[];
  /** docx байвал агуулгыг серверээр уншуулж болно. */
  has_docx: boolean;
}

/**
 * Ижил огноо + баг + дугаартай файлууд нэг очилтын хоёр хэлбэр (Word эх +
 * хэвлэсэн PDF) тул нэг нэр дэвшигч.  Дугаар/баггүй файл өөр өөр түлхүүртэй
 * учир тусдаа үлдэнэ — хэрэглэгч нэгтгэх шийдвэрийг гараар хийнэ.
 */
export function groupLegacyFiles(files: LegacyDriveFile[]): LegacyCandidate[] {
  const map = new Map<string, LegacyCandidate>();
  for (const f of files) {
    if (f.parsed.kind !== 'report' || !f.parsed.date) continue;
    const key = `${f.parsed.date}|${f.parsed.teamCode ?? ''}|${f.parsed.seq ?? ''}`;
    let c = map.get(key);
    if (!c) {
      c = {
        key,
        date: f.parsed.date,
        team_code: f.parsed.teamCode,
        seq: f.parsed.seq,
        legacy_doc_no: f.parsed.legacyDocNo,
        project_tag: f.parsed.projectTag,
        files: [],
        has_docx: false,
      };
      map.set(key, c);
    }
    c.files.push(f);
    if (f.parsed.ext === 'docx') c.has_docx = true;
  }
  const out = [...map.values()];
  // Огноогоор өсөхөөр, дараа нь баг/дугаараар — хуучин тайлан цаг хугацааны
  // дарааллаар орох нь л «зөв түүх».
  out.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.team_code ?? '').localeCompare(b.team_code ?? '') ||
      (a.seq ?? 0) - (b.seq ?? 0),
  );
  for (const c of out) c.files.sort((a, b) => a.file_name.localeCompare(b.file_name));
  return out;
}

/* ------------------------------------------------------------------ */
/*  Зорилтот төслийн санал                                              */
/* ------------------------------------------------------------------ */

export interface TargetMember {
  id: number;
  category: string | null;
  status: string | null;
  report_count: number;
}

/**
 * Эзний дүрэм (2026-09-21): хэрэглэгч сонгоно, өгөгдмөл нь
 *   идэвхтэй ZA → тайлантай гишүүн → ганц гишүүн → null (ЗХ төсөл үүсгэнэ).
 */
export function suggestTargetProject(members: TargetMember[]): number | null {
  const activeZa = members.find((m) => m.category === 'ZA' && m.status === 'active');
  if (activeZa) return activeZa.id;
  const withReports = [...members]
    .filter((m) => m.report_count > 0)
    .sort((a, b) => b.report_count - a.report_count);
  if (withReports[0]) return withReports[0].id;
  const anyZa = members.find((m) => m.category === 'ZA');
  if (anyZa) return anyZa.id;
  if (members.length === 1) return members[0]!.id;
  return null;
}

/* ------------------------------------------------------------------ */
/*  Зөөлөн давхардал                                                    */
/* ------------------------------------------------------------------ */

export interface ExistingReportLite {
  id: number;
  doc_no: string | null;
  report_date: string;
  /** group_concat(t.code) — `BA,BB`; null = баггүй. */
  team_codes: string | null;
}

/**
 * Ижил төсөл + ижил огноо + (дор хаяж нэг) ижил баг = «магадгүй давхардсан».
 * Баггүй нэр дэвшигч бол тэр өдрийн ДУРЫН тайлан давхардал (мэдээлэл дутуу
 * тул консерватив).  Эхний таарсан тайланг буцаана; байхгүй бол null.
 */
export function softDuplicateOf(
  existing: ExistingReportLite[],
  date: string,
  teamCodes: string[],
): ExistingReportLite | null {
  const wanted = new Set(teamCodes.map((c) => c.toUpperCase()));
  for (const r of existing) {
    if (r.report_date !== date) continue;
    if (wanted.size === 0) return r;
    const has = (r.team_codes ?? '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (has.length === 0) return r;
    if (has.some((c) => wanted.has(c))) return r;
  }
  return null;
}

/** Drive файлыг хөтөч дээр нээх — SA-ийн токен хэрэггүй, хэрэглэгчийн өөрийн эрхээр. */
export function driveViewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
}

/* ------------------------------------------------------------------ */
/*  Хяналт хийсэн хүн → users мөр                                       */
/* ------------------------------------------------------------------ */

export interface LegacyUserLite {
  id: number;
  full_name: string | null;
  username: string | null;
}

const foldName = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Хуучин тайлангийн гарын үсгийн мөрөнд бичсэн нэр («Б.Билгүүн», «Билгүүн»,
 * «Бат-Өлзий Билгүүн», «B.Bilguun») → ЯГ НЭГ хэрэглэгч таарвал түүний id.
 *
 * `users.full_name` нь «Овог Нэр» (Бат-Өлзий Билгүүн), `username` нь
 * «B.Bilguun» хэлбэртэй (2026-09-21-нд хэмжсэн).  Хоёр ба түүнээс олон
 * таарвал null — буруу хүнд очилт бүртгэхээс хоосон үлдээх нь дээр
 * (тэр үед импортлогч зохиогч болно, `legacy_author_name` текст хэвээр).
 */
export function matchLegacyAuthor(raw: string | null | undefined, users: LegacyUserLite[]): number | null {
  if (!raw) return null;
  // «Б.Батаа / MGL ENC инженер» — эхний хэсэг л нэр.
  const text = foldName(raw.split(/[\/,(]/)[0] ?? '');
  if (!text) return null;

  const hits = new Set<number>();
  for (const u of users) {
    const full = foldName(u.full_name ?? '');
    const uname = foldName(u.username ?? '');
    if (!full && !uname) continue;
    if (text === full || (uname && text === uname)) {
      hits.add(u.id);
      continue;
    }
    const parts = full.split(' ');
    const given = parts[parts.length - 1] ?? '';
    const surname = parts.length > 1 ? parts[0]! : '';
    if (!given) continue;
    // «Овог Нэр» урвуулсан «Нэр Овог»
    if (parts.length > 1 && text === `${given} ${surname}`) {
      hits.add(u.id);
      continue;
    }
    // Зөвхөн нэр («Билгүүн») — ганц хүнтэй л таарвал
    if (text === given) {
      hits.add(u.id);
      continue;
    }
    // «Б.Билгүүн» / «Б. Билгүүн» / «Б Билгүүн» — овгийн эхний үсэг + нэр
    // (цэг эсвэл зай ЗААВАЛ — эс бөгөөс «Ананд» нь «А + нанд» болно).
    const m = /^(\p{L})(?:\s*\.\s*|\s+)([\p{L}-]+)$/u.exec(text);
    if (m && m[2] === given && (!surname || surname.startsWith(m[1]!))) hits.add(u.id);
  }
  return hits.size === 1 ? [...hits][0]! : null;
}
