/**
 * Чөлөөний шалтгаан (reason_code) болон журмын зөөлөн хязгаар.
 *
 * Эх сурвалж: Дотоод журам MGL-HR/0124, "АРВАН НЭГ. ЧӨЛӨӨ ОЛГОХ ЖУРАМ".
 * Шалтгаан бүрд:
 *   - `leave_type`    — DB-ийн өргөн ангилал (CHECK constraint-той тааруулна)
 *   - `is_paid`       — цалинтай эсэх
 *   - `day_cap`       — нэг удаагийн өдрийн хязгаар (хэрэв байгаа бол)
 *   - `hour_cap`      — нэг удаагийн цагийн хязгаар (хэрэв байгаа бол)
 *   - `monthly_cap_days` — нэг сард авах нийт өдрийн хязгаар (11.7)
 *   - `quarterly_uses`   — улирлын хязгаарт удаагийн тоо (11.5.5)
 *   - `rule_id`       — журмын заалт (UI-д харуулна)
 *
 * Сэрэмжлүүлэг нь зөвхөн UX зөвлөмж — серверт хатуу хорихгүй.  Админ
 * хүсэлтийг хэвээр зөвшөөрөх боломжтой.  Sums нь сард, улиралд яг хэдэн
 * хоног/удаа зарцуулагдсаныг харьцуулна.
 */

export type LeaveTypeKey = 'annual' | 'sick' | 'unpaid' | 'remote' | 'other';
/** Өдрийн хэсгээр авах чөлөө.  ЗӨВХӨН 'am'.  'pm' нэмэхээс ӨМНӨ
 *  `routes/attendance.ts`-ийн хоцролтын тооцоог цаг мэддэг болгоно — тэр нь
 *  одоо sub-day чөлөөг ээлжийн ЭХЭНД байна гэж үздэг. */
export type LeaveDayPart = 'am';

export interface LeavePolicyEntry {
  code: string;
  label: string;
  leave_type: LeaveTypeKey;
  is_paid: boolean;
  day_cap?: number;
  hour_cap?: number;
  monthly_cap_days?: number;
  quarterly_uses?: number;
  /** Заавал тогтмол өдрийн хэсэг.  Утга байвал сервер клиентийн
   *  start_time/end_time/hours-ийг БҮРЭН үл хайхран өөрөө гаргана. */
  fixed_day_part?: LeaveDayPart;
  /** Тогтсон ӨДРИЙН компанийн арга хэмжээ (жнь: хичээлийн нээлт).  Утга
   *  байвал UI нь огноог хамгийн эрт зөвшөөрөгдсөн өдөрт ЦООЖИЛЖ, шалтгааныг
   *  `label`-аар автоматаар бөглөнө — ажилтан зөвхөн «Илгээх» дарна.
   *  ⚠️ Зөвхөн UI-ийн хөнгөвчлөл.  Сервер огноог ХЯЗГААРЛАХГҮЙ: админы
   *  «нөхөж бүртгэх» зам өнгөрсөн огноогоор бичих ёстой хэвээр. */
  fixed_event?: boolean;
  rule_id: string;
  /** UI-д грүпп болгож харуулах хэсэг. */
  group: 'standard' | 'paid_special' | 'unpaid';
}

