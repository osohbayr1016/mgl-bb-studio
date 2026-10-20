import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpAgent } from 'agents/mcp';
import type { Env, JWTPayload } from '../types';
import { isAdminRole } from '../types';
import { MCP_DENIED_ROLES } from './guard';
import { registerProjectTools } from './tools/projects';
import { registerReportTools } from './tools/report';
import { registerGenerateReportTool, registerReportContentTool } from './tools/generateReport';
import { registerReportTemplateTools } from './tools/reportTemplate';
import { registerTeamReportTools } from './tools/teamReports';
import { registerProjectInfoTool } from './tools/projectInfo';
import { registerTaskTools } from './tools/tasks';
import { registerCompanyTools } from './tools/company';
import { registerAttendanceTools } from './tools/attendance';
import { registerPortfolioTools } from './tools/portfolio';
import { registerTrendTools } from './tools/trends';
import { registerWorkforceTools } from './tools/workforce';
import { registerExecutiveTools } from './tools/executive';
import { registerEmailTools } from './tools/email';
import { registerEmailTriageTools } from './tools/emailTriage';
import { registerEmailReadTools, registerCorrespondenceTools } from './tools/emailRead';
import { registerActiveProjectsTools } from './tools/activeProjects';
import { registerPersonActivityTools } from './tools/personActivity';
import { registerMeetingTools } from './tools/meetings';
import { registerQuantityTools } from './tools/quantities';
import { registerQuoteTools } from './tools/quotes';

/**
 * Нэвтэрсэн хэрэглэгчийн контекст.  bearer токеноос задлаад session тус бүрт
 * `ctx.props` болгон дамжуулна (index.ts доторх `handleMcp`-г үз).  McpAgent
 * нь үүнийг өөрийн storage-д хадгалдаг тул Durable Object дахин сэрэхэд
 * `this.props` болгон автоматаар сэргээгдэнэ.
 */
export type McpProps = {
  sub: number;
  role: JWTPayload['role'];
  /**
   * Олон-tenant суулгацын хил — `lib/tenants.ts`-ийн `TenantSpec.id`.
   * НЭГ-tenant суулгацад `undefined` (талбар огт нэмэгддэггүй), тэр үед
   * `mcp/guard.ts`-ийн tenant тулгалт бүрэн алгасагдана.  Талбар НЭМЭХ нь
   * аюулгүй; ХАСАХ нь DO storage-оос сэрсэн хуучин session-ыг эвдэнэ.
   */
  tid?: string;
};

/**
 * MGL Progress-ийн remote MCP server.  Cloudflare-ийн `agents` SDK-ийн
 * `McpAgent` нь SQLite-backed Durable Object бөгөөд session бүрийг тусдаа
 * instance-аар зохицуулна.  Tool бүр REST API-тай ИЖИЛ D1 query, ижил
 * харагдах/нуух дүрмийг дахин ашигладаг тул хариу нь үргэлж нийцнэ.
 */
/**
 * ⚠️ TODO(tenant) — T5, ЭНЭ АЖЛЫН ХАМРАХ ХҮРЭЭНД БИШ (1A-4 §3 алхам 6).
 *
 * Доорх tool бүр `this.env`-ээр бүртгэгддэг.  `this.env` бол Durable
 * Object-ийн DEPLOY-ҮЕИЙН env — `index.ts`-ийн `oauthProvider.fetch`-д
 * дамжуулсан `tenantEnv(...)`-ийн scoped env БИШ.  Мөн `runWithTenant`-ийн
 * `AsyncLocalStorage` нь DO-ийн хилийг ДАВДАГГҮЙ тул `currentTenantId()` энд
 * үргэлж `'default'`.  ⇒ Олон-tenant горим асаагдвал КОМПАНИ БҮРИЙН `/mcp`
 * сесс ҮНДСЭН (MGL-ийн) `DB` рүү унших болно.
 *
 * Тиймээс `index.ts`-ийн `fetch` нь `TENANTS` тохируулагдсан үед `/mcp` ба
 * `/sse`-г БҮХЭЛД НЬ 503 болгодог (L0 fail-closed).  Тэр хаалтыг арилгахын
 * өмнө ЭНЭ асуудлыг шийдэх ЁСТОЙ — `mcp/guard.ts`-ийн `tid` тулгалт нь
 * зөвхөн ХЭН БОЛОХЫГ барина, аль DB рүү очихыг БИШ.
 */
export class MglMcpAgent extends McpAgent<Env, Record<string, never>, McpProps> {
  server = new McpServer({
    name: 'MGL Progress',
    version: '1.0.0',
  });

