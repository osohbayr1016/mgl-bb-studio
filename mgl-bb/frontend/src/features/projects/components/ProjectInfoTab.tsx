import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  FileText,
  GitBranch,
  Save,
  Loader2,
  Plus,
  Trash2,
  Check,
  X,
  Pencil,
  Building2,
  User as UserIcon,
  Hash,
  ListChecks,
  Phone,
  Mail,
  Users as UsersIcon,
  MapPin,
  LayoutList,
  Printer,
  Sparkles,
} from 'lucide-react';
import { apiFetch } from '@/shared/api/client';
import { ClientLogoUpload } from '@/features/projects/components/ClientLogoUpload';
import { useApiQuery } from '@/shared/api/useApi';
import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Textarea } from '@/ui/textarea';
import { Badge } from '@/ui/badge';
import { toast } from '@/shared/components/Toast';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { formatDate } from '@/shared/lib/time';
import { extractMapsUrl, locationDisplayText } from '@/shared/lib/mapsLink';
import { OpenInGoogleMaps } from '@/features/projects/components/OpenInGoogleMaps';
import { DisciplinePicker } from '@/features/projects/components/passport/DisciplinePicker';
import { ScopeRowsEditor } from '@/features/projects/components/passport/ScopeRowsEditor';
import { TimelineEditor } from '@/features/projects/components/passport/TimelineEditor';
import {
  fillScopeCodeLabels,
  passportForDisplay,
  seedScopeRows,
  toIsoDate,
} from '@/features/projects/components/passport/passportSections';
import { PassportDocumentEditor } from '@/features/projects/components/passport/PassportDocumentEditor';
import {
  LOCKED_FIELDS,
  diffDocRows,
  docPatchToPassport,
  docRowFromClientDoc,
  docRowsFromClientDocs,
  existingDocId,
  passportToDocDraft,
} from '@/features/projects/components/passport/passportDoc';
import type { IntroDocRow, IntroOverride } from '@/features/performance-reports/types/introOverride';
import type {
  ProjectPassport,
  ProjectDetailResponse,
  ProjectClientDocument,
  ClientDocStatus,
  ClientContact,
  ProjectTechCondition,
} from '@/shared/types';

/* =============================================================
 * ProjectInfoTab
 * -------------------------------------------------------------
 * "Паспорт" cover sheet for a project + tracker for the documents
 * the client must hand over.  Used by both staff and clients:
 *
 *   readOnly = false  → admins/engineers see the full editor + can
 *                       add/edit/remove rows in the documents grid.
 *   readOnly = true   → clients see a printable read-only summary,
 *                       and only the {Зөвшөөрөх / Хүлээгдэж байна}
 *                       toggle on each document row is interactive.
 *
 * The component is intentionally self-contained — it fetches its own
 * data, so the parent just renders <ProjectInfoTab projectId=... />.
 *
 * ХОЁР ХАРАГДАЦ (2026-09-21, эзний хүсэлт «Project Description-ийг Word
 * баримт шиг шууд харж, засаж, хадгалдаг болго»):
 *   • «Баримт» (өгөгдмөл) — `PassportDocumentEditor`, ЯГ тэр
 *     `ProjectIntroPage` бүрэлдэхүүн, үүсгэх шидтэн ба гүйцэтгэлийн
 *     тайлангийн §1-тэй ижил.  Нүд дээр нь шууд бичнэ, Хадгалах нэг.
 *   • «Маягт» — хуучин талбарын маягт; утас/имэйл, тэмдэглэл, газрын
 *     зураг зэрэг цаасан маягтад байхгүй зүйлс энд.
 * Хоёулаа ГАНЦ `passport` state-ийг засдаг тул хооронд нь солиход
 * хадгалаагүй засвар алдагдахгүй.  Зөрүүг `passport/passportDoc.ts`
 * шийднэ (түгжсэн нүд, CEO ⇄ client_contacts, бичиг баримтын diff).
 * ============================================================= */

type PassportView = 'document' | 'form';
/** Сүүлд сонгосон харагдац — ХӨТЧИЙН тохиргоо, өгөгдөл биш. */
const VIEW_STORAGE_KEY = 'mgl.passport.view';

function readStoredView(): PassportView {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'form' ? 'form' : 'document';
  } catch {
    return 'document';
  }
}

function storeView(v: PassportView): void {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, v);
  } catch {
    /* хувийн цонх / хориглосон санах ой — өгөгдмөл л ажиллана */
  }
}

/** Баримт дээрх 1.3-ын огноо чөлөөт текст тул хадгалахын өмнө ISO болгоно;
 *  хөрвүүлж чадаагүйг нь буцаана (`ProjectsPage.handleCreate`-тэй ижил дүрэм —
 *  сервер `start_date`/`finish_date` баганад ШУУД бичдэг бөгөөд тэдгээрийг
 *  `company.ts` / `deadlineSweep` харьцуулдаг). */
function isoOrBad<T extends { date: string }>(rows: T[]): { rows: T[]; bad: string | null } {
  const out = rows.map((r) => ({ ...r, date: toIsoDate(r.date) }));
  const bad = out.find((r) => r.date && !/^\d{4}-\d{2}-\d{2}$/.test(r.date));
  return { rows: out, bad: bad ? bad.date : null };
}

/** `GET /api/projects/:id/derived`-ийн нэг мөр — ЭНЭ төслөөс бүтцээ хуулж
 *  авсан төсөл (`projects.source_project_id`, migration 0254).
 *
 *  ⚠️ Энд `ProjectWithProgress`-ыг ашиглаагүй нь санаатай: маршрут нь
 *  `PROJECT_LIST_SQL`-ийг ОГТ дуудахгүй, ердөө долоон багана + ажлын тоо
 *  буцаана.  Илүү өргөн төрөл өгвөл байхгүй талбарууд руу (progress,
 *  member_count) хандаж болох мэт харагдана. */
interface DerivedProjectRow {
  id: number;
  name: string;
  display_title?: string | null;
  category?: string | null;
  status?: string | null;
  created_at?: string | null;
  source_project_id?: number | null;
  task_count?: number | null;
}

const STATUS_TONE: Record<ClientDocStatus, string> = {
  pending:
    'bg-warning/10 text-warning border-warning/30 ',
  provided:
    'bg-success/10 text-success border-success/30 ',
  not_required: 'bg-muted text-muted-foreground border-border',
};

const EMPTY_PASSPORT: ProjectPassport = {
  project_id: 0,
  full_title: null,
  drawing_no: null,
  doc_no: null,
  scope: null,
  director: null,
  client_pm: null,
  start_date: null,
  finish_date: null,
  extension_date: null,
  meeting_30: null,
  meeting_50: null,
  meeting_100: null,
  disciplines: [],
  client_contacts: [],
  scope_rows: [],
  timeline: [],
  meetings: [],
  notes: null,
  updated_at: '',
  updated_by_id: null,
};

const EMPTY_CONTACT: ClientContact = {
  full_name: '',
  position: '',
  phone: '',
  email: '',
};

interface ProjectInfoTabProps {
  projectId: number;
  locationLabel?: string | null;
  /** `projects.latitude/longitude` — «Google Maps дээр нээх» яг цэг рүү
   *  нээхэд (байхгүй бол хаягийн бичвэрээр хайна, `shared/lib/mapsLink.ts`). */
  latitude?: number | null;
  longitude?: number | null;
  mapPreview?: React.ReactNode;
  /** When true, the form is read-only (client view).  Document status can
   *  still be flipped because that's the one thing clients are meant to do. */
  readOnly?: boolean;
}

export type TeamProgressItem = {
  code: string;
  label: string;
  taskCount: number;
  progress: number;
};

