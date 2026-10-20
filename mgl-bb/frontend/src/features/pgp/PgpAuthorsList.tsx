import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage } from '@/shared/i18n';
import { apiFetch, MEDIA_BASE_URL } from '@/shared/api/client';
import type { PgpAuthor, PgpExportRow, PgpPlan } from '@/shared/types';
import { Card, CardContent } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Badge } from '@/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/avatar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table';
import { FileSpreadsheet, Loader2, Search, Sparkles, CalendarClock } from 'lucide-react';
import { formatDisplayName } from '@/shared/lib/formatting';
import { formatDateTime } from '@/shared/lib/time';
import { teamChipClass } from '@/shared/lib/team-colors';
import { cn } from '@/shared/lib/utils';
import { toast } from '@/shared/components/Toast';
import { exportPgpXlsx, sanitizeFileNamePart, type PgpXlsxRow } from './lib/exportPgpXlsx';

/**
 * PGP (Хувь хүний хөгжлийн төлөвлөгөө) бөглөсөн ажилтнуудын жагсаалт —
 * UsersPage-ийн «Хөгжлийн төлөвлөгөө» табд суудаг. Мөр дээр дарахад тухайн
 * ажилтны профайлын PGP таб руу шилжинэ (`?tab=pgp`).
 */
export function PgpAuthorsList() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const authorsQuery = useApiQuery<{ authors: PgpAuthor[] }>('/pgp/authors', { retry: false });
  const authors = useMemo(() => authorsQuery.data?.authors ?? [], [authorsQuery.data]);
  const loading = authorsQuery.isLoading;

  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return authors;
    return authors.filter(
      (a) =>
        a.full_name.toLowerCase().includes(q) ||
        (a.employee_id ?? '').toLowerCase().includes(q) ||
        (a.team_name_mn ?? '').toLowerCase().includes(q) ||
        (a.team_code ?? '').toLowerCase().includes(q),
    );
  }, [authors, search]);

  const go = (a: PgpAuthor) => navigate(`/app/users/${a.user_id}?tab=pgp`);

  const [exportingAll, setExportingAll] = useState(false);
  const [exportingUserId, setExportingUserId] = useState<number | null>(null);
  const today = () => new Date().toISOString().slice(0, 10);

  // Бүх ажилтны бүх period-ийг нэг флат хүснэгтээр татна.
  const handleExportAll = async () => {
    if (exportingAll) return;
    setExportingAll(true);
    try {
      const res = await apiFetch<{ rows: PgpExportRow[] }>('/pgp/export');
      if (!res.rows.length) {
        toast.error(t('pgpExport.noData'));
        return;
      }
      const rows: PgpXlsxRow[] = res.rows.map((r) => ({
        name: formatDisplayName(r.full_name),
        teamCode: r.team_code,
        teamName: r.team_name_mn,
        period: r.period,
        updatedAt: r.updated_at,
        answers: r.answers,
        comments: r.comments,
      }));
      await exportPgpXlsx({
        fileName: `${t('pgpExport.fileBase')}_${today()}.xlsx`,
        sheetName: t('pgpAuthors.tab'),
        rows,
        t,
      });
    } catch {
      toast.error(t('pgpExport.failed'));
    } finally {
      setExportingAll(false);
    }
  };

  // Нэг ажилтны бүх period — мөрийн download товч.
  const handleExportOne = async (a: PgpAuthor) => {
    if (exportingUserId != null) return;
    setExportingUserId(a.user_id);
    try {
      const res = await apiFetch<{ plans: PgpPlan[] }>(`/pgp/user/${a.user_id}`);
      if (!res.plans.length) {
        toast.error(t('pgpExport.noData'));
        return;
      }
      const rows: PgpXlsxRow[] = res.plans.map((p) => ({
        name: formatDisplayName(a.full_name),
        teamCode: a.team_code,
        teamName: a.team_name_mn,
        period: p.period,
        updatedAt: p.updated_at,
        answers: p.answers,
        comments: p.comments,
      }));
      await exportPgpXlsx({
        fileName: `${t('pgpExport.fileBase')}_${sanitizeFileNamePart(formatDisplayName(a.full_name))}.xlsx`,
        sheetName: t('pgpAuthors.tab'),
        rows,
        t,
      });
    } catch {
      toast.error(t('pgpExport.failed'));
    } finally {
      setExportingUserId(null);
    }
  };

  return (
    <Card className="border-border bg-card/60 backdrop-blur">
      <CardContent className="space-y-4 pt-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {t('pgpAuthors.count', { count: authors.length })}
          </p>
          <div className="flex items-center gap-2 w-full max-w-md justify-end">
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('pgpAuthors.searchPlaceholder')}
                className="pl-9"
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="shrink-0"
              disabled={exportingAll || authors.length === 0}
              onClick={() => void handleExportAll()}
            >
              {exportingAll ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="mr-1.5 h-4 w-4" />
              )}
              {t('pgpExport.button')}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="py-16 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <Sparkles className="h-10 w-10 mb-3 text-muted-subtle" />
            <p className="text-sm font-medium text-foreground">{t('pgpAuthors.empty')}</p>
            <p className="text-xs text-muted-foreground mt-1">{t('pgpAuthors.emptyHint')}</p>
          </div>
        ) : (
          <div className="rounded-md border border-border overflow-hidden">
            <Table className="w-full">
              <TableHeader className="bg-secondary/50">
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t('pgpAuthors.colEmployee')}</TableHead>
                  <TableHead>{t('pgpAuthors.colTeam')}</TableHead>
                  <TableHead>{t('pgpAuthors.colPlans')}</TableHead>
                  <TableHead>{t('pgpAuthors.colUpdated')}</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">{t('pgpExport.button')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((a) => (
                  <TableRow
                    key={a.user_id}
                    className="hover:bg-muted/40 border-border cursor-pointer"
                    onClick={() => go(a)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          {a.profile_image && (
                            <AvatarImage
                              src={`${MEDIA_BASE_URL}${a.profile_image}`}
                              alt={formatDisplayName(a.full_name)}
                            />
                          )}
                          <AvatarFallback className="bg-primary/20 text-primary text-xs">
                            {formatDisplayName(a.full_name).substring(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col min-w-0">
                          <span className="font-medium text-foreground truncate hover:text-primary transition-colors">
                            {formatDisplayName(a.full_name)}
                          </span>
                          {a.employee_id && (
                            <span className="text-xs text-muted-foreground font-mono truncate">
                              {a.employee_id}
                            </span>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {a.team_code ? (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge
                            variant="outline"
                            className={cn('font-mono text-micro px-1.5 py-0', teamChipClass(a.team_code))}
                          >
                            {a.team_code}
                          </Badge>
                          <span className="text-sm text-foreground truncate">{a.team_name_mn}</span>
                        </div>
                      ) : (
                        <span className="text-xs italic text-muted-foreground">
                          {t('pgpAuthors.noTeam')}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant="outline" className="text-micro px-1.5 py-0">
                          {t('pgpAuthors.planCount', { count: a.plan_count })}
                        </Badge>
                        {a.periods && (
                          <span className="text-xs text-muted-foreground font-mono">
                            {a.periods.split(',').sort((x, y) => Number(y) - Number(x)).join(', ')}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <CalendarClock className="w-3 h-3" />
                        {a.latest_updated_at ? formatDateTime(a.latest_updated_at) : '—'}
                      </div>
                    </TableCell>
                    {/* stopPropagation нүдэн дээр — disabled товчны click мөрийн
                        navigate руу дамжихгүй. */}
                    <TableCell className="w-12" onClick={(e) => e.stopPropagation()}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title={t('pgpExport.button')}
                        aria-label={t('pgpExport.button')}
                        disabled={exportingUserId != null}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleExportOne(a);
                        }}
                      >
                        {exportingUserId === a.user_id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <FileSpreadsheet className="h-4 w-4" />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