export const LEAVE_POLICY: LeavePolicyEntry[] = [
  // Үндсэн ангилал
  {
    code: 'annual_vacation',
    label: 'Ээлжийн амралт',
    leave_type: 'annual',
    is_paid: true,
    rule_id: 'ХЗ',
    group: 'standard',
  },
  {
    code: 'sick',
    label: 'Өвчтэй (эмчийн магадлагаа)',
    leave_type: 'sick',
    // 2026-10-13 (эзэн): цалингүй.  leave_type 'sick' хэвээр (шошго «Өвчтэй»),
    // цалингийн тооцоо `is_paid = 0`-оор цалингүйд тооцно (`lib/dayLeaves.ts`).
    is_paid: false,
    rule_id: '11.5',
    group: 'standard',
  },

  // 11.5 — цалинтай чөлөө
  // ─── 2026-06: дараах цалинтай чөлөөний төрлүүдийг чөлөөний хүсэлтээс
  // түр хассан.  Журам шинэчлэгдэх хүртэл comment хэлбэрээр үлдээв —
  // сэргээхдээ зөвхөн доорх /* */ хашилтыг авна.  Frontend дахь
  // frontend/src/features/attendance/leavePolicy.ts-тэй 1:1 ижил байлгана.
  /*
  {
    code: 'wedding',
    label: 'Хурим',
    leave_type: 'other',
    is_paid: true,
    day_cap: 3,
    rule_id: '11.5.1',
    group: 'paid_special',
  },
  */
  /*
  // Хичээлийн шинэ жилийн нээлт / цэцэрлэгийн арга хэмжээ (эзний шийдвэр).
  // Хүүхдээ хүргэж, нээлтийн ёслолд оролцох ҮДЭЭС ӨМНӨХ 4 цагийн ЦАЛИНТАЙ чөлөө.
  {
    code: 'school_opening',
    label: 'Хүүхдийн хичээлийн нээлт',
    leave_type: 'other',
    is_paid: true,
    hour_cap: 4,
    fixed_day_part: 'am',
    fixed_event: true,
    rule_id: '—',
    group: 'paid_special',
  },
  */
  {
    code: 'spouse_childbirth',
    label: 'Эхнэр төрсөн',
    leave_type: 'other',
    is_paid: true,
    day_cap: 10,
    rule_id: '11.5.2',
    group: 'paid_special',
  },
  /*
  {
    code: 'sport_culture_event',
    label: 'Спорт/урлагийн арга хэмжээ',
    leave_type: 'other',
    is_paid: true,
    day_cap: 3,
    rule_id: '11.5.3',
    group: 'paid_special',
  },
  {
    code: 'exam',
    label: 'Улирлын/төгсөлтийн шалгалт',
    leave_type: 'other',
    is_paid: true,
    day_cap: 3,
    rule_id: '11.5.4',
    group: 'paid_special',
  },
  {
    code: 'thesis',
    label: 'Дипломын ажил',
    leave_type: 'other',
    is_paid: true,
    day_cap: 3,
    rule_id: '11.5.4',
    group: 'paid_special',
  },
  {
    code: 'medical_self',
    label: 'Эмнэлгийн шинжилгээ (өөрөө)',
    leave_type: 'sick',
    is_paid: true,
    hour_cap: 4,
    quarterly_uses: 1,
    rule_id: '11.5.5',
    group: 'paid_special',
  },
  {
    code: 'medical_child',
    label: 'Эмнэлгийн шинжилгээ (хүүхэд, ≤16 нас)',
    leave_type: 'sick',
    is_paid: true,
    hour_cap: 4,
    quarterly_uses: 1,
    rule_id: '11.5.5',
    group: 'paid_special',
  },
  */
  {
    code: 'school_police',
    label: 'School police эргүүл',
    leave_type: 'other',
    is_paid: true,
    hour_cap: 4,
    rule_id: '11.5.6',
    group: 'paid_special',
  },
  {
    code: 'bereavement_ub',
    label: 'Гашуудал — Улаанбаатарт',
    leave_type: 'other',
    is_paid: true,
    day_cap: 3,
    rule_id: '11.5.7',
    group: 'paid_special',
  },
  {
    code: 'bereavement_rural',
    label: 'Гашуудал — орон нутагт',
    leave_type: 'other',
    is_paid: true,
    day_cap: 5,
    rule_id: '11.5.7',
    group: 'paid_special',
  },
  /*
  {
    code: 'family_emergency',
    label: 'Гэр бүлийн давагдашгүй нөхцөл',
    leave_type: 'other',
    is_paid: true,
    day_cap: 3,
    rule_id: '11.5.8',
    group: 'paid_special',
  },
  {
    code: 'family_emergency_travel',
    label: 'Гэр бүлийн нөхцөл — хөдөө/гадаад',
    leave_type: 'other',
    is_paid: true,
    day_cap: 10,
    rule_id: '11.5.8',
    group: 'paid_special',
  },
  */

  // 11.6 / 11.7 — цалингүй
  {
    code: 'unpaid',
    label: 'Цалингүй чөлөө',
    leave_type: 'unpaid',
    is_paid: false,
    monthly_cap_days: 3,
    rule_id: '11.7',
    group: 'unpaid',
  },
  {
    code: 'unpaid_long',
    label: 'Урт хугацааны цалингүй',
    leave_type: 'unpaid',
    is_paid: false,
    rule_id: '11.8',
    group: 'unpaid',
  },

  // Бусад — хуучин бичлэгүүд эсвэл онцгой тохиолдол
  /*
  {
    code: 'other_paid',
    label: 'Бусад (цалинтай)',
    leave_type: 'other',
    is_paid: true,
    rule_id: '—',
    group: 'paid_special',
  },
  */
  {
    code: 'other_unpaid',
    label: 'Бусад (цалингүй)',
    leave_type: 'unpaid',
    is_paid: false,
    monthly_cap_days: 3,
    rule_id: '11.6',
    group: 'unpaid',
  },
];

