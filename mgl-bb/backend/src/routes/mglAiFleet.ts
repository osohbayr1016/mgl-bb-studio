/**
 * MGL AI · ФЛОТ · РЕЛИЗ · АЛДААНЫ INBOX (Session B).
 *
 * `/api/mgl-ai`-ийн ХОЁР ДАХЬ mount — `routes/mglAi.ts`-ийг ХӨНДӨХГҮЙ.  Тэр
 * файлыг Session A (норматив) зэрэг засаж байгаа тул энд тусдаа файл:
 * `index.ts`-д нэг мөр `app.route('/api/mgl-ai', mglAiFleet)`.
 *
 *   ажилтны PC (runtime)      POST /fleet/heartbeat          суулгацын төлөв
 *                             GET  /fleet/release-manifest   энэ төхөөрөмжид очих манифест
 *   админ                     GET  /admin/fleet              төхөөрөмжүүд + хураангуй
 *                             PATCH /admin/fleet/:id         суваг / телеметрийн override
 *                             GET|POST /admin/releases/manifests, POST …/:releaseId/status
 *                             GET  /admin/failures, POST /admin/failures/sync,
 *                             POST /admin/failures/:uid/{status,redact,regression,sft}
 *                             GET  /admin/regressions, /admin/sft, /admin/model-candidates,
 *                                  /admin/knowledge-releases (+ POST үүсгэх/төлөв)
 *
 * ⚠️ `client` role-д БҮГД 403.  `lib/clientScope.ts` нь `/api/mgl-ai`-г
 *    захиалагчид нээдэг (чат хэрэглэнэ) тул энд ӨӨРСДӨӨ хаана — флот бол
 *    ажилтны PC-ийн ойлголт.
 *
 * ⚠️ ЭНД ЮУ Ч ТҮГЭЭГДЭХГҮЙ, ЮУ Ч СУРГАГДАХГҮЙ.  Манифестын төлөв солих нь
 *    админы товч; `STABLE` болсон манифестыг ажилтны PC ДАРААГИЙН шалгалтаараа
 *    өөрөө татна.  Компанийн хэмжээний rollout энэ шатанд байхгүй (§15).
 */
import { Hono } from 'hono';
import type { Env, AppVariables } from '../types';
import { requireAdmin } from '../middleware/auth';
import { nowInUBIso } from '../lib/time';
import { resolveAiIdentity } from '../lib/mglai/identity';
import { MGL_AI_VERSION } from '../lib/mglai/version';
import { parseHeartbeat, effectiveChannel, effectiveTelemetryLevel, summarizeFleet, isFleetChannel, isTelemetryLevel } from '../lib/mglai/fleet/heartbeat';
import {
  assembleManifest,
  canTransitionManifest,
  channelForStatus,
  isManifestStatus,
  manifestForChannel,
  diffManifests,
  type ReleaseManifest,
  type ModelReleaseRow,
  type KnowledgePackRow,
  type InstallerRow,
} from '../lib/mglai/releases/manifest';
import {
  candidateFromFeedback,
  canTransitionFailure,
  isFailureStatus,
  recommendRoute,
  redactCandidateText,
  sftCandidateFrom,
  isFailureReason,
  type FeedbackRowLike,
} from '../lib/mglai/improvement/failureCandidate';
import { sanitizeTrustedSummary, toRoutingSignals } from '../lib/mglai/improvement/trustedSummary';
import { diagTrustedSummaryProvider } from '../lib/mglai/improvement/trustedSummaryFromDiag';

/**
 * P0-4 / SESSION D: итгэмжлэгдсэн дүнгийн хураангуйн эх сурвалж.  Session A-ийн
 * TrustedNormResult / diag_json гэрээ тогтмогц энд бодит provider тавина —
 * `routes/mglAi.ts`-ийг хөндөхгүй.  Өнөөдөр null.
 */
// Session D (2026-09-14): бодит provider — Session A-ийн `/messages diag_json.norm`-оос
// (`improvement/trustedSummaryFromDiag.ts`).  D1 нь хүсэлт бүрд `c.env.DB`-ээр ирдэг тул модулийн
// түвшний тогтмол байхгүй; sync дотор үүсгэнэ.

const mglAiFleet = new Hono<{ Bindings: Env; Variables: AppVariables }>();

function uid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

function str(v: unknown, max = 256): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length === 0 ? null : s.slice(0, max);
}