export function ProjectInfoTab({
  projectId,
  locationLabel,
  latitude = null,
  longitude = null,
  mapPreview,
  readOnly = false,
}: ProjectInfoTabProps) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  /* ⚠️ Паспортыг senior засах боломжтой болсон (`requireManager()`), ГЭВЧ
   * энэ хуудсан дээрх дараах гурван үйлдэл backend дээр `requireAdmin()`
   * ХЭВЭЭР: `PUT /:id/client-logo`, `DELETE /client-documents/:docId`,
   * `DELETE /tech-conditions/:condId`.  Тэдгээрийн товчийг senior-т
   * ХАРУУЛАХГҮЙ — эс бөгөөс дарахад 403 өгдөг товч харагдана
   * (AdminProjectSetupPage дээр аль хэдийн байгаа алдааны хэв маяг). */
  const isAdminUser = user?.role === 'admin';
  const canDelete = !readOnly && isAdminUser;
  const passportKey = ['/projects/passport', projectId] as const;
  const documentsKey = ['/projects/client-documents', projectId] as const;
  const techCondsKey = ['/projects/tech-conditions', projectId] as const;

  const passportQuery = useApiQuery<{ passport: ProjectPassport | null }>(
    passportKey,
    `/projects/${projectId}/passport`,
  );
  const docsQuery = useApiQuery<{ documents: ProjectClientDocument[] }>(
    documentsKey,
    `/projects/${projectId}/client-documents`,
  );
  const techCondsQuery = useApiQuery<{ conditions: ProjectTechCondition[] }>(
    techCondsKey,
    `/projects/${projectId}/tech-conditions`,
  );
  /* Захиалагч (байгууллагын нэр) нь `project_clients`-д амьдардаг, паспортод
   * БИШ.  2026-09-28-аас (эзний хүсэлт: «Захиалагч» таб биш, баримт / маягт
   * дээр НЭРИЙГ шууд бичиж нэмж, хасдаг болго) энд ЗАСАГДАНА: засвар нь
   * `clientDraft`-д хүлээж, паспортын Хадгалах `client_name` илгээнэ —
   * сервер `project_clients`-д бичнэ (`backend/src/lib/passportClient.ts`:
   * хоосон = хасах, мөргүй = нэмэх, байгаа = эхний мөрийн нэрийг солих). */
  /* ⚠️ Түлхүүр нь `detail/useProjectDetail.ts`-ийнхтэй ЯГ ижил
   * (`['/projects', <route id мөр>]`) — өөр түлхүүр өгвөл TanStack дедуп
   * хийж чадахгүй бөгөөд энэ хуудсын хамгийн ХҮНД хүсэлт (бүтэн шатлал +
   * rollup CTE) хоёр удаа явна, дээрээс нь хажуугийн засварын дараа энэ
   * хуулбар хуучирна. */
  const projectQuery = useApiQuery<ProjectDetailResponse>(
    ['/projects', String(projectId)] as const,
    `/projects/${projectId}`,
  );
  /* «Үүссэн төслүүд» — ЭНЭ барилгын бүтцээс салаалсан (ихэвчлэн засварын)
   * төслүүд.
   *
   * ⚠️ Кэшийн түлхүүр нь ЗОРИУД өөр хэлбэртэй: дээрх `projectQuery` нь
   * `['/projects', String(projectId)]` (мөр!) — тэр нь `useProjectDetail`-
   * тэй дедуп хийхийн тулд.  Энэ нь тусдаа маршрут тул өөрийн нэрийн
   * зайтай (`'/projects/derived'`) бөгөөд id-г ТООГООР хадгална, паспорт /
   * баримт / техникийн нөхцөлийн түлхүүрүүдтэй ижил.  Хоёрыг «цэгцлэх»
   * гэж оролдвол дэлгэрэнгүй хуудасны ХАМГИЙН ХҮНД асуулга хоёр удаа явна.
   *
   * ⚠️ Маршрут нь `requireManager()` — эрхгүй хүнд 403 өгнө.  Иймд
   * engineer/architect/client дээр ОГТ асуухгүй, `retry: false`. */
  const canSeeDerived = !readOnly && (user?.role === 'admin' || user?.role === 'senior');
  const derivedQuery = useApiQuery<{ projects: DerivedProjectRow[] }>(
    ['/projects/derived', projectId] as const,
    `/projects/${projectId}/derived`,
    { enabled: canSeeDerived, retry: false },
  );
  const derivedProjects = derivedQuery.data?.projects ?? [];

  const clientNames = (projectQuery.data?.clients ?? [])
    .map((cl) => cl.name?.trim())
    .filter((n): n is string => !!n);
  const serverClientName = clientNames.join(', ');

  const [passport, setPassport] = useState<ProjectPassport>(EMPTY_PASSPORT);
  const [docs, setDocs] = useState<ProjectClientDocument[]>([]);
  /* Баримт дээрх «Бичиг баримт» мөрүүд — `docs`-ын ЛОКАЛ хуулбар.  Тракер
   * хүснэгт мөр бүрийг шууд серверт бичдэг бол баримт дээрх засвар Хадгалах
   * хүртэл энд хүлээнэ (`diffDocRows`).  Тракерын мутаци бүр үүнийг ч
   * шинэчилнэ — эс бөгөөс хадгалаагүй баримт хуучин нэрийг дарж бичнэ. */
  const [docRows, setDocRows] = useState<IntroDocRow[]>([]);
  const [techConds, setTechConds] = useState<ProjectTechCondition[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  /* Хадгалаагүй захиалагчийн нэр; `null` = хөндөөгүй (серверийнхийг харуулна). */
  const [clientDraft, setClientDraft] = useState<string | null>(null);
  const clientValue = clientDraft ?? serverClientName;
  const editClientName = (v: string) => {
    setClientDraft(v);
    setDirty(true);
  };
  const [view, setView] = useState<PassportView>(readStoredView);
  const switchView = (v: PassportView) => {
    setView(v);
    storeView(v);
  };
  const loading = passportQuery.isLoading || docsQuery.isLoading || techCondsQuery.isLoading;
  /* ⚠️ Паспорт ирээгүй үед маягтыг ХЭЗЭЭ Ч засварлах горимд гаргаж болохгүй.
   * Тэр үед локал төлөв нь `EMPTY_PASSPORT` (бүх талбар null, хүснэгтүүд
   * хоосон) хэвээр байдаг ба нэг нүд хүрмэгц Хадгалах идэвхжинэ — upsert нь
   * `excluded.*`-аар бүх баганыг дарж бичдэг тул нэрээс эхлээд
   * `start_date`/`finish_date` хүртэл NULL болно.  5xx нь хоёр удаа
   * дахин оролддог (queryClient) тул сүлжээ доголдоход бодитой тохиолдол. */
  const passportUnavailable = !passportQuery.isLoading && passportQuery.data === undefined;

  // Sync server data → local mirrors. Skip when dirty so unsaved edits
  // aren't clobbered by a background refetch (e.g. window-focus revalidation).
  useEffect(() => {
    const p = passportQuery.data;
    if (!p || dirty) return;
    const loaded = p.passport ?? { ...EMPTY_PASSPORT, project_id: projectId };
    /* ⚠️ 1.3-ын огноог ҮРГЭЛЖ баганаас НӨХНӨ.  `start_date`/`finish_date`-ыг
     * «Хуваарь» цонх (routes/timeline.ts) ЗӨВХӨН баганад бичдэг бөгөөд
     * `timeline_json`-д хүрдэггүй — нөхөхгүй бол энэ хүснэгт хоосон
     * харагдаад, хадгалахад сервер тэр баганыг NULL болгож төслийг хугацааны
     * хяналтаас унагана (`mergeTimelineWithLegacy`-ийн тайлбарыг үз).
     *
     * ⚠️ Уулзалтын хуваарийг АВТОМАТААР бөглөХГҮЙ: доорх `savePassport` нь
     * `meetings`-ыг болзолгүй илгээдэг тул зохиосон мөрүүд хэрэглэгчийн
     * бичээгүй байхад DB рүү бичигдэж, устгасан ч буцаж ирдэг байв.  Жишиг
     * 30/60/90/100 %-ийг `TimelineEditor`-ийн ил товчоор нэмнэ. */
    setPassport(passportForDisplay(loaded));
  }, [passportQuery.data, projectId, dirty]);

  useEffect(() => {
    const d = docsQuery.data;
    if (!d) return;
    setDocs(d.documents ?? []);
    /* Паспортын effect-тэй ижил: хадгалаагүй засвартай үед баримтын мөрийг
     * дарж бичихгүй; Хадгалсны дараа (`dirty` → false) шинэ өгөгдлөөс сэргээнэ. */
    if (!dirty) setDocRows(docRowsFromClientDocs(d.documents ?? []));
  }, [docsQuery.data, dirty]);

  useEffect(() => {
    const d = techCondsQuery.data;
    if (!d) return;
    setTechConds(d.conditions ?? []);
  }, [techCondsQuery.data]);

  useEffect(() => {
    const err = passportQuery.error ?? docsQuery.error ?? techCondsQuery.error;
    if (err) toast.error(t('projectInfoTab.loadFailed'), err.message);
  }, [passportQuery.error, docsQuery.error, techCondsQuery.error, t]);

  const updatePassport = <K extends keyof ProjectPassport>(key: K, val: ProjectPassport[K]) => {
    setPassport((p) => ({ ...p, [key]: val }));
    setDirty(true);
  };

  /* ---- Баримтын харагдац: `ProjectIntroPage`-ийн патч → state ---- */
  const docDraft = passportToDocDraft({
    passport,
    documents: docRows,
    clientName: clientValue,
    /* Захиалагчийн самбар `locationLabel` өгдөггүй — төслийн мөрөөс нөхнө. */
    location: locationLabel ?? projectQuery.data?.project?.location ?? '',
  });

  const applyDocPatch = (patch: Partial<IntroOverride>) => {
    if (patch.documents !== undefined) {
      setDocRows(patch.documents);
      setDirty(true);
    }
    /* Захиалагч паспортын багана биш — `client_name`-ээр тусад нь хадгална. */
    if (patch.clientName !== undefined) editClientName(patch.clientName);
    /* Функциональ setState — CEO мөр `client_contacts`-ын ОДООГИЙН утгаас
     * (утас/имэйл хэвээр) гаргадаг тул хуучирсан closure-оор бичиж болохгүй. */
    setPassport((p) => {
      const next = docPatchToPassport(patch, p);
      if (Object.keys(next).length === 0) return p;
      setDirty(true);
      return { ...p, ...next };
    });
  };

  /* «Бичиг баримт» мөрүүдийг серверт тулгана — мөр бүр ТУСДАА хүсэлт (багц
   * route байхгүй, `ProjectsPage.handleCreate`-тэй ижил).  Унасан мөрийг
   * буцааж баримт дээр үлдээж, `dirty` хэвээр — дараагийн Хадгалах дахин
   * оролдоно.  Амжилттай үүссэн мөрийн түр id-г серверийн id-гаар СОЛИНО,
   * эс бөгөөс дахин Хадгалахад давхар үүснэ. */
  const syncDocRows = async (): Promise<{ next: ProjectClientDocument[]; failed: string[] }> => {
    const diff = diffDocRows(docs, docRows);
    let next = docs.slice();
    const failed: string[] = [];
    const replaceId = new Map<string, IntroDocRow>();
    const restore: IntroDocRow[] = [];

    for (const { row, sort_order } of diff.create) {
      try {
        const res = await apiFetch<{ document: ProjectClientDocument }>(
          `/projects/${projectId}/client-documents`,
          {
            method: 'POST',
            data: {
              doc_name: row.name.trim(),
              doc_no: row.no.trim() || null,
              doc_date: row.date.trim() || null,
              description: row.description.trim() || null,
              sort_order,
            },
          },
        );
        next.push(res.document);
        replaceId.set(row.id, docRowFromClientDoc(res.document));
      } catch {
        failed.push(row.name);
      }
    }
    for (const { id, row, sort_order } of diff.update) {
      try {
        const res = await apiFetch<{ document: ProjectClientDocument }>(
          `/projects/client-documents/${id}`,
          {
            method: 'PUT',
            data: {
              doc_name: row.name.trim(),
              doc_no: row.no.trim() || null,
              doc_date: row.date.trim() || null,
              description: row.description.trim() || null,
              sort_order,
            },
          },
        );
        next = next.map((d) => (d.id === id ? res.document : d));
      } catch {
        failed.push(row.name);
      }
    }
    for (const id of diff.remove) {
      const cur = docs.find((d) => d.id === id);
      try {
        await apiFetch(`/projects/client-documents/${id}`, { method: 'DELETE' });
        next = next.filter((d) => d.id !== id);
      } catch {
        /* `DELETE` нь backend дээр requireAdmin() ХЭВЭЭР — senior-т 403.
         * Мөрийг баримт дээр буцааж тавина, устгагдаагүйг ил хэлнэ. */
        if (cur) {
          failed.push(`${cur.doc_name} (${t('projectInfoTab.docDeleteAdminOnly')})`);
          restore.push(docRowFromClientDoc(cur));
        }
      }
    }
    next.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    if (replaceId.size || restore.length) {
      setDocRows((rows) => [...rows.map((r) => replaceId.get(r.id) ?? r), ...restore]);
    }
    return { next, failed };
  };

  const savePassport = async () => {
    const tl = isoOrBad(passport.timeline);
    const mt = isoOrBad(passport.meetings);
    const badDate = tl.bad ?? mt.bad;
    if (badDate) {
      toast.error(t('projectsPage.badDate'), badDate);
      return;
    }
    /* Захиалагчийг ЗӨВХӨН өөрчлөгдсөн үед илгээнэ — талбар ирээгүй бол сервер
     * `project_clients`-д хүрэхгүй (төрөл / хувь хэвээр). */
    const clientChanged = clientDraft !== null && clientDraft.trim() !== serverClientName.trim();
    setSaving(true);
    try {
      const res = await apiFetch<{
        passport: ProjectPassport;
        message: string;
        clients?: ProjectDetailResponse['clients'];
      }>(
        `/projects/${projectId}/passport`,
        {
          method: 'PUT',
          data: {
            ...(clientChanged ? { client_name: clientDraft.trim() || null } : {}),
            full_title: passport.full_title,
            drawing_no: passport.drawing_no,
            doc_no: passport.doc_no,
            scope: passport.scope,
            director: passport.director,
            // legacy single-line field — kept null; replaced by client_contacts
            client_pm: null,
            disciplines: passport.disciplines,
            client_contacts: passport.client_contacts,
            /* Word загварын 1.2 / 1.3.  ⚠️ `start_date` / `finish_date` /
             * `extension_date`-ыг ЭНД дахин илгээхгүй — сервер тэднийг
             * `timeline`-аас гаргаж авдаг (хоёр эх сурвалж болвол зөрнө). */
            scope_rows: passport.scope_rows,
            timeline: tl.rows,
            meetings: mt.rows,
            notes: passport.notes,
          },
        },
      );
      const fresh = {
        ...res.passport,
        client_contacts: res.passport.client_contacts ?? [],
        scope_rows: fillScopeCodeLabels(res.passport.scope_rows ?? []),
        timeline: res.passport.timeline ?? [],
        meetings: res.passport.meetings ?? [],
      };
      setPassport(fresh);
      queryClient.setQueryData(passportKey, { passport: fresh });
      /* Захиалагчийн шинэ жагсаалт — толгойн карт, ЗХ, тайлан бүгд
       * `['/projects', id]`-аас уншдаг тул тэр кэшийг шууд шинэчилнэ
       * (дахин татвал бүтэн шатлалын хүнд асуулга явна). */
      if (res.clients) {
        const clients = res.clients;
        queryClient.setQueryData<ProjectDetailResponse>(
          ['/projects', String(projectId)],
          (old) => (old ? { ...old, clients } : old),
        );
      }
      setClientDraft(null);

      /* Баримт дээрх «Бичиг баримт» мөрүүд — паспортын ДАРАА, тусдаа. */
      const { next, failed } = await syncDocRows();
      setDocs(next);
      queryClient.setQueryData(documentsKey, { documents: next });
      if (failed.length) {
        toast.error(t('projectInfoTab.docsSyncFailed'), failed.join(', '));
        return; // `dirty` хэвээр — дахин Хадгалах боломжтой
      }
      setDirty(false);
      toast.success(res.message ?? t('common.saved'));
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('common.error');
      toast.error(t('projectInfoTab.saveFailed'), msg);
    } finally {
      setSaving(false);
    }
  };

  /* Хэвлэх нь ТУСДАА хуудсанд (`PassportPrintPage`) — ЗХ, RFI/CR, үнийн
   * саналтай ижил бүтэц.  Энэ таб дотроос `window.print()` хийхэд аппын
   * бүрхүүл (`h-dvh overflow-hidden` + `<main>`-ийн скролл) `.print-area`-г
   * тайрч баримтын ДЭЭД хэсэг хэвлэгддэггүй, мөн хар-хөх толгойн нүд
   * «Background graphics»-гүйгээр цайрдаг байв (2026-09-28, эзний скрин).
   * Хэвлэх хуудас СЕРВЕРЭЭС уншдаг тул хадгалаагүй засвар түүнд харагдахгүй —
   * тиймээс эхлээд хадгалуулна. */
  const printDocument = () => {
    if (dirty) {
      toast.error(t('projectInfoTab.printUnsaved'));
      return;
    }
    window.open(`/reports/project/${projectId}/passport/print?auto=1`, '_blank');
  };

  /* ------------------------ documents ops ------------------------ */
  const addDoc = async () => {
    const draft = {
      doc_name: t('projectInfoTab.newDocument'),
      doc_no: null,
      doc_date: null,
      source: null,
      description: null,
      status: 'pending' as const,
      sort_order: docs.length + 1,
    };
    try {
      const res = await apiFetch<{ document: ProjectClientDocument }>(
        `/projects/${projectId}/client-documents`,
        { method: 'POST', data: draft },
      );
      setDocs((prev) => {
        const next = [...prev, res.document];
        queryClient.setQueryData(documentsKey, { documents: next });
        return next;
      });
      /* Баримт дээр ч гарна — `dirty` үед effect дахин синк хийдэггүй. */
      setDocRows((rows) => [...rows, docRowFromClientDoc(res.document)]);
    } catch (e) {
      toast.error(t('projectInfoTab.addFailed'), e instanceof Error ? e.message : '');
    }
  };

  const updateDoc = async (id: number, patch: Partial<ProjectClientDocument>) => {
    // Optimistic — rollback on server error.
    const prev = docs;
    setDocs((d) => d.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    try {
      const res = await apiFetch<{ document: ProjectClientDocument }>(
        `/projects/client-documents/${id}`,
        { method: 'PUT', data: patch },
      );
      setDocs((d) => {
        const next = d.map((x) => (x.id === id ? res.document : x));
        queryClient.setQueryData(documentsKey, { documents: next });
        return next;
      });
      /* ЗӨВХӨН патчид ирсэн талбарыг баримтын мөрөнд буулгана — тэр мөрийн
       * бусад нүдэнд хадгалаагүй баримтын засвар байж болно. */
      setDocRows((rows) =>
        rows.map((r) =>
          existingDocId(r.id) === id
            ? {
                ...r,
                ...(patch.doc_name !== undefined ? { name: patch.doc_name ?? '' } : {}),
                ...(patch.doc_no !== undefined ? { no: patch.doc_no ?? '' } : {}),
                ...(patch.doc_date !== undefined ? { date: patch.doc_date ?? '' } : {}),
                ...(patch.description !== undefined
                  ? { description: patch.description ?? '' }
                  : {}),
              }
            : r,
        ),
      );
    } catch (e) {
      setDocs(prev);
      toast.error(t('projectInfoTab.updateFailed'), e instanceof Error ? e.message : '');
    }
  };

  const removeDoc = async (id: number) => {
    if (!(await confirmDialog({ description: t('projectInfoTab.confirmDeleteDoc'), variant: 'destructive' }))) return;
    const prev = docs;
    const next = docs.filter((x) => x.id !== id);
    setDocs(next);
    queryClient.setQueryData(documentsKey, { documents: next });
    try {
      await apiFetch(`/projects/client-documents/${id}`, { method: 'DELETE' });
      setDocRows((rows) => rows.filter((r) => existingDocId(r.id) !== id));
    } catch (e) {
      setDocs(prev);
      queryClient.setQueryData(documentsKey, { documents: prev });
      toast.error(t('projectInfoTab.deleteFailed'), e instanceof Error ? e.message : '');
    }
  };

  /* ------------------------ tech conditions ops ------------------------ */
  const addTechCond = async () => {
    const draft = {
      title: t('projectInfoTab.newCondition'),
      value: null,
      description: null,
      condition_date: null,
      sort_order: techConds.length + 1,
    };
    try {
      const res = await apiFetch<{ condition: ProjectTechCondition }>(
        `/projects/${projectId}/tech-conditions`,
        { method: 'POST', data: draft },
      );
      setTechConds((prev) => {
        const next = [...prev, res.condition];
        queryClient.setQueryData(techCondsKey, { conditions: next });
        return next;
      });
    } catch (e) {
      toast.error(t('projectInfoTab.addFailed'), e instanceof Error ? e.message : '');
    }
  };

  const updateTechCond = async (id: number, patch: Partial<ProjectTechCondition>) => {
    const prev = techConds;
    setTechConds((arr) => arr.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    try {
      const res = await apiFetch<{ condition: ProjectTechCondition }>(
        `/projects/tech-conditions/${id}`,
        { method: 'PUT', data: patch },
      );
      setTechConds((arr) => {
        const next = arr.map((x) => (x.id === id ? res.condition : x));
        queryClient.setQueryData(techCondsKey, { conditions: next });
        return next;
      });
    } catch (e) {
      setTechConds(prev);
      toast.error(t('projectInfoTab.updateFailed'), e instanceof Error ? e.message : '');
    }
  };

  const removeTechCond = async (id: number) => {
    if (!(await confirmDialog({ description: t('projectInfoTab.confirmDeleteCondition'), variant: 'destructive' }))) return;
    const prev = techConds;
    const next = techConds.filter((x) => x.id !== id);
    setTechConds(next);
    queryClient.setQueryData(techCondsKey, { conditions: next });
    try {
      await apiFetch(`/projects/tech-conditions/${id}`, { method: 'DELETE' });
    } catch (e) {
      setTechConds(prev);
      queryClient.setQueryData(techCondsKey, { conditions: prev });
      toast.error(t('projectInfoTab.deleteFailed'), e instanceof Error ? e.message : '');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> {t('common.loading')}
      </div>
    );
  }

  if (passportUnavailable) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
        <p className="font-medium text-destructive">{t('projectInfoTab.loadFailed')}</p>
        <p className="mt-1 text-muted-foreground text-xs">
          {t('projectInfoTab.loadFailedHint')}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => void passportQuery.refetch()}
        >
          {t('common.retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ClientLogoUpload projectId={projectId} readOnly={readOnly || !isAdminUser} />
      {/* ============================================================
       *  Passport / cover-sheet card
       * ============================================================ */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2 pb-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              {t('projectInfoTab.passport')}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {t('projectInfoTab.passportDesc')}
              {readOnly && ` ${t('projectInfoTab.readOnlyMode')}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Баримт / Маягт — хоёулаа ижил state, Хадгалах нэг. */}
            <div
              role="tablist"
              aria-label={t('projectInfoTab.viewLabel')}
              className="inline-flex rounded-md border border-border bg-muted/30 p-0.5"
            >
              <Button
                type="button"
                role="tab"
                aria-selected={view === 'document'}
                size="sm"
                variant={view === 'document' ? 'default' : 'ghost'}
                className="h-7 px-2.5 text-xs"
                onClick={() => switchView('document')}
              >
                <FileText className="w-3.5 h-3.5 mr-1.5" />
                {t('projectInfoTab.viewDocument')}
              </Button>
              <Button
                type="button"
                role="tab"
                aria-selected={view === 'form'}
                size="sm"
                variant={view === 'form' ? 'default' : 'ghost'}
                className="h-7 px-2.5 text-xs"
                onClick={() => switchView('form')}
              >
                <LayoutList className="w-3.5 h-3.5 mr-1.5" />
                {t('projectInfoTab.viewForm')}
              </Button>
            </div>
            {/* «Багуудаас бөглөх» — баримт дотор товч байрлуулах газар байхгүй
                тул толгойд (маягтад `ScopeRowsEditor` өөрөө харуулдаг). */}
            {view === 'document' && !readOnly && passport.disciplines.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() =>
                  updatePassport(
                    'scope_rows',
                    seedScopeRows({
                      existing: passport.scope_rows,
                      disciplines: passport.disciplines,
                      teamShares: projectQuery.data?.team_shares ?? [],
                      projectName: projectQuery.data?.project?.name ?? '',
                      startDate:
                        passport.timeline.find((r) => r.id === 'tl-start')?.date ||
                        passport.start_date ||
                        null,
                    }),
                  )
                }
              >
                <Sparkles className="w-3 h-3 mr-1.5" />
                {t('projectInfoTab.scopeRowsSeed')}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={printDocument}
            >
              <Printer className="w-3.5 h-3.5 mr-1.5" />
              {t('projectInfoTab.print')}
            </Button>
            {!readOnly && (
              <Button onClick={savePassport} disabled={!dirty || saving} size="sm" className="h-7">
                {saving ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5 mr-1.5" />
                )}
                {saving
                  ? t('common.saving')
                  : dirty
                    ? t('common.save')
                    : t('projectInfoTab.saved')}
              </Button>
            )}
          </div>
        </CardHeader>
        {view === 'document' ? (
          <CardContent className="space-y-3">
            {!readOnly && (
              <p className="text-micro text-muted-foreground">{t('projectInfoTab.docViewHint')}</p>
            )}
            {/* Глобал хайлтын анкорууд — маягтын харагдацад хэсэг бүр дээрээ
                байдаг; баримтад хэсгүүд нэг хуудсан дотор тул энд л. */}
            <div id="sec-passport-scope" className="scroll-mt-24" />
            <div id="sec-passport-timeline" className="scroll-mt-24" />
            <div className="print-area pd-doc-print">
              <PassportDocumentEditor
                value={docDraft}
                onChange={applyDocPatch}
                readOnly={readOnly}
                lockedFields={LOCKED_FIELDS}
              />
            </div>
            {!readOnly && (
              <div className="pt-1">
                <Label className="text-xs">{t('projectInfoTab.notes')}</Label>
                <Textarea
                  rows={2}
                  value={passport.notes ?? ''}
                  onChange={(e) => updatePassport('notes', e.target.value || null)}
                  placeholder={t('projectInfoTab.notesPlaceholder')}
                />
              </div>
            )}
            {readOnly && passport.notes && (
              <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                <div className="text-xs text-muted-foreground mb-1">{t('projectInfoTab.notes')}</div>
                {passport.notes}
              </div>
            )}
          </CardContent>
        ) : (
        <CardContent className="space-y-4">
          {/* Title + drawing no.  «Doc. No.» талбар 2026-09-28-нд хасагдсан
              (эзний хүсэлт; прод дээр утга 0 — `doc_no` багана хэвээр). */}
          <div className="grid gap-3 md:grid-cols-[1fr_200px]">
            <PassField
              icon={<Building2 className="w-3.5 h-3.5" />}
              label={t('projectInfoTab.projectTitleLabel')}
              value={passport.full_title}
              readOnly={readOnly}
              onChange={(v) => updatePassport('full_title', v || null)}
              placeholder={t('projectInfoTab.projectTitlePlaceholder')}
            />
            <PassField
              icon={<Hash className="w-3.5 h-3.5" />}
              label={t('projectInfoTab.drawingNoLabel')}
              value={passport.drawing_no}
              readOnly={readOnly}
              onChange={(v) => updatePassport('drawing_no', v || null)}
              placeholder="MEC-25/21"
            />
          </div>

          {/* Захиалагч — нэрийг шууд бичнэ (хоосолбол хасагдана); баримтын
              «Client» нүдтэй ижил `clientDraft`, Хадгалахад `project_clients`. */}
          <PassField
            icon={<Building2 className="w-3.5 h-3.5" />}
            label={t('projectInfoTab.clientLabel')}
            value={clientValue}
            readOnly={readOnly}
            onChange={editClientName}
            placeholder={t('projectInfoTab.clientPlaceholder')}
          />

          {/* Scope */}
          <PassField
            icon={<ListChecks className="w-3.5 h-3.5" />}
            label={t('projectInfoTab.scopeLabel')}
            value={passport.scope}
            readOnly={readOnly}
            onChange={(v) => updatePassport('scope', v || null)}
            placeholder={t('projectInfoTab.scopePlaceholder')}
            multiline
          />

          <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-2 mb-3">
              <Label className="text-xs flex items-center gap-1.5 text-muted-foreground">
                <MapPin className="w-3.5 h-3.5 text-primary" />
                {t('projectInfoTab.locationLabel')}
              </Label>
              {!mapPreview && (
                <Badge variant="outline" className="text-micro font-normal">
                  {t('projectInfoTab.noMap')}
                </Badge>
              )}
            </div>
            <div
              className={
                mapPreview ? 'grid gap-3 lg:grid-cols-[230px_minmax(0,1fr)] lg:items-stretch' : ''
              }
            >
              {mapPreview && <div className="min-w-0">{mapPreview}</div>}
              <div className="min-w-0 rounded-md border border-border/60 bg-background/70 px-3 py-2">
                <div className="text-micro text-muted-foreground">
                  {t('projectInfoTab.addressOrNote')}
                </div>
                {/* Хаягийн бичвэрт Google Maps холбоос буулгасан бол урт URL-ийг
                    биш «Google Maps холбоос» гэсэн шошго + хүний бичсэн хэсгийг
                    харуулна; нээх нь доорх товчоор (пин → холбоос → хаяг). */}
                <p className="mt-1 text-sm font-medium text-foreground break-words">
                  {locationLabel ? (
                    <>
                      {locationDisplayText(locationLabel)}
                      {extractMapsUrl(locationLabel) && (
                        <Badge variant="outline" className="ml-1.5 align-middle text-micro font-normal">
                          {t('projectMap.linkBadge')}
                        </Badge>
                      )}
                    </>
                  ) : (
                    <span className="text-muted-foreground italic">
                      {t('projectInfoTab.noLocation')}
                    </span>
                  )}
                </p>
                <OpenInGoogleMaps
                  className="mt-2"
                  project={{ location: locationLabel, latitude, longitude }}
                />
              </div>
            </div>
          </div>

          {/* Director (single column — Client PM is now a multi-row table below) */}
          <PassField
            icon={<UserIcon className="w-3.5 h-3.5" />}
            label={t('projectInfoTab.directorLabel')}
            value={passport.director}
            readOnly={readOnly}
            onChange={(v) => updatePassport('director', v || null)}
            placeholder={t('projectInfoTab.directorPlaceholder')}
            multiline
          />

          {/* Client project-management contacts (replaces single Client PM) */}
          <ClientContactsTable
            contacts={passport.client_contacts}
            readOnly={readOnly}
            onChange={(next) => updatePassport('client_contacts', next)}
          />

          {/* Disciplines — 1.1-ийн ■ мөр (DisciplinePicker-т нүүсэн, учир
              нь төсөл ҮҮСГЭХ шидтэн ч мөн адил үүнийг харуулна). */}
          <DisciplinePicker
            value={passport.disciplines}
            onChange={(next) => updatePassport('disciplines', next)}
            readOnly={readOnly}
          />

          {/* ================= 1.2 Хамрах хүрээ ================= */}
          <div id="sec-passport-scope" className="scroll-mt-24">
            <div className="mb-2 text-xs font-semibold text-foreground">
              {t('projectInfoTab.section12')}
            </div>
            <ScopeRowsEditor
              rows={passport.scope_rows}
              onChange={(next) => updatePassport('scope_rows', next)}
              readOnly={readOnly}
              teamShares={projectQuery.data?.team_shares ?? []}
              disciplines={passport.disciplines}
              projectName={projectQuery.data?.project?.name ?? ''}
              startDate={
                passport.timeline.find((r) => r.id === 'tl-start')?.date ||
                passport.start_date ||
                null
              }
            />
          </div>

          {/* ================= 1.3 Төслийн хугацаа ================= */}
          <div id="sec-passport-timeline" className="scroll-mt-24">
            <div className="mb-2 text-xs font-semibold text-foreground">
              {t('projectInfoTab.section13')}
            </div>
            <TimelineEditor
              timeline={passport.timeline}
              meetings={passport.meetings}
              onTimelineChange={(next) => updatePassport('timeline', next)}
              onMeetingsChange={(next) => updatePassport('meetings', next)}
              readOnly={readOnly}
            />
          </div>

          {!readOnly && (
            <div className="pt-1">
              <Label className="text-xs">{t('projectInfoTab.notes')}</Label>
              <Textarea
                rows={2}
                value={passport.notes ?? ''}
                onChange={(e) => updatePassport('notes', e.target.value || null)}
                placeholder={t('projectInfoTab.notesPlaceholder')}
              />
            </div>
          )}

          {readOnly && passport.notes && (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
              <div className="text-xs text-muted-foreground mb-1">{t('projectInfoTab.notes')}</div>
              {passport.notes}
            </div>
          )}
        </CardContent>
        )}
      </Card>

      {/* ============================================================
       *  Client-supplied documents tracker
       * ============================================================ */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <ListChecks className="w-4 h-4 text-primary" />
              {t('projectInfoTab.requiredDocuments')}
              <Badge variant="outline" className="text-micro font-normal ml-1">
                {docs.filter((d) => d.status === 'provided').length} / {docs.length}
              </Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {readOnly
                ? t('projectInfoTab.docsDescReadOnly')
                : t('projectInfoTab.docsDesc')}
            </p>
          </div>
          {!readOnly && (
            <Button size="sm" variant="outline" onClick={addDoc}>
              <Plus className="w-3.5 h-3.5 mr-1.5" /> {t('projectInfoTab.addRow')}
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {docs.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground italic">
              {t('projectInfoTab.noDocuments')} {!readOnly && t('projectInfoTab.addRowHint')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <th className="px-3 py-2 border-b border-border w-12 text-center">№</th>
                    <th className="px-3 py-2 border-b border-border min-w-[200px]">
                      {t('projectInfoTab.colDocument')}
                    </th>
                    <th className="px-3 py-2 border-b border-border w-40">
                      {t('projectInfoTab.colNumber')}
                    </th>
                    <th className="px-3 py-2 border-b border-border w-32">
                      {t('projectInfoTab.colDate')}
                    </th>
                    <th className="px-3 py-2 border-b border-border w-44">
                      {t('common.description')}
                    </th>
                    <th className="px-3 py-2 border-b border-border w-44 text-center">
                      {t('projectInfoTab.colStatus')}
                    </th>
                    {!readOnly && <th className="px-2 py-2 border-b border-border w-10"></th>}
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d, idx) => (
                    <DocRow
                      key={d.id}
                      doc={d}
                      index={idx + 1}
                      readOnly={readOnly}
                      onChange={(patch) => updateDoc(d.id, patch)}
                      onRemove={() => removeDoc(d.id)}
                      canDelete={canDelete}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ============================================================
       *  Технийн нөхцөл — engineering parameters provided at project
       *  start.  Same UX as the documents table (inline editing,
       *  "Мөр нэмэх", per-row delete) but stripped of status logic
       *  because these rows are spec values, not deliverables.
       * ============================================================ */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <ListChecks className="w-4 h-4 text-primary" />
              {t('projectInfoTab.techConditions')}
              <Badge variant="outline" className="text-micro font-normal ml-1">
                {techConds.length}
              </Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {readOnly
                ? t('projectInfoTab.techDescReadOnly')
                : t('projectInfoTab.techDesc')}
            </p>
          </div>
          {!readOnly && (
            <Button size="sm" variant="outline" onClick={addTechCond}>
              <Plus className="w-3.5 h-3.5 mr-1.5" /> {t('projectInfoTab.addRow')}
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {techConds.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground italic">
              {t('projectInfoTab.noConditions')} {!readOnly && t('projectInfoTab.addRowHint')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <th className="px-3 py-2 border-b border-border w-12 text-center">№</th>
                    <th className="px-3 py-2 border-b border-border min-w-[200px]">
                      {t('projectInfoTab.colTitle')}
                    </th>
                    <th className="px-3 py-2 border-b border-border min-w-[160px]">
                      {t('projectInfoTab.colValue')}
                    </th>
                    <th className="px-3 py-2 border-b border-border min-w-[180px]">
                      {t('common.description')}
                    </th>
                    <th className="px-3 py-2 border-b border-border w-32">
                      {t('projectInfoTab.colDate')}
                    </th>
                    {!readOnly && <th className="px-2 py-2 border-b border-border w-10"></th>}
                  </tr>
                </thead>
                <tbody>
                  {techConds.map((cond, idx) => (
                    <TechConditionRow
                      key={cond.id}
                      cond={cond}
                      index={idx + 1}
                      readOnly={readOnly}
                      onChange={(patch) => updateTechCond(cond.id, patch)}
                      onRemove={() => removeTechCond(cond.id)}
                      canDelete={canDelete}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ============================================================
       *  Үүссэн төслүүд — ЭНЭ төслийн бүтцээс хуулж үүсгэсэн төслүүд
       *  (`projects.source_project_id`, migration 0254).  Ихэнхдээ ижил
       *  барилгын ЗА (засвар) төслүүд.
       *
       *  ⚠️ `id="sec-derived-projects"` + `scroll-mt-24` нь глобал хайлтын
       *  анкор — хосолсон мөр нь `shared/lib/search/sections.ts`-д байна.
       *  Хоёрын аль нэгийг нь хасвал хайлтын үр дүн ХООСОН хуудас руу
       *  аваачна.
       * ============================================================ */}
      {canSeeDerived && !derivedQuery.isError && (
        <Card id="sec-derived-projects" className="scroll-mt-24">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-primary" />
              {t('projectDetail.derivedProjects')}
              <Badge variant="outline" className="text-micro font-normal ml-1">
                {derivedProjects.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {derivedProjects.length === 0 ? (
              <div className="px-6 py-8 text-center text-sm text-muted-foreground italic">
                {derivedQuery.isLoading ? t('common.loading') : t('projectDetail.derivedEmpty')}
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {derivedProjects.map((p) => (
                  <li key={p.id}>
                    <Link
                      to={`/app/projects/${p.id}`}
                      className="flex items-center gap-2 px-4 py-2.5 text-sm transition-colors hover:bg-muted/40"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {p.display_title || p.name}
                      </span>
                      {p.category && (
                        <Badge
                          variant="outline"
                          className="shrink-0 font-mono text-micro font-normal"
                        >
                          {p.category}
                        </Badge>
                      )}
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {t('setupCompletionHero.tasksCount', { count: p.task_count ?? 0 })}
                      </span>
                      {p.created_at && (
                        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                          {formatDate(p.created_at)}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ---------- subcomponents ---------- */

/** Editable list of client-side project-management contacts.
 *  Replaces the old single-line `client_pm` field.  Same UX as the funding
 *  milestones table: one row per contact, "+ Мөр нэмэх" at the bottom. */
function ClientContactsTable({
  contacts,
  readOnly,
  onChange,
}: {
  contacts: ClientContact[];
  readOnly: boolean;
  onChange: (next: ClientContact[]) => void;
}) {
  const { t } = useLanguage();
  const updateRow = (idx: number, patch: Partial<ClientContact>) => {
    onChange(contacts.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };
  const removeRow = (idx: number) => onChange(contacts.filter((_, i) => i !== idx));
  const addRow = () => onChange([...contacts, { ...EMPTY_CONTACT }]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <Label className="text-xs flex items-center gap-1.5">
          <UsersIcon className="w-3.5 h-3.5 text-primary" />
          {t('projectInfoTab.clientContactsLabel')}
        </Label>
        {!readOnly && (
          <Button size="sm" variant="outline" onClick={addRow}>
            <Plus className="w-3.5 h-3.5 mr-1.5" /> {t('projectInfoTab.addRow')}
          </Button>
        )}
      </div>

      {contacts.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-muted/20 px-4 py-6 text-center text-xs text-muted-foreground italic">
          {readOnly
            ? t('projectInfoTab.noContactsReadOnly')
            : t('projectInfoTab.noContactsHint')}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left">
                <th className="px-3 py-2 border-b border-border min-w-[180px]">
                  {t('projectInfoTab.colFullName')}
                </th>
                <th className="px-3 py-2 border-b border-border min-w-[140px]">
                  {t('projectInfoTab.colPosition')}
                </th>
                <th className="px-3 py-2 border-b border-border w-44">
                  {t('projectInfoTab.colPhone')}
                </th>
                <th className="px-3 py-2 border-b border-border w-56">
                  {t('projectInfoTab.colEmail')}
                </th>
                {!readOnly && <th className="px-2 py-2 border-b border-border w-10"></th>}
              </tr>
            </thead>
            <tbody>
              {contacts.map((c, i) => (
                <tr key={i} className="border-b last:border-b-0 border-border">
                  <td className="px-2 py-1.5 align-top">
                    {readOnly ? (
                      <div className="px-1 py-1 text-sm">{c.full_name || '—'}</div>
                    ) : (
                      <Input
                        value={c.full_name}
                        onChange={(e) => updateRow(i, { full_name: e.target.value })}
                        placeholder={t('projectInfoTab.fullNamePlaceholder')}
                        className="h-8 text-sm"
                      />
                    )}
                  </td>
                  <td className="px-2 py-1.5 align-top">
                    {readOnly ? (
                      <div className="px-1 py-1 text-sm">{c.position || '—'}</div>
                    ) : (
                      <Input
                        value={c.position}
                        onChange={(e) => updateRow(i, { position: e.target.value })}
                        placeholder={t('projectInfoTab.positionPlaceholder')}
                        className="h-8 text-sm"
                      />
                    )}
                  </td>
                  <td className="px-2 py-1.5 align-top">
                    {readOnly ? (
                      <div className="px-1 py-1 text-sm flex items-center gap-1.5">
                        {c.phone && <Phone className="w-3 h-3 text-muted-foreground" />}
                        {c.phone || '—'}
                      </div>
                    ) : (
                      <Input
                        value={c.phone}
                        onChange={(e) => updateRow(i, { phone: e.target.value })}
                        placeholder="9911-2233"
                        className="h-8 text-sm"
                      />
                    )}
                  </td>
                  <td className="px-2 py-1.5 align-top">
                    {readOnly ? (
                      <div className="px-1 py-1 text-sm flex items-center gap-1.5">
                        {c.email && <Mail className="w-3 h-3 text-muted-foreground" />}
                        {c.email || '—'}
                      </div>
                    ) : (
                      <Input
                        type="email"
                        value={c.email}
                        onChange={(e) => updateRow(i, { email: e.target.value })}
                        placeholder="example@company.mn"
                        className="h-8 text-sm"
                      />
                    )}
                  </td>
                  {!readOnly && (
                    <td className="px-1 py-1.5 align-top text-center">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => removeRow(i)}
                        title={t('projectInfoTab.deleteRow')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PassField({
  icon,
  label,
  value,
  onChange,
  placeholder,
  multiline,
  readOnly,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string | null;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  readOnly?: boolean;
}) {
  return (
    <div>
      <Label className="text-xs flex items-center gap-1.5 mb-1">
        {icon}
        {label}
      </Label>
      {readOnly ? (
        <div
          className={
            multiline
              ? 'min-h-[2.25rem] rounded-md border border-border bg-muted/20 px-3 py-1.5 text-sm whitespace-pre-wrap'
              : 'h-9 rounded-md border border-border bg-muted/20 px-3 py-1.5 text-sm flex items-center'
          }
        >
          {value || <span className="text-muted-foreground italic">—</span>}
        </div>
      ) : multiline ? (
        <Textarea
          rows={2}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <Input
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
    </div>
  );
}

interface DocRowProps {
  doc: ProjectClientDocument;
  index: number;
  readOnly: boolean;
  onChange: (patch: Partial<ProjectClientDocument>) => void;
  onRemove: () => void;
  /** Устгах товч — backend дээр `requireAdmin()` тул senior-т харуулахгүй. */
  canDelete: boolean;
}

interface TechConditionRowProps {
  cond: ProjectTechCondition;
  index: number;
  readOnly: boolean;
  onChange: (patch: Partial<ProjectTechCondition>) => void;
  onRemove: () => void;
  /** Устгах товч — backend дээр `requireAdmin()` тул senior-т харуулахгүй. */
  canDelete: boolean;
}

function TechConditionRow({
  cond,
  index,
  readOnly,
  onChange,
  onRemove,
  canDelete,
}: TechConditionRowProps) {
  // Inline-edit pattern identical to DocRow but trimmed for the
  // smaller column set.  Click a cell → editable input → blur commits
  // the patch through the parent's optimistic update helper.
  const { t } = useLanguage();
  const [editingField, setEditingField] = useState<keyof ProjectTechCondition | null>(null);
  const [draftValue, setDraftValue] = useState('');

  const startEdit = (field: keyof ProjectTechCondition) => {
    if (readOnly) return;
    setEditingField(field);
    setDraftValue((cond[field] as string | null) ?? '');
  };
  const commitEdit = () => {
    if (!editingField) return;
    const next = draftValue.trim();
    const prev = (cond[editingField] as string | null) ?? '';
    if (next !== prev) {
      onChange({ [editingField]: next || null } as Partial<ProjectTechCondition>);
    }
    setEditingField(null);
  };

  const Cell = ({
    field,
    placeholder,
    type = 'text',
  }: {
    field: keyof ProjectTechCondition;
    placeholder?: string;
    type?: 'text' | 'date';
  }) => {
    if (editingField === field) {
      return (
        <Input
          autoFocus
          type={type}
          value={draftValue}
          onChange={(e) => setDraftValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEdit();
            if (e.key === 'Escape') setEditingField(null);
          }}
          className="h-7 text-sm"
        />
      );
    }
    const value = cond[field] as string | null;
    return (
      <div
        className={
          readOnly
            ? 'text-sm'
            : 'text-sm cursor-text hover:bg-primary/5 rounded px-1 -mx-1 py-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        }
        role={readOnly ? undefined : 'button'}
        tabIndex={readOnly ? undefined : 0}
        onClick={() => startEdit(field)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            startEdit(field);
          }
        }}
        title={readOnly ? undefined : t('projectInfoTab.clickToEdit')}
      >
        {value || <span className="text-muted-foreground italic">{placeholder ?? '—'}</span>}
      </div>
    );
  };

  return (
    <tr className="hover:bg-muted/30 align-top">
      <td className="px-3 py-2 border-b border-border text-center text-xs text-muted-foreground">
        {index}
      </td>
      <td className="px-3 py-2 border-b border-border">
        <div className="font-medium">
          <Cell field="title" placeholder={t('projectInfoTab.colTitle')} />
        </div>
      </td>
      <td className="px-3 py-2 border-b border-border">
        <Cell field="value" placeholder={t('projectInfoTab.colValue')} />
      </td>
      <td className="px-3 py-2 border-b border-border">
        <Cell field="description" placeholder={t('common.description')} />
      </td>
      <td className="px-3 py-2 border-b border-border">
        <Cell field="condition_date" placeholder={t('projectInfoTab.datePlaceholder')} type="date" />
      </td>
      {canDelete && (
        <td className="px-2 py-2 border-b border-border text-center">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={onRemove}
            title={t('common.delete')}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </td>
      )}
    </tr>
  );
}

function DocRow({ doc, index, readOnly, onChange, onRemove, canDelete }: DocRowProps) {
  // Inline editing for staff: clicking a cell switches to <Input>; blur saves.
  const { t } = useLanguage();
  const [editingField, setEditingField] = useState<keyof ProjectClientDocument | null>(null);
  const [draftValue, setDraftValue] = useState('');

  const startEdit = (field: keyof ProjectClientDocument) => {
    if (readOnly) return;
    setEditingField(field);
    setDraftValue((doc[field] as string | null) ?? '');
  };
  const commitEdit = () => {
    if (editingField === null) return;
    const value = draftValue.trim() || null;
    if (value !== (doc[editingField] as string | null)) {
      onChange({ [editingField]: value } as Partial<ProjectClientDocument>);
    }
    setEditingField(null);
  };
  const cancelEdit = () => setEditingField(null);

  const Cell = ({
    field,
    placeholder,
  }: {
    field: keyof ProjectClientDocument;
    placeholder?: string;
  }) => {
    const isEditing = editingField === field;
    const value = doc[field] as string | null;
    if (isEditing) {
      return (
        <Input
          autoFocus
          value={draftValue}
          onChange={(e) => setDraftValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEdit();
            if (e.key === 'Escape') cancelEdit();
          }}
          className="h-7 text-xs"
        />
      );
    }
    return (
      <div
        className={
          readOnly
            ? 'text-sm'
            : 'text-sm cursor-text hover:bg-primary/5 rounded px-1 -mx-1 py-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        }
        role={readOnly ? undefined : 'button'}
        tabIndex={readOnly ? undefined : 0}
        onClick={() => startEdit(field)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            startEdit(field);
          }
        }}
        title={readOnly ? undefined : t('projectInfoTab.clickToEdit')}
      >
        {value || <span className="text-muted-foreground italic">{placeholder ?? '—'}</span>}
      </div>
    );
  };

  return (
    <tr className="hover:bg-muted/30 align-top">
      <td className="px-3 py-2 border-b border-border text-center text-xs text-muted-foreground">
        {index}
      </td>
      <td className="px-3 py-2 border-b border-border">
        <div className="font-medium">
          <Cell field="doc_name" placeholder={t('projectInfoTab.docNamePlaceholder')} />
        </div>
      </td>
      <td className="px-3 py-2 border-b border-border">
        <Cell field="doc_no" placeholder={t('projectInfoTab.colNumber')} />
      </td>
      <td className="px-3 py-2 border-b border-border">
        <Cell field="doc_date" placeholder={t('projectInfoTab.datePlaceholder')} />
      </td>
      <td className="px-3 py-2 border-b border-border">
        {/* Single "Тайлбар" cell — collapsed the old source / description
            pair into one field per UX request.  Legacy `source` strings
            from older rows still display (as a faint top line) so we
            don't lose existing data; new entries write to `description`
            only. */}
        {doc.source && (
          <div className="text-micro text-muted-foreground mb-0.5 italic">{doc.source}</div>
        )}
        <Cell field="description" placeholder={t('common.description')} />
      </td>
      <td className="px-3 py-2 border-b border-border text-center">
        <StatusToggle value={doc.status} onChange={(s) => onChange({ status: s })} />
        {doc.status === 'provided' && doc.provided_at && (
          <div className="text-micro text-muted-foreground mt-0.5">
            {formatDate(new Date(doc.provided_at))}
            {doc.provided_by_name && !readOnly && ` · ${doc.provided_by_name}`}
          </div>
        )}
      </td>
      {canDelete && (
        <td className="px-2 py-2 border-b border-border text-center">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={onRemove}
            title={t('common.delete')}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </td>
      )}
    </tr>
  );
}

function StatusToggle({
  value,
  onChange,
}: {
  value: ClientDocStatus;
  onChange: (s: ClientDocStatus) => void;
}) {
  const { t } = useLanguage();
  // Binary flip between "Өгсөн" / "Өгөөгүй" per UX request — the legacy
  // "Шаардлагагүй" state is preserved in DB but no longer cycled through
  // here; admins can still set it via direct API if needed.  Clicking a
  // row in `not_required` state flips it back to `pending` (Өгөөгүй).
  const next = (cur: ClientDocStatus): ClientDocStatus =>
    cur === 'provided' ? 'pending' : 'provided';
  return (
    <button
      type="button"
      onClick={() => onChange(next(value))}
      className={
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-micro font-medium hover:opacity-80 transition-opacity ' +
        STATUS_TONE[value]
      }
      title={t('projectInfoTab.clickToChangeStatus')}
    >
      {value === 'provided' && <Check className="w-3 h-3" />}
      {value === 'pending' && <Pencil className="w-3 h-3" />}
      {value === 'not_required' && <X className="w-3 h-3" />}
      {t(`projectInfoTab.status.${value}`)}
    </button>
  );
}
