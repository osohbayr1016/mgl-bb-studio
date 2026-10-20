import { useEffect, useState } from 'react';
import {
  Sun,
  Cloud,
  CloudSun,
  CloudRain,
  CloudSnow,
  CloudLightning,
  CloudFog,
  CloudDrizzle,
  Wind,
  Droplets,
  MapPin,
} from 'lucide-react';
import { Card, CardContent } from '@/ui/card';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';

type TFn = (key: string, vars?: Record<string, string | number>) => string;

/* ---------------------------------------------------------------- *
 *  Ulaanbaatar weather widget — uses the free Open-Meteo Forecast
 *  API (no API key required).  Shows current conditions plus a
 *  7-day forecast strip so the team can plan the work week at a
 *  glance (site work is heavily weather-dependent).
 *  Docs: https://open-meteo.com/en/docs
 * ---------------------------------------------------------------- */

const ULAANBAATAR = { lat: 47.9077, lon: 106.8832 };
const ENDPOINT =
  `https://api.open-meteo.com/v1/forecast` +
  `?latitude=${ULAANBAATAR.lat}&longitude=${ULAANBAATAR.lon}` +
  `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m` +
  `&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max` +
  `&timezone=Asia%2FUlaanbaatar` +
  `&forecast_days=7`;

interface WeatherData {
  current: {
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    weather_code: number;
    wind_speed_10m: number;
    time: string;
  };
  daily?: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    weather_code: number[];
    precipitation_probability_max: number[];
  };
}

/** WMO weather-code (https://open-meteo.com/en/docs#weathervariables)
 *  → Mongolian label, lucide icon, and a tailwind colour pair. */
function wmo(
  code: number,
  t: TFn,
): { label: string; Icon: typeof Sun; tone: string; gradient: string } {
  if (code === 0)
    return {
      label: t('weatherWidget.clear'),
      Icon: Sun,
      tone: 'text-warning',
      gradient: 'from-amber-500/20 via-orange-500/10 to-transparent',
    };
  if (code === 1)
    return {
      label: t('weatherWidget.mainlyClear'),
      Icon: Sun,
      tone: 'text-warning',
      gradient: 'from-amber-400/15 via-amber-500/5 to-transparent',
    };
  if (code === 2)
    return {
      label: t('weatherWidget.partlyCloudy'),
      Icon: CloudSun,
      tone: 'text-warning',
      gradient: 'from-sky-500/15 via-amber-500/5 to-transparent',
    };
  if (code === 3)
    return {
      label: t('weatherWidget.cloudy'),
      Icon: Cloud,
      tone: 'text-slate-600 dark:text-slate-300',
      gradient: 'from-slate-500/20 via-slate-500/5 to-transparent',
    };
  if (code === 45 || code === 48)
    return {
      label: t('weatherWidget.foggy'),
      Icon: CloudFog,
      tone: 'text-slate-600 dark:text-slate-300',
      gradient: 'from-slate-400/20 to-transparent',
    };
  if (code >= 51 && code <= 57)
    return {
      label: t('weatherWidget.drizzle'),
      Icon: CloudDrizzle,
      tone: 'text-info',
      gradient: 'from-sky-500/20 to-transparent',
    };
  if (code >= 61 && code <= 67)
    return {
      label: t('weatherWidget.rain'),
      Icon: CloudRain,
      tone: 'text-info',
      gradient: 'from-blue-500/20 to-transparent',
    };
  if (code >= 71 && code <= 77)
    return {
      label: t('weatherWidget.snow'),
      Icon: CloudSnow,
      tone: 'text-info dark:text-cyan-200',
      gradient: 'from-cyan-500/20 to-transparent',
    };
  if (code >= 80 && code <= 82)
    return {
      label: t('weatherWidget.showers'),
      Icon: CloudRain,
      tone: 'text-info',
      gradient: 'from-blue-500/25 to-transparent',
    };
  if (code >= 85 && code <= 86)
    return {
      label: t('weatherWidget.snowStorm'),
      Icon: CloudSnow,
      tone: 'text-info dark:text-cyan-200',
      gradient: 'from-cyan-500/25 to-transparent',
    };
  if (code >= 95)
    return {
      label: t('weatherWidget.thunderstorm'),
      Icon: CloudLightning,
      tone: 'text-warning',
      gradient: 'from-yellow-500/25 via-purple-500/10 to-transparent',
    };
  return {
    label: t('weatherWidget.unknown'),
    Icon: Cloud,
    tone: 'text-muted-foreground',
    gradient: 'from-slate-500/10 to-transparent',
  };
}

