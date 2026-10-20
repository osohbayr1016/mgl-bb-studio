/**
 * «Үнийн санал» — НЭГДСЭН хуудас.
 *
 * Өмнө нь гурван тусдаа маршрут (жагсаалт / загварууд / тарифын каталог) байсныг
 * 2026-08-04-нд хэрэглэгчийн хүсэлтээр НЭГ хуудасны 3 таб болгов. Хажуугийн
 * цэсэнд задардаг дэд цэс байхаа больж, ганц «Үнийн санал» мөр үлдсэн.
 *
 * ── Хуучин холбоос ажиллана ────────────────────────────────────────────────
 * `/app/admin/quotes/template` ба `.../tariffs` нь `routes.tsx`-д тохирох
 * `?tab=`-руу redirect хийгддэг тул хадгалсан хавчуурга/лавлагаа эвдрэхгүй.
 *
 * ── Яагаад `?tab=` вэ (зөвхөн `useState` биш) ───────────────────────────────
 * Таб нь URL-д тусдаг тул сэргээх/хуваалцах/redirect бүгд ажиллана. `ProfilePage`
 * -ийн ХХТ-ийн deep-link-тэй ижил зарчим.
 *
 * ── Яагаад `KeepAliveTabs` вэ ───────────────────────────────────────────────
 * Гурвуулаа ХҮНД: жагсаалт нь юүлүүрийн график + хүснэгт, загвар нь Excel
 * маягийн засварлагч, тариф нь 353 мөрийн pivot. Radix-ийн энгийн `TabsContent`
 * идэвхгүй табыг unmount хийдэг тул таб сольж буцахад бүх fetch + mount дахин
 * төлөгдөнө. `KeepAliveTabs` нь нэг удаа нээгдсэн табыг мод дотор үлдээж, зөвхөн
 * CSS-ээр нууна. Нээгээгүй таб огт зардалгүй.
 *
 * ⚠️ Гурван хуудас бүр `lazy()`-ээр орж ирнэ — эс бөгөөс `/app/quotes` нээхэд
 * гурвуулангийнх нь chunk татагдана. `KeepAliveTabsPanel` нь идэвхжих хүртэл
 * `null` рендэрлэдэг тул lazy chunk нь таб дарагдсан үед л татагдана.
 */
import { lazy, Suspense, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileSpreadsheet } from 'lucide-react';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { PageSkeleton } from '@/shared/components/skeletons';
import { useLanguage } from '@/shared/i18n';
import { TabsList, TabsTrigger } from '@/ui/tabs';
import { KeepAliveTabs, KeepAliveTabsPanel } from '@/ui/keep-alive-tabs';

const QuoteListPage = lazy(() => import('./QuoteListPage'));
const QuoteTemplatePage = lazy(() => import('./admin/QuoteTemplatePage'));
const QuoteTariffPage = lazy(() => import('./admin/QuoteTariffPage'));

const TABS = ['list', 'templates', 'tariffs'] as const;
type QuotesTab = (typeof TABS)[number];
const DEFAULT_TAB: QuotesTab = 'list';

function isTab(v: string | null): v is QuotesTab {
  return v !== null && (TABS as readonly string[]).includes(v);
}

export default function QuotesPage() {
  const { t } = useLanguage();
  const [params, setParams] = useSearchParams();

  const raw = params.get('tab');
  const tab: QuotesTab = isTab(raw) ? raw : DEFAULT_TAB;

  const setTab = useCallback(
    (next: string) => {
      // `replace` — таб сольсон болгон түүхэнд бичвэл «буцах» товч нь хуудсаас
      // гарахын оронд табуудаар ухраад хэрэглэгчийг гацаана.
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === DEFAULT_TAB) p.delete('tab');
          else p.set('tab', next);
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return (
    <PageContainer>
      <PageHeader title={t('quotes.pageTitle')} icon={FileSpreadsheet} />

      <KeepAliveTabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full max-w-xl grid-cols-3">
          <TabsTrigger value="list">{t('nav.quotesList')}</TabsTrigger>
          <TabsTrigger value="templates">{t('nav.quoteTemplates')}</TabsTrigger>
          <TabsTrigger value="tariffs">{t('nav.quoteTariffs')}</TabsTrigger>
        </TabsList>

        <KeepAliveTabsPanel value="list">
          <Suspense fallback={<PageSkeleton />}>
            <QuoteListPage embedded />
          </Suspense>
        </KeepAliveTabsPanel>
        <KeepAliveTabsPanel value="templates">
          <Suspense fallback={<PageSkeleton />}>
            <QuoteTemplatePage embedded />
          </Suspense>
        </KeepAliveTabsPanel>
        <KeepAliveTabsPanel value="tariffs">
          <Suspense fallback={<PageSkeleton />}>
            <QuoteTariffPage embedded />
          </Suspense>
        </KeepAliveTabsPanel>
      </KeepAliveTabs>
    </PageContainer>
  );
}
