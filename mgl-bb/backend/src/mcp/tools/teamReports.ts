import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Env } from '../../types';
import type { McpProps } from '../MglMcpAgent';
import { assertVisible } from './report';
import { TEAM_REPORT_STATUS_QUESTIONS } from '../../lib/teamReportStatusQuestions';
import {
  TEAM_REPORT_CATALOG,
  DRAWING_LIST_LABELS,
  type CatalogField,
} from '../../lib/teamReportFieldCatalog';

/* =============================================================
 * get_team_reports — «Тайлан» табуудын дүүргэсэн агуулга, ШОШГОТОЙ.
 * -------------------------------------------------------------
 * project_team_reports (PK project_id, team_code) хүснэгтээс мэргэжлийн баг
 * бүрийн (BA/BB/HAS/TSBU/TSAH/HD/AU/IZ) + төслийн хэсгүүдийн (GENERAL/NORM/
 * ROOMS/FIRE) хариултыг буцаана.  Талбарын түүхий key-г teamReportFieldCatalog.ts
 * (frontend template-ээс auto-extract хийсэн)-ээр хүний уншихуйц шошго + хэсэг +
 * select-ийн сонголт + row-widget баганы нэрээр баяжуулна.  dl_* зургийн жагсаалт
 * checkbox-ыг статик шошго + team_drawing_items (dl_custom_*)-оор нэрлэнэ.
 * REST GET /:id/team-reports-ийн MCP дүйцэл, assertVisible member-gated.
 * ============================================================= */

const txt = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

interface TeamReportRow {
  team_code: string;
  building_type: string | null;
  answers_json: string;
  updated_at: string | null;
}

/** Тухайн багийн каталогийг key -> {field, section} болгож flatten хийнэ. */
function buildFieldMap(teamCode: string) {
  const cat = TEAM_REPORT_CATALOG[teamCode];
  const map = new Map<string, { field: CatalogField; sectionId: string; sectionTitle: string }>();
  if (cat) {
    for (const s of cat.sections) {
      for (const f of s.fields) map.set(f.key, { field: f, sectionId: s.id, sectionTitle: s.title });
    }
  }
  return map;
}

/** select талбарын хадгалсан утгыг сонголтын шошготой холбоно. */
function optionLabel(field: CatalogField, value: unknown): string | undefined {
  if (!field.options || value == null) return undefined;
  const v = String(value);
  return field.options.find((o) => o.value === v)?.label;
}

