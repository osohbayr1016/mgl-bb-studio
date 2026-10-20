/* Google Maps холбоосоор пин тавих цонх (газрын зургийн засах горим).
 *
 * Ажилтан Google Maps-аас «Хуваалцах» → холбоосыг энд буулгана → координат
 * задарна (богино холбоос бол серверээр урт болгож) → `onPick(lat,lng)`
 * газрын зургийн ноорог пин болно, дараа нь ердийн «Хадгалах».  Хадгалах
 * нь ЭНД биш — одоо байгаа `ProjectMap` урсгал (draft → Save → PUT) хэвээр,
 * зөвхөн пиныг гараар биш холбоосоор ТАВИХ арга нэмэгдсэн.  Координатыг
 * шууд «47.91, 106.91» гэж бичсэн ч болно. */
import { useEffect, useRef, useState } from 'react';
import { Link2, Loader2, MapPin } from 'lucide-react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { useLanguage } from '@/shared/i18n';
import { resolveMapsLink, type ResolvedMapsLink } from '@/features/projects/lib/resolveMapsLink';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (lat: number, lng: number) => void;
}

export function MapsLinkDialog({ open, onOpenChange, onPick }: Props) {
  const { t } = useLanguage();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResolvedMapsLink | null>(null);
  /* Гараар бичихэд товч бүрд сервер дуудахгүй — 500 мс debounce; буулгахад
   * шууд.  `seq` нь хоцорч ирсэн хуучин хариуг хаяна. */
  const seqRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) {
      setValue('');
      setResult(null);
      setBusy(false);
      seqRef.current++;
      if (timerRef.current) clearTimeout(timerRef.current);
    }
  }, [open]);

  const check = async (text: string) => {
    const seq = ++seqRef.current;
    setResult(null);
    if (!text.trim()) {
      setBusy(false);
      return;
    }
    setBusy(true);
    try {
      const r = await resolveMapsLink(text);
      if (seq !== seqRef.current) return;
      setResult(r);
    } finally {
      if (seq === seqRef.current) setBusy(false);
    }
  };

  const onType = (text: string) => {
    setValue(text);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void check(text), 500);
  };
  const onPasteText = (text: string) => {
    setValue(text);
    if (timerRef.current) clearTimeout(timerRef.current);
    void check(text);
  };

  const reasonText = (r: Extract<ResolvedMapsLink, { ok: false }>) => {
    switch (r.reason) {
      case 'not_maps':
        return t('projectMap.linkNotMaps');
      case 'no_coords':
        return t('projectMap.linkNoCoords');
      case 'offline':
        return t('projectMap.linkOffline');
      default:
        return t('projectMap.linkResolveFailed');
    }
  };

  const apply = () => {
    if (!result?.ok) return;
    onPick(result.coords.lat, result.coords.lng);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-primary" /> {t('projectMap.linkDialogTitle')}
          </DialogTitle>
          <DialogDescription>{t('projectMap.linkDialogHint')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Input
            autoFocus
            value={value}
            onChange={(e) => onType(e.target.value)}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData('text');
              if (pasted) {
                e.preventDefault();
                onPasteText(pasted);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && result?.ok) apply();
            }}
            placeholder="https://maps.app.goo.gl/…"
            inputMode="url"
            spellCheck={false}
            data-testid="maps-link-input"
          />
          <p className="min-h-5 text-xs" data-testid="maps-link-status">
            {busy ? (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> {t('projectMap.linkChecking')}
              </span>
            ) : result?.ok ? (
              <span className="inline-flex items-center gap-1 text-success">
                <MapPin className="h-3 w-3" />
                {result.coords.lat.toFixed(5)}, {result.coords.lng.toFixed(5)}
              </span>
            ) : result ? (
              <span className="text-warning">
                {reasonText(result)}
                {result.url && result.reason !== 'not_maps' && (
                  <>
                    {' '}
                    <a
                      href={result.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2"
                    >
                      {t('projectMap.linkOpenAnyway')}
                    </a>
                  </>
                )}
              </span>
            ) : null}
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={apply} disabled={!result?.ok || busy} data-testid="maps-link-apply">
            <MapPin className="h-4 w-4" /> {t('projectMap.linkApply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default MapsLinkDialog;