const SHORT_WEEKDAY_KEYS = [
  'weatherWidget.sun',
  'weatherWidget.mon',
  'weatherWidget.tue',
  'weatherWidget.wed',
  'weatherWidget.thu',
  'weatherWidget.fri',
  'weatherWidget.sat',
];

function shortWeekday(iso: string, isToday: boolean, t: TFn): string {
  if (isToday) return t('weatherWidget.today');
  const d = new Date(`${iso}T00:00:00`);
  const key = SHORT_WEEKDAY_KEYS[d.getDay()];
  return key ? t(key) : '—';
}

interface WeatherWidgetProps {
  /** Compact layout — slim badge-style card with just current temp,
   *  condition, hi/lo and a small icon.  Used inline in the dashboard
   *  hero next to the headline carousel where the full 7-day strip
   *  doesn't fit. */
  compact?: boolean;
  /** Header-chip layout — pill with just the icon and current temp,
   *  sized to fit inside the global header bar (~28px tall). No card
   *  chrome, no city label, no hi/lo.  Hover tooltip shows the rest. */
  chip?: boolean;
}

export default function WeatherWidget({ compact = false, chip = false }: WeatherWidgetProps = {}) {
  const { t } = useLanguage();
  const [data, setData] = useState<WeatherData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(ENDPOINT)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json: WeatherData) => {
        if (!cancelled) setData(json);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    if (chip) return null; // Silent failure in the header — don't clutter the bar.
    return (
      <Card
        className={cn('border-border bg-card/60 backdrop-blur shadow-sm', compact ? '' : 'h-full')}
      >
        <CardContent className={cn('text-sm text-muted-foreground', compact ? 'p-3' : 'p-4')}>
          {t('weatherWidget.fetchFailed')}
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    if (chip) {
      return (
        <div className="hidden sm:inline-flex items-center gap-1.5 h-7 px-2 rounded-full bg-chrome-hover/60 border border-chrome-border">
          <div className="h-3 w-10 rounded bg-muted/50 animate-pulse" />
        </div>
      );
    }
    return (
      <Card
        className={cn('border-border bg-card/60 backdrop-blur shadow-sm', compact ? '' : 'h-full')}
      >
        <CardContent className={cn(compact ? 'p-3' : 'p-4')}>
          <div className={cn('rounded bg-muted/50 animate-pulse', compact ? 'h-14' : 'h-44')} />
        </CardContent>
      </Card>
    );
  }

  const w = wmo(data.current.weather_code, t);
  const Icon = w.Icon;
  const temp = Math.round(data.current.temperature_2m);
  const feelsLike = Math.round(data.current.apparent_temperature);
  const todayIso = (() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  })();

  // Build a normalised 7-day list — we always render 7 cells so the
  // strip stays a fixed shape even if the API momentarily returns less.
  const days = (data.daily?.time ?? []).slice(0, 7).map((iso, i) => ({
    iso,
    isToday: iso === todayIso,
    code: data.daily!.weather_code[i] ?? 0,
    max: data.daily!.temperature_2m_max[i] ?? 0,
    min: data.daily!.temperature_2m_min[i] ?? 0,
    rain: data.daily!.precipitation_probability_max?.[i] ?? 0,
  }));

  if (chip) {
    /* Header-bar chip — fits inside the global Layout header strip.
       Pill shape, hover tooltip carries city / condition / hi-lo so we
       can drop them from the visible row to keep the widget tiny. */
    const tooltip = days[0]
      ? `${t('weatherWidget.city')} · ${w.label} · ↑${Math.round(days[0].max)}° ↓${Math.round(days[0].min)}° · ${t('weatherWidget.feelsLike')} ${feelsLike}°`
      : `${t('weatherWidget.city')} · ${w.label}`;
    return (
      <div
        className="hidden sm:inline-flex items-center gap-1.5 h-7 px-2 rounded-full bg-chrome-hover/60 border border-chrome-border text-foreground/90"
        title={tooltip}
      >
        <Icon className={cn('h-3.5 w-3.5 shrink-0', w.tone)} strokeWidth={1.8} />
        <span className="text-xs font-semibold tabular-nums leading-none">{temp}°</span>
      </div>
    );
  }

  if (compact) {
    /* Compact layout — used in the dashboard hero next to the headline
       carousel.  One slim row: condition icon + city/label, big temp
       on the right, hi/lo + feels-like underneath.  No 7-day strip. */
    return (
      <Card
        className={cn(
          'border-border backdrop-blur shadow-sm overflow-hidden bg-gradient-to-br',
          w.gradient,
        )}
      >
        <CardContent className="p-3">
          <div className="flex items-center gap-3">
            <Icon className={cn('h-9 w-9 shrink-0', w.tone)} strokeWidth={1.6} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 text-micro text-muted-foreground leading-none">
                <MapPin className="w-2.5 h-2.5" />
                <span className="truncate">{t('weatherWidget.city')}</span>
              </div>
              <div className="text-micro text-muted-foreground truncate mt-0.5">{w.label}</div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-2xl font-bold tabular-nums leading-none">{temp}°</div>
              {days[0] && (
                <div className="text-micro text-muted-foreground tabular-nums mt-0.5">
                  ↑{Math.round(days[0].max)}° ↓{Math.round(days[0].min)}°
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        'border-border backdrop-blur shadow-sm overflow-hidden bg-gradient-to-br h-full',
        w.gradient,
      )}
    >
      <CardContent className="p-5">
        {/* ── HERO row: city + current temperature + headline icon ── */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-0.5">
              <MapPin className="w-3 h-3" />
              <span>{t('weatherWidget.city')}</span>
              <span className="text-muted-subtle">·</span>
              <span>{w.label}</span>
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-5xl font-bold tabular-nums leading-none">{temp}°</span>
              {days[0] && (
                <span className="text-xs text-muted-foreground">
                  ↑{Math.round(days[0].max)}° ↓{Math.round(days[0].min)}°
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3 mt-3 text-micro text-muted-foreground">
              <div className="flex items-center gap-1">
                <span className="opacity-60">{t('weatherWidget.feelsLikeLabel')}</span>
                <span className="font-medium text-foreground tabular-nums">{feelsLike}°</span>
              </div>
              <div className="flex items-center gap-1">
                <Wind className="w-3 h-3 opacity-60 shrink-0" />
                <span className="tabular-nums">
                  {Math.round(data.current.wind_speed_10m)} {t('weatherWidget.kmh')}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Droplets className="w-3 h-3 opacity-60 shrink-0" />
                <span className="tabular-nums">{data.current.relative_humidity_2m}%</span>
              </div>
            </div>
          </div>
          <Icon className={cn('h-16 w-16 shrink-0', w.tone)} strokeWidth={1.5} />
        </div>

        {/* ── 7-day forecast strip ── */}
        <div className="grid grid-cols-7 gap-1 pt-3 border-t border-border/40">
          {days.map((d) => {
            const dayWmo = wmo(d.code, t);
            const DayIcon = dayWmo.Icon;
            return (
              <div
                key={d.iso}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-md py-2 px-1 text-center transition-colors',
                  d.isToday
                    ? 'bg-foreground/10 ring-1 ring-foreground/20'
                    : 'hover:bg-foreground/5',
                )}
                title={`${d.iso} · ${dayWmo.label}`}
              >
                <span
                  className={cn(
                    'text-label font-medium ',
                    d.isToday ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {shortWeekday(d.iso, d.isToday, t)}
                </span>
                <DayIcon className={cn('h-5 w-5', dayWmo.tone)} strokeWidth={1.75} />
                <div className="flex items-baseline gap-0.5 leading-none">
                  <span className="text-xs font-semibold tabular-nums text-foreground">
                    {Math.round(d.max)}°
                  </span>
                  <span className="text-micro tabular-nums text-muted-foreground">
                    {Math.round(d.min)}°
                  </span>
                </div>
                {d.rain > 20 && (
                  <span className="flex items-center gap-0.5 text-micro text-info">
                    <Droplets className="w-2 h-2" />
                    {Math.round(d.rain)}%
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