async function body(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown> | null> {
  try {
    const b = await c.req.json();
    return typeof b === 'object' && b !== null ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Ажилтан/админ Л — захиалагч, зочин 403. */
mglAiFleet.use('/fleet/*', async (c, next) => {
  const id = resolveAiIdentity(c.get('user') ?? null, null);
  if (id.userId === null || id.mode === 'client' || id.mode === 'denied') {
    return c.json({ error: 'Флотын гарц зөвхөн ажилтны суулгацад.' }, 403);
  }
  await next();
});

/* ================================================================== */
/*  1. HEARTBEAT (§16, §17)                                            */
/* ================================================================== */

mglAiFleet.post('/fleet/heartbeat', async (c) => {
  const id = resolveAiIdentity(c.get('user') ?? null, null);
  const raw = await body(c);
  const parsed = parseHeartbeat(raw);
  if (!parsed.ok) {
    // ⚠️ FORBIDDEN_FIELD нь 400 — «зарим талбарыг хасаад хадгалъя» гэсэн зөөлрүүлэлт БАЙХГҮЙ.
    return c.json({ error: 'Heartbeat хүлээн авсангүй.', code: parsed.code, detail: parsed.detail ?? null }, 400);
  }
  const h = parsed.heartbeat;

  await c.env.DB.prepare(
    `INSERT INTO ai_fleet_devices
       (installation_id, user_id, channel, telemetry_level, hardware_class, hardware_json, versions_json, running_versions_json,
        release_id, last_known_good_release, health_status, health_facets_json, health_reasons_json,
        update_json, latency_json, crash_json, runtime_uptime_s, heartbeat_count, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
     ON CONFLICT (installation_id) DO UPDATE SET
       user_id = excluded.user_id,
       channel = excluded.channel,
       telemetry_level = excluded.telemetry_level,
       hardware_class = excluded.hardware_class,
       hardware_json = excluded.hardware_json,
       versions_json = excluded.versions_json,
       running_versions_json = excluded.running_versions_json,
       release_id = excluded.release_id,
       last_known_good_release = excluded.last_known_good_release,
       health_status = COALESCE(excluded.health_status, ai_fleet_devices.health_status),
       health_facets_json = CASE WHEN excluded.health_status IS NULL THEN ai_fleet_devices.health_facets_json ELSE excluded.health_facets_json END,
       health_reasons_json = CASE WHEN excluded.health_status IS NULL THEN ai_fleet_devices.health_reasons_json ELSE excluded.health_reasons_json END,
       update_json = excluded.update_json,
       latency_json = COALESCE(excluded.latency_json, ai_fleet_devices.latency_json),
       crash_json = COALESCE(excluded.crash_json, ai_fleet_devices.crash_json),
       runtime_uptime_s = excluded.runtime_uptime_s,
       heartbeat_count = ai_fleet_devices.heartbeat_count + 1,
       last_seen_at = datetime('now')`,
  )
    .bind(
      h.installation_id,
      id.userId,
      h.channel,
      h.telemetry_level,
      h.hardware_class,
      JSON.stringify(h.hardware),
      JSON.stringify(h.versions),
      JSON.stringify(h.running_versions),
      h.versions.release ?? null,
      h.versions.last_known_good ?? null,
      h.health?.status ?? null,
      JSON.stringify(h.health?.facets ?? {}),
      JSON.stringify(h.health?.reasonCodes ?? []),
      h.update ? JSON.stringify(h.update) : null,
      h.latency ? JSON.stringify(h.latency) : null,
      h.crash ? JSON.stringify(h.crash) : null,
      h.runtime_uptime_s,
    )
    .run();

  const row = await c.env.DB.prepare(
    `SELECT channel, channel_override, telemetry_level, telemetry_level_override FROM ai_fleet_devices WHERE installation_id = ?`,
  )
    .bind(h.installation_id)
    .first<{ channel: string; channel_override: string | null; telemetry_level: string; telemetry_level_override: string | null }>();

  // ⚠️ Хариу нь ЗААВАР: клиент override-ийг дагана (суваг солих, түр DEBUG).
  return c.json({
    ok: true,
    installation_id: h.installation_id,
    channel: row ? effectiveChannel(row) : h.channel,
    telemetry_level: row ? effectiveTelemetryLevel(row) : h.telemetry_level,
    server_time: nowInUBIso(),
  });
});

/**
 * МЕССЕЖИЙН СУУЛГАЦЫН ТАМГА (§20).  Хөтөч санал хүсэлт илгээхдээ локал
 * runtime-ийн `/info`-оос уншсан хувилбаруудыг энд тавина; алдааны inbox
 * `msg_uid`-аар JOIN хийж авна.  `routes/mglAi.ts`-ийн `/feedback`-ийг хөндөхгүй.
 *
 * ⚠️ Хувилбарын утга ХӨТЧӨӨС ирж байгаа тул ЦАГААН ЖАГСААЛТ + урт хязгаар;
 *    installation_id нь `ins_` угтвартай байх ёстой.
 */
mglAiFleet.post('/fleet/message-context', async (c) => {
  const b = await body(c);
  if (!b) return c.json({ error: 'Invalid JSON' }, 400);
  const msgUid = str(b.msg_uid, 64);
  if (!msgUid) return c.json({ error: 'msg_uid шаардлагатай.' }, 400);
  const installationId = str(b.installation_id, 64);
  if (installationId && !/^ins_[0-9a-f-]{8,64}$/i.test(installationId)) return c.json({ error: 'installation_id буруу.' }, 400);
  const versions: Record<string, string> = {};
  if (b.versions && typeof b.versions === 'object') {
    for (const k of ['app', 'runtime', 'model', 'knowledge', 'normRegistry', 'revit', 'release']) {
      const v = (b.versions as Record<string, unknown>)[k];
      if (typeof v === 'string' && v.length > 0) versions[k] = v.slice(0, 64);
    }
  }
  await c.env.DB.prepare(
    `INSERT INTO ai_message_install_context (msg_uid, conv_uid, installation_id, versions_json, channel, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (msg_uid) DO UPDATE SET installation_id = excluded.installation_id, versions_json = excluded.versions_json, channel = excluded.channel`,
  )
    .bind(msgUid, str(b.conv_uid, 64), installationId, JSON.stringify(versions), isFleetChannel(b.channel) ? b.channel : null)
    .run();
  return c.json({ ok: true });
});

/* ================================================================== */
/*  2. ТӨХӨӨРӨМЖИД ОЧИХ МАНИФЕСТ (§6, §15)                             */
/* ================================================================== */

mglAiFleet.get('/fleet/release-manifest', async (c) => {
  const installationId = str(c.req.query('installation_id'), 64);
  let channel: 'admin' | 'canary' | 'stable' = 'stable';
  if (installationId) {
    const row = await c.env.DB.prepare(`SELECT channel, channel_override FROM ai_fleet_devices WHERE installation_id = ?`)
      .bind(installationId)
      .first<{ channel: string; channel_override: string | null }>();
    if (row) channel = effectiveChannel(row);
  }
  const requested = c.req.query('channel');
  // Админ өөрөө admin сувгийг шууд асууж болно; бусад нь бүртгэлээр.
  const id = resolveAiIdentity(c.get('user') ?? null, null);
  if (isFleetChannel(requested) && id.mode === 'admin') channel = requested;

  const { results } = await c.env.DB.prepare(
    `SELECT release_id, status, created_at, manifest_json FROM ai_release_manifests
      WHERE status IN ('APPROVED','CANARY','STABLE') ORDER BY created_at DESC LIMIT 50`,
  ).all<{ release_id: string; status: string; created_at: string; manifest_json: string }>();
  const pick = manifestForChannel(results ?? [], channel);
  if (!pick) return c.json({ available: false, channel, checked_at: nowInUBIso() });
  let manifest: unknown;
  try {
    manifest = JSON.parse(pick.manifest_json);
  } catch {
    return c.json({ available: false, channel, error: 'Манифест эвдэрсэн.' }, 500);
  }
  return c.json({ available: true, channel, release_id: pick.release_id, manifest, checked_at: nowInUBIso() });
});

/* ================================================================== */
/*  3. АДМИН — ФЛОТ (§16)                                              */
/* ================================================================== */

mglAiFleet.get('/admin/fleet', requireAdmin(), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT d.installation_id, d.user_id, u.full_name, d.channel, d.channel_override, d.telemetry_level,
            d.telemetry_level_override, d.hardware_class, d.hardware_json, d.versions_json, d.running_versions_json, d.release_id,
            d.last_known_good_release, d.health_status, d.health_facets_json, d.health_reasons_json,
            d.update_json, d.latency_json, d.crash_json, d.runtime_uptime_s, d.heartbeat_count,
            d.first_seen_at, d.last_seen_at, d.note
       FROM ai_fleet_devices d LEFT JOIN users u ON u.id = d.user_id
      ORDER BY d.last_seen_at DESC LIMIT 500`,
  ).all<Record<string, unknown>>();
  const rows = results ?? [];
  const summary = summarizeFleet(
    rows.map((r) => ({ health_status: r.health_status as string | null, last_seen_at: String(r.last_seen_at), versions_json: String(r.versions_json) })),
    new Date().toISOString(),
  );
  return c.json({ devices: rows, summary, server_time: nowInUBIso() });
});

mglAiFleet.patch('/admin/fleet/:installationId', requireAdmin(), async (c) => {
  const installationId = c.req.param('installationId');
  const b = await body(c);
  if (!b) return c.json({ error: 'Invalid JSON' }, 400);
  const channel = b.channel_override === null ? null : b.channel_override;
  const level = b.telemetry_level_override === null ? null : b.telemetry_level_override;
  if (channel !== undefined && channel !== null && !isFleetChannel(channel)) return c.json({ error: 'channel_override буруу.' }, 400);
  if (level !== undefined && level !== null && !isTelemetryLevel(level)) return c.json({ error: 'telemetry_level_override буруу.' }, 400);

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (channel !== undefined) {
    sets.push('channel_override = ?');
    binds.push(channel);
  }
  if (level !== undefined) {
    sets.push('telemetry_level_override = ?');
    binds.push(level);
  }
  if ('note' in b) {
    sets.push('note = ?');
    binds.push(str(b.note, 500));
  }
  if (sets.length === 0) return c.json({ error: 'Өөрчлөх талбар алга.' }, 400);
  binds.push(installationId);
  const r = await c.env.DB.prepare(`UPDATE ai_fleet_devices SET ${sets.join(', ')} WHERE installation_id = ?`).bind(...binds).run();
  if (r.meta.changes === 0) return c.json({ error: 'Төхөөрөмж олдсонгүй.' }, 404);
  return c.json({ ok: true });
});

/* ================================================================== */
/*  4. АДМИН — РЕЛИЗИЙН МАНИФЕСТ (§6, §27)                             */
/* ================================================================== */

mglAiFleet.get('/admin/releases/manifests', requireAdmin(), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT m.id, m.release_id, m.channel, m.status, m.manifest_json, m.notes, m.created_by, u.full_name AS created_by_name,
            m.created_at, m.approved_by, m.approved_at, m.promoted_at, m.rolled_back_at
       FROM ai_release_manifests m LEFT JOIN users u ON u.id = m.created_by
      ORDER BY m.created_at DESC LIMIT 100`,
  ).all<Record<string, unknown>>();
  return c.json({ manifests: results ?? [] });
});

/**
 * Бүртгэлийн мөрүүдээс НЭР ДЭВШИГЧ манифест угсарна (CANDIDATE).
 * Body: { release_id, model_release_uid?, adapter_release_uid?, knowledge_pack_id?,
 *         norm_registry_version?, runtime_code_version?, revit?: {version,url,sha256,bytes},
 *         min_runtime_version?, notes? }
 */
mglAiFleet.post('/admin/releases/manifests', requireAdmin(), async (c) => {
  const user = c.get('user');
  const b = await body(c);
  if (!b) return c.json({ error: 'Invalid JSON' }, 400);
  const releaseId = str(b.release_id, 128);
  if (!releaseId || !/^[0-9A-Za-z][0-9A-Za-z.\-_]{0,127}$/.test(releaseId)) return c.json({ error: 'release_id буруу.' }, 400);

  const modelUid = str(b.model_release_uid, 64);
  const adapterUid = str(b.adapter_release_uid, 64);
  const packId = typeof b.knowledge_pack_id === 'number' ? b.knowledge_pack_id : null;
  const rtVersion = str(b.runtime_code_version, 64);

  const modelRow = modelUid
    ? await c.env.DB.prepare(
        `SELECT release_uid, version, artifact_url, artifact_bytes, artifact_sha256, quantization, min_vram_mb,
                minimum_runtime_version, kind, base_release_uid
           FROM ai_model_releases WHERE release_uid = ? AND license_cleared = 1 AND eval_passed = 1`,
      )
        .bind(modelUid)
        .first<ModelReleaseRow>()
    : null;
  if (modelUid && !modelRow) return c.json({ error: 'Загварын релиз олдсонгүй эсвэл лиценз/үнэлгээний хаалга даваагүй.', code: 'MODEL_NOT_ELIGIBLE' }, 400);

  const adapterRow = adapterUid
    ? await c.env.DB.prepare(
        `SELECT release_uid, version, artifact_url, artifact_bytes, artifact_sha256, quantization, min_vram_mb,
                minimum_runtime_version, kind, base_release_uid
           FROM ai_model_releases WHERE release_uid = ? AND kind = 'adapter' AND license_cleared = 1 AND eval_passed = 1`,
      )
        .bind(adapterUid)
        .first<ModelReleaseRow>()
    : null;
  if (adapterUid && !adapterRow) return c.json({ error: 'Адаптерын релиз олдсонгүй эсвэл хаалга даваагүй.', code: 'ADAPTER_NOT_ELIGIBLE' }, 400);

  const knowledgeRow = packId
    ? await c.env.DB.prepare(`SELECT pack_id, version, url, sha256, bytes FROM ai_knowledge_packs WHERE id = ?`).bind(packId).first<KnowledgePackRow>()
    : null;
  if (packId && !knowledgeRow) return c.json({ error: 'Мэдлэгийн багц олдсонгүй.' }, 400);

  const runtimeRow = rtVersion
    ? await c.env.DB.prepare(
        `SELECT component, version, url, sha256, bytes FROM ai_runtime_installers
          WHERE component = 'runtime-code' AND version = ? ORDER BY created_at DESC LIMIT 1`,
      )
        .bind(rtVersion)
        .first<InstallerRow>()
    : null;
  if (rtVersion && !runtimeRow) return c.json({ error: 'runtime-code хувилбар олдсонгүй.' }, 400);

  let revit: { version: string; sha256: string; url: string; bytes: number | null } | null = null;
  if (b.revit && typeof b.revit === 'object') {
    const r = b.revit as Record<string, unknown>;
    const v = str(r.version, 64);
    const sha = str(r.sha256, 64);
    const url = str(r.url, 1024);
    if (!v || !sha || !url) return c.json({ error: 'revit: version/sha256/url шаардлагатай.' }, 400);
    revit = { version: v, sha256: sha, url, bytes: typeof r.bytes === 'number' ? r.bytes : null };
  }

  const assembled = assembleManifest({
    releaseId,
    createdAt: new Date().toISOString(),
    model: modelRow,
    adapter: adapterRow,
    knowledge: knowledgeRow,
    runtimeCode: runtimeRow,
    normRegistryVersion: str(b.norm_registry_version, 64),
    revit,
    minRuntimeVersion: str(b.min_runtime_version, 64),
    notes: str(b.notes, 2000),
  });
  if (!assembled.ok) return c.json({ error: 'Манифест угсарч чадсангүй.', errors: assembled.errors }, 400);

  const prev = await c.env.DB.prepare(`SELECT manifest_json FROM ai_release_manifests WHERE status = 'STABLE' ORDER BY created_at DESC LIMIT 1`).first<{ manifest_json: string }>();
  let prevManifest: ReleaseManifest | null = null;
  try {
    prevManifest = prev ? (JSON.parse(prev.manifest_json) as ReleaseManifest) : null;
  } catch {
    prevManifest = null;
  }

  try {
    await c.env.DB.prepare(
      `INSERT INTO ai_release_manifests (release_id, channel, status, manifest_json, notes, created_by, created_at)
       VALUES (?, 'admin', 'CANDIDATE', ?, ?, ?, datetime('now'))`,
    )
      .bind(releaseId, JSON.stringify(assembled.manifest), str(b.notes, 2000), user?.sub ?? null)
      .run();
  } catch (err) {
    if (/UNIQUE/i.test((err as Error).message)) return c.json({ error: 'release_id аль хэдийн байна.', code: 'EXISTS' }, 409);
    throw err;
  }
  return c.json({ ok: true, release_id: releaseId, manifest: assembled.manifest, diff_from_stable: diffManifests(prevManifest, assembled.manifest) }, 201);
});

mglAiFleet.post('/admin/releases/manifests/:releaseId/status', requireAdmin(), async (c) => {
  const user = c.get('user');
  const releaseId = c.req.param('releaseId');
  const b = await body(c);
  const to = b?.status;
  if (!isManifestStatus(to)) return c.json({ error: 'status буруу.' }, 400);
  const row = await c.env.DB.prepare(`SELECT status FROM ai_release_manifests WHERE release_id = ?`).bind(releaseId).first<{ status: string }>();
  if (!row || !isManifestStatus(row.status)) return c.json({ error: 'Манифест олдсонгүй.' }, 404);
  if (!canTransitionManifest(row.status, to)) {
    return c.json({ error: `${row.status} → ${to} шилжилт зөвшөөрөгдөхгүй.`, code: 'TRANSITION_NOT_ALLOWED' }, 409);
  }
  const channel = channelForStatus(to);
  const r = await c.env.DB.prepare(
    `UPDATE ai_release_manifests
        SET status = ?, channel = ?,
            approved_by = CASE WHEN ? = 'APPROVED' THEN ? ELSE approved_by END,
            approved_at = CASE WHEN ? = 'APPROVED' THEN datetime('now') ELSE approved_at END,
            promoted_at = CASE WHEN ? IN ('CANARY','STABLE') THEN datetime('now') ELSE promoted_at END,
            rolled_back_at = CASE WHEN ? = 'ROLLED_BACK' THEN datetime('now') ELSE rolled_back_at END
      WHERE release_id = ? AND status = ?`,
  )
    .bind(to, channel, to, user?.sub ?? null, to, to, to, releaseId, row.status)
    .run();
  // ⚠️ Уралдааны хамгаалалт — өөр админ зэрэг сольсон бол 409.
  if (r.meta.changes === 0) return c.json({ error: 'Төлөв зэрэг өөрчлөгдсөн.', code: 'CONFLICT' }, 409);
  return c.json({ ok: true, release_id: releaseId, status: to, channel });
});

/* ================================================================== */
/*  5. АДМИН — АЛДААНЫ INBOX (§21, §22)                                */
/* ================================================================== */

mglAiFleet.get('/admin/failures', requireAdmin(), async (c) => {
  const status = str(c.req.query('status'), 32);
  const where = status && isFailureStatus(status) ? `WHERE f.status = ?1` : `WHERE ?1 IS NULL OR 1 = 1`;
  const { results } = await c.env.DB.prepare(
    `SELECT f.id, f.failure_uid, f.feedback_id, f.request_id, f.conv_uid, f.msg_uid, f.installation_id, f.user_id, u.full_name,
            f.reason_code, f.question_text, f.answer_text, f.corrected_answer, f.redaction_status, f.intent,
            f.tool_route_json, f.validator_json, f.trusted_summary_json, f.versions_json, f.status,
            f.recommended_route, f.admin_notes, f.triaged_by, f.triaged_at, f.created_at, f.updated_at
       FROM ai_failure_candidates f LEFT JOIN users u ON u.id = f.user_id
       ${where}
      ORDER BY f.created_at DESC LIMIT 200`,
  )
    .bind(status && isFailureStatus(status) ? status : null)
    .all<Record<string, unknown>>();
  const counts = await c.env.DB.prepare(`SELECT status, COUNT(*) AS n FROM ai_failure_candidates GROUP BY status`).all<{ status: string; n: number }>();
  return c.json({ failures: results ?? [], counts: Object.fromEntries((counts.results ?? []).map((r) => [r.status, r.n])) });
});

/**
 * 👎 санал хүсэлт → алдааны нэр дэвшигч (батчаар, идемпотент — feedback_id UNIQUE).
 * ⚠️ Хувилбарын тамга: feedback-ийн model/prompt/tool + ОДООГИЙН app хувилбар.
 *    Мэдлэг/нормын бүртгэлийн хувилбар нь feedback мөрөнд БАЙХГҮЙ (0269-д
 *    багана алга) — тэр цоорхойг `POST /feedback`-ийн тамга нэмэх нь mglAi.ts-ийн
 *    засвар (Session A-тай зэрэгцээ тул тусад нь).  Одоогоор `null`.
 */
mglAiFleet.post('/admin/failures/sync', requireAdmin(), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT f.id, f.conv_uid, f.msg_uid, f.user_id, f.vote, f.reason_codes_json, f.reason_text, f.corrected_answer,
            f.prompt_snapshot, f.answer_snapshot, f.model_version, f.runtime_variant, f.system_prompt_version,
            f.tool_schema_version, f.context_ref,
            x.installation_id AS ctx_installation_id, x.versions_json AS ctx_versions_json
       FROM ai_feedback f
       LEFT JOIN ai_message_install_context x ON x.msg_uid = f.msg_uid
      WHERE f.vote = -1 AND NOT EXISTS (SELECT 1 FROM ai_failure_candidates c WHERE c.feedback_id = f.id)
      ORDER BY f.created_at ASC LIMIT 200`,
  ).all<FeedbackRowLike & { ctx_installation_id: string | null; ctx_versions_json: string | null }>();
  let created = 0;
  for (const fb of results ?? []) {
    let ctx: Record<string, string> = {};
    try {
      ctx = fb.ctx_versions_json ? (JSON.parse(fb.ctx_versions_json) as Record<string, string>) : {};
    } catch {
      ctx = {};
    }
    const cand = candidateFromFeedback(fb, {
      failureUid: uid('fail'),
      appVersion: ctx.app ?? MGL_AI_VERSION,
      runtimeVersion: ctx.runtime ?? null,
      knowledgeVersion: ctx.knowledge ?? null,
      normRegistryVersion: ctx.normRegistry ?? null,
    });
    if (!cand) continue;
    const trusted = sanitizeTrustedSummary(await diagTrustedSummaryProvider(c.env.DB).summaryForMessage(fb.conv_uid, fb.msg_uid));
    if (trusted) {
      // Хураангуй байвал чиглүүлэлтийн зөвлөмж нь дохиогоор (reason-оор биш).
      cand.recommended_route = recommendRoute({ reason: cand.reason_code, validator: null, trusted: toRoutingSignals(trusted) }).status;
    }
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO ai_failure_candidates
         (failure_uid, feedback_id, request_id, conv_uid, msg_uid, installation_id, user_id, reason_code, question_text, answer_text,
          corrected_answer, redaction_status, versions_json, status, recommended_route, trusted_summary_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RAW', ?, 'NEW', ?, ?, datetime('now'), datetime('now'))`,
    )
      .bind(
        cand.failure_uid,
        cand.feedback_id,
        cand.request_id,
        cand.conv_uid,
        cand.msg_uid,
        fb.ctx_installation_id,
        cand.user_id,
        cand.reason_code,
        cand.question_text,
        cand.answer_text,
        cand.corrected_answer,
        cand.versions_json,
        cand.recommended_route,
        trusted ? JSON.stringify(trusted) : null,
      )
      .run();
    created++;
  }
  return c.json({ ok: true, created });
});

