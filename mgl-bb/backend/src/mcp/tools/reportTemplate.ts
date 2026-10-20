import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Env } from '../../types';
import type { McpProps } from '../MglMcpAgent';

/* =============================================================
 * get_report_template — тайлангийн загварын (report_templates)
 * бүтцийг + блок бүрийн бичих зааврыг Claude-д өгнө.  Claude үүнийг
 * get_report_content (амьд өгөгдөл)-той хослуулж, компанийн стандарт
 * бүтэцтэй Microsoft Word (.docx) явцын тайланг ӨӨРӨӨ зохионо.
 *
 * Зөвхөн read.  Сервер тал ямар ч файл (docx/pdf) үүсгэхгүй — .docx-ийг
 * Claude client өөрөө үүсгэдэг.  non-client (staff)-д бүртгэнэ.
 * ============================================================= */

/** MCP tool-ийн стандарт текст хариу. */
const txt = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

/**
 * Блокийн төрөл бүрт Word баримт дээр «юу бичих, аль өгөгдлийн талбарыг
 * ашиглах»-ыг зааварчилна.  Тайлбар нь өгөгдөлтэй хамт Claude руу дамждаг тул
 * MCP prompt дэмждэггүй client дээр ч ажиллана.  Блокийн төрлүүд нь
 * report_template_blocks дахь `type`-тай (frontend-ийн performanceReportBlocks.ts
 * BLOCK_TYPES) нийцнэ.
 */
const BLOCK_GUIDE: Record<string, string> = {
  cover:
    'Нүүр хуудас. passport.full_title (байхгүй бол project.name)-ийг гол гарчиг болгож, ' +
    'үйлчлүүлэгч (passport.client_contacts эсвэл project_clients), тайлангийн огноо (generated_at), ' +
    'зургийн дугаар (passport.drawing_no), тайлангийн № (report.report_no)-г тавь.',
  toc:
    'Гарчиг. Word-ийн автомат Table of Contents-ийг дараагийн хэсгүүдийн гарчгаас үүсгэ.',
  'project-intro':
    'Төслийн танилцуулга. passport-аас scope (цар хүрээ), director (удирдагч), start_date/finish_date/extension_date, ' +
    'disciplines[] (оролцох мэргэжлүүд), client_contacts[] (холбоо барих хүмүүс); ' +
    'get_project_info-оос захиалагчийн баримтын бүртгэл (өгсөн/өгөөгүй статус), техникийн нөхцөл, ' +
    'гэрээний хугацаа/санхүүжилтийн үе шат (admin)-ийг эмхэлж бич.',
  'summary-notes':
    'Чөлөөт хураангуй тэмдэглэл. execution-summary-тэй адил боловч нэмэлт тэмдэглэл/тайлбарыг өгөгдөлд тулгуурлан бич.',
  'rich-text':
    'Чөлөөт текст блок (content.heading + content.body). Ихэвч «Гүйцэтгэх хураангуй» — нийт явц, хуваарьт байдал, ' +
    'энэ үед хийсэн гол ажил, дараагийн алхмуудыг 2–5 өгүүлбэрээр өгөгдлөөр бич. content.heading-ийг гарчиг болго.',
  'execution-summary':
    'Гүйцэтгэлийн хураангуй. overall_progress (%), schedule.rag статус, schedule.variance (оноо), ' +
    'schedule.elapsed_pct vs schedule.expected_pct (50/70 S-муруй), finish_passed зэргийг 2–4 өгүүлбэр + жижиг хүснэгтээр илэрхийл.',
  'team-narrative':
    'Тухайн багийн (content.team_code) явцын өгүүлэмж. ГОЛ ЭХ СУРВАЛЖ = get_team_reports-ийн тухайн team_code-ийн status (5 асуултын хариу) + answers (инженерийн бичсэн чөлөөт текст). ' +
    'Үүн дээр disciplines[]-аас progress/rag/task_count-ийг нэмж дэлгэрэнгүй явцын өгүүлэмж бич.',
  'team-stats':
    'Тухайн багийн (content.team_code) статистик. disciplines[]-аас progress %, task_count, share_percent, RAG; блок бүрийн задаргаа хэрэгтэй бол ' +
    'get_project_breakdown-ийн тухайн багийн блокуудаас (weight_percent, progress) хүснэгт гарга.',
  'all-team-stats':
    'Бүх мэргэжлийн (баг) явцын нэгтгэсэн хүснэгт. disciplines[] бүрийг мөр болгож: team_code, нэр (team_name_mn), ' +
    'share_percent, progress %, RAG статус.',
  'project-sections':
    'Төслийн ерөнхий хэсгүүд. get_team_reports-ийн GENERAL / ROOMS / FIRE / NORM team_code-ийн answers-аас агуулгыг ав (өрөө, галын аюулгүй байдал, норм г.м). Холбогдох өгөгдөл байхгүй бол алгасаж болно.',
  divider:
    'Хуваагч. content.style="page-break" бол Word-т хуудас таслал (page break), эс бөгөөс нимгэн зураас оруул.',
};

