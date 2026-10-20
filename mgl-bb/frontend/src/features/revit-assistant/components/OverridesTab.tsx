import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw, ShieldOff, TriangleAlert } from 'lucide-react';

import { ApiError, apiFetch } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage } from '@/shared/i18n';
import { useTabParam } from '@/shared/hooks/useTabParam';
import { toast } from '@/shared/components/Toast';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { Label } from '@/ui/label';
import { Skeleton } from '@/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table';
import { Textarea } from '@/ui/textarea';

/**
 * ХҮЧИНГҮЙ БОЛГОЛТ (§68) — инженерийн БҮРТГЭГДСЭН САНАЛ ЗӨРӨЛДӨӨН.
 *
 * ⚠️ ЭНЭ ТАБ ЮУ ГЭЖ УНШИГДАХ ЁСТОЙ ВЭ:
 * Хүчингүй болголт нь машины дүгнэлтийг ЗАССАН ч, УСТГАСАН ч үйлдэл БИШ.
 * `compliance_findings`-ийн `verdict`, `severity`, `evidence_level`, тооцоо,
 * нотолгоо нь ХӨНДӨГДӨХГҮЙ — зөвхөн `lifecycle_state` нь `'DISMISSED'`
 * болно.  Хүчингүй болгох мөч дэх машины дүгнэлт нь `*_at_override`
 * баганууд дотор ХӨЛДӨЖ хадгалагдана, яг тэднийг энд харуулна.  Тиймээс
 * мөр бүр «хүн ийм гэж хэлсэн, машин тийм гэж хэлсэн» гэсэн ХОС бичлэг
 * болж уншигдана.  UI-аас «дүгнэлтийг зассан», «алдааг арилгасан» гэсэн
 * утга гарах ЁСГҮЙ — тиймээс мөр бүрийн дор `overrides.notErased` мөр
 * ҮРГЭЛЖ хэвлэгдэнэ.
 *
 * ⚠️ §69-R3 (v2:2238) «This should never be a legal certification».
 * Энэ файлд «баталгаажлаа», «нийцэж байна», «зөвшөөрөгдлөө» гэсэн үг
 * ХЭЗЭЭ Ч бичигдэхгүй — хянагчийн шийдвэрийн шошго хүртэл «Зөв гэж үзсэн»
 * (сургалтын хаалга) болохоос «баталгаажсан» БИШ.
 *
 * ⚠️ ХОЁР ДАХЬ ХЯНАХ ГАДАРГУУ БАРИХГҮЙ (2-5 §2.9).  Хүчингүй болголтын
 * хяналт нь сургалтын курацийн ЯГ ТЭР хуудсанд амьдарна: `review_state`
 * нь 0215-ийн ДӨРВӨН утгыг байт байтаар дахин ашигладаг ба `2-6` нь
 * `reviewed|verified` болсон мөрийг Л сургалтад авдаг (§68-R4).
 *
 * ⚠️ СЕРВЕРИЙН ХАМААРАЛ.  Уншилт нь `GET /api/compliance/overrides`
 * (`POST /api/compliance/overrides/:id/review`-ийн ах дүү).  Тэр хоёр
 * хандлагчийг `2-5`-ийн BACKEND хагас нэмнэ; хараахан нийлүүлэгдээгүй
 * worker дээр 404 ирнэ.  Түүнийг ЕРӨНХИЙ АЛДАА гэж харуулах нь хянагчид
 * «систем эвдэрсэн» гэсэн худал дохио өгнө — тиймээс 404-ийг ТУСГАЙ,
 * тайван мөрөөр ялгаж хэлнэ.
 */

/* ------------------------------------------------------------------ */
/*  Үгсийн сангийн ХОС (twin) — `backend/src/lib/complianceModel.ts`    */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ ЭДГЭЭР НЬ BACKEND-ИЙН `complianceModel.ts`-ийн ХОС.  Frontend нь
 * worker-ийн модулийг import хийж ЧАДАХГҮЙ (өөр tsconfig, өөр bundle) тул
 * `shared/lib/roles.ts` ↔ backend-ийн дүрийн жагсаалттай ЯГ ИЖИЛ
 * конвенцоор гараар толилуулав: утга нэмэх / хасахад ХОЁУЛАНГ нь зэрэг
 * хөдөлгөнө.
 *
 * ⚠️ ГЭХДЭЭ ЭНД ЖАГСААЛТ НЬ ХААЛТ БИШ — ЗӨВХӨН ШОШГЫН ТҮЛХҮҮР.  Сервер
 * танихгүй утга буцаавал мөрийг НУУХГҮЙ, түүхий утгыг нь харуулна
 * (`labelOr`).  Хуучирсан bundle дээр хүчингүй болголт «алга болох» нь
 * аудитын мөр алдагдсантай ижил үр дагавартай.
 */
