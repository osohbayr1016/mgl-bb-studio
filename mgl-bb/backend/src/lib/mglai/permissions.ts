/**
 * MGL AI · REVIT ЭРХИЙН ШАТ (§24) + ХЭРЭГСЛИЙН ХААЛГА (§23).
 *
 * ⚠️ ХАМГИЙН ЧУХАЛ ДҮРЭМ: МӨР БАЙХГҮЙ = `READ_ONLY`.  `ai_permission_
 *    profiles`-д мөргүй хэрэглэгч нь «тохируулаагүй» биш «зөвхөн уншина».
 *    Эсрэгээр бичих нь нэг INSERT мартагдахад бүх ажилтанд бичих эрх
 *    өгнө — 0239-ийн `no_row` сургамжтай ижил.
 *
 * ⚠️ ХЭРЭГЛЭГЧ ӨӨРИЙГӨӨ ДЭЭШЛҮҮЛЖ ЧАДАХГҮЙ.  Энэ файл нь ЗӨВХӨН
 *    ШИЙДВЭР гаргана — олголт нь `requireAdmin()`-ээр хамгаалагдсан
 *    маршрут ба 0273-ийн `granted_by <> user_id` CHECK хоёрын ажил.
 *
 * ⚠️ ROSLYN НЬ ШАТНААС ГАДУУР.  `FULL_AGENT` ч дур мэдэн C# ажиллуулахгүй.
 *    `revit-mcp/server/`-ийн баталгаажаагүй localhost Roslyn нь репогийн
 *    мэдэгдэж буй аюулгүй байдлын #7 — MGL AI түүнийг ӨРГӨТГӨХГҮЙ.
 *
 * ⚠️ ХЭРЭГСЛИЙГ НЭРЭЭР НЬ ГҮЙЦЭТГЭХГҮЙ.  Загварын сонгосон нэр нь ЭНД
 *    бүртгэгдсэн олонлогтой тулгагдана.  Реflection-ээр дуудах нь
 *    хорлогдсон ярианы түүхэд шинэ хэрэгсэл ЗОХИОХ боломж өгнө
 *    (`lib/revitAgent.ts`-ийн `ALLOWED_TOOLS` дээр сурсан сургамж).
 */

export const REVIT_LEVELS = [
  'READ_ONLY',
  'SAFE_WRITE',
  'CONFIRM_EVERY_WRITE',
  'PROJECT_ADMIN',
  'FULL_AGENT',
] as const;
export type RevitLevel = (typeof REVIT_LEVELS)[number];

export function isRevitLevel(v: unknown): v is RevitLevel {
  return typeof v === 'string' && (REVIT_LEVELS as readonly string[]).includes(v);
}

/** Хэрэгслийн эрсдэлийн ангилал — 0271-ийн `tool_kind`-тай ЯГ ижил. */
export const TOOL_KINDS = ['read', 'view', 'write', 'admin'] as const;
export type ToolKind = (typeof TOOL_KINDS)[number];

export interface AiPermissionProfile {
  revitLevel: RevitLevel;
  erpWriteEnabled: boolean;
  roslynEnabled: boolean;
  maxToolIterations: number;
  /** Хоосон массив = «бүх төсөл» БИШ, «хязгаарлаагүй» гэсэн утга. */
  projectScope: number[];
}

/**
 * ⚠️ БАЙХГҮЙ МӨРИЙН ӨГӨГДМӨЛ.  Энэ объектыг өөрчлөх нь бүх хэрэглэгчийн
 *    эрхийг нэг мөрөөр өөрчилнө — тестээр хаагдсан.
 */
export const DEFAULT_PROFILE: AiPermissionProfile = Object.freeze({
  revitLevel: 'READ_ONLY',
  erpWriteEnabled: false,
  roslynEnabled: false,
  maxToolIterations: 8,
  projectScope: [],
});

export type ToolDecision =
  | { allow: true; requiresConfirmation: boolean; reason: 'auto' | 'confirm' }
  | { allow: false; requiresConfirmation: false; reason: ToolDenyReason };

export type ToolDenyReason =
  | 'unknown_tool'
  | 'client_mode'
  | 'denied_mode'
  | 'level_too_low'
  | 'roslyn_disabled'
  | 'erp_write_disabled'
  | 'project_out_of_scope';

/** Бичих хэрэгсэл хамгийн багадаа ямар түвшин шаардах вэ. */
const WRITE_MIN_LEVEL: Record<ToolKind, number> = {
  read: 0, // READ_ONLY
  view: 0, // харагдацыг л өөрчилнө, буцаагдана
  write: 1, // SAFE_WRITE
  admin: 3, // PROJECT_ADMIN
};

function levelIndex(level: RevitLevel): number {
  return REVIT_LEVELS.indexOf(level);
}

