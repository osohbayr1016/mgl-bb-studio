/**
 * Хяналтын самбарын зурвас — Word баримтын гарын үсэг (2026-10-01).
 *   • Захиралд: «Баталгаажуулах N баримт хүлээгдэж байна» + жагсаалт.
 *   • Ажилтанд: хамт олон «гарын үсэг зурна уу» гэж хүссэн, хараахан зураагүй баримтууд.
 * Мөр бүр «Баримт бичиг» хуудсанд тэр файлыг самбартай нь нээнэ (`?file=…&sign=1`).
 * Хүлээгдэж буй зүйлгүй бол юу ч зурахгүй (null).  Шинэ цэс НЭМЭЭГҮЙ.
 */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BadgeCheck, PenLine } from 'lucide-react';
import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import { formatDateTime } from '@/shared/lib/time';
import { fetchPendingSignatures, pendingSignaturesKey } from './api';

const STAFF = new Set(['admin', 'senior', 'engineer', 'architect']);
const MAX_ROWS = 4;

export function PendingDocSignBanner() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const q = useQuery({
    queryKey: pendingSignaturesKey,
    queryFn: fetchPendingSignatures,
    enabled: !!user && STAFF.has(user.role),
    retry: false,
    staleTime: 0,
  });
  const data = q.data;
  if (!data) return null;
  const approvals = data.approvals;
  const asks = data.asks;
  if (approvals.length === 0 && asks.length === 0) return null;

  return (
    <div className="space-y-2" data-testid="pending-doc-sign-banner">
      {approvals.length > 0 && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-foreground">
          <div className="flex items-center gap-2 font-medium">
            <BadgeCheck className="h-5 w-5 shrink-0 text-primary" aria-hidden />
            {t('docSign.bannerApprovals', { count: approvals.length })}
          </div>
          <ul className="mt-2 space-y-1">
            {approvals.slice(0, MAX_ROWS).map((a) => (
              <li key={a.id}>
                <Link to={a.link} className="group flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-primary/10">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{a.file_name}</span>
                    <span className="text-muted-foreground">
                      {' '}
                      · {a.project_name ?? ''} · {a.requested_by} · {formatDateTime(a.created_at)}
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
          {approvals.length > MAX_ROWS && (
            <p className="mt-1 text-xs text-muted-foreground">{t('docSign.bannerMore', { n: approvals.length - MAX_ROWS })}</p>
          )}
        </div>
      )}
      {asks.length > 0 && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground">
          <div className="flex items-center gap-2 font-medium">
            <PenLine className="h-5 w-5 shrink-0 text-warning" aria-hidden />
            {t('docSign.bannerAsks', { count: asks.length })}
          </div>
          <ul className="mt-2 space-y-1">
            {asks.slice(0, MAX_ROWS).map((a) => (
              <li key={a.file_id}>
                <Link to={a.link} className="group flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-warning/15">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{a.file_name}</span>
                    <span className="text-muted-foreground">
                      {' '}
                      · {a.project_name ?? ''} · {a.asked_by}
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
