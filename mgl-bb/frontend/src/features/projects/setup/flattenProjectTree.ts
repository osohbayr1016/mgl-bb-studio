/** Flattens the nested project hierarchy returned by `GET /projects/:id`
 *  into the four parallel arrays this page is built around.
 *
 *  The project detail endpoint returns the entire block/drawing/component/
 *  task tree in one request (see `getProjectHierarchyFast` on the backend).
 *  An older version of the loader walked that tree client-side with a
 *  per-node fetch, producing an O(B·D·C·T) sequential waterfall of HTTP
 *  calls — hundreds of round trips serialised one after the other, which is
 *  the "loop" users saw on the configure screen. We hit the endpoint exactly
 *  once and flatten here instead.
 *
 *  Extracted verbatim from `AdminProjectSetupPage.tsx`'s `loadAll` when that
 *  module was split up — no behavioural change. */
import type { AssigneeSummary, Block, Comp, Drawing, Task } from './types';

/** One `task_assignees` row as `getProjectHierarchyFast` serialises it. Wider
 *  than `AssigneeSummary`: the join also carries avatar + primary-team columns
 *  this page never uses. That is exactly why the flattener projects each row
 *  down to `{ user_id, full_name }` before it reaches the store — the `.map`
 *  below is a narrowing, not a redundant clone. */
export interface ProjectTreeAssignee extends AssigneeSummary {
  profile_image: string | null;
  team_id: number | null;
  team_code: string | null;
  team_name_mn: string | null;
}

/* The server sends more per node than we read (`created_at`, `project_id`,
 * `responsible_name`, `assigned_name`, per-level `progress`, …). Those are
 * deliberately left undeclared: nothing here reads them, and omitting them
 * keeps a typo on a field we DO read a compile error. This used to be
 * `T & Record<string, any>`, which silently typed every misspelling as `any`. */
export type ProjectTreeTask = Omit<Task, 'assignees'> & { assignees?: ProjectTreeAssignee[] };
export type ProjectTreeComponent = Comp & { tasks?: ProjectTreeTask[] };
export type ProjectTreeDrawing = Drawing & { components?: ProjectTreeComponent[] };
export type ProjectTreeBlock = Block & { drawings?: ProjectTreeDrawing[] };

export function flattenProjectTree(resBlocks: ProjectTreeBlock[] | undefined) {
  const bs: Block[] = [];
  const aD: Drawing[] = [],
    aC: Comp[] = [],
    aT: Task[] = [];

  for (const b of resBlocks ?? []) {
    bs.push({
      id: b.id,
      name: b.name,
      weight_percent: b.weight_percent,
      sort_order: b.sort_order,
      team_id: b.team_id ?? null,
    });
    for (const d of b.drawings ?? []) {
      aD.push({
        id: d.id,
        block_id: b.id,
        name: d.name,
        weight_percent: d.weight_percent,
        sort_order: d.sort_order,
      });
      for (const c of d.components ?? []) {
        aC.push({
          id: c.id,
          drawing_id: d.id,
          name: c.name,
          weight_percent: c.weight_percent,
          sort_order: c.sort_order,
        });
        for (const t of c.tasks ?? []) {
          aT.push({
            id: t.id,
            component_id: c.id,
            name: t.name,
            weight_percent: t.weight_percent,
            assigned_to: t.assigned_to ?? null,
            assignees: (t.assignees ?? []).map(
              (a): AssigneeSummary => ({ user_id: a.user_id, full_name: a.full_name }),
            ),
            due_date: t.due_date ?? null,
            start_date: t.start_date ?? null,
            sort_order: t.sort_order,
            progress: typeof t.progress === 'number' ? t.progress : 0,
          });
        }
      }
    }
  }

  return { blocks: bs, drawings: aD, components: aC, tasks: aT };
}
