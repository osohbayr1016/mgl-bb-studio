import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { BookOpen, Bot, Copy, Check, Plug, Sparkles } from 'lucide-react';
import { useAuth } from '@/shared/context/AuthContext';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { toast } from '@/shared/components/Toast';
import { useBrand } from '@/shared/config/useBrand';
import { resolveApiHost } from '@/shared/api/apiHost';

/**
 * MCP гарын авлага — бүх ажилтанд (client-аас бусад) харагдана.  MGL-ийн MCP
 * server рүү Claude (болон MCP дэмждэг бусад AI) -г холбох заавар + tool
 * бүрийн жишээ prompt-уудыг хуулж авах боломжтой.
 *
 * Бүлэг бүр `audience`-тэй: MglMcpAgent.init() доторх бүртгэлийн түвшинг
 * (бүгд → staff → admin|senior → admin) яг толин тусгал болгож, хэрэглэгчид
 * зөвхөн ӨӨРИЙН эрхээр ажиллах prompt-уудыг харуулна — серверээс
 * бүртгэгдээгүй tool-ийн prompt үзүүлээд "ажиллахгүй" гэх төөрөгдлөөс
 * сэргийлнэ.  Бүх контент монголоор (дотоод хэрэглээ).
 */

/**
 * MCP-ийн үзүүлэлтүүд нь `resolveApiHost()`-оос ГАРНА — өөрийн хуулбар
 * барихгүй.  Урьд нь worker-ийн URL энд ДАХИН бичигдсэн байсан тул өөр
 * компанийн build нь API руугаа зөв ханддаг мөртлөө MCP-ийн зааварт MGL-ийн
 * хаягийг хэвлэдэг байв.
 *
 * Сервер (connector)-ын нэрийг байгууллагын аппын нэрээс slug болгоно —
 * MGL дээр `mgl-progress`, өөрөөр хэлбэл өмнөхтэй ЯГ ИЖИЛ.
 */
function mcpServerSlug(appName: string): string {
  const slug = appName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'app';
}

/** MglMcpAgent.init()-ийн бүртгэлийн блокуудтай 1:1 тохирох түвшингүүд. */
type Audience = 'all' | 'staff' | 'manager' | 'admin';

const AUDIENCE_META: Record<Audience, { label: string; cls: string }> = {
  all: { label: 'Бүгд', cls: 'bg-success/10 text-success border-success/30' },
  staff: { label: 'Ажилтан', cls: 'bg-info/10 text-info border-info/30' },
  manager: { label: 'Админ + ахлах', cls: 'bg-warning/10 text-warning border-warning/30' },
  admin: { label: 'Зөвхөн админ', cls: 'bg-danger/10 text-danger border-danger/30' },
};

const canSee = (role: string, a: Audience): boolean =>
  a === 'all'
    ? true
    : a === 'staff'
      ? role !== 'client'
      : a === 'manager'
        ? role === 'admin' || role === 'senior'
        : role === 'admin';

type Prompt = { label: string; prompt: string };
type Group = { title: string; audience: Audience; items: Prompt[] };

/**
 * Жишиг prompt-ууд.  ФУНКЦ — модулийн түвшний `const` нь брэнд серверээс
 * ирэхээс өмнө нэг л удаа тогтох тул админ нэрээ сольсон ч хуучнаараа
 * үлдэнэ.  `org` нь байгууллагын богино нэр.
 */