/** Word баримт угсрах эцсийн заавар (аль ч Claude client дээр ажиллана). */
const WORD_AUTHORING_GUIDE = [
  'Энэ бол тайлангийн загварын бүтэц (блокуудын дараалал) ба блок бүрийн бичих заавар.',
  'Дараах алхмаар Microsoft Word (.docx) баримт бэлд:',
  '1) Дараах өгөгдлийг цуглуул (тухайн project_id-аар): get_report_content (нийт явц, хуваарь/RAG, disciplines, drawing register, recent, authored) + get_project_info («Мэдээлэл» таб: захиалагчийн баримтын бүртгэл, техникийн нөхцөл, гэрээ/санхүүжилт[admin], лого) + get_team_reports («Тайлан» табуудад багуудын бичсэн агуулга: status + answers, мөн GENERAL/NORM/ROOMS/FIRE) + get_project_breakdown (блок→зураг→эд анги→таск бүтэн бүтэц + блок бүрийн явцын тоо). Илүү дэлгэрэнгүй хэрэгтэй бол get_project_report нэм.',
  '2) Доорх blocks[]-ийг дарааллаар нь дага. Блок бүрийн "guide"-ийн дагуу тухайн хэсгийн агуулгыг өгөгдлөөр бөглөж, шаардлагатай өгүүлэмж/дүгнэлт/эрсдэлийг өөрөө бич.',
  '3) Тайланг өгөгдлийн lang (эс бөгөөс mn)-ийн дагуу — анхдагчаар Монгол хэлээр бич. RAG статусыг шошго/өнгөөр илэрхийл: green=«Хуваарьт нийцэж байгаа», amber=«Эрсдэлтэй», red=«Хоцорсон», unknown=«Тодорхойгүй».',
  '4) Эцэст нь хэрэглэгчид татаж авах боломжтой .docx файлыг чат дотор шууд үүсгэж өг. Гарчиг, хүснэгт, хуудас таслал ашиглаж цэвэрхэн форматла.',
].join('\n');

/** Хадгалсан загвар байхгүй үед ашиглах built-in анхдагч бүтэц. */
const DEFAULT_OUTLINE: Array<{ type: string; content: Record<string, never> }> = [
  { type: 'cover', content: {} },
  { type: 'execution-summary', content: {} },
  { type: 'all-team-stats', content: {} },
  { type: 'project-intro', content: {} },
];

interface TemplateBlockRow {
  id: number;
  type: string;
  position: number;
  content_json: string;
  hidden: number;
}

interface TemplateListRow {
  id: number;
  name: string;
  description: string | null;
  is_default: number;
  team_code: string | null;
  block_count: number;
}