mglAiFleet.post('/admin/failures/:uid/status', requireAdmin(), async (c) => {
  const user = c.get('user');
  const failureUid = c.req.param('uid');
  const b = await body(c);
  const to = b?.status;
  if (!isFailureStatus(to)) return c.json({ error: 'status буруу.' }, 400);
  const row = await c.env.DB.prepare(`SELECT status, reason_code, validator_json, trusted_summary_json FROM ai_failure_candidates WHERE failure_uid = ?`)
    .bind(failureUid)
    .first<{ status: string; reason_code: string; validator_json: string | null; trusted_summary_json: string | null }>();
  if (!row || !isFailureStatus(row.status)) return c.json({ error: 'Олдсонгүй.' }, 404);
  if (!canTransitionFailure(row.status, to)) {
    return c.json({ error: `${row.status} → ${to} зөвшөөрөгдөхгүй.`, code: 'TRANSITION_NOT_ALLOWED' }, 409);
  }
  const reason = b && isFailureReason(b.reason_code) ? b.reason_code : null;
  const r = await c.env.DB.prepare(
    `UPDATE ai_failure_candidates
        SET status = ?, admin_notes = COALESCE(?, admin_notes), reason_code = COALESCE(?, reason_code),
            triaged_by = ?, triaged_at = datetime('now'), updated_at = datetime('now')
      WHERE failure_uid = ? AND status = ?`,
  )
    .bind(to, str(b?.admin_notes, 2000), reason, user?.sub ?? null, failureUid, row.status)
    .run();
  if (r.meta.changes === 0) return c.json({ error: 'Зэрэг өөрчлөгдсөн.', code: 'CONFLICT' }, 409);

  let parsedValidator: { failures?: string[] } | null = null;
  let parsedTrusted: ReturnType<typeof toRoutingSignals> = null;
  try {
    parsedValidator = row.validator_json ? (JSON.parse(row.validator_json) as { failures?: string[] }) : null;
    parsedTrusted = toRoutingSignals(sanitizeTrustedSummary(row.trusted_summary_json ? JSON.parse(row.trusted_summary_json) : null));
  } catch {
    /* хадгалсан JSON эвдэрсэн — зөвлөмжгүй */
  }
  const rec = isFailureReason(reason ?? row.reason_code)
    ? recommendRoute({ reason: (reason ?? row.reason_code) as never, validator: parsedValidator, trusted: parsedTrusted })
    : null;
  return c.json({ ok: true, status: to, recommendation: rec });
});

