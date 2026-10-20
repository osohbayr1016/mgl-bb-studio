import { Cpu, CircleAlert, CircleCheck, Download, KeyRound } from 'lucide-react';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { type ProbeResult } from '../lib/runtime';

/**
 * ЛОКАЛ RUNTIME-ИЙН ТӨЛӨВ.
 *
 * ⚠️ ЭНЭ КОМПОНЕНТ НЬ ҮНЭНИЙГ ХЭЛНЭ.  Загвар суулгаагүй, эсвэл Echo
 *    хөдөлгүүр дээр ажиллаж байгааг НУУХГҮЙ — хэрэглэгч «MGL AI муу
 *    хариулж байна» гэж бодохын оронд «загвар суугаагүй байна» гэдгийг
 *    мэдэх ёстой.  §12-ийн «Never sacrifice security to satisfy same
 *    model» -ийн ил тод байдлын хувилбар.
 */
export function RuntimeStatus({
  probe,
  serverModel,
}: {
  probe: ProbeResult | null;
  serverModel: { display_name: string; version: string; runtime_variant: string } | null;
}) {
  if (probe === null) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Cpu className="size-3.5 animate-pulse" aria-hidden />
        Локал хөдөлгүүрийг шалгаж байна…
      </div>
    );
  }

  if (!probe.installed) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-700 dark:text-amber-300">
          <CircleAlert className="size-3" aria-hidden />
          Локал MGL AI ажиллахгүй байна
        </Badge>
        <span className="text-muted-foreground">
          Хайлт, ERP-ийн хариу ажиллана — өгүүлбэр үүсгэх нь локал хөдөлгүүр шаардана.
        </span>
        <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-xs" asChild>
          <a href="/app/mgl-ai/setup">
            <Download className="size-3" aria-hidden />
            Суулгах заавар
          </a>
        </Button>
      </div>
    );
  }

  // ⚠️ НУУЦ АСУУХ ЦОНХ УСТСАН (2026-09-09, эзний заавар).  ERP-д нэвтэрсэн
  //    ажилтнаас дахин «нууц» асуух нь давхардсан саад байсан бөгөөд
  //    аюулгүй байдалд бараг юу ч нэмдэггүй байв (нууц файл нь ажилтны
  //    өөрийнх нь профайлд ил байдаг).  Локал үйлчилгээ одоо Origin-оор
  //    итгэмжилдэг.
  //
  //    Энэ мөчлөг нь одоо ЗӨВХӨН ховор тохиолдолд ажиллана: ERP-ийг
  //    цагаан жагсаалтад БАЙХГҮЙ домэйнээс нээсэн үед.  Хэрэглэгчээс
  //    засах зүйл байхгүй тул талбар БИШ, тайлбар харуулна.
  if (!probe.authorized) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge
          variant="outline"
          className="gap-1 border-amber-500/40 text-amber-700 dark:text-amber-300"
        >
          <KeyRound className="size-3" aria-hidden />
          Локал AI холбогдсонгүй
        </Badge>
        <span className="text-muted-foreground">
          Энэ хаягнаас локал үйлчилгээ рүү хандах эрхгүй байна. ERP-ийн албан ёсны хаягаар
          нэвтэрнэ үү.
        </span>
      </div>
    );
  }

  const { info } = probe;
  const isEcho = info.engine.engine === 'echo';

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Badge
        variant="outline"
        className={
          isEcho
            ? 'gap-1 border-amber-500/40 text-amber-700 dark:text-amber-300'
            : 'gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
        }
      >
        {isEcho ? <CircleAlert className="size-3" aria-hidden /> : <CircleCheck className="size-3" aria-hidden />}
        {isEcho ? 'Загвар суугаагүй' : `${serverModel?.display_name ?? 'MGL AI'} · локал`}
      </Badge>

      <span className="text-muted-foreground">
        {info.hardware.gpu ?? 'GPU илрээгүй'}
        {info.hardware.vramMb ? ` · ${(info.hardware.vramMb / 1024).toFixed(0)} GB VRAM` : ''}
        {info.engine.quantization ? ` · ${info.engine.quantization}` : ''}
      </span>

      {isEcho && <span className="text-amber-700 dark:text-amber-300">{info.engine_reason}</span>}
    </div>
  );
}
