import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Puzzle,
  Download,
  ShieldAlert,
  Lock,
  CheckCircle2,
  Info,
  Loader2,
} from 'lucide-react';
import { useAuth } from '@/shared/context/AuthContext';
import { downloadPdf } from '@/shared/api/client';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Button } from '@/ui/button';
import { toast } from '@/shared/components/Toast';
import { brand } from '@/shared/config/brand';

/**
 * «Revit нэмэлт» татах + суулгах заавар — ОДООХОНДОО зөвхөн эзэмшигч (user id 1,
 * Anand)-д харагдана.  Хуудас өөрөө id-гаар хамгаалагдана; backend
 * (/api/revit-addin/*) мөн зөвхөн id 1-д zip татуулна.  Дараа бусдад нээхэд
 * энэ хуудасны + Layout nav + backend-ийн gate-ийг role/жагсаалт болгож солино.
 *
 * Багцууд Revit хувилбар бүрт тусдаа (нэг DLL бүх Revit-д ачаалагдахгүй:
 * 2024=net48, 2025/2026=net8, 2027=net10).  Хүлээн авагч зөвхөн ӨӨРИЙН Revit-ийн
 * zip-ийг л татна.
 */

const OWNER_ID = 1;

type AddinVersion = { year: string; revit: string; size: string };

const VERSIONS: AddinVersion[] = [
  { year: '2024', revit: 'Revit 2024', size: '~0.5 MB' },
  { year: '2025', revit: 'Revit 2025', size: '~3.7 MB' },
  { year: '2026', revit: 'Revit 2026', size: '~3.7 MB' },
  { year: '2027', revit: 'Revit 2027', size: '~3.4 MB' },
];

export default function RevitAddinPage() {
  const { user } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);

  // Хуудасны gate: одоохондоо зөвхөн эзэмшигч (id 1).
  if (!user || user.id !== OWNER_ID) {
    return <Navigate to="/app" replace />;
  }

  const handleDownload = async (v: AddinVersion) => {
    setBusy(v.year);
    try {
      await downloadPdf(`/revit-addin/download/${v.year}`, `RevitMcpAddin-Revit${v.year}.zip`);
      toast.success(`${v.revit}-ийн багц татагдлаа`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Татахад алдаа гарлаа');
    } finally {
      setBusy(null);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        icon={Puzzle}
        eyebrow="Revit"
        title="Revit нэмэлт"
        description={`${brand().nameShort} «Тоо хэмжээ» Revit нэмэлтийг татаж, өөр компьютерт суулгах багц + заавар. Зөвхөн өөрийн Revit хувилбарын багцыг татна уу.`}
      />

      {/* Зөвхөн эзэмшигчид харагдана гэдгийг сануулах жижиг тэмдэг */}
      <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
        <Lock className="h-4 w-4 shrink-0" />
        <span>Энэ хуудас одоохондоо зөвхөн танд (id {OWNER_ID}) харагдаж байна. Бэлэн болмогц бусад ажилтанд нээнэ.</span>
      </div>

      {/* Татах — хувилбар бүрт */}
      <Card className="border-border bg-card/60 backdrop-blur">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Download className="h-5 w-5 text-primary" /> Багц татах (Revit хувилбараар)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {VERSIONS.map((v) => (
            <div
              key={v.year}
              className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 p-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">{v.revit}</div>
                <div className="text-xs text-muted-foreground">
                  RevitMcpAddin-Revit{v.year}.zip · {v.size}
                </div>
              </div>
              <Button
                size="sm"
                className="shrink-0"
                disabled={busy === v.year}
                onClick={() => handleDownload(v)}
              >
                {busy === v.year ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-1.5 h-4 w-4" />
                )}
                Татах
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Суулгах заавар */}
      <Card className="border-border bg-card/60 backdrop-blur">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CheckCircle2 className="h-5 w-5 text-primary" /> Суулгах (энгийн)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              <span className="font-medium text-foreground">ZIP-ийг задлахаас ӨМНӨ «Unblock» хийх:</span>{' '}
              татсан zip дээр баруун товч → <span className="font-medium">Properties</span> → доод талд{' '}
              <span className="font-medium">«Unblock»</span> тэмдэглээд OK → дараа нь задлах.
            </li>
            <li>
              Задалсан хавтас доторх <span className="font-mono text-xs">Install.bat</span> дээр давхар дарна.
            </li>
            <li>
              Revit-ээ <span className="font-medium text-foreground">хааж, дахин нээх</span>. Дээд талд «{brand().nameShort}» таб + «Тоо хэмжээ илгээх» товч гарна.
            </li>
          </ol>
          <p className="text-xs">
            Гараар суулгах бол: <span className="font-mono">RevitMcpAddin.addin</span> файл ба{' '}
            <span className="font-mono">RevitMcpAddin</span> хавтсыг хамт{' '}
            <span className="font-mono">%APPDATA%\Autodesk\Revit\Addins\&lt;он&gt;\</span> руу хуулна
            (zip доторх README.txt-д дэлгэрэнгүй).
          </p>
        </CardContent>
      </Card>

      {/* Анхаарах зүйлс */}
      <Card className="border-border bg-card/60 backdrop-blur">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldAlert className="h-5 w-5 text-warning" /> Анхаарах
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5 text-sm text-muted-foreground">
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>
              <span className="font-medium text-foreground">«Unblock»-ийг заавал хий.</span>{' '}
              Татсан файлын Windows «block»-ийг арилгахгүй бол Revit нэмэлтийг ачаалж чадахгүй
              («Cannot load assembly» алдаа). Install.bat нь суулгасны дараа автоматаар арилгадаг ч,
              zip-ээ эхлээд unblock хийвэл найдвартай.
            </span>
          </div>
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
            <span>
              Эхний нээлтэд <span className="font-medium text-foreground">«Add-In Security»</span>{' '}
              анхааруулга гарвал <span className="font-medium text-foreground">«Always Load»</span>{' '}
              сонго (гарын үсэггүй тул). Цаашид асуухгүй.
            </span>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <span>
              Нэмэлт .NET суулгах <span className="font-medium text-foreground">шаардлагагүй</span> —
              Revit өөрийн runtime-тай ирдэг. Зөвхөн тухайн PC-д тохирох Revit хувилбар суусан байхад
              л хангалттай.
            </span>
          </div>
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
            <span>
              Add-in ашиглахын тулд хэрэглэгч «Тохиргоо» цонхоор {brand().nameShort}-ийн нэр/нууц үгээрээ нэвтэрнэ
              (илгээх эрх backend талд шалгагдана).
            </span>
          </div>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