/** Ариутгал: админ засварласан текст өгч болно; өгөөгүй бол детерминист ариутгал. */
mglAiFleet.post('/admin/failures/:uid/redact', requireAdmin(), async (c) => {
  const failureUid = c.req.param('uid');
  const b = (await body(c)) ?? {};
  const row = await c.env.DB.prepare(`SELECT question_text, answer_text, corrected_answer FROM ai_failure_candidates WHERE failure_uid = ?`)
    .bind(failureUid)
    .first<{ question_text: string | null; answer_text: string | null; corrected_answer: string | null }>();
  if (!row) return c.json({ error: 'Олдсонгүй.' }, 404);
  const q = str(b.question_text, 8000) ?? (row.question_text ? redactCandidateText(row.question_text) : null);
  const a = str(b.answer_text, 8000) ?? (row.answer_text ? redactCandidateText(row.answer_text) : null);
  const corr = str(b.corrected_answer, 8000) ?? (row.corrected_answer ? redactCandidateText(row.corrected_answer) : null);
  const status = b.not_needed === true ? 'NOT_NEEDED' : 'REDACTED';
  await c.env.DB.prepare(
    `UPDATE ai_failure_candidates SET question_text = ?, answer_text = ?, corrected_answer = ?, redaction_status = ?, updated_at = datetime('now')
      WHERE failure_uid = ?`,
  )
    .bind(q, a, corr, status, failureUid)
    .run();
  return c.json({ ok: true, redaction_status: status, question_text: q, answer_text: a, corrected_answer: corr });
});

