import { useCallback, useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Clock,
  ImagePlus,
  Loader2,
  MoreVertical,
  RefreshCw,
  RotateCw,
  Trash2,
  X,
} from 'lucide-react';
import { uploadFile, mediaUrl } from '@/shared/api/client';
import { toast } from '@/shared/components/Toast';
import { useMediaQuery } from '@/shared/hooks/useMediaQuery';
import { useLanguage } from '@/shared/i18n';
import { normalizeTakenAt, readPhotoTakenAt } from '@/shared/lib/exifDate';
import { downscaleImage, UnsupportedImageError } from '@/shared/lib/imageDownscale';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { Input } from '@/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { DocBand, DocBlock, DocText } from './AsrDocKit';
import { photoStamp, type AsrPhotoStampContext } from './photoStamp';
import {
  ASR_MAX_CAPTION,
  ASR_MAX_PHOTOS,
  ASR_MEETING_MAX_PHOTOS,
  ASR_PHOTOS_PER_PAGE,
  type AsrPhoto,
} from './types';

/**
 * Зургийн хуудас — баримтын хэлбэрээр (эзний хүсэлт 2026-09-25).
 *
 * Хэвлэх баримтын адил хуудас бүрт 2×2 нүд.  Хоосон нүд дээр дарахад камер /
 * зургийн сан нээгдэж, зураг ЯГ ТЭР нүдэнд орно; бүтэн нүдийг цэснээс солих,
 * зөөх, устгана.  Хуудас дүүрмэгц дараагийн хоосон хуудас гарна.
 *
 * Зураг бүрийн БАРУУН ДООД буланд авсан огноо (секундтэй) + төслийн нэр
 * автоматаар гарна (`photoStamp.ts`).  Огноо нь байршуулахаас ӨМНӨ эх
 * файлын EXIF-ээс уншигдана — урьд авсан зургийг оруулахад ч тэр агшных.
 *
 * ⚠️ Зураг бүр БИЕ ДААН байршина (муу сүлжээнд нэг нь унавал бусад нь
 *    алдагдахгүй), гэхдээ ЗАХИАЛГАА хадгалж маягтад орно: нүднүүдийг дарааллаар
 *    сонгосон бол дараалалаар нь.  Зэрэг байршиж буй зургуудаас хурдан
 *    дууссан нь өмнөхөө «гүйцэж түрүүлбэл» нүдний байрлал солигдоно — тиймээс
 *    `flush()` нь ЭХНИЙ дуусаагүй зураг хүртэлх бэлэн зургуудыг л нэмнэ.
 *    Унасан зураг дараалал хаахгүй (алгасна), дахин оролдвол ард нэмэгдэнэ.
 */

type PendingStatus = 'uploading' | 'ready' | 'failed';

interface PendingUpload {
  id: string;
  file: File;
  previewUrl: string;
  status: PendingStatus;
  photo?: AsrPhoto;
  /** Байгаа зургийг СОЛИХ байршуулалт — тэр зургийн нүдэнд суух. */
  replaceUrl?: string;
}

/** Дараагийн файл сонголт юунд зориулагдсан бэ. */
type PickTarget = { replaceUrl?: string };

const pad2 = (n: number) => String(n).padStart(2, '0');