const OVERRIDE_KINDS = [
  'FALSE_POSITIVE',
  'RULE_WRONG',
  'NOT_APPLICABLE_HERE',
  'ACCEPTED_RISK',
  'DESIGN_EXCEPTION',
  'DUPLICATE',
] as const;

/** 0215-ийн ДӨРВӨН утга, байт байтаар (§68-R4). */
const REVIEW_STATES = ['pending', 'reviewed', 'verified', 'rejected'] as const;

/** Хянагчийн бичиж болох ГУРВАН шийдвэр — `pending` нь эхлэлийн төлөв. */
const REVIEW_DECISIONS = ['verified', 'reviewed', 'rejected'] as const;
type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

type BadgeVariant = 'destructive' | 'default' | 'secondary' | 'outline';

/** §67 — эрэмбийг СЕРВЕР хийнэ, энд зөвхөн ХҮНД БАЙДЛЫН өнгө. */
const SEVERITY_VARIANT: Record<string, BadgeVariant> = {
  CRITICAL: 'destructive',
  HIGH: 'default',
  MEDIUM: 'secondary',
  LOW: 'outline',
  INFO: 'outline',
};

const VERDICT_VARIANT: Record<string, BadgeVariant> = {
  VIOLATION: 'destructive',
  WARNING: 'default',
  UNCERTAIN: 'secondary',
  PASS: 'outline',
};

/**
 * §65 — НОТОЛГООНЫ ТҮВШИН БҮРИЙН ЭШЛЭЛИЙН ЭРХ.
 *
 * ⚠️ `backend/src/lib/complianceModel.ts`-ийн `EVIDENCE_RENDER[x].citation`
 * -ийн ХОС.  «A model-generated explanation without evidence must never be
 * presented as a verified regulatory fact» (v2:2158) — өөрөөр хэлбэл
 * `false` түвшний мөрөнд нормын КОД / ЗААЛТ / ХЭВЛЭЛ нь ЭХ СУРВАЛЖ гэсэн
 * шошготой ХЭВЛЭГДЭХГҮЙ.  `rule_uid` нь ДОТООД танигч тул хянагчид
 * хэрэгтэй хэвээр — гэхдээ тэр нь «эшлэл» БИШ гэдгийг шошго нь ил хэлнэ.
 */
const EVIDENCE_CITATION: Record<string, boolean> = {
  RULE_BACKED: true,
  MODEL_DERIVED: false,
  HUMAN_VERIFIED: true,
  AI_INFERRED: false,
  UNKNOWN: false,
};

/* ------------------------------------------------------------------ */
/*  Серверийн хэлбэр                                                   */
/* ------------------------------------------------------------------ */

/**
 * `finding_overrides`-ийн нэг мөр (миграц 0237).
 *
 * ⚠️ Нэмэлт талбарууд ЗОРИУД `optional` — хуучин worker тэднийг буцаахгүй
 * байж болно.  `PendingTab`-ийн `team_code`-ийн жишиг: талбар байхгүй нь
 * хүсэлт амжилтгүй болсон гэсэн үг БИШ.
 */
interface OverrideRow {
  id: number;
  finding_id: number;
  /** 0224-ийн ТОГТВОРТОЙ танигч.  `finding_id` нь гараар устгагдаж болно. */
  finding_uid?: string | null;
  dedup_key?: string | null;
  override_kind: string;
  reason: string;
  evidence_note?: string | null;
  verdict_at_override: string;
  severity_at_override: string;
  evidence_level_at_override: string;
  issue_class_at_override?: string | null;
  rule_uid?: string | null;
  rule_version?: number | null;
  ruleset_version?: string | null;
  team_code?: string | null;
  /** §68-ийн 7 дахь элемент — «аль ЗАГВАР, аль add-in ингэж дүгнэсэн бэ». */
  model_version?: string | null;
  addin_version?: string | null;
  created_by?: number | null;
  created_by_name?: string | null;
  created_at: string;
  review_state: string;
  reviewed_by?: number | null;
  reviewed_by_name?: string | null;
  reviewed_at?: string | null;
  review_note?: string | null;
}