const buildGroups = (org: string): Group[] => [
  {
    title: 'Төсөл ба явц',
    audience: 'all',
    items: [
      {
        label: 'Бүх төсөл + явц',
        prompt: `${org} дээр ямар төслүүд байна, явцтай нь жагсаа.`,
      },
      { label: 'Төслийн бүрэн тайлан', prompt: '44-р төслийн бүрэн тайланг (явц, багууд, сүүлийн ажлууд) гаргаж өг.' },
      { label: 'Хугацаа хэтэрсэн таск', prompt: 'Хугацаа хэтэрсэн бүх таскыг хариуцагч, хэдэн хоног хэтэрсэнтэй нь жагсаа.' },
      { label: 'Таск түвшний задаргаа', prompt: '44-р төслийн таск түвшний задаргааг (блок→зураг→эд анги→таск) харуул.' },
    ],
  },
  {
    title: 'Миний ажил',
    audience: 'all',
    items: [{ label: 'Миний таскууд', prompt: 'Миний өнөөдөр хийх, тайлагнах ажлуудыг харуул.' }],
  },
  {
    title: 'Захидлын бүртгэл',
    audience: 'all',
    items: [
      { label: 'Захидлын бүртгэл', prompt: '44-р төслийн захидлын бүртгэлийг (RFI/CR/албан) харуул.' },
    ],
  },
  {
    title: 'Тоо хэмжээ (QTO)',
    audience: 'staff',
    items: [
      { label: 'Төслийн тоо хэмжээ', prompt: '44-р төслийн материалын тоо хэмжээг (нийт жин, эзлэхүүн, профилийн задаргаа) харуул.' },
      { label: 'Ган төмрийн жин', prompt: '44-р төслийн ган хийцийн нийт жинг профиль тус бүрээр задалж өг.' },
      { label: 'Загварын шалгалт', prompt: '44-р төслийн IFC загварын шалгалтын дүнг тайлбарла — ямар алдаа, анхааруулга байна, загвар хэр цэвэр зурагдсан бэ?' },
      { label: 'Хувилбарын зөрүү', prompt: '44-р төслийн сүүлийн хоёр QTO тооцооллыг харьцуулаад материалын өөрчлөлтийг тайлбарла — зураач юу өөрчилсөн бэ?' },
    ],
  },
  {
    title: 'Компанийн тойм',
    audience: 'staff',
    items: [
      { label: 'Ерөнхий тойм', prompt: 'Компанийн өнөөдрийн ерөнхий байдлыг (төслүүд, явц, багууд) тоймлож өг.' },
    ],
  },
  {
    title: 'Ирц ба ажиллах хүч',
    audience: 'manager',
    items: [
      { label: 'Өнөөдрийн ирц', prompt: 'Өнөөдөр хэн ирсэн, хэн хоцорсон, хэн чөлөөтэй вэ?' },
      { label: 'Өнөөдрийн идэвхтэй төслүүд', prompt: 'Өнөөдөр баг ямар төслүүд дээр ажиллаж байна вэ?' },
      { label: 'Тодорхой өдрийн ажил', prompt: '6-р сарын 5-нд хэн ямар төсөл дээр ажилласан бэ?' },
      { label: 'Хүний ирц + идэвхжил', prompt: 'Бат сүүлийн сард хэр ирсэн, хэр идэвхтэй (оноо, бичлэг) байсан бэ?' },
      { label: 'Сахилгын чиг хандлага', prompt: 'Ажиллах хүчний сахилга сайжирч байна уу, хэн сул байна вэ?' },
      { label: 'Батлах хүлээлгийн жагсаалт', prompt: 'Батлагдахыг хүлээж буй явцын мэдүүлгүүдийг харуул.' },
    ],
  },
  {
    title: 'Гүйцэтгэх удирдлага (CEO)',
    audience: 'admin',
    items: [
      { label: 'Гүйцэтгэх товч', prompt: 'Компанийн өнөөдрийн гүйцэтгэх товчийг (executive summary) гаргаж өг.' },
      { label: 'Төслийн эрсдэл', prompt: 'Аль төслүүд эрсдэлтэй/хоцорч байна, яагаад вэ?' },
      { label: 'Бүтээмжийн чиг', prompt: 'Бүтээмж хурдасч байна уу, хэн манлайлж, хэн ухарч байна вэ?' },
      { label: 'Борлуулалтын funnel', prompt: 'Үнийн саналын funnel, win-rate болон дуусах гэж буй саналуудыг харуул.' },
      { label: 'Үнийн саналууд', prompt: 'Нээлттэй болон хугацаа дуусаж буй үнийн саналуудыг харуул.' },
    ],
  },
  {
    title: 'Имэйл',
    audience: 'admin',
    items: [
      { label: 'Имэйл жагсаалт', prompt: 'Сүүлд ирсэн имэйлүүдийг харуул.' },
      { label: 'Имэйл унших', prompt: 'Энэ имэйлийг бүтнээр уншуулж, товч агуулгыг хэлж өг.' },
      { label: 'Имэйл ангилах (бичих)', prompt: 'Энэ имэйлийг зөв төсөлд official болгож бүртгэ — эхлээд preview, баталгаажуулсны дараа бичээрэй.' },
      { label: 'Хариу ноорог', prompt: 'Энэ имэйлд эелдэг, мэргэжлийн хариу ноорог бичээд өг (илгээхгүй).' },
    ],
  },
  {
    title: 'Хурал',
    audience: 'admin',
    items: [
      { label: 'Хурлын жагсаалт', prompt: 'Сүүлийн хурлуудыг жагсаа.' },
      { label: 'Хурлын дүгнэлт', prompt: `Энэ хурлын тэмдэглэлийг уншаад гол шийдвэр, action item-уудыг гаргаж, ${org} рүү буцаан хадгал.` },
      { label: 'Action item → даалгавар', prompt: 'Сүүлийн хурлын action item-уудаас хариуцагчтай нь даалгавар үүсгэ — эхлээд preview харуулж, баталгаажуулсны дараа бичээрэй.' },
    ],
  },
];