const POLICY_BY_CODE: Record<string, LeavePolicyEntry> = Object.fromEntries(
  LEAVE_POLICY.map((p) => [p.code, p]),
);

export function findLeavePolicy(code: string | null | undefined): LeavePolicyEntry | null {
  if (!code) return null;
  return POLICY_BY_CODE[code] ?? null;
}

/** Журмын 11.3 — 1 сараас дээш чөлөөг Ерөнхий захирлын тушаалаар. */
export const CEO_APPROVAL_DAY_THRESHOLD = 30;

export interface PolicyWarningInput {
  /** Хүсэлтийн reason_code. */
  code: string | null | undefined;
  /** Нэг удаагийн хүсэлтийн өдөр (decimal — 0.5 хагас өдөр). */
  days: number;
  /** Нэг удаагийн хүсэлтийн цаг (хагас өдрийн / цагийн хүрээг тооцох). */
  hours: number | null;
  /** Хүсэлт ороход байсан тухайн сарын цалингүй чөлөөний нийт өдөр. */
  monthlyUnpaidDaysUsed?: number;
  /** Хүсэлт ороход байсан тухайн улирлын ижил кодын ашиглалтын тоо. */
  quarterlyUsesUsed?: number;
}

/**
 * Зөөлөн сэрэмжлүүлэг үүсгэнэ.  Сервер хүсэлтийг хориглохгүй —
 * UI / админ дэлгэц энэ массивыг харуулна.
 */
export function computePolicyWarnings(input: PolicyWarningInput): string[] {
  const policy = findLeavePolicy(input.code);
  const warnings: string[] = [];
  if (!policy) return warnings;

  if (policy.day_cap !== undefined && input.days > policy.day_cap) {
    warnings.push(
      `${policy.rule_id}-р заалт: ${policy.label} нь ${policy.day_cap} өдрөөр хязгаарлагдсан (хүссэн: ${input.days} өдөр).`,
    );
  }
  if (policy.hour_cap !== undefined && input.hours !== null && input.hours > policy.hour_cap) {
    warnings.push(
      `${policy.rule_id}-р заалт: ${policy.label} нь ${policy.hour_cap} цагаар хязгаарлагдсан (хүссэн: ${input.hours} цаг).`,
    );
  }
  if (
    policy.monthly_cap_days !== undefined &&
    input.monthlyUnpaidDaysUsed !== undefined &&
    input.monthlyUnpaidDaysUsed + input.days > policy.monthly_cap_days
  ) {
    warnings.push(
      `${policy.rule_id}-р заалт: цалингүй чөлөө сард ${policy.monthly_cap_days} хоногоор хязгаарлагдсан ` +
        `(өмнө: ${input.monthlyUnpaidDaysUsed}, шинээр: ${input.days}).`,
    );
  }
  if (
    policy.quarterly_uses !== undefined &&
    input.quarterlyUsesUsed !== undefined &&
    input.quarterlyUsesUsed + 1 > policy.quarterly_uses
  ) {
    warnings.push(
      `${policy.rule_id}-р заалт: ${policy.label}-ийг улиралд ${policy.quarterly_uses} удаа л авах боломжтой.`,
    );
  }
  if (input.days >= CEO_APPROVAL_DAY_THRESHOLD) {
    warnings.push('11.3-р заалт: 1 сараас дээш чөлөө — Ерөнхий захирлын тушаал шаардлагатай.');
  }
  return warnings;
}

/**
 * Огнооноос YYYY-MM (сар) гарга.
 */
export function ymOf(date: string): string {
  return date.slice(0, 7);
}

/**
 * Огнооноос YYYY-Q (улирал) гарга.
 */
export function yqOf(date: string): string {
  const y = date.slice(0, 4);
  const m = parseInt(date.slice(5, 7), 10);
  const q = Math.ceil(m / 3);
  return `${y}-Q${q}`;
}