/** Регрессийн нэр дэвшигч (§23) — зөвхөн APPROVED_REGRESSION эсвэл ангилагдсан төлвөөс. */
mglAiFleet.post('/admin/failures/:uid/regression', requireAdmin(), async (c) => {
  const failureUid = c.req.param('uid');
  const b = await body(c);
  if (!b) return c.json({ error: 'Invalid JSON' }, 400);
  const target = b.target;
  if (!['NORM', 'COMPANY', 'CONVERSATION', 'MODEL_BEHAVIOR', 'UI'].includes(target as string)) return c.json({ error: 'target буруу.' }, 400);
  if (!b.expected || typeof b.expected !== 'object') return c.json({ error: 'expected (объект) шаардлагатай.' }, 400);
  const row = await c.env.DB.prepare(`SELECT id, status, question_text, redaction_status, versions_json FROM ai_failure_candidates WHERE failure_uid = ?`)
    .bind(failureUid)
    .first<{ id: number; status: string; question_text: string | null; redaction_status: string; versions_json: string }>();
  if (!row) return c.json({ error: 'Олдсонгүй.' }, 404);
  if (row.status === 'NEW' || row.status === 'REJECTED') return c.json({ error: 'Эхлээд ангилна.', code: 'NOT_TRIAGED' }, 409);
  if (row.redaction_status === 'RAW') return c.json({ error: 'Эхлээд ариутгана.', code: 'NOT_REDACTED' }, 409);
  const question = str(b.question, 4000) ?? row.question_text;
  if (!question) return c.json({ error: 'question шаардлагатай.' }, 400);
  const candidateUid = uid('reg');
  await c.env.DB.prepare(
    `INSERT INTO ai_regression_candidates (candidate_uid, failure_id, target, question, expected_json, failure_class, versions_json, approval_state, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', datetime('now'), datetime('now'))`,
  )
    .bind(candidateUid, row.id, target, question, JSON.stringify(b.expected).slice(0, 16000), row.status, row.versions_json)
    .run();
  return c.json({ ok: true, candidate_uid: candidateUid }, 201);
});