export function AsrDocPhotos({
  photos,
  onChange,
  readOnly,
  stamp,
  projectName,
  single = false,
}: {
  photos: AsrPhoto[];
  /** ЗААВАЛ updater хэлбэр — зэрэг дуусаж буй байршуулалт бие биеэ дарахгүй. */
  onChange: (updater: (prev: AsrPhoto[]) => AsrPhoto[]) => void;
  readOnly?: boolean;
  stamp: AsrPhotoStampContext;
  projectName: string;
  /**
   * Оффис уулзалт (0367, эзэн 2026-09-30): ЯГ НЭГ ТОМ зураг — хуудсанд 1,
   * бүтэн өргөнөөр, гараар бичих тайлбаргүй (тайлбар нь автомат: төслийн
   * нэр · огноо цаг:мин:сек).  Төрөл солиход өмнөх зургууд устахгүй — тэд
   * тус бүр өөрийн хуудсанд харагдаж, хасаж болно, шинээр нэмэхгүй.
   */
  single?: boolean;
}) {
  const MAX = single ? ASR_MEETING_MAX_PHOTOS : ASR_MAX_PHOTOS;
  const PER_PAGE = single ? 1 : ASR_PHOTOS_PER_PAGE;
  const { t } = useLanguage();
  const coarse = useMediaQuery('(pointer: coarse)');
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const target = useRef<PickTarget>({});
  const [dragOver, setDragOver] = useState(false);

  /*
   * `pending`-ийн ХУВЬ ref-д давхар — `flush()` нь байршуулалтын callback
   * дотроос хамгийн сүүлийн жагсаалтыг СИНХРОНООР унших ёстой (state нь
   * дараагийн render хүртэл хуучин).
   */
  const pendingRef = useRef<PendingUpload[]>([]);
  const [pending, setPendingState] = useState<PendingUpload[]>([]);
  const setPending = useCallback((fn: (prev: PendingUpload[]) => PendingUpload[]) => {
    pendingRef.current = fn(pendingRef.current);
    setPendingState(pendingRef.current);
  }, []);

  const flush = useCallback(() => {
    const ready: AsrPhoto[] = [];
    const done = new Set<string>();
    for (const it of pendingRef.current) {
      if (it.replaceUrl) continue;
      if (it.status === 'uploading') break;
      if (it.status === 'ready' && it.photo) {
        ready.push(it.photo);
        done.add(it.id);
      }
    }
    if (ready.length === 0) return;
    // `Math.max(prev.length, MAX)` — төрөл солигдсон тайлангийн хуучин зургийг
    // (оффис уулзалтад 1-ээс олон) энд тайрч устгахгүй.
    onChange((prev) => [...prev, ...ready].slice(0, Math.max(prev.length, MAX)));
    for (const it of pendingRef.current) if (done.has(it.id)) URL.revokeObjectURL(it.previewUrl);
    setPending((p) => p.filter((x) => !done.has(x.id)));
  }, [onChange, setPending, MAX]);

  const drop = useCallback(
    (item: PendingUpload) => {
      setPending((p) => p.filter((x) => x.id !== item.id));
      URL.revokeObjectURL(item.previewUrl);
    },
    [setPending],
  );

  const uploadOne = useCallback(
    async (item: PendingUpload) => {
      try {
        // Авсан огноо ЭХ файлаас — жижигрүүлсний дараа EXIF байхгүй.
        const takenAt = await readPhotoTakenAt(item.file);
        const small = await downscaleImage(item.file);
        const url = await uploadFile(small);
        const photo: AsrPhoto = { url, name: item.file.name, taken_at: takenAt };
        if (item.replaceUrl) {
          const old = item.replaceUrl;
          // Тайлбарыг ҮЛДЭЭНЭ — нүдний утга (юу харуулж буй) өөрчлөгдөөгүй,
          // зөвхөн зураг нь илүү сайн хувилбараар солигдсон.
          onChange((prev) =>
            prev.some((p) => p.url === old)
              ? prev.map((p) => (p.url === old ? { ...photo, caption: p.caption } : p))
              : [...prev, photo].slice(0, Math.max(prev.length, MAX)),
          );
          drop(item);
          return;
        }
        setPending((p) =>
          p.map((x) => (x.id === item.id ? { ...x, status: 'ready' as const, photo } : x)),
        );
        flush();
      } catch (err) {
        if (err instanceof UnsupportedImageError) {
          toast.error(t('asr.unsupportedImage'));
          drop(item);
        } else {
          // Сүлжээ унасан — файлыг барьж үлдэж, дахин оролдох боломж өгнө.
          setPending((p) =>
            p.map((x) => (x.id === item.id ? { ...x, status: 'failed' as const } : x)),
          );
        }
        flush();
      }
    },
    [onChange, setPending, flush, drop, t, MAX],
  );

  const appendPending = pending.filter((p) => !p.replaceUrl);
  const used = photos.length + appendPending.length;

  const addFiles = useCallback(
    (files: FileList | File[] | null, to: PickTarget = {}) => {
      const list = files ? Array.from(files).filter((f) => f.type.startsWith('image/') || !f.type) : [];
      if (list.length === 0) return;
      if (to.replaceUrl) {
        const item: PendingUpload = {
          id: `${Date.now()}-r-${list[0]!.name}`,
          file: list[0]!,
          previewUrl: URL.createObjectURL(list[0]!),
          status: 'uploading',
          replaceUrl: to.replaceUrl,
        };
        setPending((p) => [...p.filter((x) => x.replaceUrl !== to.replaceUrl), item]);
        void uploadOne(item);
        return;
      }
      const room = MAX - used;
      if (room <= 0) {
        toast.error(t('asr.photoLimit', { max: MAX }));
        return;
      }
      const picked = list.slice(0, room);
      if (picked.length < list.length) toast.error(t('asr.photoLimit', { max: MAX }));
      const items: PendingUpload[] = picked.map((file, i) => ({
        id: `${Date.now()}-${i}-${file.name}`,
        file,
        previewUrl: URL.createObjectURL(file),
        status: 'uploading',
      }));
      setPending((p) => [...p, ...items]);
      for (const item of items) void uploadOne(item);
    },
    [used, setPending, uploadOne, t, MAX],
  );

  const pick = (mode: 'camera' | 'gallery', to: PickTarget = {}) => {
    target.current = to;
    (mode === 'camera' ? cameraRef : galleryRef).current?.click();
  };

  const retry = (item: PendingUpload) => {
    setPending((p) => p.map((x) => (x.id === item.id ? { ...x, status: 'uploading' } : x)));
    void uploadOne({ ...item, status: 'uploading' });
  };

  const remove = (url: string) => onChange((prev) => prev.filter((p) => p.url !== url));
  const move = (i: number, dir: -1 | 1) =>
    onChange((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const setCaption = (url: string, caption: string) =>
    onChange((prev) => prev.map((p) => (p.url === url ? { ...p, caption } : p)));
  /*
   * Авсан огноог ГАРААР засах (эзэн 2026-10-12): хуучин тайланг нөхөж
   * оруулахад татаж авсан зурагт EXIF байхгүй тул огноо нь файлын
   * `lastModified` = өнөөдөр болдог.  `all` бол бусад зургийн ӨДРИЙГ мөн
   * солино — тэдний цаг хэвээр (цаггүй зураг энэ зургийн цагийг авна).
   */
  const setTakenAt = (url: string, takenAt: string, all: boolean) =>
    onChange((prev) =>
      prev.map((p) => {
        if (p.url === url) return { ...p, taken_at: takenAt };
        if (!all) return p;
        const time = /T(.+)$/.exec(p.taken_at ?? '')?.[1] ?? takenAt.slice(11);
        return { ...p, taken_at: `${takenAt.slice(0, 10)}T${time}` };
      }),
    );

  /*
   * Нүдний тоо: засах горимд одоогийн хуудсыг дүүргэх хоосон нүднүүд (дүүрсэн
   * бол ДАРААГИЙН хуудас) — дээд хязгаар хүртэл.  Уншихад л бол бодит зураг.
   */
  const canAdd = !readOnly && used < MAX;
  const slotCount = canAdd
    ? Math.min(MAX, Math.max(PER_PAGE, Math.ceil((used + 1) / PER_PAGE) * PER_PAGE))
    : used;

  if (slotCount === 0) {
    return (
      <DocBlock id="asr-sec-photos">
        <DocBand mn="Хавсралт зураг" en="Photos" />
        <p className="px-3 py-4 text-sm text-muted-foreground">{t('asr.photosNone')}</p>
      </DocBlock>
    );
  }

  const replacing = new Map(pending.filter((p) => p.replaceUrl).map((p) => [p.replaceUrl!, p]));
  const sheets = Math.ceil(slotCount / PER_PAGE);

  const onDragOver = (e: DragEvent) => {
    if (!canAdd || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setDragOver(true);
  };
  const onDrop = (e: DragEvent) => {
    if (!canAdd) return;
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  };

  return (
    <div
      id="asr-sec-photos"
      className="scroll-mt-4"
      onDragOver={onDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {/* `capture="environment"` нь утсанд арын камерыг шууд нээнэ. */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files, target.current);
          e.target.value = '';
        }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple={MAX > 1}
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files, target.current);
          e.target.value = '';
        }}
      />

      {Array.from({ length: sheets }, (_, si) => {
        const from = si * PER_PAGE;
        const to = Math.min(slotCount, from + PER_PAGE);
        const filledTo = Math.min(used, to);
        return (
          <DocBlock
            key={si}
            className={cn(dragOver && canAdd && 'ring-2 ring-primary ring-offset-2')}
          >
            <DocBand mn="Хавсралт зураг" en="Photos">
              {!(single && sheets === 1) && (
                <span className="text-label tabular-nums opacity-80">
                  {filledTo > from
                    ? t('asr.photoRange', { from: from + 1, to: filledTo, total: used })
                    : t('asr.photoSheet', { n: si + 1 })}
                </span>
              )}
            </DocBand>
            <div className="grid grid-cols-[auto_1fr] gap-px border-b border-foreground/35 bg-foreground/35">
              <div className="bg-brand-navy px-3 py-1.5 text-micro font-semibold text-white">
                Төслийн нэр
              </div>
              <div className="min-w-0 truncate bg-card px-3 py-1.5 text-sm font-semibold">
                {projectName}
              </div>
            </div>
            <div
              className={cn(
                'grid gap-x-2 gap-y-3 p-2 sm:gap-x-4 sm:gap-y-4 sm:p-4',
                single ? 'grid-cols-1' : 'grid-cols-2',
              )}
            >
              {Array.from({ length: to - from }, (_, k) => {
                const i = from + k;
                if (i < photos.length) {
                  const p = photos[i]!;
                  return (
                    <PhotoSlot
                      key={p.url}
                      index={i}
                      photo={p}
                      total={photos.length}
                      stampCtx={stamp}
                      readOnly={readOnly}
                      coarse={coarse}
                      replacing={replacing.get(p.url)}
                      autoCaption={single}
                      onPick={(mode) => pick(mode, { replaceUrl: p.url })}
                      onMove={(dir) => move(i, dir)}
                      onRemove={() => remove(p.url)}
                      onCaption={(v) => setCaption(p.url, v)}
                      onTakenAt={(v, all) => setTakenAt(p.url, v, all)}
                    />
                  );
                }
                const pend = appendPending[i - photos.length];
                if (pend) {
                  return (
                    <PendingSlot
                      key={pend.id}
                      index={i}
                      item={pend}
                      onRetry={() => retry(pend)}
                      onDrop={() => {
                        drop(pend);
                        flush();
                      }}
                    />
                  );
                }
                return (
                  <EmptySlot key={`empty-${i}`} index={i} coarse={coarse} onPick={(m) => pick(m)} />
                );
              })}
            </div>
          </DocBlock>
        );
      })}
      {!readOnly && (
        <p className="mt-1.5 text-micro text-muted-foreground">
          {single
            ? t('asr.meeting.photoHint')
            : coarse
              ? t('asr.photoStampHint')
              : `${t('asr.photoStampHint')} ${t('asr.photoDropHint')}`}
        </p>
      )}
    </div>
  );
}