export function registerReportTemplateTools(server: McpServer, env: Env, _user: McpProps) {
  /** Тухайн загварын харагдах (нуугдаагүй) блокуудыг ачаалж, зааврыг хавсаргана. */
  const loadBlocks = async (templateId: number) => {
    const res = await env.DB.prepare(
      `SELECT id, type, position, content_json, hidden
         FROM report_template_blocks
        WHERE template_id = ? ORDER BY position, id`,
    )
      .bind(templateId)
      .all<TemplateBlockRow>();
    return (res.results ?? [])
      .filter((b) => b.hidden !== 1)
      .map((b) => {
        let content: unknown = {};
        try {
          content = JSON.parse(b.content_json ?? '{}');
        } catch {
          /* ignore malformed content_json */
        }
        return {
          id: b.id,
          type: b.type,
          position: b.position,
          content,
          guide: BLOCK_GUIDE[b.type] ?? 'Чөлөөт хэсэг — холбогдох гарчиг + агуулгыг өгөгдлөөр бич.',
        };
      });
  };

  server.registerTool(
    'get_report_template',
    {
      title: 'Get report template outline (to author a Word report)',
      description:
        'Return the structure of a saved report TEMPLATE (an ordered list of typed ' +
        'blocks) plus per-block authoring guidance, so you can compose a Microsoft ' +
        'Word (.docx) design-progress report that follows the firm’s standard ' +
        'layout. With no template_id, lists available templates and auto-selects the ' +
        'default one (its blocks are returned as `blocks`). Pass template_id to pick a ' +
        'specific one; team_code filters templates by discipline (firm-wide templates ' +
        'are always included). If no templates exist, a sensible built-in outline is ' +
        'returned so you can still produce a report. Pair with get_report_content to ' +
        'fill each section with live project data.',
      inputSchema: {
        template_id: z
          .number()
          .int()
          .optional()
          .describe('Specific report-template id. Omit to auto-select the default (or list all).'),
        team_code: z
          .string()
          .optional()
          .describe('Filter templates by discipline code (e.g. BA); firm-wide templates are always included.'),
      },
    },
    async ({ template_id, team_code }) => {
      // --- Тодорхой загвар шаардсан ---
      if (template_id != null) {
        const t = await env.DB.prepare(
          'SELECT id, name, description, is_default, team_code FROM report_templates WHERE id = ?',
        )
          .bind(template_id)
          .first<Omit<TemplateListRow, 'block_count'>>();
        if (!t) return txt({ error: `Report template ${template_id} not found.` });
        return txt({
          selected: {
            id: t.id,
            name: t.name,
            description: t.description,
            is_default: t.is_default === 1,
            team_code: t.team_code,
          },
          blocks: await loadBlocks(t.id),
          block_guide: BLOCK_GUIDE,
          word_authoring_guide: WORD_AUTHORING_GUIDE,
        });
      }

      // --- Жагсаалт + анхдагчийг автоматаар сонгох (route-ийн GET / SQL-тэй ижил) ---
      let sql =
        `SELECT t.id, t.name, t.description, t.is_default, t.team_code,
                (SELECT COUNT(*) FROM report_template_blocks b WHERE b.template_id = t.id) AS block_count
           FROM report_templates t`;
      const binds: unknown[] = [];
      if (team_code) {
        sql += ' WHERE t.team_code = ? OR t.team_code IS NULL';
        binds.push(team_code);
      }
      sql += ' ORDER BY t.is_default DESC, t.team_code IS NOT NULL DESC, t.created_at DESC';
      const stmt = env.DB.prepare(sql);
      const listRes = await (binds.length > 0 ? stmt.bind(...binds) : stmt).all<TemplateListRow>();
      const templates = (listRes.results ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        is_default: r.is_default === 1,
        team_code: r.team_code,
        block_count: r.block_count,
      }));

      if (templates.length === 0) {
        return txt({
          templates: [],
          selected: null,
          note: 'Хадгалсан тайлангийн загвар алга — доорх built-in анхдагч бүтцийг ашигла.',
          blocks: DEFAULT_OUTLINE.map((b) => ({
            type: b.type,
            content: b.content,
            guide: BLOCK_GUIDE[b.type] ?? '',
          })),
          block_guide: BLOCK_GUIDE,
          word_authoring_guide: WORD_AUTHORING_GUIDE,
        });
      }

      // Эрэмбэ нь is_default-ийг эхэнд тавьсан тул find эсвэл эхнийхийг ав.
      const chosen = templates.find((t) => t.is_default) ?? templates[0];
      return txt({
        templates,
        selected: chosen
          ? { id: chosen.id, name: chosen.name, is_default: chosen.is_default, team_code: chosen.team_code }
          : null,
        blocks: chosen ? await loadBlocks(chosen.id) : [],
        block_guide: BLOCK_GUIDE,
        word_authoring_guide: WORD_AUTHORING_GUIDE,
      });
    },
  );

  // ------- MCP prompt: "нэг товшилтын" туршлага (Claude Desktop) -------
  // Client талын дэмжлэг тогтмол биш тул зөвхөн нэмэлт тав тух — гол заавар нь
  // дээрх tool-уудын word_authoring_guide-д шингэсэн (аль ч client дээр ажиллана).
  server.registerPrompt(
    'write_word_report',
    {
      title: 'Write a Word progress report',
      description:
        'Compose a Microsoft Word (.docx) design-progress report for a project, ' +
        'following the firm’s report template and live project data.',
      argsSchema: {
        project: z.string().describe('Project name or id.'),
        lang: z.string().optional().describe("Report language: 'mn' (default) or 'en'."),
      },
    },
    ({ project, lang }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text:
              `«${project}» төслийн зураг төслийн явцын тайланг Microsoft Word (.docx) баримт болгож бэлдэж өгнө үү` +
              ` (${lang || 'mn'} хэлээр).\n\n` +
              'Алхам: (1) list_projects-оор төслийн ID-г ол. ' +
              '(2) get_report_template-ээр тайлангийн загварын бүтэц + блок бүрийн зааврыг ав. ' +
              '(3) Өгөгдлийг цуглуул: get_report_content (явц, хуваарь/RAG, багуудын гүйцэтгэл, drawing register, сүүлийн ажлууд), ' +
              'get_project_info («Мэдээлэл» таб: захиалагчийн баримт, техникийн нөхцөл, гэрээ/санхүүжилт[admin]), ' +
              'get_team_reports («Тайлан» табуудын багуудын бичсэн агуулга + GENERAL/ROOMS/FIRE), ' +
              'get_project_breakdown (блокуудын задаргаа). Шаардвал get_project_report нэм. ' +
              '(4) Загварын блокуудыг дарааллаар нь дагаж, гүйцэтгэлийн хураангуй, эрсдэл, багуудын өгүүлэмж, дүгнэлтийг өгөгдөлд тулгуурлан бичиж, эцэст нь татаж авах боломжтой .docx файлыг үүсгэж өг.',
          },
        },
      ],
    }),
  );
}