/** SFT нэр дэвшигч (§24) — `sftCandidateFrom`-ийн гурван хаалга. */
mglAiFleet.post('/admin/failures/:uid/sft', requireAdmin(), async (c) => {
  const failureUid = c.req.param('uid');
  const row = await c.env.DB.prepare(
    `SELECT id, status, redaction_status, question_text, corrected_answer, reason_code FROM ai_failure_candidates WHERE failure_uid = ?`,
  )
    .bind(failureUid)
    .first<{ id: number; status: string; redaction_status: string; question_text: string | null; corrected_answer: string | null; reason_code: string }>();
  if (!row) return c.json({ error: 'Олдсонгүй.' }, 404);
  const cand = sftCandidateFrom(row, uid('sft'));
  if (!cand) {
    return c.json(
      { error: 'SFT нэр дэвшигч болох нөхцөл хангагдаагүй: MODEL_BEHAVIOR/APPROVED_SFT төлөв + ариутгасан + залруулгатай.', code: 'SFT_GATE' },
      409,
    );
  }
  await c.env.DB.prepare(
    `INSERT INTO ai_sft_candidates (candidate_uid, failure_id, input_text, target_text, language, category, redaction_status, review_state, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', datetime('now'), datetime('now'))`,
  )
    .bind(cand.candidate_uid, cand.failure_id, cand.input_text, cand.target_text, cand.language, cand.category, cand.redaction_status)
    .run();
  return c.json({ ok: true, candidate_uid: cand.candidate_uid }, 201);
});