/** Нүдний хайрцаг — хэвлэлтийн 66мм хайрцгийн дэлгэцийн ихэр (4:3). */
const BOX =
  'relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden border border-foreground/60 bg-muted';

function SlotNo({ index }: { index: number }) {
  return (
    <span className="pointer-events-none absolute left-1 top-1 z-10 rounded-sm bg-background/90 px-1 text-label font-bold tabular-nums text-foreground">
      {pad2(index + 1)}
    </span>
  );
}

function PhotoSlot({
  index,
  photo,
  total,
  stampCtx,
  readOnly,
  coarse,
  replacing,
  autoCaption = false,
  onPick,
  onMove,
  onRemove,
  onCaption,
  onTakenAt,
}: {
  index: number;
  photo: AsrPhoto;
  total: number;
  stampCtx: AsrPhotoStampContext;
  readOnly?: boolean;
  coarse: boolean;
  replacing?: PendingUpload;
  /** Тайлбар = автомат тэмдэг (төслийн нэр · огноо цаг) — гараар бичихгүй (оффис уулзалт). */
  autoCaption?: boolean;
  onPick: (mode: 'camera' | 'gallery') => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onCaption: (v: string) => void;
  onTakenAt: (takenAt: string, all: boolean) => void;
}) {
  const { t } = useLanguage();
  const s = photoStamp(stampCtx, photo);
  const caption = photo.caption ?? '';
  return (
    <figure className="m-0 min-w-0">
      {/* `container-type: size` — зургийн хүрээ хайрцагт `cqh/cqw`-ээр
          багтана.  Тэмдэг нь хайрцгийн саарал зайд биш, ЗУРАГ ДЭЭР суух ёстой
          тул хүрээ нь зургийн хэмжээтэй (хэвлэлтийн `.asr-photo-frame`). */}
      <div className={cn(BOX, '[container-type:size]')}>
        <div className="relative max-h-full max-w-full leading-[0]">
          <img
            src={replacing?.previewUrl ?? mediaUrl(photo.url)}
            alt={photo.name}
            loading="lazy"
            className={cn(
              'block h-auto max-h-[100cqh] w-auto max-w-[100cqw]',
              replacing && 'opacity-50',
            )}
          />
          {!replacing && readOnly && (s.when || s.project) && (
            <div className={cn(STAMP, 'pointer-events-none')}>
              <StampText when={s.when} project={s.project} />
            </div>
          )}
          {!replacing && !readOnly && (
            <TakenAtEditor
              photo={photo}
              reportDate={stampCtx.reportDate}
              multi={total > 1}
              onSave={onTakenAt}
            >
              <button
                type="button"
                aria-label={t('asr.photoTakenAtEdit')}
                title={t('asr.photoTakenAtEdit')}
                className={cn(
                  STAMP,
                  'cursor-pointer hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-primary',
                )}
              >
                <StampText when={s.when || t('asr.photoTakenAtEdit')} project={s.project} />
              </button>
            </TakenAtEditor>
          )}
        </div>
        <SlotNo index={index} />
        {replacing && (
          <div className="absolute inset-0 flex items-center justify-center">
            {replacing.status === 'failed' ? (
              <span className="rounded bg-background/90 px-2 py-1 text-micro text-danger">
                {t('asr.uploadFailed')}
              </span>
            ) : (
              <Loader2 className="size-6 animate-spin text-foreground" />
            )}
          </div>
        )}
        {!readOnly && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="secondary"
                size="icon-xs"
                aria-label={t('asr.photoMenu')}
                className="absolute right-1 top-1 z-10 rounded-full bg-background/90 shadow-sm"
              >
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {coarse && (
                <DropdownMenuItem onSelect={() => onPick('camera')}>
                  <Camera /> {t('asr.photoReplaceCamera')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => onPick('gallery')}>
                <RefreshCw /> {t('asr.photoReplace')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={index === 0} onSelect={() => onMove(-1)}>
                <ArrowLeft /> {t('asr.photoMoveLeft')}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index >= total - 1} onSelect={() => onMove(1)}>
                <ArrowRight /> {t('asr.photoMoveRight')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                <Trash2 /> {t('asr.photoRemove')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {/* Тайлбар — баримт дээр зургийн доор хэвлэгдэнэ.  Оффис уулзалтад
          автомат (эзэн 2026-09-30): төслийн нэр · он сар өдөр цаг:мин:сек. */}
      {autoCaption ? (
        <figcaption className="mt-1 break-words py-1.5 text-sm italic">
          {[s.project, s.when].filter(Boolean).join(' · ')}
        </figcaption>
      ) : (
        <figcaption className="mt-1 flex items-start gap-1">
          <span className="pt-2.5 text-micro font-bold tabular-nums text-brand-navy dark:text-primary">
            {pad2(index + 1)}
          </span>
          {readOnly ? (
            <span className="min-w-0 break-words py-2 text-sm italic">
              {caption.trim() || <span className="not-italic text-muted-foreground">—</span>}
            </span>
          ) : (
            <div className="min-w-0 flex-1">
              <DocText
                value={caption}
                maxLength={ASR_MAX_CAPTION}
                placeholder={t('asr.photoCaption')}
                aria-label={t('asr.photoCaption')}
                aiPolish={false}
                className="min-h-10 px-1.5 py-2 text-sm"
                onChange={(e) => onCaption(e.target.value)}
              />
            </div>
          )}
        </figcaption>
      )}
    </figure>
  );
}

/** Зургийн баруун доод булангийн тэмдэг — хэвлэлтийн тэмдгийн дэлгэцийн ихэр. */
const STAMP =
  'absolute bottom-0 right-0 max-w-full bg-black/60 px-1.5 py-0.5 text-right leading-tight text-white';

function StampText({ when, project }: { when: string; project: string }) {
  return (
    <>
      {when && (
        <div className="whitespace-nowrap text-label font-semibold tabular-nums">{when}</div>
      )}
      {project && <div className="truncate text-label">{project}</div>}
    </>
  );
}

/** `2026-03-14T10:05:09` → [`2026-03-14`, `10:05:09`]; `…T10:05` → `10:05:00`. */
function splitTakenAt(v: string | null | undefined): [string, string] {
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2})(?::(\d{2}))?)?/.exec(v ?? '');
  if (!m) return ['', ''];
  return [m[1]!, m[2] ? `${m[2]}:${m[3] ?? '00'}` : ''];
}

/**
 * Тэмдэг дээр дарахад нээгдэх огноо/цаг засварлагч (эзэн 2026-10-12).  Утга
 * нь `normalizeTakenAt`-аар шалгагдана (2005-аас өмнө, ирээдүй хориотой) —
 * backend-ийн `TAKEN_AT_RE`-тэй ижил `YYYY-MM-DDTHH:mm:ss` хэлбэр.
 */
function TakenAtEditor({
  photo,
  reportDate,
  multi,
  onSave,
  children,
}: {
  photo: AsrPhoto;
  reportDate: string | null | undefined;
  multi: boolean;
  onSave: (takenAt: string, all: boolean) => void;
  children: ReactNode;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');

  const onOpenChange = (next: boolean) => {
    if (next) {
      const [d, tm] = splitTakenAt(photo.taken_at);
      setDate(d || splitTakenAt(reportDate)[0]);
      setTime(tm || '12:00:00');
    }
    setOpen(next);
  };

  const hms = time.length === 5 ? `${time}:00` : time;
  const value = date && hms ? normalizeTakenAt(`${date}T${hms}`) : null;
  const save = (all: boolean) => {
    if (!value) return;
    onSave(value, all);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <form
          className="flex flex-col gap-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            save(false);
          }}
        >
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <Clock className="size-4" /> {t('asr.photoTakenAtEdit')}
          </div>
          <label className="flex flex-col gap-1 text-micro text-muted-foreground">
            {t('asr.photoTakenAtDate')}
            <Input
              type="date"
              value={date}
              max={new Date().toLocaleDateString('sv-SE')}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-micro text-muted-foreground">
            {t('asr.photoTakenAtTime')}
            <Input type="time" step={1} value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
          {date && hms && !value && (
            <p className="text-micro text-danger">{t('asr.photoTakenAtInvalid')}</p>
          )}
          <Button type="submit" size="sm" disabled={!value}>
            {t('asr.photoTakenAtSave')}
          </Button>
          {multi && (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!value}
                onClick={() => save(true)}
              >
                {t('asr.photoTakenAtAll')}
              </Button>
              <p className="text-micro text-muted-foreground">{t('asr.photoTakenAtAllHint')}</p>
            </>
          )}
        </form>
      </PopoverContent>
    </Popover>
  );
}