  async init(): Promise<void> {
    // Wrapper нь props-гүй (нэвтрээгүй) хүсэлтийг 401-ээр буцаадаг тул энд
    // props заавал байна; гэхдээ strict mode-д тааруулж хамгаалалт нэмэв.
    const user = this.props;
    if (!user) return;

    // ⛔ MCP-д хориотой role — НЭГ Ч tool бүртгэхгүй (mcp/guard.ts).
    //    index.ts-ийн `guardMcp` аль хэдийн 403 өгдөг; ЭНЭ давхарга нь
    //    Durable Object СЭРЭХ замыг барина: `agents` нь props-ыг DO
    //    storage-д хадгалж (dist/mcp/index.js:1491), сэрэхэд `onStart` →
    //    `init()` дахин ажилладаг (:1499-1503) — тэр зам ямар ч HTTP
    //    хаалтаар дамжихгүй.  Зориудаар `throw` хийхгүй: DO доторх throw нь
    //    ойлгомжгүй 500 болдог, цэвэр 403 нь Worker талын wrapper-ийн ажил.
    if ((MCP_DENIED_ROLES as readonly string[]).includes(user.role)) return;

    registerProjectTools(this.server, this.env, user);

    // Тайлангийн tool-ууд (get_project_report / get_project_breakdown) — бүх
    // нэвтэрсэн хэрэглэгчид; доторх логик нь complexity_pct болон contributors
    // points-ийг non-admin-аас нуудаг (self-redacting).
    registerReportTools(this.server, this.env, user);

    // Үйлчлүүлэгчид зориулсан зураг төслийн явцын тайлан (WeasyPrint PDF) — бүх
    // нэвтэрсэн хэрэглэгчид (assertVisible нь client-ийг гишүүн төслөөр
    // хязгаарладаг; compute давхарга нь 'client' audience-д дотоод мэдээллийг
    // нуудаг).
    registerGenerateReportTool(this.server, this.env, user);

    // Word тайлан зохиоход зориулсан ДАТА tool (get_report_content) — бүх нэвтэрсэн
    // хэрэглэгчид, assertVisible-аар member-gated.  Файл рендэрлэхгүй; Claude
    // client энэ өгөгдлөөс .docx-ийг өөрөө үүсгэдэг.
    registerReportContentTool(this.server, this.env, user);

    // «Тайлан» табуудын дүүргэсэн агуулга (get_team_reports) — багуудын discipline
    // тайлан + GENERAL/NORM/ROOMS/FIRE.  REST /:id/team-reports-ийн MCP дүйцэл,
    // assertVisible-аар member-gated (client зөвхөн гишүүн төслөө).
    registerTeamReportTools(this.server, this.env, user);

    // Төслийн «Мэдээлэл» табын өгөгдөл (get_project_info) — захиалагчийн баримт,
    // техникийн нөхцөл, лого; гэрээ/санхүүжилт/агентлаг зөвхөн admin.  assertVisible
    // member-gated.
    registerProjectInfoTool(this.server, this.env, user);

    // Tier-1: миний таск (өөрийн) ба хугацаа хэтэрсэн таскууд — бүх хэрэглэгчид
    // (доторх логик нь харагдах төслөөр хязгаарладаг).
    registerTaskTools(this.server, this.env, user);

    // Захидлын бүртгэл унших — admin бүх төслийг, staff зөвхөн өөрийн гишүүн
    // төслийг (доторх canRead шалгана).
    registerCorrespondenceTools(this.server, this.env, user);

    // Компанийн ерөнхий тойм — client-ээс бусад бүх staff (route-ийн client
    // блоктой нийцнэ).
    if (user.role !== 'client') {
      registerCompanyTools(this.server, this.env, user);
      // Тайлангийн загварын бүтэц + Word угсрах заавар (get_report_template) +
      // write_word_report prompt — staff-ийн тайлан зохиох үйл тул client-д хэрэггүй.
      registerReportTemplateTools(this.server, this.env, user);
    }

    // Өнөөдрийн ирц = admin-tier ЭСВЭЛ багийн ахлах (senior).
    // requireManager-ийн MCP дүйцэл — бусад role-д tool огт бүртгэгдэхгүй.
    // (`list_pending_approvals` энд байсан — явцын баталгаажуулалтын алхам
    // 2026-09-17-нд хасагдсан тул tool-ийн хамт устгав.)
    if (isAdminRole(user.role) || user.role === 'senior') {
      registerAttendanceTools(this.server, this.env, user);
      // CEO-аналитик: ажиллах хүчний дүн шинжилгээ — admin ЭСВЭЛ senior
      // (timesheet/ирцийн REST gate-тэй нийцнэ).
      registerWorkforceTools(this.server, this.env, user);
      // Өдрөөр: хэн ямар төсөл дээр ажиллаж байгаа (clock-in дээр сонгосон төсөл).
      registerActiveProjectsTools(this.server, this.env, user);
      // Нэг хүн/багийн түүхэн ирц + идэвхжил (present/late/leave + оноо/бичлэг/төсөл).
      registerPersonActivityTools(this.server, this.env, user);
      // Тоо хэмжээ (QTO) — routes/qto.ts-ийн requireRole('admin','senior')
      // gate-ийн MCP дүйцэл (engineer/architect-ийг 2026-06-д хассан).
      registerQuantityTools(this.server, this.env, user);
    }

    // Үнэ тогтоох / гүйцэтгэх удирдлагын аналитик — зөвхөн admin-tier (senior
    // хасагдана — CLAUDE.md: seniors are excluded from pricing).
    if (isAdminRole(user.role)) {
      registerExecutiveTools(this.server, this.env, user);
      registerPortfolioTools(this.server, this.env, user);
      registerTrendTools(this.server, this.env, user);
      registerEmailTools(this.server, this.env, user);
      // Анхны WRITE tool: имэйлийг төсөл/баримтын төрөлд ангилж бүртгэнэ.
      // confirm-gate-тэй (default dry-run) тул санамсаргүй бичихгүй.
      registerEmailTriageTools(this.server, this.env, user);
      // Имэйл унших + хариу ноорог (илгээхгүй) — admin-only.
      registerEmailReadTools(this.server, this.env, user);
      // Хурлын тэмдэглэл — транскрипт + AI дүгнэлтийг Claude-д унших (admin-only,
      // route-ийн requireAdmin-тэй нийцнэ).
      registerMeetingTools(this.server, this.env, user);
      // Үнийн санал (list_quotes / get_quote) — routes/quotes.ts-ийн
      // requireAdmin()-ийн MCP дүйцэл. Үнэ, тариф нь нууц тул senior ОРОХГҮЙ;
      // tool дотор нь мөн isAdminRole-оор давхар шалгадаг.
      registerQuoteTools(this.server, this.env, user);
    }
  }
}