mglAiFleet.get('/admin/regressions', requireAdmin(), async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM ai_regression_candidates ORDER BY created_at DESC LIMIT 200`).all();
  return c.json({ candidates: results ?? [] });
});

mglAiFleet.post('/admin/regressions/:uid/state', requireAdmin(), async (c) => {
  const user = c.get('user');
  const b = await body(c);
  const state = b?.approval_state;
  if (!['APPROVED', 'REJECTED', 'EXPORTED', 'DRAFT'].includes(state as string)) return c.json({ error: 'approval_state буруу.' }, 400);
  const r = await c.env.DB.prepare(
    `UPDATE ai_regression_candidates
        SET approval_state = ?, approved_by = CASE WHEN ? = 'APPROVED' THEN ? ELSE approved_by END,
            exported_to = CASE WHEN ? = 'EXPORTED' THEN ? ELSE exported_to END,
            exported_at = CASE WHEN ? = 'EXPORTED' THEN datetime('now') ELSE exported_at END,
            updated_at = datetime('now')
      WHERE candidate_uid = ?`,
  )
    .bind(state, state, user?.sub ?? null, state, str(b?.exported_to, 256), state, c.req.param('uid'))
    .run();
  if (r.meta.changes === 0) return c.json({ error: 'Олдсонгүй.' }, 404);
  return c.json({ ok: true });
});

mglAiFleet.get('/admin/sft', requireAdmin(), async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM ai_sft_candidates ORDER BY created_at DESC LIMIT 200`).all();
  return c.json({ candidates: results ?? [] });
});

mglAiFleet.post('/admin/sft/:uid/state', requireAdmin(), async (c) => {
  const user = c.get('user');
  const b = await body(c);
  const state = b?.review_state;
  if (!['APPROVED', 'REJECTED', 'DRAFT'].includes(state as string)) {
    // ⚠️ INCLUDED нь ЗӨВХӨН багц угсрагчаас (dataset_version-тэй) — админы товчоор БИШ.
    return c.json({ error: 'review_state нь DRAFT | APPROVED | REJECTED.' }, 400);
  }
  const r = await c.env.DB.prepare(
    `UPDATE ai_sft_candidates SET review_state = ?, approved_by = CASE WHEN ? = 'APPROVED' THEN ? ELSE approved_by END, updated_at = datetime('now')
      WHERE candidate_uid = ? AND review_state <> 'INCLUDED'`,
  )
    .bind(state, state, user?.sub ?? null, c.req.param('uid'))
    .run();
  if (r.meta.changes === 0) return c.json({ error: 'Олдсонгүй эсвэл аль хэдийн багцад орсон.' }, 404);
  return c.json({ ok: true });
});

/* ================================================================== */
/*  6. АДМИН — ЗАГВАРЫН НЭР ДЭВШИГЧ ба МЭДЛЭГИЙН РЕЛИЗ (§25, §26)      */
/* ================================================================== */

const MODEL_CANDIDATE_STATUSES = ['TRAINING', 'CANDIDATE', 'FAILED', 'APPROVED', 'CANARY', 'PRODUCTION', 'ROLLED_BACK', 'ARCHIVED'];
const KNOWLEDGE_RELEASE_STATUSES = ['CANDIDATE', 'VALIDATED', 'APPROVED', 'CANARY', 'STABLE', 'ROLLED_BACK', 'ARCHIVED'];

mglAiFleet.get('/admin/model-candidates', requireAdmin(), async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM ai_model_candidates ORDER BY created_at DESC LIMIT 100`).all();
  return c.json({ candidates: results ?? [] });
});

mglAiFleet.post('/admin/model-candidates', requireAdmin(), async (c) => {
  const user = c.get('user');
  const b = await body(c);
  if (!b) return c.json({ error: 'Invalid JSON' }, 400);
  const releaseId = str(b.release_id, 128);
  const baseModel = str(b.base_model, 256);
  if (!releaseId || !baseModel) return c.json({ error: 'release_id, base_model шаардлагатай.' }, 400);
  const status = MODEL_CANDIDATE_STATUSES.includes(b.status as string) ? (b.status as string) : 'TRAINING';
  if (status === 'PRODUCTION' || status === 'CANARY') return c.json({ error: 'Үүсгэхдээ PRODUCTION/CANARY байж болохгүй.' }, 400);
  try {
    await c.env.DB.prepare(
      `INSERT INTO ai_model_candidates (release_id, base_model, base_sha256, adapter_name, adapter_sha256, training_dataset_id, dataset_sha256,
         training_config_json, benchmark_json, status, note, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    )
      .bind(
        releaseId,
        baseModel,
        str(b.base_sha256, 64),
        str(b.adapter_name, 256),
        str(b.adapter_sha256, 64),
        str(b.training_dataset_id, 128),
        str(b.dataset_sha256, 64),
        b.training_config && typeof b.training_config === 'object' ? JSON.stringify(b.training_config).slice(0, 16000) : null,
        b.benchmark && typeof b.benchmark === 'object' ? JSON.stringify(b.benchmark).slice(0, 16000) : null,
        status,
        str(b.note, 2000),
        user?.sub ?? null,
      )
      .run();
  } catch (err) {
    if (/UNIQUE/i.test((err as Error).message)) return c.json({ error: 'release_id аль хэдийн байна.', code: 'EXISTS' }, 409);
    throw err;
  }
  return c.json({ ok: true, release_id: releaseId, status }, 201);
});

