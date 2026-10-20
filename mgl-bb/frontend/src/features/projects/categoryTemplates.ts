/* Ангиллын ЗАГВАР төсөл (2026-10-06) — backend `lib/categoryTemplates.ts`-ийн
 * клиент тал.  Тухайн ангилалд загвар төсөл тохируулсан бол шинэ төсөл тэр
 * ангиллаар үүсэхэд (`POST /api/projects`) загварын бүтэц, ажлын
 * хуваарилалт (багийн хувь, блок, зураг, бүрэлдэхүүн, ажил, жин) СЕРВЕР
 * дээр автоматаар хуулагдана.  Энэ модуль зөвхөн харуулах/тохируулах. */
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import type { ProjectCategory } from '@/shared/lib/project-categories';

export interface CategoryTemplateInfo {
  category: ProjectCategory;
  project_id: number;
  name: string;
  status: string;
  counts: { teams: number; blocks: number; drawings: number; components: number; tasks: number };
  team_shares: { team_code: string; share_percent: number }[];
}

/** `POST /api/projects` хариуны `template` (null = загвар хэрэглээгүй). */
export type TemplateApplyResult =
  | {
      applied: true;
      source_project_id: number;
      source_name: string;
      counts: CategoryTemplateInfo['counts'];
      ceiling_pct: number;
      team_shares_written: boolean;
    }
  | {
      applied: false;
      source_project_id: number;
      source_name: string;
      reason: 'EMPTY' | 'TOO_LARGE' | 'FAILED';
    };

const KEY = ['/projects/category-templates'] as const;

/** Зөвхөн admin (endpoint `requireAdmin`) — бусдад `enabled: false` өг. */
export function useCategoryTemplates(enabled: boolean) {
  return useApiQuery<{ templates: CategoryTemplateInfo[] }>(KEY, '/projects/category-templates', {
    enabled,
    staleTime: 60_000,
  });
}

export function templateFor(
  templates: CategoryTemplateInfo[] | undefined,
  category: ProjectCategory | string | null | undefined,
): CategoryTemplateInfo | null {
  if (!category) return null;
  return templates?.find((x) => x.category === category) ?? null;
}

/** «EZ 100% · BA 0%» — багийн хувийн богино бичвэр. */
export function formatTemplateShares(t: CategoryTemplateInfo): string {
  return t.team_shares
    .map((s) => `${s.team_code} ${Number(s.share_percent.toFixed(2))}%`)
    .join(' · ');
}

export function useSetCategoryTemplate() {
  const qc = useQueryClient();
  return async (projectId: number, enabled: boolean) => {
    const res = await apiFetch<{ templates: CategoryTemplateInfo[] }>(
      `/projects/${projectId}/category-template`,
      { method: 'PUT', data: { enabled } },
    );
    qc.setQueryData(KEY, res);
    return res;
  };
}
