import { useEffect, useState } from 'react';
import { Blocks, Loader2, Check, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/ui/card';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Switch } from '@/ui/switch';
import { apiFetch } from '@/shared/api/client';
import { applyModules, type ModuleId } from '@/shared/config/modules';
import { toast } from '@/shared/components/Toast';

/**
 * «Модулиуд» — тухайн байгууллагад ямар хэсгүүд нээлттэй байхыг удирдана.
 *
 * ЗӨВХӨН админд харагдана.  Сервер тал ч мөн `requireAdmin()`-тэй
 * (`routes/settings.ts` → `PUT /api/settings/modules`) — энэ нь UX-ийн
 * давхарга, жинхэнэ хаалт биш.
 *
 * ⚠️ ХОЁР ГОРИМ:
 *   • «Хязгаарлалтгүй» — бүх модуль нээлттэй.  Энэ бол ДЕФОЛТ бөгөөд MGL-ийн
 *     өөрийн суулгацын горим.  DB-д мөр бичигдээгүй байхтай тэнцүү.
 *   • «Сонгосон» — зөвхөн тэмдэглэсэн модулиуд.  `core` нь үргэлж асаалттай.
 *
 * Хадгалсны дараа `applyModules` дуудагдаж, хажуугийн цэс ТЭР ДОРОО
 * шинэчлэгдэнэ (`shared/config/modules.ts` → `useEnabledModules`).
 */

interface CatalogRow {
  id: ModuleId;
  label_mn: string;
  label_en: string;
  always_on: boolean;
}

interface ModulesResponse {
  unrestricted: boolean;
  enabled: ModuleId[];
  catalog: CatalogRow[];
}

export function ModulesCard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [unrestricted, setUnrestricted] = useState(true);
  const [selected, setSelected] = useState<Set<ModuleId>>(new Set());

  useEffect(() => {
    let cancelled = false;
    void apiFetch<ModulesResponse>('/settings/modules')
      .then((r) => {
        if (cancelled) return;
        setCatalog(r.catalog ?? []);
        setUnrestricted(r.unrestricted !== false);
        setSelected(new Set(r.enabled ?? []));
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Уншиж чадсангүй');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (id: ModuleId, alwaysOn: boolean) => {
    if (alwaysOn) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = unrestricted ? { unrestricted: true } : { enabled: [...selected] };
      const res = await apiFetch<ModulesResponse>('/settings/modules', {
        method: 'PUT',
        data: body,
      });
      // Цэсийг ТЭР ДОРОО шинэчилнэ — дахин нэвтрэх шаардлагагүй.
      applyModules({ unrestricted: res.unrestricted, enabled: res.enabled });
      setUnrestricted(res.unrestricted !== false);
      setSelected(new Set(res.enabled ?? []));
      toast.success('Модулийн тохиргоо хадгалагдлаа');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Хадгалж чадсангүй';
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Blocks className="h-4 w-4" />
          Модулиуд
        </CardTitle>
        <CardDescription>
          Энэ байгууллагад ямар хэсгүүд нээлттэй байхыг тодорхойлно. Хаасан модулийн цэс алга
          болж, түүний API гарцууд 403 буцаана.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Уншиж байна…
          </div>
        ) : (
          <>
            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
              <div>
                <div className="text-sm font-medium">Хязгаарлалтгүй</div>
                <p className="text-xs text-muted-foreground">
                  Бүх модуль нээлттэй. Өөр компанид зарахдаа л унтраана.
                </p>
              </div>
              <Switch
                checked={unrestricted}
                onCheckedChange={setUnrestricted}
                aria-label="Хязгаарлалтгүй горим"
              />
            </div>

            <div
              className={
                'grid gap-2 sm:grid-cols-2 ' +
                (unrestricted ? 'pointer-events-none opacity-40' : '')
              }
              aria-disabled={unrestricted}
            >
              {catalog.map((m) => {
                const on = m.always_on || selected.has(m.id);
                return (
                  <label
                    key={m.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{m.label_mn}</span>
                      <span className="block truncate font-mono text-[10px] text-muted-foreground">
                        {m.id}
                      </span>
                    </span>
                    {m.always_on ? (
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        үргэлж
                      </Badge>
                    ) : (
                      <Switch
                        checked={on}
                        onCheckedChange={() => toggle(m.id, m.always_on)}
                        aria-label={m.label_mn}
                      />
                    )}
                  </label>
                );
              })}
            </div>

            <div className="flex items-center gap-3">
              <Button onClick={save} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                Хадгалах
              </Button>
              {!unrestricted && (
                <span className="text-xs text-muted-foreground">
                  {selected.size} / {catalog.length} нээлттэй
                </span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