/**
 * ⚠️ `items` нь `2-5` §3.3-ийн нийцлийн жагсаалтуудын хэв маяг
 * (`GET /findings` → `{ authority, ruleset_version, items, more }`).
 * `overrides` нь зөвхөн нөөц нэр — хоёрын алийг нь ч хүлээж авах нь
 * хандлагч бичигдэх өдөр frontend-д засвар шаардахгүй болгоно.
 */
interface OverridesResponse {
  items?: OverrideRow[];
  overrides?: OverrideRow[];
  /** Таслагдсан мөрийн тоо — ИЛ хэлнэ, чимээгүй таслахгүй. */
  more?: number;
}

interface RulesResponse {
  rules: unknown[];
}

/** Сервер тал жагсаалтыг таслах хязгаар. */
const LIST_LIMIT = 200;
/** `review_note`-ийн урт — 0215-ийн `str(v, 500)` конвенц. */
const MAX_NOTE = 500;

const OVERRIDES_KEY = ['/compliance/overrides'] as const;

interface OverridesTabProps {
  /** Нэвтэрсэн хянагч — ӨӨРИЙН бүртгэлээ хянахыг ИЛ анхааруулна. */
  currentUserId: number | null;
  /** `admin` бол оношилгооны танигчийг (finding_id, dedup_key) харуулна. */
  isAdmin: boolean;
}

