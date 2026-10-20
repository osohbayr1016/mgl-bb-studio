/**
 * Архивласан төсөл (`projects.status = 'archived'`) — ЗӨВХӨН админд харагдана.
 *
 * Эзний шийдвэр (2026-09-28): архивласан төсөл ажилтны (инженер, архитектор,
 * ахлах, харилцагч) ЖАГСААЛТАД огт гарахгүй — Компани хуудасны төслийн
 * жагсаалт, Төслүүд хуудас (таб, «Бүгд»), sidebar-ийн хайлт, MCP /
 * MGL AI-ийн `list_projects`.  Дүрэм энэ ганц файлд — өөр газар role-ийг
 * дахин шалгавал нэг нь мартагдана.
 *
 * ⚠️ Энэ нь ЖАГСААЛТЫН шүүлт, эрхийн хаалт БИШ: `GET /api/projects/:id`
 * (мэдэгдэл, түүх, тайлангийн холбоос) хэвээр нээлттэй.
 *
 * `/api/projects/top` ба ажилтны сонголтын цонхнууд (ирц, хурал, хугацаа)
 * архивыг бүх хүнээс аль хэдийн нуудаг — тэдгээрт хамаарахгүй.
 */
import { isAdminRole } from '../types';

export function seesArchivedProjects(role: string): boolean {
  return isAdminRole(role);
}

/** `p` alias-тай `projects` мөрөнд нэмэх `AND …` хэсэг (админд хоосон). */
export function hideArchivedSql(role: string): string {
  return seesArchivedProjects(role) ? '' : ` AND COALESCE(p.status, '') <> 'archived'`;
}

/** SQL-ийг хөндөх боломжгүй (`PROJECT_LIST_SQL` байрлалт bind) газарт JS шүүлт. */
export function hideArchivedRows<T extends { status?: unknown }>(role: string, rows: T[]): T[] {
  return seesArchivedProjects(role) ? rows : rows.filter((r) => r.status !== 'archived');
}
