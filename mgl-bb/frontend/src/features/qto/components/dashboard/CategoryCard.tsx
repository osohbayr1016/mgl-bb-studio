import type { LucideIcon } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { Card, CardContent } from '@/ui/card';

import { fmtNum } from '../../lib/pivots';

/** Run-уудын хооронд нэгтгэсэн категорийн мөр — Самбарын бүх view-гийн эх. */
export interface DashCategory {
  /** Түүхий категори string ('' = категоригүй) — chip/шүүлтийн түлхүүр. */
  key: string;
  label: string;
  count: number;
  length_m: number;
  area_m2: number;
  volume_m3: number;
  mass_kg: number;
  /** Run бүрийн type_count нийлбэр (нэг төрөл 2 файлд давхардана — хүлээн
   *  зөвшөөрөгдсөн ойролцоо утга); null = хуучин payload-д talбар байхгүй. */
  typeCount: number | null;
  color: string;
  Icon: LucideIcon;
}

/** (category, family, type) түвшний нэгтгэсэн мөр. */
export interface DashTypeRow {
  family: string;
  type_name: string;
  count: number;
  length_m: number;
  area_m2: number;
  volume_m3: number;
  mass_kg: number;
  /** Төрлийн марк (Хн3.6, ХБ-21х29…) — байхгүй бол null. */
  type_mark: string | null;
}

/** Марк badge — карт болон баар view-д ижилхэн харагдана. */
export function TypeMarkBadge({ mark }: { mark: string | null }) {
  if (!mark) return null;
  return (
    <span className="mr-1 inline-block shrink-0 rounded border bg-muted/60 px-1 font-mono text-micro leading-4 text-foreground/80">
      {mark}
    </span>
  );
}

/** Нэг view-карт: категори + харагдах (эрэмбэлсэн, хайлтаар шүүсэн) төрлүүд. */
export interface DashViewCard {
  cat: DashCategory;
  types: DashTypeRow[];
  /** true = хайлт зөвхөн төрөл дээр таарч жагсаалт нарийссан — footer/caption
   *  cat.typeCount биш локал уртыг ашиглана (typeCount нь шүүлтгүй тоо). */
  narrowed: boolean;
}

const SHOWN_TYPES = 6;

/**
 * Summary view-гийн нэг категорийн карт: будсан icon-квадрат толгой + топ-6
 * төрлийн нимгэн баар. Тоонууд үргэлж text token — өнгө зөвхөн баар/icon дээр.
 */
export function CategoryCard({ card }: { card: DashViewCard }) {
  const { t } = useLanguage();
  const { cat, types, narrowed } = card;
  const shown = types.slice(0, SHOWN_TYPES);
  const maxCount = shown.reduce((m, tp) => Math.max(m, tp.count), 0);
  // typeCount байхгүй (хуучин payload) бол локал жагсаалтын уртаар fallback —
  // бүх төрөл харагдаж байвал footer аяндаа гарахгүй (hidden = 0).
  const totalTypes = narrowed ? types.length : cat.typeCount ?? types.length;
  const hidden = Math.max(0, totalTypes - shown.length);
  const { Icon } = cat;

  return (
    <Card className="gap-0 py-4">
      <CardContent className="px-4">
        <div className="flex items-center gap-2.5">
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-md"
            style={{ backgroundColor: `color-mix(in srgb, ${cat.color} 12%, transparent)` }}
          >
            <Icon className="h-4 w-4" style={{ color: cat.color }} />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{cat.label}</span>
          <span className="font-mono text-sm tabular-nums">{fmtNum(cat.count, 0)}</span>
        </div>

        {shown.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {shown.map((tp) => (
              <div
                key={`${tp.family} ${tp.type_name}`}
                className="grid grid-cols-[minmax(0,45%)_1fr_auto] items-center gap-2"
              >
                <span
                  className="flex min-w-0 items-center text-xs text-muted-foreground"
                  title={`${tp.type_mark ? `[${tp.type_mark}] ` : ''}${tp.family || t('qtoPage.noFamily')} · ${tp.type_name || t('qtoPage.noType')}`}
                >
                  <TypeMarkBadge mark={tp.type_mark} />
                  <span className="truncate">
                    {tp.type_name || tp.family || t('qtoPage.noType')}
                  </span>
                </span>
                <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      backgroundColor: cat.color,
                      width: `${maxCount > 0 ? (tp.count / maxCount) * 100 : 0}%`,
                    }}
                  />
                </span>
                <span className="font-mono text-xs tabular-nums">{fmtNum(tp.count, 0)}</span>
              </div>
            ))}
          </div>
        )}

        {hidden > 0 && (
          <p className="mt-3 font-mono text-label text-muted-foreground">
            {t('qtoPage.dashMoreTypes', { count: fmtNum(hidden, 0) })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
