/**
 * Дотоод журам MGL-HR/0124, "АРВАН НЭГ. ЧӨЛӨӨ ОЛГОХ ЖУРАМ"-ын
 * нарийвчилсан шалтгаан (reason_code) каталог.
 *
 * Backend дахь `backend/src/lib/leavePolicy.ts` файлтай 1:1 толиор үлдэх
 * ёстой — серверийн валидаци + UI-ийн зөвлөмж нэг л зөв таксономд
 * найдах учиртай.  Хэрэв энд код нэмбэл backend-д бас нэмнэ.
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
  group: 'standard' | 'paid_special' | 'unpaid';
}

export const LEAVE_POLICY: LeavePolicyEntry[] = [
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
  // ─── 2026-06: дараах цалинтай чөлөөний төрлүүдийг чөлөөний хүсэлтээс
  // түр хассан.  Журам шинэчлэгдэх хүртэл comment хэлбэрээр үлдээв —
  // сэргээхдээ зөвхөн доорх /* */ хашилтыг авна.  Backend дахь
  // backend/src/lib/leavePolicy.ts-тэй 1:1 ижил байлгана.
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

export const POLICY_BY_CODE: Record<string, LeavePolicyEntry> = Object.fromEntries(
  LEAVE_POLICY.map((p) => [p.code, p]),
);

export function findLeavePolicy(code: string | null | undefined): LeavePolicyEntry | null {
  if (!code) return null;
  return POLICY_BY_CODE[code] ?? null;
}

/** Журмын 11.3 — 1 сараас дээш чөлөөг ЕЗ-ын тушаалаар. */
export const CEO_APPROVAL_DAY_THRESHOLD = 30;

export const GROUP_LABEL: Record<LeavePolicyEntry['group'], string> = {
  standard: 'Үндсэн',
  paid_special: 'Цалинтай чөлөө (11.5)',
  unpaid: 'Цалингүй (11.6 / 11.7)',
};

/** Журмын каталогийг UI-д грүпп болгож бэлдэнэ. */
export function groupPolicy(): { group: LeavePolicyEntry['group']; label: string; items: LeavePolicyEntry[] }[] {
  const buckets = new Map<LeavePolicyEntry['group'], LeavePolicyEntry[]>();
  for (const p of LEAVE_POLICY) {
    const arr = buckets.get(p.group) ?? [];
    arr.push(p);
    buckets.set(p.group, arr);
  }
  // 2026-06: жагсаалтад цалингүй бүлгийг хамгийн дээр, үндсэнийг хамгийн доор.
  return (['unpaid', 'paid_special', 'standard'] as const).map((g) => ({
    group: g,
    label: GROUP_LABEL[g],
    items: buckets.get(g) ?? [],
  }));
}

/** Хуучин бичлэгийн leave_type-аас reason_code-г оноох (back-compat). */
export function fallbackCodeFromType(type: LeaveTypeKey | string | null | undefined): string | null {
  switch (type) {
    case 'annual':
      return 'annual_vacation';
    case 'sick':
      return 'sick';
    case 'unpaid':
      return 'unpaid';
    case 'other':
      return 'other_paid';
    default:
      return null;
  }
}

/** UI дээр шууд харуулах товч хязгаарын тайлбар. */
export function policyLimitSummary(p: LeavePolicyEntry): string {
  const parts: string[] = [];
  if (p.day_cap !== undefined) parts.push(`нэг удаад ≤ ${p.day_cap} өдөр`);
  if (p.hour_cap !== undefined) parts.push(`нэг удаад ≤ ${p.hour_cap} цаг`);
  if (p.monthly_cap_days !== undefined) parts.push(`сард ≤ ${p.monthly_cap_days} хоног`);
  if (p.quarterly_uses !== undefined) parts.push(`улиралд ${p.quarterly_uses} удаа`);
  if (parts.length === 0) parts.push('хязгааргүй');
  return parts.join(' · ');
}