export interface ToolDecisionInput {
  mode: 'client' | 'employee' | 'admin' | 'denied';
  profile: AiPermissionProfile;
  toolKind: ToolKind;
  /** Бүртгэлд байгаа эсэх — дуудагч бүртгэлээс хайж дамжуулна. */
  known: boolean;
  /** Roslyn / дур мэдсэн код ажиллуулах хэрэгсэл эсэх. */
  isRoslyn?: boolean;
  /** ERP-ийн төлөвийг өөрчилдөг хэрэгсэл эсэх. */
  isErpWrite?: boolean;
  /** Хэрэв хэрэгсэл төсөлд хамаарвал түүний id. */
  projectId?: number | null;
}

/**
 * ⚠️ ЦЭВЭР ШИЙДВЭР — D1 хамааралгүй, `node --test`-ээр бүрэн хэмжигдэнэ.
 *
 * Дараалал нь ЧУХАЛ: танихгүй хэрэгсэл ЭХЛЭЭД хаагдана, дараа нь горим,
 * дараа нь тусгай тугууд, эцэст нь шат.  Ингэснээр `client` горимд
 * танихгүй хэрэгсэл нь `unknown_tool` гэж хариулах ба `client_mode` гэж
 * хэлж «энэ хэрэгсэл ОРШИН БАЙНА» гэдгийг задруулахгүй.
 */
export function decideTool(input: ToolDecisionInput): ToolDecision {
  const deny = (reason: ToolDenyReason): ToolDecision => ({
    allow: false,
    requiresConfirmation: false,
    reason,
  });

  if (!input.known) return deny('unknown_tool');
  if (input.mode === 'denied') return deny('denied_mode');

  // Захиалагч нь ЗӨВХӨН уншина.  Түвшний профайл нь захиалагчид огт
  // хамаарахгүй — эрх нь горимоос ирнэ, мөрөөс биш.
  if (input.mode === 'client') {
    return input.toolKind === 'read'
      ? { allow: true, requiresConfirmation: false, reason: 'auto' }
      : deny('client_mode');
  }

  if (input.isRoslyn && !input.profile.roslynEnabled) return deny('roslyn_disabled');
  if (input.isErpWrite && !input.profile.erpWriteEnabled) return deny('erp_write_disabled');

  if (
    input.projectId != null &&
    input.profile.projectScope.length > 0 &&
    !input.profile.projectScope.includes(input.projectId)
  ) {
    return deny('project_out_of_scope');
  }

  const have = levelIndex(input.profile.revitLevel);
  const need = WRITE_MIN_LEVEL[input.toolKind];
  if (have < need) return deny('level_too_low');

  // Баталгаажуулалт шаардах эсэх.
  //   read/view       — хэзээ ч биш
  //   бусад бүх бичилт — CONFIRM_EVERY_WRITE ба түүнээс доош ЗААВАЛ,
  //                      FULL_AGENT дээр Л автомат.
  const isWrite = input.toolKind === 'write' || input.toolKind === 'admin';
  if (!isWrite) return { allow: true, requiresConfirmation: false, reason: 'auto' };

  const auto = input.profile.revitLevel === 'FULL_AGENT';
  return auto
    ? { allow: true, requiresConfirmation: false, reason: 'auto' }
    : { allow: true, requiresConfirmation: true, reason: 'confirm' };
}

/**
 * D1-ийн мөрийг профайл болгоно.  ⚠️ `null` мөр нь `DEFAULT_PROFILE`
 * буцаана — «мөргүй = READ_ONLY» дүрмийн ГАНЦ хэрэгжүүлэлт.
 */
export function profileFromRow(row: Record<string, unknown> | null | undefined): AiPermissionProfile {
  if (!row) return { ...DEFAULT_PROFILE, projectScope: [] };

  const level = isRevitLevel(row.revit_level) ? row.revit_level : DEFAULT_PROFILE.revitLevel;

  let scope: number[] = [];
  if (typeof row.project_scope_json === 'string') {
    try {
      const parsed: unknown = JSON.parse(row.project_scope_json);
      if (Array.isArray(parsed)) {
        scope = parsed.filter((n): n is number => Number.isInteger(n) && (n as number) > 0);
      }
    } catch {
      // Эвдэрсэн JSON нь «хязгааргүй» гэсэн утга ОЛГОХГҮЙ — хоосон үлдэнэ,
      // тэр нь хамгийн хатуу биш ч хамгийн урьдчилан таамаглахуйц.
      scope = [];
    }
  }

  const iters = Number(row.max_tool_iterations);

  return {
    revitLevel: level,
    erpWriteEnabled: row.erp_write_enabled === 1,
    roslynEnabled: row.roslyn_enabled === 1,
    maxToolIterations:
      Number.isInteger(iters) && iters > 0 && iters <= 32 ? iters : DEFAULT_PROFILE.maxToolIterations,
    projectScope: scope,
  };
}

/** Хугацаа нь дууссан профайл нь ӨГӨГДМӨЛ рүү унана — сунгах нь админы ажил. */
export function profileExpired(expiresAt: string | null | undefined, nowIso: string): boolean {
  if (!expiresAt) return false;
  return expiresAt <= nowIso;
}
