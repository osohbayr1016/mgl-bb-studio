import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ScrollText } from 'lucide-react';

import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage, pickLocalized } from '@/shared/i18n';
import { canReadRules } from '@/shared/lib/roles';

import { fetchRules, ruleKeys } from '../api';

/**
 * Хянах самбарын дээд зурвас — гарын үсэг зураагүй нийтлэгдсэн журам байвал.
 * Байхгүй бол юу ч зурахгүй (null).  Зөвхөн журам уншдаг role-д хүсэлт явна.
 */
export function PendingRulesBanner() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ruleKeys.list,
    queryFn: fetchRules,
    enabled: canReadRules(user?.role),
    retry: false,
    // Самбар нээгдэх бүрд дахин татна (queryClient-ийн 60 с staleTime-ийг дарна):
    // жагсаалтын хуудастай ИЖИЛ түлхүүр тул тэндээс буцаж ирэхэд шинэ нийтлэгдсэн
    // журам минут хүртэл нуугдах байсан.  Хүсэлт нь ганц жижиг SELECT.
    staleTime: 0,
  });
  const pending = q.data?.rules.filter((r) => r.signature_id === null) ?? [];
  if (pending.length === 0) return null;
  const first = pending[0]!;
  const to = pending.length === 1 ? `/app/rules/${first.id}` : '/app/rules';
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground transition-colors hover:bg-warning/15"
    >
      <ScrollText className="h-5 w-5 shrink-0 text-warning" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="font-medium">{t('rules.pendingBanner', { count: pending.length })}</span>
        {pending.length === 1 && <span className="text-muted-foreground"> — {pickLocalized(lang, first.title_mn, first.title_en)}</span>}
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