function PendingSlot({
  index,
  item,
  onRetry,
  onDrop,
}: {
  index: number;
  item: PendingUpload;
  onRetry: () => void;
  onDrop: () => void;
}) {
  const { t } = useLanguage();
  return (
    <figure className="m-0 min-w-0">
      <div className={BOX}>
        <img
          src={item.previewUrl}
          alt=""
          className="absolute inset-0 size-full object-contain opacity-50"
        />
        <SlotNo index={index} />
        <div className="relative flex flex-col items-center gap-1">
          {item.status === 'failed' ? (
            <>
              <Button type="button" size="sm" variant="secondary" className="gap-1" onClick={onRetry}>
                <RotateCw /> {t('asr.photoRetry')}
              </Button>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="gap-1 bg-background/80"
                onClick={onDrop}
              >
                <X /> {t('asr.photoRemove')}
              </Button>
            </>
          ) : (
            <Loader2 className="size-6 animate-spin text-foreground" />
          )}
        </div>
      </div>
    </figure>
  );
}

/**
 * Хоосон нүд.  Мэдрэгчтэй дэлгэц дээр дарахад «Камер / Зургийн сан» сонголт,
 * хулганатай компьютер дээр шууд файл сонгох цонх (олноор сонгож болно).
 */
function EmptySlot({
  index,
  coarse,
  onPick,
}: {
  index: number;
  coarse: boolean;
  onPick: (mode: 'camera' | 'gallery') => void;
}) {
  const { t } = useLanguage();
  const face = (
    <Button
      type="button"
      variant="outline"
      className={cn(
        BOX,
        'h-auto flex-col gap-1.5 border-2 border-dashed border-foreground/30 bg-muted/40 font-normal text-muted-foreground',
        'hover:border-primary/60 hover:bg-primary/5 hover:text-foreground pointer-coarse:h-auto',
      )}
      onClick={coarse ? undefined : () => onPick('gallery')}
    >
      <SlotNo index={index} />
      <ImagePlus className="size-7" />
      <span className="text-micro">{t('asr.photoAdd')}</span>
    </Button>
  );
  if (!coarse) return <div className="min-w-0">{face}</div>;
  return (
    <div className="min-w-0">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{face}</DropdownMenuTrigger>
        <DropdownMenuContent align="center">
          <DropdownMenuItem onSelect={() => onPick('camera')}>
            <Camera /> {t('asr.camera')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onPick('gallery')}>
            <ImagePlus /> {t('asr.gallery')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
