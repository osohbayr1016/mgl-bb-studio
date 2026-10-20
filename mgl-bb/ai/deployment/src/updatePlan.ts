/**
 * MGL AI · ШИНЭЧЛЭЛТИЙН ТӨЛӨВЛӨГӨӨ (Session B §12, §28).
 *
 *   суулгасан × манифест → ЗӨВХӨН ӨӨРЧЛӨГДСӨН бүрэлдэхүүн
 *
 * ⚠️ ХУВИЛБАР ИЖИЛ Ч SHA ӨӨР БОЛ ШИНЭЧЛЭНЭ.  Админ ижил хувилбарын
 *    дугаартай өөр файл нийтэлбэл (буруу, гэхдээ болдог) ажилтны машин
 *    манифестынхаас ӨӨР байтуудтай үлдэх ёсгүй — «1.2.0 суулгасан» гэсэн
 *    үг хоёр машинд хоёр өөр зүйл байх нь оношлогдохгүй.
 *
 * ⚠️ ЦЭВЭР ФУНКЦ.  Сүлжээ, диск байхгүй; тестүүд бүх хослолыг мс-д
 *    ажиллуулна (шинэчлэлт алга · зөвхөн загвар · зөвхөн мэдлэг · зөвхөн
 *    app · олон бүрэлдэхүүн · нийцгүй).
 */
import {
  checkCompatibility,
  compareVersions,
  type ComponentId,
  type ComponentSpec,
  type CompatibilityIssue,
  type ReleaseManifest,
} from './manifest.ts';
import type { InstalledState } from './installedState.ts';
import { versionsOf } from './installedState.ts';
import { isHardwareClass, meetsHardwareClass, type HardwareClass } from './hardwareClass.ts';

export type ActionReason = 'missing' | 'version' | 'sha' | 'forced';

export interface UpdateAction {
  component: ComponentId;
  from: string | null;
  to: string;
  reason: ActionReason;
  spec: ComponentSpec;
  /** Хувилбарыг БУУРУУЛЖ байна — зөвхөн `allowDowngrade` үед зөвшөөрнө. */
  downgrade: boolean;
}

export interface BlockedComponent {
  component: ComponentId;
  code: 'HARDWARE_CLASS_UNMET' | 'DOWNGRADE_REFUSED';
  detail: string;
}

export interface UpdatePlan {
  releaseId: string;
  channel: ReleaseManifest['channel'];
  actions: UpdateAction[];
  unchanged: ComponentId[];
  blocked: BlockedComponent[];
  issues: CompatibilityIssue[];
  /** Татах нийт байт (мэдэгдэхгүй хэмжээтэй нь тоологдохгүй). */
  totalBytes: number;
  /** Идэвхжүүлж болох уу — issues/blocked хоосон. */
  ok: boolean;
}

export interface PlanOptions {
  manifest: ReleaseManifest;
  installed: InstalledState;
  hardwareClass?: HardwareClass;
  /** Бүх бүрэлдэхүүнийг дахин суулгана (repair). */
  force?: boolean;
  /** Буцаалтаас ӨӨР шалтгаанаар хувилбар буулгахыг зөвшөөрөх — өгөгдмөл ҮГҮЙ. */
  allowDowngrade?: boolean;
}

export function planUpdate(opts: PlanOptions): UpdatePlan {
  const { manifest, installed } = opts;
  const actions: UpdateAction[] = [];
  const unchanged: ComponentId[] = [];
  const blocked: BlockedComponent[] = [];

  for (const [component, spec] of Object.entries(manifest.components) as [ComponentId, ComponentSpec][]) {
    const have = installed.components[component] ?? null;

    // Хардверийн доод ангилал — манифестын `meta.minHardwareClass`.
    const minHw = spec.meta?.minHardwareClass;
    if (isHardwareClass(minHw) && opts.hardwareClass && !meetsHardwareClass(opts.hardwareClass, minHw)) {
      blocked.push({
        component,
        code: 'HARDWARE_CLASS_UNMET',
        detail: `${component} ${spec.version} нь ${minHw} шаардана, энэ машин ${opts.hardwareClass}`,
      });
      continue;
    }

    let reason: ActionReason | null = null;
    if (have === null) reason = 'missing';
    else if (opts.force) reason = 'forced';
    else if (have.version !== spec.version) reason = 'version';
    else if (have.sha256.toLowerCase() !== spec.sha256.toLowerCase()) reason = 'sha';

    if (reason === null) {
      unchanged.push(component);
      continue;
    }

    const downgrade = have !== null && compareVersions(spec.version, have.version) < 0;
    if (downgrade && !opts.allowDowngrade) {
      blocked.push({
        component,
        code: 'DOWNGRADE_REFUSED',
        detail: `${component}: ${have!.version} → ${spec.version} буулгалт (allowDowngrade биш)`,
      });
      continue;
    }

    actions.push({ component, from: have?.version ?? null, to: spec.version, reason, spec, downgrade });
  }

  // Нийцтэй байдал: суулгасан ⊕ энэ төлөвлөгөөний дараах хувилбарууд.
  const after = versionsOf(installed);
  for (const a of actions) after[a.component] = a.to;
  const issues = checkCompatibility(manifest, after);

  const totalBytes = actions.reduce((n, a) => n + (a.spec.url && a.spec.sizeBytes ? a.spec.sizeBytes : 0), 0);

  return {
    releaseId: manifest.releaseId,
    channel: manifest.channel,
    actions,
    unchanged,
    blocked,
    issues,
    totalBytes,
    ok: issues.length === 0 && blocked.length === 0,
  };
}

/** Хэрэглэгчид ХАРАГДАХ нэг мөр (§20 — техникийн үг байхгүй). */
export function describePlanMn(plan: UpdatePlan): string {
  if (!plan.ok) return 'MGL AI шинэчлэл энэ компьютерт тохирсонгүй.';
  if (plan.actions.length === 0) return 'MGL AI шинэчлэгдсэн байна.';
  const names: Record<ComponentId, string> = {
    app: 'програм',
    runtime: 'програм',
    model: 'AI загвар',
    knowledge: 'барилгын норм',
    normRegistry: 'нормын бүртгэл',
    revit: 'Revit нэмэлт',
  };
  const parts = [...new Set(plan.actions.map((a) => names[a.component]))];
  const mb = plan.totalBytes > 0 ? ` · ${Math.max(1, Math.round(plan.totalBytes / 1048576))} MB` : '';
  return `MGL AI шинэчлэл: ${parts.join(', ')}${mb}`;
}
