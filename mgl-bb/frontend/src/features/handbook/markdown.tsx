import type { ReactNode } from 'react';

/**
 * Гарын авлагын биеийг (`body_md`) React элемент болгон хөрвүүлэх ЖИЖИГ
 * рендерлэгч.
 *
 * Яагаад жинхэнэ markdown парсер БИШ вэ:
 *  1. Энэ repo-д markdown сан огт байхгүй.  Ганц хуудасны төлөө
 *     `react-markdown` + sanitizer чирэх нь бүх chunk-ийг хөнгөн байлгах
 *     бодлоготой зөрчилдөнө (vite.config.ts-ийн manualChunks-ийг үз).
 *  2. Агуулгыг ЗӨВХӨН админ бичдэг тул синтакс нь урьдчилан мэдэгдэж байна:
 *     HR-ийн бичих зүйл бол гарчиг, дэд гарчиг, сумтай/дугаартай жагсаалт,
 *     тодруулсан үг, догол мөр — түүнээс илүү зүйл шаардлагагүй.
 *  3. `dangerouslySetInnerHTML` ОГТ ХЭРЭГЛЭХГҮЙ — бүх зүйл React node болж
 *     буцна.  Тиймээс агуулгад HTML/скрипт бичсэн ч энгийн текст болж
 *     харагдана; XSS-ийн гарц үүсэхгүй (энэ хуудас нэвтрэлтийн ард ч гэсэн
 *     ийм эрүүл ахуй үнэгүй тул орхих шалтгаангүй).
 *
 * Дэмждэг ЦОРЫН ГАНЦ синтакс:
 *   `## `     гарчиг            `### `  дэд гарчиг
 *   `- `      сумтай жагсаалт   `1. `   дугаартай жагсаалт
 *   `**тод**` мөрийн доторх тодруулга
 *   хоосон мөр = догол мөрийн заагч
 * Бусад бүхэн (`*налуу*`, `[холбоос](…)`, `> ишлэл`, кодын блок) ЗОРИУДААР
 * задлагдахгүй — түүхий текстээрээ харагдана.
 */

const BULLET = /^[-*•]\s+/;
const ORDERED = /^\d+[.)]\s+/;

/** Мөрийн дотор зөвхөн `**тод**`-ыг л таслана; үлдсэн нь энгийн текст. */
function inline(text: string, k: string): ReactNode[] {
  // split нь барих бүлэгтэй тул: тэгш индекс = энгийн, сондгой = тод.
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
    i % 2 === 1 ? (
      <strong key={`${k}-b${i}`} className="font-semibold text-foreground">
        {part}
      </strong>
    ) : (
      <span key={`${k}-t${i}`}>{part}</span>
    ),
  );
}

/** `body_md`-г React node массив болгоно (HTML руу хэзээ ч хөрвүүлэхгүй).
 *  Экспортлохгүй: энэ файл ЗӨВХӨН компонент экспортлох ёстой (Fast Refresh). */
function renderMarkdown(body: string): ReactNode[] {
  const out: ReactNode[] = [];
  let para: string[] = [];
  let items: string[] = [];
  let ordered = false;

  const flushPara = () => {
    if (para.length === 0) return;
    const k = `p${out.length}`;
    out.push(
      <p key={k} className="text-body text-muted-foreground">
        {inline(para.join(' '), k)}
      </p>,
    );
    para = [];
  };
  const flushList = () => {
    if (items.length === 0) return;
    const k = `l${out.length}`;
    const li = items.map((it, i) => <li key={`${k}-${i}`}>{inline(it, `${k}-${i}`)}</li>);
    const cls = 'text-body space-y-1 pl-5 text-muted-foreground';
    out.push(
      ordered ? (
        <ol key={k} className={`list-decimal ${cls}`}>
          {li}
        </ol>
      ) : (
        <ul key={k} className={`list-disc ${cls}`}>
          {li}
        </ul>
      ),
    );
    items = [];
  };
  const pushHeading = (text: string, sub: boolean) => {
    const k = `h${out.length}`;
    const kids = inline(text, k);
    out.push(
      sub ? (
        <h4 key={k} className="text-body pt-1 font-semibold text-foreground">{kids}</h4>
      ) : (
        <h3 key={k} className="text-section pt-2 text-foreground">{kids}</h3>
      ),
    );
  };

  for (const raw of body.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (line === '') {
      flushPara();
      flushList();
    } else if (line.startsWith('### ')) {
      flushPara();
      flushList();
      pushHeading(line.slice(4), true);
    } else if (line.startsWith('## ')) {
      flushPara();
      flushList();
      pushHeading(line.slice(3), false);
    } else if (BULLET.test(line)) {
      flushPara();
      if (ordered) flushList(); // сумтай руу шилжихэд өмнөх дугаартайг хаана
      ordered = false;
      items.push(line.replace(BULLET, ''));
    } else if (ORDERED.test(line)) {
      flushPara();
      if (!ordered) flushList();
      ordered = true;
      items.push(line.replace(ORDERED, ''));
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return out;
}

/** Хэрэглэхэд эвтэйхэн бүрхүүл — `<Markdown body={entry.body_md} />`. */
export function Markdown({ body, className }: { body: string; className?: string }) {
  if (!body.trim()) return null;
  return <div className={className ?? 'space-y-2'}>{renderMarkdown(body)}</div>;
}
