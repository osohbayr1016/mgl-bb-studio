/**
 * .docx-ийг ХӨТӨЧ ДЭЭР render хийнэ (`docx-preview`) — Drive-аас ирсэн эх
 * байтуудаас шууд; хуулбар, Google хөрвүүлэлт, серверийн ажил ХЭРЭГГҮЙ.
 *
 * Эзний 2026-09-11-ний гомдол: Drive-ын нэг хуудасны зураг «preview not good».
 * `docx-preview` нь хуудас, хүснэгт, зураг, толгой/хөл, хуудасны хэмжээг
 * Word-той ойролцоо гаргадаг; яг pixel-ээр Word биш (шрифт орлуулагдана,
 * зарим нарийн layout зөрнө) — тэр тохиолдолд «Эх файлыг нээх» товч хажууд нь.
 *
 * Сан нь ~1 MB тул зөвхөн энэ компонент нээгдэхэд л динамикаар ачаалагдана
 * (`DriveFilePreviewDialog` үүнийг `lazy()`-аар дуудна).
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';

export default function DocxPreview({ blob, name }: { blob: Blob; name: string }) {
  const { t } = useLanguage();
  const bodyRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLDivElement>(null);
  // Үр дүнг ямар blob-ынх гэдгээр нь тэмдэглэнэ — effect дотор синхрон
  // setState хэрэггүй; өөр файл ирэхэд автоматаар «ачаалж байна» болно.
  const [done, setDone] = useState<{ blob: Blob; ok: boolean } | null>(null);
  const state: 'loading' | 'ready' | 'error' =
    done && done.blob === blob ? (done.ok ? 'ready' : 'error') : 'loading';

  useEffect(() => {
    let cancelled = false;
    const body = bodyRef.current;
    const style = styleRef.current;
    if (!body || !style) return;
    body.replaceChildren();
    style.replaceChildren();
    void import('docx-preview')
      .then((m) =>
        m.renderAsync(blob, body, style, {
          className: 'docx',
          inWrapper: true,
          breakPages: true,
          ignoreLastRenderedPageBreak: false,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          useBase64URL: true,
        }),
      )
      .then(() => {
        if (!cancelled) setDone({ blob, ok: true });
      })
      .catch((err) => {
        console.error('[drive-preview] docx render failed', name, err);
        if (!cancelled) setDone({ blob, ok: false });
      });
    return () => {
      cancelled = true;
    };
  }, [blob, name]);

  return (
    <div className="relative h-full overflow-auto bg-neutral-300/60 dark:bg-neutral-800">
      {state === 'loading' && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/70 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">{t('projectDrive.rendering')}</p>
        </div>
      )}
      {state === 'error' && (
        <div className="flex h-full items-center justify-center px-6 text-center">
          <p className="max-w-md text-sm text-muted-foreground">{t('projectDrive.renderFailed')}</p>
        </div>
      )}
      <div ref={styleRef} />
      {/* `docx-preview`-ийн wrapper нь өөрөө хуудас бүрийг цагаан дэвсгэр,
          сүүдэртэй гаргадаг — гадна талд нь зөвхөн саарал дэвсгэр өгнө. */}
      <div ref={bodyRef} className="docx-preview-body min-h-full py-4 [&_.docx-wrapper]:bg-transparent [&_.docx-wrapper]:p-0" />
    </div>
  );
}