export default function McpGuidePage() {
  const { user } = useAuth();
  const [copied, setCopied] = useState<string | null>(null);
  const { appName } = useBrand();

  // Deploy бүрийн бодит worker origin — `shared/api/apiHost.ts` дахь нэг л
  // шийдвэрлэгчийг дахин ашиглана.
  const MCP_URL = `${resolveApiHost()}/mcp`;
  const CODE_CMD = `claude mcp add --transport http ${mcpServerSlug(appName)} ${MCP_URL}`;
  const REMOTE_CMD = `npx mcp-remote ${MCP_URL} --header "Authorization: Bearer <token>"`;

  // Бүх staff үзнэ; client /client shell-д амьдардаг тул энд ирэхгүй ч
  // хамгаалалтыг үлдээв.
  if (!user || user.role === 'client') {
    return <Navigate to="/app" replace />;
  }

  const visibleGroups = buildGroups(appName).filter((g) => canSee(user.role, g.audience));

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((k) => (k === key ? null : k)), 1800);
      toast.success('Хуулагдлаа');
    } catch {
      toast.error('Хуулж чадсангүй');
    }
  };

  const copyBtn = (text: string, key: string, label = 'Хуулах') => (
    <Button variant="outline" size="sm" className="shrink-0" onClick={() => copy(text, key)}>
      {copied === key ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
      {copied === key ? 'Хуулсан' : label}
    </Button>
  );

  return (
    <PageContainer>
      <PageHeader
        icon={BookOpen}
        eyebrow="Claude + MCP"
        title="MCP гарын авлага"
        description={`Claude (эсвэл MCP дэмждэг өөр AI)-г ${appName}-ийн MCP server-т холбоод доорх асуултуудыг бичихэд таны эрхийн дагуу ${appName}-ийн өгөгдлөөс шууд хариулна. Зөвхөн таны эрхээр ажиллах хэрэгслүүдийг харуулж байна.`}
      />

      {/* Холболт */}
      <Card className="border-border bg-card/60 backdrop-blur">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Plug className="h-5 w-5 text-primary" /> Холболт
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 p-3">
            <div className="min-w-0">
              <div className="text-xs font-medium text-muted-foreground">MCP server URL</div>
              <code className="mt-1 block break-all font-mono text-xs text-foreground">{MCP_URL}</code>
            </div>
            {copyBtn(MCP_URL, 'url')}
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 p-3">
            <div className="min-w-0">
              <div className="text-xs font-medium text-muted-foreground">Claude Code (терминал)</div>
              <code className="mt-1 block break-all font-mono text-xs text-foreground">{CODE_CMD}</code>
            </div>
            {copyBtn(CODE_CMD, 'cmd')}
          </div>

          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-muted-foreground">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-foreground/70">
              claude.ai (вэб / Desktop)
            </div>
            <ol className="list-decimal space-y-1 pl-4">
              <li>Settings → Connectors → «Add custom connector»</li>
              <li>
                URL талбарт дээрх <span className="font-mono">/mcp</span> хаягийг оруулаад «Connect»
              </li>
              <li>Шинэ цонхонд {appName}-ийн нэр/нууц үгээрээ нэвтэрвэл холбогдоно</li>
            </ol>
            <p className="mt-2 text-xs">
              Tool бүр таны нэвтэрсэн эрхийн дагуу ажиллана (админ бүгдийг хардаг).
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Бусад AI клиент — MCP бол нээлттэй стандарт */}
      <Card className="border-border bg-card/60 backdrop-blur">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Bot className="h-5 w-5 text-primary" /> Claude-аас гадна өөр AI холбож болох уу?
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Болно — MCP бол нээлттэй стандарт тул MCP дэмждэг ямар ч клиент яг энэ
            хаягаар холбогдоно. Аль ч AI-аар орсон эрхийн шалгалт <em>сервер талд</em>{' '}
            хийгддэг тул хэн нэвтэрснээс л юу харагдах нь шийдэгдэнэ.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <span className="font-medium text-foreground">ChatGPT</span> (Plus/Pro/Business) —
              Settings → Apps → Advanced settings → «Developer mode» асаагаад MCP server URL-ийг
              нэмнэ; манай OAuth нэвтрэлт шууд ажиллана.
            </li>
            <li>
              <span className="font-medium text-foreground">Cursor / VS Code Copilot / Windsurf</span>{' '}
              — <span className="font-mono text-xs">mcp.json</span>-д URL +{' '}
              <span className="font-mono text-xs">Authorization: Bearer &lt;token&gt;</span> header.
            </li>
            <li>
              <span className="font-medium text-foreground">Gemini CLI</span> —{' '}
              <span className="font-mono text-xs">settings.json → mcpServers</span> дотор{' '}
              <span className="font-mono text-xs">httpUrl</span> + headers.
            </li>
          </ul>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 p-3">
            <div className="min-w-0">
              <div className="text-xs font-medium text-muted-foreground">
                Header дэмждэггүй (stdio-only) клиентэд — гүүр
              </div>
              <code className="mt-1 block break-all font-mono text-xs text-foreground">{REMOTE_CMD}</code>
            </div>
            {copyBtn(REMOTE_CMD, 'remote')}
          </div>
          <p className="text-xs">
            Урт хугацааны (~1 жил) токеныг нэвтэрсэн үедээ{' '}
            <span className="font-mono">POST /api/auth/mcp-token</span> дуудаж авна. Токен
            алдагдвал админ <span className="font-mono">JWT_SECRET</span>-г сольж бүгдийг хүчингүй
            болгоно.
          </p>
        </CardContent>
      </Card>

      {/* Жишээ prompt-ууд — эрхийн түвшингээр шүүгдсэн */}
      {visibleGroups.map((g, gi) => (
        <Card key={g.title} className="border-border bg-card/60 backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" /> {g.title}
              <Badge variant="outline" className={`ml-1 text-micro ${AUDIENCE_META[g.audience].cls}`}>
                {AUDIENCE_META[g.audience].label}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {g.items.map((it, ii) => {
              const key = `g${gi}i${ii}`;
              return (
                <div
                  key={key}
                  className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 p-3"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-muted-foreground">{it.label}</div>
                    <div className="mt-1 break-words text-sm text-foreground">{it.prompt}</div>
                  </div>
                  {copyBtn(it.prompt, key)}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </PageContainer>
  );
}