mglAiFleet.post('/admin/model-candidates/:releaseId/status', requireAdmin(), async (c) => {
  const user = c.get('user');
  const b = await body(c);
  const to = b?.status;
  if (!MODEL_CANDIDATE_STATUSES.includes(to as string)) return c.json({ error: 'status буруу.' }, 400);
  // ⚠️ PRODUCTION-ыг ЭНЭ гарцаар ХЭЗЭЭ Ч тавихгүй (§25 — энэ шатанд промоушн байхгүй).
  if (to === 'PRODUCTION') return c.json({ error: 'PRODUCTION промоушн энэ шатанд хаалттай.', code: 'PROMOTION_DISABLED' }, 403);
  const r = await c.env.DB.prepare(
    `UPDATE ai_model_candidates SET status = ?, approved_by = CASE WHEN ? = 'APPROVED' THEN ? ELSE approved_by END,
            benchmark_json = COALESCE(?, benchmark_json), note = COALESCE(?, note), updated_at = datetime('now')
      WHERE release_id = ? AND status NOT IN ('ARCHIVED')`,
  )
    .bind(to, to, user?.sub ?? null, b?.benchmark && typeof b.benchmark === 'object' ? JSON.stringify(b.benchmark).slice(0, 16000) : null, str(b?.note, 2000), c.req.param('releaseId'))
    .run();
  if (r.meta.changes === 0) return c.json({ error: 'Олдсонгүй эсвэл архивлагдсан.' }, 404);
  return c.json({ ok: true, status: to });
});

mglAiFleet.get('/admin/knowledge-releases', requireAdmin(), async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM ai_knowledge_releases ORDER BY created_at DESC LIMIT 100`).all();
  return c.json({ releases: results ?? [] });
});

/**
 * Мэдлэгийн релиз — багцлалт/тээврийн бүртгэл.  `validation` нь Session A-ийн
 * pipeline-ийн ГАРГАСАН хураангуй (Recall@5, алтан кейс, гоожилт) — энд дахин тооцохгүй.
 */
mglAiFleet.post('/admin/knowledge-releases', requireAdmin(), async (c) => {
  const user = c.get('user');
  const b = await body(c);
  if (!b) return c.json({ error: 'Invalid JSON' }, 400);
  const krId = str(b.knowledge_release_id, 128);
  if (!krId || !b.manifest || typeof b.manifest !== 'object') return c.json({ error: 'knowledge_release_id, manifest шаардлагатай.' }, 400);
  const sha = str(b.artifact_sha256, 64);
  if (sha && !/^[0-9a-f]{64}$/i.test(sha)) return c.json({ error: 'artifact_sha256 буруу.' }, 400);
  try {
    await c.env.DB.prepare(
      `INSERT INTO ai_knowledge_releases (knowledge_release_id, manifest_json, document_count, dataset_shas_json, compiled_registry_version,
         retrieval_index_version, schema_version, validation_json, artifact_url, artifact_sha256, artifact_bytes, status, knowledge_pack_id, note,
         created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CANDIDATE', ?, ?, ?, datetime('now'), datetime('now'))`,
    )
      .bind(
        krId,
        JSON.stringify(b.manifest).slice(0, 32000),
        typeof b.document_count === 'number' ? b.document_count : null,
        Array.isArray(b.dataset_shas) ? JSON.stringify(b.dataset_shas.slice(0, 200)) : '[]',
        str(b.compiled_registry_version, 64),
        str(b.retrieval_index_version, 64),
        str(b.schema_version, 16),
        b.validation && typeof b.validation === 'object' ? JSON.stringify(b.validation).slice(0, 16000) : null,
        str(b.artifact_url, 1024),
        sha?.toLowerCase() ?? null,
        typeof b.artifact_bytes === 'number' ? b.artifact_bytes : null,
        typeof b.knowledge_pack_id === 'number' ? b.knowledge_pack_id : null,
        str(b.note, 2000),
        user?.sub ?? null,
      )
      .run();
  } catch (err) {
    if (/UNIQUE/i.test((err as Error).message)) return c.json({ error: 'knowledge_release_id аль хэдийн байна.', code: 'EXISTS' }, 409);
    throw err;
  }
  return c.json({ ok: true, knowledge_release_id: krId, status: 'CANDIDATE' }, 201);
});

mglAiFleet.post('/admin/knowledge-releases/:id/status', requireAdmin(), async (c) => {
  const user = c.get('user');
  const b = await body(c);
  const to = b?.status;
  if (!KNOWLEDGE_RELEASE_STATUSES.includes(to as string)) return c.json({ error: 'status буруу.' }, 400);
  const r = await c.env.DB.prepare(
    `UPDATE ai_knowledge_releases SET status = ?, approved_by = CASE WHEN ? = 'APPROVED' THEN ? ELSE approved_by END, updated_at = datetime('now')
      WHERE knowledge_release_id = ? AND status <> 'ARCHIVED'`,
  )
    .bind(to, to, user?.sub ?? null, c.req.param('id'))
    .run();
  if (r.meta.changes === 0) return c.json({ error: 'Олдсонгүй эсвэл архивлагдсан.' }, 404);
  return c.json({ ok: true, status: to });
});

export default mglAiFleet;