export function registerTeamReportTools(server: McpServer, env: Env, user: McpProps) {
  server.registerTool(
    'get_team_reports',
    {
      title: 'Get "Тайлан" per-discipline report answers (labelled)',
      description:
        'Return the filled "Тайлан" (report) tab content for ONE project — one entry ' +
        'per discipline team (BA, BB, HAS, TSBU, TSAH, HD, AU, IZ) and project section ' +
        '(GENERAL, NORM, ROOMS, FIRE). Each entry has: the universal status block (5 ' +
        'labelled questions), the discipline answers grouped into labelled sections ' +
        '(field label + kind + resolved select option + row-widget column labels), and ' +
        'the drawing-list checklist (which drawings are done). Use this for the ' +
        'team-narrative and project-sections parts of a Word report — include the ' +
        'engineers’ free-text verbatim/condensed. Pair with get_project_breakdown for ' +
        'per-block progress numbers. Get project_id from list_projects.',
      inputSchema: {
        project_id: z.number().int().describe('Project id from list_projects.'),
        team_code: z
          .string()
          .optional()
          .describe('Single discipline/section code (e.g. BA, HAS, GENERAL). Omit for all.'),
      },
    },
    async ({ project_id, team_code }) => {
      if (!(await assertVisible(env, user, project_id)))
        return txt({ error: `Project ${project_id} not visible to you.` });

      const code = team_code ? team_code.trim().toUpperCase() : null;
      const base =
        'SELECT team_code, building_type, answers_json, updated_at FROM project_team_reports WHERE project_id = ?';
      const [rowsRes, dlCustomRes] = await Promise.all([
        (code
          ? env.DB.prepare(`${base} AND team_code = ?`).bind(project_id, code)
          : env.DB.prepare(`${base} ORDER BY team_code`).bind(project_id)
        ).all<TeamReportRow>(),
        // dl_custom_* нэмэлт зургийн мөрүүдийн шошго (админ/senior-ийн нэмсэн).
        env.DB.prepare('SELECT key, label FROM team_drawing_items').all<{ key: string; label: string }>(),
      ]);

      const dlLabels: Record<string, string> = { ...DRAWING_LIST_LABELS };
      for (const r of dlCustomRes.results ?? []) if (r.key) dlLabels[r.key] = r.label;

      const statusIds = new Set(TEAM_REPORT_STATUS_QUESTIONS.map((q) => `status_${q.id}`));

      const teams = (rowsRes.results ?? []).map((r) => {
        let parsed: Record<string, unknown> = {};
        try {
          const j = JSON.parse(r.answers_json ?? '{}');
          if (j && typeof j === 'object') parsed = j as Record<string, unknown>;
        } catch {
          /* ignore malformed answers_json */
        }

        // Универсал статусын блок — шошготой (баг бүрт нийтлэг).
        const status = TEAM_REPORT_STATUS_QUESTIONS.map((q) => ({
          id: q.id,
          title: q.title,
          question: q.text,
          answer: parsed[`status_${q.id}`] ?? null,
        }));

        const fieldMap = buildFieldMap(r.team_code.toUpperCase());
        const cat = TEAM_REPORT_CATALOG[r.team_code.toUpperCase()];

        // Хэсэг бүрд бөглөгдсөн талбаруудыг цуглуулна (каталогийн дараалал хадгална).
        const sectionAcc = new Map<
          string,
          { id: string; title: string; fields: Array<Record<string, unknown>> }
        >();
        const drawing_list: Array<{ key: string; label: string; done: boolean; value: unknown }> = [];
        const unmapped: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(parsed)) {
          if (statusIds.has(key)) continue;
          if (key.startsWith('dl_')) {
            // Багийн каталог (base dl_*) → dlLabels (статик + DB dl_custom_*) → түүхий.
            const dlLabel = fieldMap.get(key)?.field.label ?? dlLabels[key] ?? key;
            drawing_list.push({
              key,
              label: dlLabel,
              done: value === true || value === '1' || value === 1,
              value,
            });
            continue;
          }
          const hit = fieldMap.get(key);
          if (!hit) {
            unmapped[key] = value;
            continue;
          }
          const f = hit.field;
          const entry: Record<string, unknown> = { key, label: f.label, kind: f.kind, value };
          const vl = optionLabel(f, value);
          if (vl !== undefined) entry.value_label = vl;
          if (f.columns && f.columns.length) entry.columns = f.columns;
          let sec = sectionAcc.get(hit.sectionId);
          if (!sec) {
            sec = { id: hit.sectionId, title: hit.sectionTitle, fields: [] };
            sectionAcc.set(hit.sectionId, sec);
          }
          sec.fields.push(entry);
        }

        // Каталогийн дараалалд оруулж эрэмбэлнэ.
        const orderedSections = cat
          ? cat.sections
              .map((s) => sectionAcc.get(s.id))
              .filter((s): s is NonNullable<typeof s> => !!s && s.fields.length > 0)
          : [...sectionAcc.values()];

        return {
          team_code: r.team_code,
          building_type: r.building_type,
          updated_at: r.updated_at,
          labelled: !!cat,
          status,
          sections: orderedSections,
          drawing_list,
          ...(Object.keys(unmapped).length ? { unmapped } : {}),
        };
      });

      return txt({
        project_id,
        team_count: teams.length,
        teams,
        note:
          'status = универсал статусын блок (баг бүрт нийтлэг, шошготой). ' +
          'sections = мэргэжлийн талбарууд, хэсэгт бүлэглэсэн, шошготой (label), select-ийн утга value_label-тай, ' +
          'row-widget талбар нь columns-тай (массив дахь объектын баганы нэр). value нь инженерийн бичсэн бодит агуулга — тайланд оруул/хураангуйл. ' +
          'drawing_list = зургийн жагсаалт (done=дууссан эсэх). ' +
          'labelled=false бол тухайн багт каталог алга (ж: NORM), value түүхий. ' +
          'Блок бүрийн явцын тоог get_project_breakdown-оос ав.',
      });
    },
  );
}