export function OverridesTab({ currentUserId, isAdmin }: OverridesTabProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  /**
   * Дэд шүүлт нь URL-д (`useState` БИШ — глобал хайлтын гүн холбоос).
   *
   * ⚠️ Параметрийн нэр нь `ostate`, `status` БИШ.  `KeepAliveTabs` нь нэг
   * удаа нээгдсэн панелийг МОУНТЛАГДСАН хэвээр үлдээдэг тул «Хянасан» таб
   * ба энэ таб хоёр ЗЭРЭГ амьд байж болно; хоёулаа `status`-ыг уншвал нэг
   * табын шүүлт нөгөөгийнхийг ЧИМЭЭГҮЙ солино.
   */
  const [state, setState] = useTabParam(REVIEW_STATES, 'pending', 'ostate');

  const query = useApiQuery<OverridesResponse>(
    [...OVERRIDES_KEY, state],
    `/compliance/overrides?state=${state}&limit=${LIST_LIMIT}`,
    // ⚠️ Дахин оролдохгүй: хандлагч хараахан нийлүүлэгдээгүй worker дээр
    //    404 нь ТОГТМОЛ хариу — дахин оролдох нь зөвхөн саатал нэмнэ.
    { retry: false },
  );

  /**
   * ДҮРМИЙН БАГЦ ХООСОН ЭСЭХ.
   *
   * ⚠️ Эзэн БНбД-ийн баримтуудыг ӨӨРӨӨ оруулна (шийдвэр Ш4) тул `rules`
   * хүснэгт ХООСОН нийлүүлэгдэнэ.  Хоосон багцтай үед «зөрчил алга» гэж
   * уншигдах гадаргуу нь ХУДАЛ БАТАЛГАА — юу ч шалгагдаагүй байхад
   * «цэвэр» гэж хэлж байна.  Тиймээс хоосон багцыг ИЛ, тусад нь хэлнэ.
   *
   * ⚠️ АЛДАА ≠ ХООСОН.  Хүсэлт унасан үед баннер ГАРАХГҮЙ — «мэдэхгүй»
   * гэдгийг «хоосон» гэж дүрслэх нь дахиад л худал мэдэгдэл болно.
   */
  const rulesQuery = useApiQuery<RulesResponse>(
    ['/compliance/rules', 'published'],
    '/compliance/rules?status=published',
    { retry: false },
  );
  const rulePackEmpty = rulesQuery.data != null && (rulesQuery.data.rules ?? []).length === 0;

  const rows = useMemo(() => query.data?.items ?? query.data?.overrides ?? [], [query.data]);

  const [busy, setBusy] = useState(false);
  /** Шийдвэр бичих гэж буй мөр (null = цонх хаалттай). */
  const [deciding, setDeciding] = useState<{ row: OverrideRow; decision: ReviewDecision } | null>(
    null,
  );

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: OVERRIDES_KEY });
  }, [queryClient]);

  /**
   * Танихгүй утгыг ХАЯХГҮЙ: түлхүүр олдохгүй бол ТҮҮХИЙ утгыг харуулна
   * (`curation.ts`-ийн `intentLabel`-ийн жишиг).
   */
  const labelOr = useCallback(
    (prefix: string, raw: string | null | undefined): string => {
      if (!raw) return '—';
      const key = `${prefix}.${raw}`;
      const label = t(key);
      return label === key ? raw : label;
    },
    [t],
  );

  const submitReview = useCallback(
    async (row: OverrideRow, decision: ReviewDecision, note: string) => {
      setBusy(true);
      try {
        await apiFetch(`/compliance/overrides/${row.id}/review`, {
          method: 'POST',
          data: { review_state: decision, review_note: note.trim() || null },
        });
        toast.success(t('compliance.overrides.reviewDone'));
        setDeciding(null);
        refresh();
      } catch (err) {
        // ⚠️ 409 = ЭХНИЙ ШИЙДВЭР ЯЛСАН.  Энэ бол алдаа БИШ, тогтолцооны
        //    зан төлөв (`AND reviewed_at IS NULL` + хөдөлгөшгүй trigger).
        //    Ерөнхий «үйлдэл амжилтгүй» гэж хэлбэл хянагч дахин оролдоно.
        if (err instanceof ApiError && err.status === 409) {
          toast.warn(t('compliance.overrides.alreadyReviewed'));
          setDeciding(null);
          refresh();
        } else {
          toast.error(err instanceof Error ? err.message : t('assistantCuration.actionFailed'));
        }
      } finally {
        setBusy(false);
      }
    },
    [refresh, t],
  );

  /* ---------------------------------------------------------------- */

  if (query.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {REVIEW_STATES.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={s === state ? 'default' : 'outline'}
            onClick={() => setState(s)}
          >
            {t(`compliance.overrides.state.${s}`)}
          </Button>
        ))}
        <span className="flex-1" />
        <span className="text-body text-muted-foreground">
          {t('compliance.overrides.count', { count: rows.length })}
        </span>
        <Button variant="outline" size="sm" onClick={refresh} disabled={busy}>
          <RefreshCw aria-hidden />
          {t('assistantCuration.refresh')}
        </Button>
      </div>

      {/* §68-R4 — хяналт нь СУРГАЛТЫН хаалга, дүгнэлтийн хувь заяа БИШ. */}
      <p className="text-micro text-muted-foreground">{t('compliance.overrides.hint')}</p>

      {rulePackEmpty ? (
        <div className="flex gap-2 rounded-md bg-amber-500/10 p-3 text-body">
          <ShieldOff className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
          <p className="break-words">{t('compliance.noPublishedRules')}</p>
        </div>
      ) : null}

      {query.isError ? (
        query.error?.status === 404 ? (
          <div className="flex gap-2 rounded-md bg-muted p-3 text-body">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <p className="break-words">{t('compliance.overrides.notDeployed')}</p>
          </div>
        ) : (
          <p className="text-body text-destructive">{t('assistantCuration.loadFailed')}</p>
        )
      ) : null}

      {!query.isError && rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-body text-muted-foreground">
          {state === 'pending'
            ? t('compliance.overrides.empty')
            : t('compliance.overrides.emptyState')}
        </p>
      ) : null}

      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('compliance.overrides.colKind')}</TableHead>
                <TableHead>{t('compliance.overrides.colReason')}</TableHead>
                <TableHead>{t('compliance.overrides.colFrozen')}</TableHead>
                <TableHead>{t('compliance.overrides.colRule')}</TableHead>
                <TableHead>{t('compliance.overrides.colWho')}</TableHead>
                <TableHead className="text-right">{t('assistantCuration.colActions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const decided = row.reviewed_at != null;
                const isOwn = currentUserId != null && row.created_by === currentUserId;
                const citation = EVIDENCE_CITATION[row.evidence_level_at_override] ?? false;
                const knownKind = (OVERRIDE_KINDS as readonly string[]).includes(row.override_kind);
                return (
                  <TableRow key={row.id}>
                    {/* 1. ЮУ ГЭСЭН ХҮЧИНГҮЙ БОЛГОЛТ */}
                    <TableCell className="align-top">
                      <Badge
                        variant={
                          row.override_kind === 'FALSE_POSITIVE' ||
                          row.override_kind === 'RULE_WRONG'
                            ? 'destructive'
                            : 'secondary'
                        }
                      >
                        {labelOr('compliance.overrides.kind', row.override_kind)}
                      </Badge>
                      {!knownKind ? (
                        <p className="mt-1 text-micro text-amber-600">
                          {t('compliance.overrides.unknownKind')}
                        </p>
                      ) : null}
                    </TableCell>

                    {/* 2. ШАЛТГААН + НОТОЛГОО */}
                    <TableCell className="max-w-[22rem] align-top break-words">
                      <p className="text-body">{row.reason}</p>
                      {row.evidence_note ? (
                        <p className="mt-1 text-micro text-muted-foreground">
                          {t('compliance.overrides.evidenceNote')}: {row.evidence_note}
                        </p>
                      ) : null}
                      {/* ⚠️ МӨР БҮРД.  Хүчингүй болголт нь ЗАСВАР БИШ. */}
                      <p className="mt-1 text-micro text-muted-foreground">
                        {t('compliance.overrides.notErased')}
                      </p>
                    </TableCell>

                    {/* 3. ХӨЛДӨӨСӨН МАШИНЫ ДҮГНЭЛТ */}
                    <TableCell className="align-top">
                      <p className="mb-1 text-micro text-muted-foreground">
                        {t('compliance.overrides.machineVerdict')}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant={VERDICT_VARIANT[row.verdict_at_override] ?? 'outline'}>
                          {labelOr('compliance.verdict', row.verdict_at_override)}
                        </Badge>
                        <Badge variant={SEVERITY_VARIANT[row.severity_at_override] ?? 'outline'}>
                          {labelOr('compliance.severity', row.severity_at_override)}
                        </Badge>
                        <Badge variant="outline">
                          {labelOr('compliance.evidence', row.evidence_level_at_override)}
                        </Badge>
                      </div>
                      {row.issue_class_at_override ? (
                        <p className="mt-1 text-micro text-muted-foreground">
                          {labelOr('compliance.issueClass', row.issue_class_at_override)}
                        </p>
                      ) : null}
                      {/* §65 — эшлэлгүй түвшин нь НОРМЫН БАРИМТ гэж уншигдахгүй. */}
                      {row.evidence_level_at_override === 'AI_INFERRED' ? (
                        <p className="mt-1 text-micro text-amber-600">
                          {t('compliance.evidence.aiWarning')}
                        </p>
                      ) : !citation ? (
                        <p className="mt-1 text-micro text-muted-foreground">
                          {t('compliance.evidence.noCitation')}
                        </p>
                      ) : null}
                    </TableCell>

                    {/* 4. ДҮРЭМ / БАГЦЫН ХУВИЛБАР (§68-ийн 7 дахь элемент) */}
                    <TableCell className="align-top">
                      {row.rule_uid ? (
                        <p className="font-mono text-micro break-all">
                          {/* ⚠️ Эшлэлийн эрхгүй түвшинд энэ нь НОРМЫН ЭШЛЭЛ
                              БИШ, зөвхөн дотоод дүрмийн танигч. */}
                          {citation
                            ? row.rule_uid
                            : t('compliance.overrides.internalRuleId', { uid: row.rule_uid })}
                          {row.rule_version != null ? ` @v${row.rule_version}` : ''}
                        </p>
                      ) : (
                        <p className="text-micro text-muted-foreground">
                          {t('compliance.overrides.noRule')}
                        </p>
                      )}
                      <p className="mt-1 text-micro text-muted-foreground">
                        {row.ruleset_version
                          ? t('compliance.overrides.ruleset', { version: row.ruleset_version })
                          : t('compliance.overrides.noRuleset')}
                      </p>
                      {row.team_code ? (
                        <Badge variant="outline" className="mt-1">
                          {t('assistantCuration.teamBadgeTitle', { team: row.team_code })}
                        </Badge>
                      ) : null}
                      {/* ⚠️ §68-ийн ГИНЖ бүрэн харагдана: дүгнэлт → дүрэм →
                          ЗАГВАР / add-in-ийн хувилбар.  Загварын хувилбаргүй
                          бол «яагаад тэр үед ингэж дүгнэсэн» гэдэг асуултад
                          хожим ХЭЗЭЭ Ч хариулж чадахгүй. */}
                      {isAdmin ? (
                        <p className="mt-1 font-mono text-micro break-all text-muted-foreground">
                          {row.finding_uid ? row.finding_uid : `#${row.finding_id}`}
                          {row.dedup_key ? ` · ${row.dedup_key}` : ''}
                          {row.model_version ? ` · ${row.model_version}` : ''}
                          {row.addin_version ? ` · ${row.addin_version}` : ''}
                        </p>
                      ) : null}
                    </TableCell>

                    {/* 5. ХЭН, ХЭЗЭЭ */}
                    <TableCell className="align-top">
                      <p className="text-body">{row.created_by_name ?? '—'}</p>
                      <p className="text-micro text-muted-foreground">{row.created_at}</p>
                      {isOwn ? (
                        <Badge variant="outline" className="mt-1">
                          {t('compliance.overrides.ownRecord')}
                        </Badge>
                      ) : null}
                      {decided ? (
                        <p className="mt-1 text-micro text-muted-foreground">
                          {t('compliance.overrides.decidedBy', {
                            state: t(`compliance.overrides.state.${row.review_state}`),
                            name: row.reviewed_by_name ?? '—',
                            date: row.reviewed_at ?? '',
                          })}
                        </p>
                      ) : null}
                      {row.review_note ? (
                        <p className="mt-1 text-micro break-words text-muted-foreground">
                          {row.review_note}
                        </p>
                      ) : null}
                    </TableCell>

                    {/* 6. ШИЙДВЭР — НЭГ УДАА */}
                    <TableCell className="align-top text-right">
                      {decided ? (
                        <p className="text-micro text-muted-foreground">
                          {t('compliance.overrides.alreadyReviewed')}
                        </p>
                      ) : (
                        <div className="flex flex-col items-end gap-1">
                          {REVIEW_DECISIONS.map((d) => (
                            <Button
                              key={d}
                              size="sm"
                              variant={d === 'rejected' ? 'destructive' : 'outline'}
                              disabled={busy}
                              onClick={() => setDeciding({ row, decision: d })}
                            >
                              {t(`compliance.overrides.review.${d}`)}
                            </Button>
                          ))}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {/* ⚠️ Таслагдсаныг ИЛ хэлнэ — «санамсаргүй 200» нь БҮРЭН жагсаалт
          гэж уншигдах нь аудитын гадаргуу дээрх хамгийн муу алдаа. */}
      {query.data?.more ? (
        <p className="text-micro text-muted-foreground">
          {t('compliance.overrides.truncated', { count: query.data.more })}
        </p>
      ) : null}

      <ReviewDecisionDialog
        open={deciding != null}
        decision={deciding?.decision ?? 'reviewed'}
        busy={busy}
        onCancel={() => setDeciding(null)}
        onConfirm={(note) => {
          const d = deciding;
          if (d) void submitReview(d.row, d.decision, note);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Шийдвэрийн цонх                                                    */
/* ------------------------------------------------------------------ */

interface ReviewDecisionDialogProps {
  open: boolean;
  decision: ReviewDecision;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (note: string) => void;
}

/**
 * ⚠️ `ReviewDialogs.tsx`-ийн `RejectDialog`-ыг ДАХИН АШИГЛААГҮЙ ШАЛТГААН:
 * тэр цонхны баталгаажуулах товч нь ҮРГЭЛЖ «Хасах» (destructive) бөгөөд
 * гурван өөр шийдвэрийг илэрхийлж чадахгүй — «Зөв гэж үзсэн» гэдгийг улаан
 * «Хасах» товчоор бичих нь хянагчийг шууд төөрөгдүүлнэ.  Тэр файл нь
 * `2-6`-ийн сериалчлагдсан хуваалцсан файл тул ӨРГӨТГӨХГҮЙ; энд түүний
 * ЯГ ТЭР хэв маягийг (`Textarea` + render үеийн reset) давтав.
 */
function ReviewDecisionDialog({
  open,
  decision,
  busy,
  onCancel,
  onConfirm,
}: ReviewDecisionDialogProps) {
  const { t } = useLanguage();
  const [note, setNote] = useState('');

  // ⚠️ useEffect БИШ, render үеийн засвар (`ReviewDialogs.tsx`-ийн жишиг):
  //    өмнөх мөрийн тайлбар шинэ цонхонд агшин зуур ч харагдах ЁСГҮЙ.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setNote('');
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('compliance.overrides.reviewTitle')}</DialogTitle>
          <DialogDescription>
            {t('compliance.overrides.reviewHint', {
              decision: t(`compliance.overrides.review.${decision}`),
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="compliance-override-note">{t('assistantCuration.reviewNoteLabel')}</Label>
          <Textarea
            id="compliance-override-note"
            autoFocus
            rows={4}
            maxLength={MAX_NOTE}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('compliance.overrides.reviewNotePlaceholder')}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={decision === 'rejected' ? 'destructive' : 'default'}
            onClick={() => onConfirm(note)}
            disabled={busy}
          >
            {t(`compliance.overrides.review.${decision}`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
