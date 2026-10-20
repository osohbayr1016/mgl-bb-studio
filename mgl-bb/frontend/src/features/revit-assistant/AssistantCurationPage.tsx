import { useCallback } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { BrainCircuit } from 'lucide-react';

import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import { useTabParam } from '@/shared/hooks/useTabParam';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { TabsList, TabsTrigger } from '@/ui/tabs';
import { KeepAliveTabs, KeepAliveTabsPanel } from '@/ui/keep-alive-tabs';

import { normalizeTeamCode } from './curation';
import { PendingTab } from './components/PendingTab';
import { ReviewedTab } from './components/ReviewedTab';
import { ExamplesTab } from './components/ExamplesTab';
import { OverridesTab } from './components/OverridesTab';

/**
 * Revit туслахын СУРГАЛТЫН КУРАЦИ — хүний баталгаажуулах хаалга.
 *
 * ⚠️ ЯАГААД ЭНЭ ХУУДАС БАЙГАА ВЭ:
 * Санаа таних ангилагч нь API, LLM, интернэтгүйгээр локалд ажилладаг.
 * Түүнийг сайжруулах ЦОРЫН ГАНЦ зам бол
 *
 *   add-in --logs--> assistant_logs --ШОШГО--> assistant_examples
 *                                                    |
 *                                              сургалт (Python)
 *                                                    v
 *   add-in <--model-- assistant_models (is_active = 1)
 *
 * гэсэн гогцоо.  Сервер тал бүрэн бичигдсэн байсан ч «--ШОШГО-->» сумыг
 * дуудах КЛИЕНТ ОГТ БАЙХГҮЙ байв: `GET /assistant/pending` ба
 * `POST /assistant/examples` хоёулаа НЭГ Ч дуудагчгүй байсан.  Тиймээс
 * нийлүүлэгдсэн модель 100% СИНТЕТИК өгөгдөл дээр сургагдсан
 * («LLM монгол инженерүүд юу бичих байх гэж төсөөлсөн нь»).  Энэ хуудас
 * яг тэр хоёрыг сольдог зүйл.
 *
 * ⚠️ Эрх: `admin` эсвэл `senior` (`revit.ts`-ийн `isManager()`-тэй ижил).
 * Энд байгаа шалгалт нь ЗӨВХӨН UX — жинхэнэ хаалга нь backend
 * (`requireRole(...REVIT_ROLES)` + `isManager`).  `ProtectedRoute`-ийн
 * `allowedRoles` prop-ыг ЗОРИУД ашиглаагүй: тэр нь апп даяар ганц газар
 * (`/app/attendance/admin`) хэрэглэгддэг конвенц.
 */

/** Табны утгууд нь глобал хайлтын гүн холбоосын бай (`?tab=…`) —
 *  `shared/lib/search/sections.ts` эдгээрийг давхар тусгасан тул нэрийг
 *  солих бол ХОЁУЛАНГ нь зэрэг солино. */
/** ⚠️ `'overrides'` (2-5 §68) — сургалтын кураци ба нормын дүгнэлтийн
 *  хүчингүй болголт нь НЭГ хянах гадаргуу дээр амьдарна.  Хоёр дахь
 *  хуудас барих нь §68-ийн аудитын бүртгэлийг ХУВААНА (2-5 §2.9). */
const CURATION_TABS = ['pending', 'reviewed', 'examples', 'overrides'] as const;

/**
 * БАГИЙН ШҮҮЛТИЙН URL параметр.
 *
 * ⚠️ ЯАГААД `useTabParam` БИШ ВЭ: тэр hook нь зөвшөөрөгдөх утгуудыг
 * ЭМХЭТГЭЛИЙН ҮЕД мэдэхийг шаарддаг (`readonly T[]`), харин багийн жагсаалт
 * нь АМЬД бүртгэлээс (`GET /api/teams`) ирдэг.  Багийн кодыг энд хатуу
 * бичих нь яг тэр хоригийг зөрчинө, тиймээс `useSearchParams`-ыг ШУУД
 * ашиглаад хэлбэрийг нь `normalizeTeamCode`-оор (серверийн `/^[A-Z]{2,8}$/`
 * -ийн ХОС) шалгана.
 *
 * ⚠️ Утга нь `?tab=`-тай ИЖИЛ URL-д амьдарна: хянагч «BA-гийн хүлээгдэж
 * буй дараалал» гэсэн холбоосыг хуваалцаж, сэргээж ачаалахад буцаж ирнэ.
 *
 * ⚠️ `replace: true` — шүүлт солих бүрт «буцах» товч ажиллахгүй болно
 * (`useTabParam`-ийн шийдвэрийн хуулбар).
 */
const TEAM_PARAM = 'team';

export default function AssistantCurationPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [tab, setTab] = useTabParam(CURATION_TABS, 'pending', 'tab');
  const [searchParams, setSearchParams] = useSearchParams();

  const team = normalizeTeamCode(searchParams.get(TEAM_PARAM));
  const setTeam = useCallback(
    (next: string | null) => {
      const code = normalizeTeamCode(next);
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (code) p.set(TEAM_PARAM, code);
          else p.delete(TEAM_PARAM);
          return p;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // admin + senior — backend-ийн `isManager()` gate-ийн толь.
  const allowed = !!user && (user.role === 'admin' || user.role === 'senior');
  const isAdmin = user?.role === 'admin';
  const currentUserId = user?.id ?? null;

  if (!allowed) return <Navigate to="/app" replace />;

  return (
    <PageContainer>
      <PageHeader
        icon={BrainCircuit}
        eyebrow={t('assistantCuration.eyebrow')}
        title={t('assistantCuration.pageTitle')}
        description={t('assistantCuration.pageDescription')}
        bare
      />

      <KeepAliveTabs value={tab} onValueChange={(v) => setTab(v as (typeof CURATION_TABS)[number])}>
        <TabsList>
          <TabsTrigger value="pending">{t('assistantCuration.pendingTab')}</TabsTrigger>
          <TabsTrigger value="reviewed">{t('assistantCuration.reviewedTab')}</TabsTrigger>
          <TabsTrigger value="examples">{t('assistantCuration.examplesTab')}</TabsTrigger>
          <TabsTrigger value="overrides">{t('compliance.overridesTab')}</TabsTrigger>
        </TabsList>

        <KeepAliveTabsPanel value="pending">
          <section id="sec-assistant-pending" className="scroll-mt-24">
            <PendingTab currentUserId={currentUserId} team={team} onTeamChange={setTeam} />
          </section>
        </KeepAliveTabsPanel>

        <KeepAliveTabsPanel value="reviewed">
          <section id="sec-assistant-reviewed" className="scroll-mt-24">
            <ReviewedTab />
          </section>
        </KeepAliveTabsPanel>

        <KeepAliveTabsPanel value="examples">
          <section id="sec-assistant-examples" className="scroll-mt-24">
            <ExamplesTab isAdmin={isAdmin} />
          </section>
        </KeepAliveTabsPanel>

        {/* ⚠️ §68 — «нормын дүгнэлттэй санал нийлэхгүй» гэсэн БҮРТГЭЛ.
            `sections.ts`-д ХОСТОЙ мөр байна (`?tab=overrides`); нэрийг
            солих бол ХОЁУЛАНГ нь зэрэг солино. */}
        <KeepAliveTabsPanel value="overrides">
          <section id="sec-assistant-overrides" className="scroll-mt-24">
            <OverridesTab currentUserId={currentUserId} isAdmin={isAdmin} />
          </section>
        </KeepAliveTabsPanel>
      </KeepAliveTabs>
    </PageContainer>
  );
}
