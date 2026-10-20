import { apiFetch, mediaUrl } from '@/shared/api/client';
import { cropInkUrl, signatureDisplayMm } from '@/shared/lib/trimInk';
import { formatDate } from '@/shared/lib/time';
import {
  ASR_DOC_TITLE_EN,
  DOC_KIND_ROWS,
  ROW_H,
  TEMPLATE_TEAM_CODES,
  VISITED_TEAM_CELLS,
  WORK_REPORT_TEAMS,
  asrFileStem,
  asrHeaderDocNo,
  headerDate,
  tableDate,
  templateTeamLabel,
} from './asrTemplate';
import { asrProjectLabel, asrProjectName } from './asrProjectName';
import {
  MEETING_LABEL,
  meetingFooter,
  meetingParticipants,
  meetingPartiesText,
  meetingRequestSections,
  meetingSigner,
  participantLine,
  type PrintedRequestSection,
} from './meetingDoc';
import { photoStamp, photoStampLine } from './photoStamp';
import { asrInfoRows, type AsrInfoRow } from './projectInfo';
import {
  ASR_REPORT_TYPES,
  REPORT_TYPE_LABEL_MN,
  meetingTimeRange,
  redBookStatusOf,
  reportTypeOf,
  usesMeetingForm,
  type AsrDetailResponse,
  type AsrDocKind,
  type AsrReportType,
} from './types';

/**
 * Зохиогчийн хяналтын тайланг WORD (.docx) болгож татна.
 *
 * ⚠️ ХУУДСЫГ HTML-ЭЭС ХӨРВҮҮЛДЭГГҮЙ — `YYMMDD_PROJECT ID_ASR_BA_001.docx`
 *    ЗАГВАРЫГ ӨӨРИЙГ НЬ бөглөнө.  Гүйцэтгэлийн тайлан (`performanceReports.ts`)
 *    Browser Rendering + `html-to-docx`-оор хэвлэх хуудсаа хөрвүүлдэг; тэр зам
 *    чөлөөт бүтэцтэй тайланд тохирдог ч энэ баримт бол багуудын 12×15 нүдтэй
 *    Word маягт — хөрвүүлэгч gridSpan/vMerge/дүүргэлтийг алдаж, «загвар шиг
 *    биш» Word гаргадаг.  Загварыг бөглөвөл гарах файл нь ажилтнуудын гараар
 *    бөглөдөг файлтай ЯГ ижил бүтэцтэй (мөрийн өндөр, фонт, хүрээ, толгой).
 *
 * Хэрхэн: .docx нь ZIP; `word/document.xml` дотор ГАНЦ хүснэгт (15 мөр),
 * `word/header1.xml` дотор running толгой.  Загварын мөр/нүдний ДАРААЛАЛ
 * тогтмол тул нүдийг индексээр нь олж, tcPr-ыг (өргөн, дүүргэлт, хүрээ)
 * ХЭВЭЭР үлдээгээд зөвхөн догол мөрийг нь солино.  Зургийг `word/media/`-д
 * нэмж, rels + [Content_Types] шинэчилнэ.  Загварт ХЭЗЭЭ Ч БАЙХГҮЙ хоёр
 * блок (төслийн мэдээлэл — эзний шийдвэрээр маягтын ДЭЭР; улаан дэвтэр —
 * маягтын ДООР) тусдаа хүснэгт болж орно — `AsrDocument.tsx`-ийн яг тэр
 * зарчим, ингэснээр 12×15 сүлжээ хөндөгдөхгүй.
 *
 * ⚠️ Загвар нь `frontend/public/asr-template.docx` — репогийн үндсэн дэх
 *    `YYMMDD_PROJECT ID_ASR_BA_001.docx`-ийн хуулбар.  Загварыг солих бол
 *    ХОЁУЛАНГ нь солиод `asrTemplate.ts`-ийн twip тоог дахин уншина; доорх
 *    мөрийн индексүүд (`ROW`) 15 мөрийн ДАРААЛАЛД тулгуурладаг.
 *
 * Хэвлэх хуудастай ижил ЭХ СУРВАЛЖ: ХАДГАЛАГДСАН мөр (`GET /author-supervision/:id`)
 * ба төслийн нэр (`GET /projects/:id`) — засварлагчийн хадгалаагүй төлөв биш.
 * XML-ийг мөр (string) дээр боловсруулна: DOMParser-оор namespace-тэй OOXML
 * угсрах нь `pic:`/`a:` угтварын тунхаглалаас болж эмзэг; загварт хүснэгт
 * ҮҮРЛЭДЭГГҮЙ тул `<w:tr>…</w:tr>` / `<w:tc>…</w:tc>` тааруулалт найдвартай.
 */

/* ------------------------------------------------------------------ */
/*  OOXML туслахууд                                                    */
/* ------------------------------------------------------------------ */

const EMU_PER_MM = 36000;
const mmEmu = (mm: number) => Math.round(mm * EMU_PER_MM);

/** XML 1.0-д хориотой удирдах тэмдэгт (tab/LF/CR-аас бусад) — байвал Word
 *  «файл эвдэрсэн» гэнэ.  Код цэгээр шүүнэ (regex-д `no-control-regex`). */
function isXmlControl(code: number): boolean {
  return code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d;
}

function esc(s: string): string {
  let clean = '';
  for (const ch of s) if (!isXmlControl(ch.codePointAt(0) ?? 0)) clean += ch;
  return clean
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Загварын дата нүдний фонт: Arial 9pt (sz=18). */
const RPR_DATA =
  '<w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Gulim" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/><w:lang w:val="mn-MN"/></w:rPr>';
/** Checkbox-той нүд: Arial 9pt, тэмдэгтийн өргөн 80% (загварын w:w=80). */
const RPR_CHECK =
  '<w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Gulim" w:hAnsi="Arial" w:cs="Arial"/><w:bCs/><w:w w:val="80"/><w:sz w:val="18"/><w:szCs w:val="18"/><w:lang w:val="mn-MN"/></w:rPr>';
/** Шошгын нүд: Arial 8pt тод цагаан. */
const RPR_LABEL =
  '<w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Gulim" w:hAnsi="Arial" w:cs="Arial"/><w:b/><w:bCs/><w:color w:val="FFFFFF"/><w:sz w:val="16"/><w:szCs w:val="16"/><w:lang w:val="mn-MN"/></w:rPr>';
/** Гарын үсгийн мөрийн нэр: Arial Narrow 8pt. */
const RPR_SIGN =
  '<w:rPr><w:rFonts w:ascii="Arial Narrow" w:eastAsia="Gulim" w:hAnsi="Arial Narrow"/><w:sz w:val="16"/><w:szCs w:val="16"/><w:lang w:val="mn-MN"/></w:rPr>';
/** Ажлын тайлангийн багийн шошго: Arial 8pt тод. */
const RPR_NOTE_TEAM =
  '<w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Gulim" w:hAnsi="Arial" w:cs="Arial"/><w:b/><w:bCs/><w:sz w:val="16"/><w:szCs w:val="16"/><w:lang w:val="mn-MN"/></w:rPr>';
/** Зургийн тэмдэг (дугаар · огноо · шифр · ЗХ дугаар): Arial 6.5pt саарал. */
const RPR_PHOTO_STAMP =
  '<w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Gulim" w:hAnsi="Arial" w:cs="Arial"/><w:color w:val="4B5563"/><w:sz w:val="13"/><w:szCs w:val="13"/><w:lang w:val="mn-MN"/></w:rPr>';
/** Толгой: Arial Narrow (хэмжээ нь Header загвараас). */
const RPR_HEAD =
  '<w:rPr><w:rFonts w:ascii="Arial Narrow" w:hAnsi="Arial Narrow"/><w:szCs w:val="20"/></w:rPr>';

type Jc = 'left' | 'center' | 'right';

function run(text: string, rpr = RPR_DATA): string {
  // Мөр таслалтыг <w:br/>-ээр — олон мөрт тайлбар нэг догол мөрөнд үлдэнэ.
  const parts = text.replace(/\r\n?/g, '\n').split('\n');
  return parts
    .map(
      (line, i) =>
        `${i > 0 ? `<w:r>${rpr}<w:br/></w:r>` : ''}<w:r>${rpr}<w:t xml:space="preserve">${esc(line)}</w:t></w:r>`,
    )
    .join('');
}

/** Wingdings F06F = ☐ (загварынх), F0FE = ☒. */
function box(on: boolean, rpr = RPR_CHECK): string {
  return `<w:r>${rpr}<w:sym w:font="Wingdings" w:char="${on ? 'F0FE' : 'F06F'}"/></w:r>`;
}

function para(
  runs: string,
  opts: { jc?: Jc; rpr?: string; spacing?: string; tabs?: string; keepNext?: boolean } = {},
): string {
  const jc = opts.jc ? `<w:jc w:val="${opts.jc}"/>` : '';
  const spacing = opts.spacing ?? '';
  // ⚠️ pPr-ийн ДАРААЛАЛ схемээр хатуу: tabs → snapToGrid → spacing → jc → rPr.
  //    Буруу дараалалд Word «уншигдахгүй агуулга» гэж сэрэмжлүүлдэг.
  const tabs = opts.tabs ?? '';
  const keep = opts.keepNext ? '<w:keepNext/>' : '';
  return `<w:p><w:pPr>${keep}${tabs}<w:snapToGrid w:val="0"/>${spacing}${jc}${opts.rpr ?? RPR_DATA}</w:pPr>${runs}</w:p>`;
}

/**
 * Хар-хөх шошгын нүд бүрийн голлуулсан догол мөрийг зүүн тийш (эзэн 2026-09-30:
 * «бүх хүснэгтийн цагаан бичвэр зүүн талаасаа эхэлнэ»).  Загвар (`asr-template.docx`)
 * Шифр, Тайлбар, Хяналтаар явсан, Шалгасан, мөн гарын үсгийн толгойн
 * (Хяналт хийсэн / Овог, Нэр / Гарын үсэг / Огноо) шошгыг `jc=center`-ээр
 * хадгалсан.  Утгын нүд (Төслийн нэр, огноо, нэр, гарын үсэг) ХӨНДӨГДӨХГҮЙ —
 * зөвхөн `0F243E` дүүргэлттэй нүд.  Загварын мөрд үүрлэсэн хүснэгт байхгүй
 * (мөр бүр `<w:tr>…</w:tr>` нэг regex-ээр салдаг) тул нүд бүрийн regex аюулгүй.
 */
function leftAlignLabelCells(rowXml: string): string {
  return rowXml.replace(/<w:tc>[\s\S]*?<\/w:tc>/g, (cell) =>
    /w:fill="0F243E"/i.test(cell)
      ? cell.replace(/<w:jc w:val="center"\/>/g, '<w:jc w:val="left"/>')
      : cell,
  );
}

/** Нүдний tcPr-ыг ХЭВЭЭР үлдээж, догол мөрүүдийг солино. */
function setCell(cellXml: string, paragraphs: string): string {
  const m = cellXml.match(/^<w:tc>(<w:tcPr>[\s\S]*?<\/w:tcPr>)/);
  if (!m) throw new Error('asr-docx: нүдэнд tcPr алга');
  return `<w:tc>${m[1]}${paragraphs}</w:tc>`;
}

/* ------------------------------------------------------------------ */
/*  Зураг                                                              */
/* ------------------------------------------------------------------ */

interface DocxImage {
  /** `word/media/<name>` */
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
  ext: 'png' | 'jpeg';
  widthPx: number;
  heightPx: number;
  rId: string;
}

let imageSeq = 0;
let docPrSeq = 100;

/**
 * Зургийг татаж, хэмжээг нь уншина.  PNG/JPEG-ийг байтаар нь хэвээр
 * (дахин кодлохгүй — 5 MB JPEG PNG болбол 20 MB), бусад форматыг (webp, heic…)
 * canvas-аар PNG болгоно — Word тэднийг ойлгодоггүй.
 */
async function loadImage(src: string, alreadyDataUrl = false): Promise<DocxImage | null> {
  try {
    const res = await fetch(src, alreadyDataUrl ? undefined : { mode: 'cors' });
    if (!res.ok) return null;
    let blob = await res.blob();
    let ext: 'png' | 'jpeg';
    if (blob.type === 'image/png') ext = 'png';
    else if (blob.type === 'image/jpeg' || blob.type === 'image/jpg') ext = 'jpeg';
    else {
      const bmp = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      canvas.getContext('2d')?.drawImage(bmp, 0, 0);
      bmp.close();
      blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png'),
      );
      ext = 'png';
    }
    const bmp = await createImageBitmap(blob);
    const bytes = new Uint8Array(await blob.arrayBuffer()) as Uint8Array<ArrayBuffer>;
    // ⚠️ Дугаарыг БҮХ await-ын ДАРАА нэг удаа авна: зургууд зэрэг татагддаг тул
    //    объектын дунд await байвал өөр зураг тоолуурыг зөөж, хоёр зураг нэг
    //    rId авдаг (2026-09-11 хэмжсэн: rIdAsr3 давхардаж Word нээгддэггүй).
    const n = ++imageSeq;
    const img: DocxImage = {
      name: `asr${n}.${ext}`,
      bytes,
      ext,
      widthPx: bmp.width,
      heightPx: bmp.height,
      rId: `rIdAsr${n}`,
    };
    bmp.close();
    return img;
  } catch {
    return null;
  }
}

/** Гарын үсэг — бэхийг тайрч (хэвлэх хуудасны `HandSignature`-тэй ижил). */
async function loadSignature(url: string): Promise<DocxImage | null> {
  const abs = mediaUrl(url);
  const cropped = await cropInkUrl(abs).catch(() => null);
  return cropped ? loadImage(cropped, true) : loadImage(abs);
}

/** Зургийг `maxW × maxH` мм хайрцагт багтаах хэмжээ (харьцаа хадгална). */
function fitMm(img: DocxImage, maxW: number, maxH: number): { w: number; h: number } {
  const r = img.widthPx / img.heightPx;
  let w = maxW;
  let h = w / r;
  if (h > maxH) {
    h = maxH;
    w = h * r;
  }
  return { w, h };
}

/** Гарын үсэг: A4 баримтын ЖИГД хэмжээ (`signatureDisplayMm` — хэвлэх хуудасны
 *  `HandSignature fitToInk="document"`-тэй ижил: өндөр ≈ 12 мм, өргөн ≤ 44 мм),
 *  нүднээс том бол л багасгана.  Бэх тайрагдаж тунгалаг PNG болсон (`loadSignature`). */
function fitSignature(img: DocxImage, maxW: number, maxH: number): { w: number; h: number } {
  const n = signatureDisplayMm(img.widthPx, img.heightPx);
  if (!n) return fitMm(img, maxW, maxH);
  const k = Math.min(1, maxW / n.widthMm, maxH / n.heightMm);
  return { w: n.widthMm * k, h: n.heightMm * k };
}

function drawingRun(img: DocxImage, wMm: number, hMm: number): string {
  const id = ++docPrSeq;
  const cx = mmEmu(wMm);
  const cy = mmEmu(hMm);
  return (
    `<w:r><w:rPr><w:noProof/></w:rPr><w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${id}" name="Picture ${id}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${esc(img.name)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${img.rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
  );
}

/**
 * Хөвөгч зураг (wrapNone) — тэмдэгтээс `offXmm`, мөрөөс `offYmm` зайд.  Оффис
 * уулзалтын хөлийн гарын үсэг цэгтэй шугамын ДЭЭР (хэвлэх хуудасны
 * `.asr-mf-dots img`-тэй ижил) — inline зураг мөрийн өндрийг 12мм болгож
 * шугамыг доош түлхдэг байв.
 */
function anchoredDrawingRun(
  img: DocxImage,
  wMm: number,
  hMm: number,
  offXmm: number,
  offYmm: number,
): string {
  const id = ++docPrSeq;
  const cx = mmEmu(wMm);
  const cy = mmEmu(hMm);
  return (
    `<w:r><w:rPr><w:noProof/></w:rPr><w:drawing>` +
    `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${251659264 + id}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
    `<wp:simplePos x="0" y="0"/>` +
    `<wp:positionH relativeFrom="character"><wp:posOffset>${mmEmu(offXmm)}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="line"><wp:posOffset>${mmEmu(offYmm)}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>` +
    `<wp:docPr id="${id}" name="Signature ${id}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${esc(img.name)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${img.rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`
  );
}

/* ------------------------------------------------------------------ */
/*  Загварт байхгүй хоёр блок — тусдаа хүснэгт                          */
/* ------------------------------------------------------------------ */

/** Хүснэгтийн бүтэн өргөн twip (загварын tblGrid нийлбэр). */
const GRID_TOTAL_TWIP = 9802;
const INFO_LABEL_TWIP = Math.round(GRID_TOTAL_TWIP * 0.26);
const INFO_VALUE_TWIP = GRID_TOTAL_TWIP - INFO_LABEL_TWIP;

const TBL_BORDERS =
  '<w:tblBorders><w:top w:val="single" w:sz="12" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="12" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="12" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="12" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders>';

/** Оффис уулзалтын хөл / «Тайлбар»: Arial 10.5pt (энгийн, тод). */
const RPR_FOOT =
  '<w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Gulim" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="mn-MN"/></w:rPr>';
const RPR_FOOT_B =
  '<w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Gulim" w:hAnsi="Arial" w:cs="Arial"/><w:b/><w:bCs/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="mn-MN"/></w:rPr>';

/**
 * Оффис уулзалтын хөл (2026-10-12) — хэвлэх хуудасны `MeetingFooterBlock`-ийн ихэр:
 * «MGL E&C LLC Талаас Хуралд оролцсон:» → хүн бүрд байгууллагын мөр + «албан тушаал
 * нэр ………» (цэгтэй таб), гарын үсгийн зураг байвал цэгийн өмнө → захиалагчийн
 * төлөөлөгч → огноо.  Хүснэгтийн ДООР энгийн догол мөрүүд.
 */
function meetingFooterXml(
  f: ReturnType<typeof meetingFooter>,
  reportDate: string,
  sigOur: DocxImage | null,
  sigClient: DocxImage | null,
): string {
  const DOTS = '<w:tabs><w:tab w:val="left" w:leader="dot" w:pos="8200"/></w:tabs>';
  // Гарчиг дараагийн мөртэйгээ, захиалагчийн хэсэг огноотойгоо нэг хуудсанд (keepNext).
  const head = (text: string, before: number) =>
    para(run(text, RPR_FOOT_B), {
      rpr: RPR_FOOT_B,
      jc: 'left',
      keepNext: true,
      spacing: `<w:spacing w:before="${before}" w:after="120"/>`,
    });
  const person = (
    p: { orgLine: string; nameLine: string; signatureUrl: string | null },
    sig: DocxImage | null,
    keepWithNext = false,
  ) => {
    const hasSig = !!(sig && p.signatureUrl);
    // Гарын үсэг дээшээ ~10мм цухуйна — хөвөгч зураг мөрийн өндрийг тэлэхгүй тул
    // хүний блокийн ДЭЭД талд зай (хэвлэлтийн `.asr-mf-person` padding-top).
    const org = p.orgLine
      ? para(run(p.orgLine, RPR_FOOT), {
          jc: 'left',
          keepNext: true,
          spacing: `<w:spacing w:before="${hasSig ? 300 : 0}" w:after="0"/>`,
        })
      : '';
    // Гарын үсэг нэрийн ард, цэгтэй шугамын эхнээс ~12мм баруунд, доод хэсэг нь
    // шугамыг ~2.5мм давна (хэвлэлтийн `.asr-mf-dots img`).
    let sigRun = '';
    if (sig && hasSig) {
      const fit = fitSignature(sig, 44, 15);
      sigRun = anchoredDrawingRun(sig, fit.w, fit.h, 12, 4.4 + 2.5 - fit.h);
    }
    return (
      org +
      para(`${run(p.nameLine, RPR_FOOT)}${sigRun}<w:r>${RPR_FOOT}<w:tab/></w:r>`, {
        jc: 'left',
        tabs: DOTS,
        keepNext: keepWithNext,
        spacing: `<w:spacing w:before="${hasSig && !p.orgLine ? 300 : 20}" w:after="200"/>`,
      })
    );
  };
  return (
    head(f.ourHead, 360) +
    f.our.map((p) => person(p, sigOur)).join('') +
    head(f.clientHead, 240) +
    person(f.client ?? { orgLine: '', nameLine: '', signatureUrl: null }, sigClient, true) +
    para(run(tableDate(reportDate), RPR_FOOT), {
      jc: 'left',
      spacing: '<w:spacing w:before="360" w:after="0"/>',
    })
  );
}

/** Хүсэлтийн хүснэгтийн гарчиг («0.1 Захиалагч»): Arial 10pt тод. */
const RPR_REQ_HEAD =
  '<w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Gulim" w:hAnsi="Arial" w:cs="Arial"/><w:b/><w:bCs/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="mn-MN"/></w:rPr>';
/** Хүсэлтийн хүснэгтийн толгой: Arial 9pt тод. */
const RPR_REQ_TH =
  '<w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Gulim" w:hAnsi="Arial" w:cs="Arial"/><w:b/><w:bCs/><w:sz w:val="18"/><w:szCs w:val="18"/><w:lang w:val="mn-MN"/></w:rPr>';
/** № · Хүсэлт гаргагч · Тайлбар — хэвлэх хуудасны 8 / 18 / 74 %. */
const REQ_COLS = [770, 1730, 7100] as const;

/**
 * Оффис уулзалтын хүсэлтийн хүснэгтүүд (0396) — «Уулзалтын агуулга»-ын бичих
 * нүдэн ДОТОРХ хүснэгт (Word нүдэнд хүснэгт үүрлүүлэхийг зөвшөөрдөг; нүд
 * заавал догол мөрөөр төгсөх ёстой тул дуудагч ард нь `para`-г залгана).
 * Хэвлэх хуудасны ихэр `AsrDocument.tsx` `MeetingRequestTable`.
 *
 * ⚠️ Энэ XML нь `leftAlignLabelCells` / мөр задлах regex-ээс ХОЙНО (`patchRow`
 *    дотор) орно — үүрлэсэн `<w:tr>` загварын мөрийн тоололд хэзээ ч ороогүй.
 */
/** Мөр / «Тайлбар»-ын ард хавсаргасан зураг — бичвэрийн доор, догол мөр тус бүрд нэг. */
function itemImagesXml(
  urls: string[],
  imgs: Map<string, DocxImage | null>,
  maxW: number,
  maxH: number,
): string {
  return urls
    .map((u) => imgs.get(u))
    .filter((img): img is DocxImage => !!img)
    .map((img) => {
      const f = fitMm(img, maxW, maxH);
      return para(drawingRun(img, f.w, f.h), {
        jc: 'left',
        spacing: '<w:spacing w:before="40" w:after="40"/>',
      });
    })
    .join('');
}

function meetingRequestXml(
  sections: PrintedRequestSection[],
  imgs: Map<string, DocxImage | null>,
): string {
  const cell = (twip: number, body: string, extra = '', vAlign = 'center') =>
    `<w:tc><w:tcPr><w:tcW w:w="${twip}" w:type="dxa"/>${extra}<w:vAlign w:val="${vAlign}"/></w:tcPr>${body}</w:tc>`;
  return sections
    .map((sec) => {
      const head = para(run(sec.heading, RPR_REQ_HEAD), {
        rpr: RPR_REQ_HEAD,
        spacing: '<w:spacing w:before="120" w:after="60"/>',
      });
      const intro = sec.intro
        ? para(run(sec.intro), {
            jc: 'left',
            spacing: '<w:spacing w:after="60"/><w:ind w:left="227"/>',
          })
        : '';
      const th = (twip: number, text: string) =>
        cell(twip, para(run(text, RPR_REQ_TH), { jc: 'center', rpr: RPR_REQ_TH }));
      const headRow =
        `<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>` +
        th(REQ_COLS[0], MEETING_LABEL.requestNo) +
        th(REQ_COLS[1], MEETING_LABEL.requestBy) +
        th(REQ_COLS[2], MEETING_LABEL.requestText) +
        `</w:tr>`;
      const items = sec.items.length > 0 ? sec.items : [{ text: '', images: [] }];
      const bodyRows = items
        .map(
          (item, i) =>
            // Зурагтай мөр хуудаснаас өндөр байж болно — `cantSplit` бол Word тайрна.
            `<w:tr><w:trPr>${item.images.length ? '' : '<w:cantSplit/>'}</w:trPr>` +
            cell(REQ_COLS[0], para(run(sec.items.length ? String(i + 1) : '—'), { jc: 'center' })) +
            cell(
              REQ_COLS[1],
              i === 0 ? para(run(sec.sideLabel), { jc: 'center' }) : para(''),
              `<w:vMerge${i === 0 ? ' w:val="restart"' : ''}/>`,
            ) +
            cell(
              REQ_COLS[2],
              // Тайлбарын нүд ≈ 125мм − дотор зай; зураг бичвэрийн доор.
              para(run(item.text), { jc: 'left' }) + itemImagesXml(item.images, imgs, 115, 60),
              '',
              'top',
            ) +
            `</w:tr>`,
        )
        .join('');
      // Хөлийн хар-хөх мөр — жишээ баримтын хэлбэр.
      const footRow =
        `<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="340" w:hRule="exact"/></w:trPr>` +
        REQ_COLS.map(
          (w) =>
            `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="0F243E"/></w:tcPr>${para('')}</w:tc>`,
        ).join('') +
        `</w:tr>`;
      const tblXml =
        `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>` +
        `<w:tblBorders><w:top w:val="single" w:sz="8" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="8" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="8" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="8" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders>` +
        `<w:tblLayout w:type="fixed"/>` +
        `<w:tblCellMar><w:top w:w="28" w:type="dxa"/><w:left w:w="85" w:type="dxa"/><w:bottom w:w="28" w:type="dxa"/><w:right w:w="85" w:type="dxa"/></w:tblCellMar>` +
        `<w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="0"/></w:tblPr>` +
        `<w:tblGrid>${REQ_COLS.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>` +
        headRow +
        bodyRows +
        footRow +
        `</w:tbl>`;
      return head + intro + tblXml;
    })
    .join('');
}

/** Шошго + агуулга (runs XML) хоёр баганатай блок — мэдээлэл ба улаан дэвтэр. */
function infoTable(rows: { label: string; runs: string; jc?: Jc }[]): string {
  if (rows.length === 0) return '';
  const trs = rows
    .map(
      (r) =>
        `<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="246"/></w:trPr>` +
        `<w:tc><w:tcPr><w:tcW w:w="${INFO_LABEL_TWIP}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="0F243E"/><w:vAlign w:val="center"/></w:tcPr>${para(run(r.label, RPR_LABEL), { rpr: RPR_LABEL })}</w:tc>` +
        `<w:tc><w:tcPr><w:tcW w:w="${INFO_VALUE_TWIP}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>${para(r.runs, { jc: r.jc ?? 'left' })}</w:tc>` +
        `</w:tr>`,
    )
    .join('');
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>${TBL_BORDERS}` +
    `<w:tblCellMar><w:left w:w="57" w:type="dxa"/><w:right w:w="57" w:type="dxa"/></w:tblCellMar>` +
    `<w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="0"/></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="${INFO_LABEL_TWIP}"/><w:gridCol w:w="${INFO_VALUE_TWIP}"/></w:tblGrid>${trs}</w:tbl>`
  );
}

/** Хоёр хүснэгтийн хоорондох 2.5мм зай — Word зэрэгцсэн хүснэгтийг нэгтгэдэг
 *  тул дундаа заавал догол мөр хэрэгтэй. */
const GAP_PARA =
  '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="142" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr></w:p>';

/** Шинэ хуудас — зургийн хавсралт бүрийн өмнө. */
const PAGE_BREAK = '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:br w:type="page"/></w:r></w:p>';

/* ------------------------------------------------------------------ */
/*  Маягтын НЭМЭЛТ МӨР — төслийн мэдээлэл (2026-09-23)                  */
/* ------------------------------------------------------------------ */

/**
 * Загварын 12 багана: 1 (шошго) + 6 (утга) + 1 (шошго) + 4 (утга).  Хэвлэх
 * хуудас дээр төслийн мэдээлэл маягтын НЭГ хүснэгтэд нийлсэн (эзний
 * 2026-09-23-ны шийдвэр) тул Word-д ч тусдаа хүснэгт БИШ, загварын эхний
 * мөрийн хэлбэрээр мөр НЭМНЭ.
 *
 * ⚠️ tcPr-ыг загвараас хуулахгүй, ЭНД ИЛ бичнэ: эхний мөрийн нүднүүд `top`
 *    талдаа ЗУЗААН (sz=12) гадна хүрээтэй бөгөөд түүнийг хуулбарлавал
 *    хүснэгтийн дунд зузаан зураас гарна.  gridSpan-ийн нийлбэр ЗААВАЛ 12
 *    (эс бөгөөс Word хүснэгтийг эвдэрсэн гэж үзнэ).
 */
const FORM_LBL_L = `<w:tcPr><w:tcW w:w="674" w:type="pct"/><w:tcBorders><w:left w:val="single" w:sz="12" w:space="0" w:color="auto"/></w:tcBorders><w:shd w:val="clear" w:color="auto" w:fill="0F243E"/><w:vAlign w:val="center"/></w:tcPr>`;
const FORM_VAL_L = `<w:tcPr><w:tcW w:w="1992" w:type="pct"/><w:gridSpan w:val="6"/><w:vAlign w:val="center"/></w:tcPr>`;
const FORM_LBL_R = `<w:tcPr><w:tcW w:w="626" w:type="pct"/><w:shd w:val="clear" w:color="auto" w:fill="0F243E"/><w:vAlign w:val="center"/></w:tcPr>`;
const FORM_VAL_R = `<w:tcPr><w:tcW w:w="1708" w:type="pct"/><w:gridSpan w:val="4"/><w:tcBorders><w:right w:val="single" w:sz="12" w:space="0" w:color="auto"/></w:tcBorders><w:vAlign w:val="center"/></w:tcPr>`;
/** Бүтэн өргөн утга — 6 + 1 + 4 = 11 багана. */
const FORM_VAL_WIDE = `<w:tcPr><w:tcW w:w="4326" w:type="pct"/><w:gridSpan w:val="11"/><w:tcBorders><w:right w:val="single" w:sz="12" w:space="0" w:color="auto"/></w:tcBorders><w:vAlign w:val="center"/></w:tcPr>`;

const tc = (tcPr: string, paragraphs: string) => `<w:tc>${tcPr}${paragraphs}</w:tc>`;
const lblCell = (tcPr: string, text: string) =>
  tc(tcPr, para(run(text, RPR_LABEL), { rpr: RPR_LABEL }));

/** Маягтын нэг мөр: хос шошго/утга, эсвэл бүтэн өргөнтэй ганц утга. */
function formRow(left: AsrInfoRow, right: AsrInfoRow | null, full: boolean): string {
  const cells =
    full || !right
      ? lblCell(FORM_LBL_L, left.label) + tc(FORM_VAL_WIDE, para(run(left.value)))
      : lblCell(FORM_LBL_L, left.label) +
        tc(FORM_VAL_L, para(run(left.value))) +
        lblCell(FORM_LBL_R, right.label) +
        tc(FORM_VAL_R, para(run(right.value)));
  return `<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="246"/></w:trPr>${cells}</w:tr>`;
}

/**
 * «Хяналтын төрөл» мөр (0362) — бүтэн өргөнтэй (1 + 11), 4 Wingdings чагт,
 * ЯГ НЭГ нь тэмдэглэгдэнэ; цахим уулзалтад платформ хаалтанд.  Хэвлэх
 * хуудасны `asr-typecell` мөрийн ихэр — хоёуланг хамт өөрчил.
 */
function formTypeRow(type: AsrReportType, platform: string): string {
  const runs = ASR_REPORT_TYPES.map((k) => {
    const label =
      REPORT_TYPE_LABEL_MN[k] + (k === 'online' && type === 'online' && platform ? ` (${platform})` : '');
    return `${box(k === type)}${run(` ${label}    `, RPR_CHECK)}`;
  }).join('');
  const cells = lblCell(FORM_LBL_L, 'Хяналтын төрөл') + tc(FORM_VAL_WIDE, para(runs, { rpr: RPR_CHECK }));
  return `<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="246"/></w:trPr>${cells}</w:tr>`;
}

/** «Гэрээний дугаар» шошго — загварын «Бичиг баримтын төрөл» нүдний өргөн (gridSpan 4), vMerge-гүй. */
const CONTRACT_LBL = `<w:tcPr><w:tcW w:w="1323" w:type="pct"/><w:gridSpan w:val="4"/><w:shd w:val="clear" w:color="auto" w:fill="0F243E"/><w:vAlign w:val="center"/></w:tcPr>`;

/** Тайлбарын нүдний (≈43.8мм) нэг мөрөнд багтах 9pt кирилл тэмдэгт — өндрийн ТООЦООНД л. */
const DESC_CHARS_PER_LINE = 25;
/** Arial 9pt-ийн нэг мөр (≈1.15 × 9pt) twip-ээр. */
const DESC_LINE_TWIP = 207;

/**
 * Нүдэнд vMerge (эхлэл / үргэлжлэл) + босоо голлуулалт нэмнэ.  tcPr-ийн
 * схемийн дараалал: tcW → gridSpan → vMerge → tcBorders → shd → … → vAlign.
 * Үргэлжлэлийн нүдний агуулга Word-д харагдахгүй тул хоосон догол мөр.
 */
function mergeCell(cell: string, mode: 'restart' | 'continue'): string {
  const m = cell.match(/^<w:tc><w:tcPr>([\s\S]*?)<\/w:tcPr>([\s\S]*)<\/w:tc>$/);
  if (!m) throw new Error('asr-docx: нүдэнд tcPr алга');
  let pr = m[1]!.replace(/<w:vMerge[^>]*\/>/, '').replace(/<w:vAlign[^>]*\/>/, '');
  const anchor = pr.match(/<w:gridSpan[^>]*\/>/) ?? pr.match(/<w:tcW[^>]*\/>/);
  if (!anchor || anchor.index == null) throw new Error('asr-docx: нүдэнд tcW алга');
  const at = anchor.index + anchor[0].length;
  const vm = mode === 'restart' ? '<w:vMerge w:val="restart"/>' : '<w:vMerge/>';
  pr = `${pr.slice(0, at)}${vm}${pr.slice(at)}<w:vAlign w:val="center"/>`;
  return `<w:tc><w:tcPr>${pr}</w:tcPr>${mode === 'continue' ? para('') : m[2]}</w:tc>`;
}

/** Чагтын нүдийг босоо голлуулна — Тайлбар урт бол хэвлэлтийн адил голдоо. */
function vCenter(cell: string): string {
  return cell.replace(
    /<w:tcPr>([\s\S]*?)<\/w:tcPr>/,
    (_, pr: string) => `<w:tcPr>${pr.replace(/<w:vAlign[^>]*\/>/, '')}<w:vAlign w:val="center"/></w:tcPr>`,
  );
}

/**
 * Шифр | Гэрээний дугаар (0363) ба Тайлбар | Бичиг баримтын төрөл — хэвлэх
 * хуудасны (`AsrDocument.tsx`) ихэр, эзний хүсэлт 2026-09-29.  Загварын
 * 1–2-р мөр (Шифр / Тайлбар, хажууд нь 2 мөр дамжсан «Бичиг баримтын төрөл»)
 * ГУРВАН мөр болно (gridSpan-ийн нийлбэр мөр бүрт 12):
 *
 *   A: Шифр(1) | шифр(3) | Гэрээний дугаар(4) | дугаар(4)
 *   B: Тайлбар(1) | тайлбар(3) | Бичиг баримтын төрөл(4)  — гурвуулаа vMerge эхлэл | чагт 2+1+1
 *   C: (үргэлжлэл ×3)                                                              | чагт 2+1+1
 *
 * B ба C ИЖИЛ өндөртэй байх ёстой (эзэн).  Word vMerge-ийн илүүдэл өндрийг
 * СҮҮЛИЙН мөрөнд өгдөг тул тайлбарын мөрийн тоог ТООЦООЛЖ, хэрэгтэй өндрийг
 * хоёр мөрөнд тэнцүү хувааж тавина (trHeight = atLeast).  Тооцоо дутуу
 * гарвал л C бага зэрэг өндөр болно.  (Хэвлэх хуудсанд Chrome өөрөө тэнцүү
 * хуваадаг — хэмжсэн.)
 *
 * ⚠️ `patchRow` дууссаны ДАРАА дуудна.  `ROW`-ийн индекс хэвээр байлгахын
 *    тулд A+B нь `rows[ROW.shifr]`-д, C нь `rows[ROW.description]`-д орно.
 *    A нь шинэ `<w:tr>` (загварын мөрийн w14:paraId давхардахгүй).
 */
const cellsOf = (row: string) => row.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? [];

/** A мөр: Шифр(1) | шифр(3) | Гэрээний дугаар(4) | дугаар(4) — шинэ `<w:tr>`. */
function shifrContractRow(shifrCells: string[], contractNo: string): string {
  return (
    `<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="${ROW_H.shifr}"/></w:trPr>` +
    shifrCells[0]! +
    shifrCells[1]! +
    lblCell(CONTRACT_LBL, 'Гэрээний дугаар') +
    tc(FORM_VAL_R, para(run(contractNo))) +
    '</w:tr>'
  );
}

/**
 * Оффис уулзалт (0367, эзэн 2026-09-30) — загварын 1–2-р мөр (Шифр / Тайлбар +
 * «Бичиг баримтын төрөл»-ийн 6 чагт) ОРОНД нь: A мөр (Шифр | Гэрээний дугаар)
 * + уулзалтын мэдээллийн мөрүүд (`formRow`, gridSpan 12).  Хэвлэх хуудасны
 * `AsrDocument.tsx`-ийн `meeting` салааны ихэр.  `ROW`-ийн индекс хэвээр:
 * A нь `rows[ROW.shifr]`-д, мэдээлэл нь `rows[ROW.description]`-д.
 */
function meetingShifrRows(rows: string[], contractNo: string, meetingRows: string): void {
  const s = cellsOf(rows[ROW.shifr]!);
  if (s.length !== 6) throw new Error('asr-docx: Шифр мөрийн нүдний тоо загвартай таарахгүй');
  rows[ROW.shifr] = shifrContractRow(s, contractNo);
  rows[ROW.description] = meetingRows;
}

function restructureShifrRows(rows: string[], contractNo: string, description: string): void {
  const headOf = (row: string) => row.slice(0, row.indexOf('<w:tc>'));
  const withHeight = (head: string, twip: number) =>
    head.replace(/<w:trHeight w:val="\d+"\/>/, `<w:trHeight w:val="${twip}"/>`);
  const shifrRow = rows[ROW.shifr]!;
  const descRow = rows[ROW.description]!;
  const s = cellsOf(shifrRow);
  const d = cellsOf(descRow);
  if (s.length !== 6 || d.length !== 6)
    throw new Error('asr-docx: Шифр/Тайлбар мөрийн нүдний тоо загвартай таарахгүй');

  const lines = description
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .reduce((n, l) => n + Math.max(1, Math.ceil(l.length / DESC_CHARS_PER_LINE)), 0);
  const half = Math.max(ROW_H.shifr, Math.ceil((lines * DESC_LINE_TWIP + 40) / 2));

  const rowA = shifrContractRow(s, contractNo);
  const rowB =
    withHeight(headOf(shifrRow), half) +
    mergeCell(d[0]!, 'restart') +
    mergeCell(d[1]!, 'restart') +
    mergeCell(s[2]!, 'restart') +
    vCenter(s[3]!) +
    vCenter(s[4]!) +
    vCenter(s[5]!) +
    '</w:tr>';
  const rowC =
    withHeight(headOf(descRow), half) +
    mergeCell(d[0]!, 'continue') +
    mergeCell(d[1]!, 'continue') +
    d[2]! +
    vCenter(d[3]!) +
    vCenter(d[4]!) +
    vCenter(d[5]!) +
    '</w:tr>';
  rows[ROW.shifr] = rowA + rowB;
  rows[ROW.description] = rowC;
}

/**
 * Утга нь урт байх нь тодорхой мөрүүд — ХОСЛОХГҮЙ (хэвлэх хуудасны
 * `AsrDocument.tsx` `FULL_WIDTH_INFO`-ийн ИХЭР; хоёулаа өөрчлөгдөнө).
 */
const FULL_WIDTH_INFO = new Set(['Албан ёсны нэр', 'Байршил']);

/** Богино мөрүүдийг хосоор нь багцална (хэвлэх хуудасны `pairInfoRows`-ийн ихэр). */
function formInfoRows(rows: AsrInfoRow[]): string {
  const out: string[] = [];
  let pending: AsrInfoRow | null = null;
  const flush = () => {
    if (pending) out.push(formRow(pending, null, true));
    pending = null;
  };
  for (const r of rows) {
    if (FULL_WIDTH_INFO.has(r.label) || r.value.length > 44) {
      flush();
      out.push(formRow(r, null, true));
      continue;
    }
    if (pending) {
      out.push(formRow(pending, r, false));
      pending = null;
    } else {
      pending = r;
    }
  }
  flush();
  return out.join('');
}

/* ------------------------------------------------------------------ */
/*  Үндсэн                                                             */
/* ------------------------------------------------------------------ */

/** Загварын 15 мөрийн индекс (asrTemplate.ts-ийн ROW_H-тэй ижил дараалал). */
const ROW = {
  projectName: 0,
  shifr: 1,
  description: 2,
  visitedTeams: 3,
  checkedBy: 4,
  photos: 6,
  /** «Attachment / 1. Daily Report No.01-Photos» — 2026-09-23-аас ХАСАГДАНА. */
  attachment: 7,
  workReportTeams: 10,
  workReportBody: 11,
  /** «Ажлын тайлан» тууз — оффис уулзалтад «Уулзалтын агуулга» (0367). */
  workReportHead: 9,
  /** «Хяналт хийсэн | Овог, Нэр | Гарын үсэг | Огноо» толгой. */
  signHead: 12,
  signArch: 13,
  signSite: 14,
} as const;

/** Загварын бичих талбай 6862 twip = 121мм — Word-д нэг хуудас дүүргэдэг хэмжээ. */
const BODY_TWIP_MAX = 6862;
const BODY_TWIP_MIN = 1200;
const TWIP_PER_MM = 1 / 0.0176389;

const RED_BOOK_LABEL = {
  missing: 'Гарын үсэг дутуу',
  absent: 'Талбай дээр улаан дэвтэр байгаагүй',
  signed: 'Гарын үсэг зурагдсан (баталгаажуулалт хүлээж байна)',
  verified: 'Улаан дэвтэр баталгаажсан',
} as const;

export interface AsrDocxOptions {
  /** Хадгалагдсан тайлангийн id. */
  reportId: number;
  projectId: number;
}

/** Word баримтыг угсарч, Blob + файлын нэр буцаана.  UI-аас `downloadAsrDocx` дуудна. */
export async function buildAsrDocx(
  opts: AsrDocxOptions,
): Promise<{ blob: Blob; fileName: string }> {
  const [{ unzipSync, zipSync, strFromU8, strToU8 }, detail, project, tplRes] = await Promise.all([
    import('fflate'),
    apiFetch<AsrDetailResponse>(`/author-supervision/${opts.reportId}`),
    apiFetch<{ project: { name: string; asr_name?: string | null } }>(`/projects/${opts.projectId}`),
    fetch('/asr-template.docx'),
  ]);
  if (!tplRes.ok) throw new Error('Word загвар (asr-template.docx) олдсонгүй');
  const entry = detail.entry;
  /** Оффис уулзалтын баримт (0367) — хэвлэх хуудасны `meeting` салааны ихэр. */
  const meeting = usesMeetingForm(reportTypeOf(entry));
  // «Төслийн нэр» = ЗХ-д засварласан нэр (0358) түрүүлнэ; Doc. No. ба файлын
  // нэрийн PROJECT-ID нь `projects.name`-ээс (`codeName`) — засвар кодыг арилгахгүй.
  const codeName = asrProjectName(project.project?.name ?? '');
  const projectName = asrProjectLabel(project.project);

  const files = unzipSync(new Uint8Array(await tplRes.arrayBuffer()));
  const read = (name: string) => {
    const u8 = files[name];
    if (!u8) throw new Error(`asr-docx: загварт ${name} алга`);
    return strFromU8(u8);
  };

  imageSeq = 0;
  docPrSeq = 100;
  const images: DocxImage[] = [];
  const keep = (img: DocxImage | null) => {
    if (img) images.push(img);
    return img;
  };

  /* --- зургууд (зэрэг татна) --- */
  const approved = entry.status === 'approved';
  const [photos, sigArch, sigSite, sigChecked, redBookPhoto] = await Promise.all([
    Promise.all(entry.photos.map((p) => loadImage(mediaUrl(p.url)))),
    entry.sig_arch_url ? loadSignature(entry.sig_arch_url) : null,
    entry.sig_site_url ? loadSignature(entry.sig_site_url) : null,
    // Оффис уулзалтад «Шалгасан» мөр байхгүй (эзэн 2026-10-08) — татахгүй.
    approved && !meeting && entry.checked_by_signature_url
      ? loadSignature(entry.checked_by_signature_url)
      : null,
    // Оффис уулзалтад улаан дэвтрийн хүснэгт огт гарахгүй — татахгүй.
    entry.red_book_photo_url && !meeting ? loadImage(mediaUrl(entry.red_book_photo_url)) : null,
  ]);
  photos.forEach(keep);
  // Оффис уулзалтын мөр / «Тайлбар»-ын зураг (эзэн 2026-10-12) — зэрэг татна.
  const requestSections = meeting ? meetingRequestSections(entry.meeting_requests) : [];
  const extraUrls = meeting
    ? [
        ...new Set([
          ...requestSections.flatMap((sec) => sec.items.flatMap((it) => it.images)),
          ...(entry.meeting_doc?.note_images ?? []),
        ]),
      ]
    : [];
  const extraImgs = new Map<string, DocxImage | null>(
    await Promise.all(
      extraUrls.map(async (u) => [u, keep(await loadImage(mediaUrl(u)))] as const),
    ),
  );
  keep(sigArch);
  keep(sigSite);
  keep(sigChecked);
  keep(redBookPhoto);

  /* --- утгууд --- */
  const shifr = entry.shifr || '';
  const teams = entry.teams ?? [];
  const picked = new Set(teams.map((t) => t.team_code));
  const kinds = new Set<AsrDocKind>(entry.doc_types ?? []);
  const extras = teams.filter((t) => !TEMPLATE_TEAM_CODES.has(t.team_code)).map((t) => t.team_code);
  const withNotes = teams.filter((t) => (t.work_note ?? '').trim().length > 0);
  const infoRows = asrInfoRows(entry.project_info);
  const redBook = redBookStatusOf(entry);
  const sigDate = (iso: string | null | undefined) => {
    const d = tableDate(iso);
    return d === '20__.__.__' ? '' : d;
  };

  /* --- document.xml --- */
  let doc = read('word/document.xml');
  const tblStart = doc.indexOf('<w:tbl>');
  const tblEnd = doc.lastIndexOf('</w:tbl>') + '</w:tbl>'.length;
  if (tblStart < 0 || tblEnd < tblStart) throw new Error('asr-docx: загварт хүснэгт алга');
  let tbl = doc.slice(tblStart, tblEnd);
  const rows = tbl.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g);
  if (!rows || rows.length !== 15)
    throw new Error(`asr-docx: загварт 15 мөр хүлээсэн, ${rows?.length ?? 0} олдов`);
  // ⚠️ patchRow / restructureShifrRows-аас ӨМНӨ: тэдгээр нь загварын нүдийг хуулж
  //    (mergeCell, vCenter) шинэ мөр угсардаг тул зүүн болсон нүд л дамжина.
  rows.forEach((r, i) => {
    rows[i] = leftAlignLabelCells(r);
  });

  /** Мөрийн нүдийг индексээр нь солино. */
  const patchRow = (ri: number, edits: Record<number, string>, trHeightTwip?: number) => {
    let row = rows[ri]!;
    const cells = row.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? [];
    let out = '';
    let cursor = 0;
    cells.forEach((cell, ci) => {
      const at = row.indexOf(cell, cursor);
      out += row.slice(cursor, at);
      out += ci in edits ? setCell(cell, edits[ci]!) : cell;
      cursor = at + cell.length;
    });
    out += row.slice(cursor);
    if (trHeightTwip != null)
      out = out.replace(/<w:trHeight w:val="\d+"\/>/, `<w:trHeight w:val="${trHeightTwip}"/>`);
    row = out;
    rows[ri] = row;
  };

  // 0 — Төслийн нэр | Он сар өдөр
  patchRow(ROW.projectName, {
    1: para(run(projectName), { jc: 'center' }),
    3: para(run(tableDate(entry.report_date)), { jc: 'center' }),
  });
  // 1 — Шифр | 3 checkbox
  const kindCell = (k: { key: string; label: string }) =>
    para(`${box(kinds.has(k.key as AsrDocKind))}${run(' ' + k.label, RPR_CHECK)}`, {
      rpr: RPR_CHECK,
    });
  patchRow(ROW.shifr, {
    1: para(run(shifr)),
    3: kindCell(DOC_KIND_ROWS[0][0]),
    4: kindCell(DOC_KIND_ROWS[0][1]),
    5: kindCell(DOC_KIND_ROWS[0][2]),
  });
  // 2 — Тайлбар | 3 checkbox
  const description =
    (entry.description || '') +
    (kinds.has('other') && entry.doc_type_other ? ` (${entry.doc_type_other})` : '');
  patchRow(ROW.description, {
    1: para(run(description)),
    3: kindCell(DOC_KIND_ROWS[1][0]),
    4: kindCell(DOC_KIND_ROWS[1][1]),
    5: kindCell(DOC_KIND_ROWS[1][2]),
  });
  /** Оффис уулзалтын «Оролцсон» — зохиогч + сонгосон ажилтнууд, мөр бүрд нэг. */
  const participants = meeting ? meetingParticipants(entry).map(participantLine) : [];
  if (meeting) {
    // Тайлбар / «Бичиг баримтын төрөл»-ийн ОРОНД уулзалтын мэдээлэл (0367).
    meetingShifrRows(
      rows,
      (entry.contract_no ?? '').trim(),
      formRow(
        { label: MEETING_LABEL.place, value: (entry.meeting_place ?? '').trim() },
        {
          label: MEETING_LABEL.time,
          value: meetingTimeRange(entry.meeting_start, entry.meeting_end),
        },
        false,
      ) +
        formRow(
          { label: MEETING_LABEL.parties, value: meetingPartiesText(entry) },
          null,
          true,
        ) +
        formRow(
          { label: MEETING_LABEL.purpose, value: (entry.meeting_purpose ?? '').trim() },
          null,
          true,
        ),
    );
  } else {
    restructureShifrRows(rows, (entry.contract_no ?? '').trim(), description);
  }
  // 3 — Хяналтаар явсан: 7 нүд (+ энэ мөрөнд нүдгүй багууд сүүлийн нүдэнд).
  // ⚠️ `extras` БИШ: TEMPLATE_TEAM_CODES нь АУ-г (ажлын тайлангийн мөрөөс)
  //    агуулдаг тул АУ сонгогдвол энэ мөрөнд огт гардаггүй байв (2026-09-28).
  const visitedExtras = teams
    .map((t) => t.team_code)
    .filter((code) => !VISITED_TEAM_CELLS.some((c) => c.code === code));
  const visited: Record<number, string> = {};
  VISITED_TEAM_CELLS.forEach((c, i) => {
    let runs = `${box(!!c.code && picked.has(c.code))}${run(' ' + c.label, RPR_CHECK)}`;
    if (i === VISITED_TEAM_CELLS.length - 1) {
      for (const code of visitedExtras)
        runs += `${run('  ', RPR_CHECK)}${box(true)}${run(' ' + templateTeamLabel(code), RPR_CHECK)}`;
    }
    visited[i + 1] = para(runs, { rpr: RPR_CHECK });
  });
  patchRow(ROW.visitedTeams, visited);
  if (meeting) {
    // «Хяналтаар явсан» мөр оффис уулзалтад ХАСАГДАНА (доор `dropped`) — эзэн
    // 2026-10-12: оролцогчид «Оролцогч тал» нүдэнд ба хөлд аль хэдийн байгаа.
    // «Ажлын тайлан» тууз → «Уулзалтын агуулга»; «Талбайн Инженер» → «Захиалагч тал».
    rows[ROW.workReportHead] = rows[ROW.workReportHead]!.replace(
      '<w:t>Ажлын тайлан</w:t>',
      () => `<w:t>${esc(MEETING_LABEL.content)}</w:t>`,
    );
    rows[ROW.signSite] = rows[ROW.signSite]!.replace(
      '<w:t>Талбайн Инженер</w:t>',
      () => `<w:t>${esc(MEETING_LABEL.clientSide)}</w:t>`,
    );
    // «Архитектор, Инженер» → «Манай тал» (оролцогчдоос сонгосон нэг хүн, эзэн
    // 2026-10-08); толгой «Хяналт хийсэн / Овог, Нэр» → «Тал / Албан тушаал, нэр».
    rows[ROW.signArch] = rows[ROW.signArch]!.replace(
      '<w:t>Архитектор, Инженер</w:t>',
      () => `<w:t>${esc(MEETING_LABEL.ourSide)}</w:t>`,
    );
    rows[ROW.signHead] = rows[ROW.signHead]!
      .replace('<w:t>Хяналт хийсэн</w:t>', () => `<w:t>${esc(MEETING_LABEL.signHeadSide)}</w:t>`)
      .replace('<w:t>Овог, Нэр</w:t>', () => `<w:t>${esc(MEETING_LABEL.signHeadName)}</w:t>`);
  }
  // 4 — Шалгасан | Баталсан
  {
    const checkedName = [entry.checked_by_name, entry.checked_by_title].filter(Boolean).join(' / ');
    let checked = para(run(checkedName, RPR_CHECK), { jc: 'center', rpr: RPR_CHECK });
    if (sigChecked) {
      const f = fitSignature(sigChecked, 42, 12);
      checked += para(drawingRun(sigChecked, f.w, f.h), { jc: 'center' });
    }
    const approvedRuns = approved ? run(entry.reviewer_name ?? '') : '';
    patchRow(ROW.checkedBy, { 1: checked, 3: para(approvedRuns, { jc: 'center' }) });
  }
  /* ── ЗУРГИЙН ХАВСРАЛТ (2026-09-23) ───────────────────────────────────
     Хэвлэх хуудастай ИЖИЛ дүрэм: ХУУДАС ТУС БҮРД ЯГ 4 зураг (2×2), зураг
     бүрийн доор дугаар + тайлбар, хуудас бүр «Төслийн нэр» толгойн мөртэй.

     ⚠️ Зураг нь загварын 6-р мөрөнд БАЙХАА БОЛИВ.  Тэр нүд бол жишээ
        баримтын «Хяналт гүйцэтгэх үеийн ажлын явц» хэсэг бөгөөд эзний
        2026-09-23-ны шийдвэрээр тэр хэсэг БҮХЭЛДЭЭ хасагдсан; зураг нь
        гарын үсэг, улаан дэвтрийн ДАРАА бие даасан хуудас болж орно
        (4 зургийн хуудас бүтэн хуудас эзэлдэг тул маягтын дунд байрлуулбал
        өмнөх хуудасны тал нь хоосон үлддэг). ── */
  let photoPages = '';
  {
    // Оффис уулзалт (0367): хуудсанд НЭГ ТОМ зураг (бичих талбайн бүтэн өргөн),
    // тайлбар нь автомат «төслийн нэр · огноо цаг» — гараар бичсэн тайлбаргүй.
    const PHOTO_W = meeting ? 170 : 82;
    const PHOTO_MAX_H = meeting ? 180 : 66;
    const PER_LINE = meeting ? 1 : 2;
    const PER_PAGE = meeting ? 1 : 4;
    /** Зураг + зайны өргөн twip — tab-ын байрлал (82мм ≈ 4649 + зай ≈ 250). */
    const TAB_STEP = 4900;
    const stampCtx = {
      reportDate: entry.report_date,
      shifr: entry.shifr,
      projectName,
      seq: entry.seq,
    };
    /** 82мм-д 6.5pt-ээр ~72 тэмдэгт багтана; урт төслийн нэр дараагийн tab руу халихгүй. */
    const clamp = (v: string) => (v.length > 70 ? `${v.slice(0, 69)}…` : v);
    const valid = entry.photos
      .map((p, i) => {
        const st = photoStamp(stampCtx, p);
        return {
          img: photos[i],
          stamp: meeting
            ? [st.project, st.when].filter(Boolean).join(' · ')
            : clamp(photoStampLine(st)),
          caption: meeting ? '' : (p.caption ?? '').trim(),
        };
      })
      .filter((x): x is { img: DocxImage; stamp: string; caption: string } => !!x.img);
    const tabStops = Array.from(
      { length: PER_LINE - 1 },
      (_, k) => `<w:tab w:val="left" w:pos="${TAB_STEP * (k + 1)}"/>`,
    ).join('');
    const tabs = `<w:tabs>${tabStops}</w:tabs>`;
    for (let page = 0; page * PER_PAGE < valid.length; page++) {
      const sheet = valid.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
      const from = page * PER_PAGE + 1;
      const to = page * PER_PAGE + sheet.length;
      const counter =
        meeting && valid.length === 1 ? '' : `    (Зураг ${from}–${to} / ${valid.length})`;
      photoPages +=
        PAGE_BREAK +
        infoTable([
          {
            label: 'Төслийн нэр',
            runs: run(`${projectName}${counter}`, RPR_NOTE_TEAM),
          },
        ]) +
        GAP_PARA;
      for (let at = 0; at < sheet.length; at += PER_LINE) {
        const line = sheet.slice(at, at + PER_LINE);
        const base = page * PER_PAGE + at;
        photoPages += para(
          line
            .map((x, i) => {
              const f = fitMm(x.img, PHOTO_W, PHOTO_MAX_H);
              return `${i > 0 ? run(' ') : ''}${drawingRun(x.img, f.w, f.h)}`;
            })
            .join(''),
          meeting ? { jc: 'center' } : {},
        );
        if (meeting) {
          // Автомат тайлбар — зургийн доор голлуулж (дугааргүй).
          photoPages += para(run(line[0]!.stamp, RPR_DATA), { jc: 'center' });
          continue;
        }
        // Тэмдгийн мөр («01 · 2026.09.21 14:35 · MEC-25-21 · DASR-012»).
        photoPages += para(
          line
            .map((x, i) => {
              const no = String(base + i + 1).padStart(2, '0');
              const text = run(x.stamp ? `${no} · ${x.stamp}` : no, RPR_PHOTO_STAMP);
              return i > 0 ? `<w:r>${RPR_PHOTO_STAMP}<w:tab/></w:r>${text}` : text;
            })
            .join(''),
          { rpr: RPR_PHOTO_STAMP, tabs },
        );
        // Тайлбарын мөр — хэвлэх хуудасны figcaption-ий Word хувилбар.  Урт
        // тайлбар мөр таслагдвал хоёр дахь нь зэрэгцэхээ болино (Word-ийн
        // хүлээн зөвшөөрсөн хязгаар; PDF нь үндсэн гаралт).
        if (line.some((x) => x.caption)) {
          photoPages += para(
            line
              .map((x, i) => {
                const no = String(base + i + 1).padStart(2, '0');
                const text = run(x.caption ? `${no} — ${x.caption}` : no);
                return i > 0 ? `<w:r>${RPR_DATA}<w:tab/></w:r>${text}` : text;
              })
              .join(''),
            { tabs, spacing: '<w:spacing w:after="120"/>' },
          );
        }
      }
    }
  }
  // 10 — ажлын тайлангийн багууд (нэг догол мөр, tab-аар)
  {
    const items = [
      ...WORK_REPORT_TEAMS.map((c) => ({ on: !!c.code && picked.has(c.code), label: c.label })),
      ...extras.map((code) => ({ on: true, label: code })),
    ];
    const runs = items
      .map(
        (it, i) =>
          `${i > 0 ? run('         ', RPR_CHECK) : ''}${box(it.on)}${run(' ' + it.label, RPR_CHECK)}`,
      )
      .join('');
    patchRow(ROW.workReportTeams, { 0: para(runs, { rpr: RPR_CHECK }) });
  }
  // 11 — бичих талбай: ерөнхий тайлан (0336) + баг бүрд догол мөр (тод шошго +
  //      tab + тайлбар) + дэд хэсгүүд (үүрэг даалгавар / алдаа дутагдал / өмнөх
  //      тайлангийн шийдэл) — хэвлэх хуудасны 3.1–3.3-ын Word хувилбар.
  {
    const subHead = (title: string) =>
      para(run(title, RPR_NOTE_TEAM), { spacing: '<w:spacing w:before="120" w:after="40"/>' });
    const body = (text: string | null | undefined) => para(run((text ?? '').trim() || '—'));
    const workReport = (entry.work_report ?? '').trim();
    let subs = '';
    subs += subHead('Талбай дээр өгсөн үүрэг даалгавар:') + body(entry.site_tasks);
    subs += subHead('Илэрсэн алдаа, дутагдал:') + body(entry.defects);
    for (const r of entry.resolved_in ?? []) {
      subs += para(
        run(
          `Шийдсэн: ${r.doc_no ?? '—'} · ${tableDate(r.report_date)}` +
            (r.resolution_text ? ` — ${r.resolution_text}` : ''),
        ),
      );
    }
    subs += subHead('Өмнөх тайлангийн асуудлыг бид ингэж шийдсэн:');
    const resolutions = entry.resolutions ?? [];
    if (resolutions.length === 0) subs += body(null);
    for (const r of resolutions) {
      const ref = [r.prev_doc_no ?? '—', r.prev_report_date ? tableDate(r.prev_report_date) : '']
        .filter(Boolean)
        .join(' · ');
      subs += para(
        `${run(ref, RPR_NOTE_TEAM)}<w:r>${RPR_DATA}<w:br/></w:r>` +
          run(`Асуудал: ${r.issue_text || '—'}`) +
          `<w:r>${RPR_DATA}<w:br/></w:r>` +
          run(`Шийдэл: ${r.resolution_text || '—'}`),
        { spacing: '<w:spacing w:after="80"/>' },
      );
    }
    const general = workReport
      ? para(run(workReport), { spacing: '<w:spacing w:after="120"/>' })
      : '';
    // Оффис уулзалт (0367) — «Уулзалтын агуулга» нь ганц бичвэр, дэд асуултгүй.
    // 0396 — эхэнд «0.1 Захиалагч / 0.2 Гүйцэтгэгч» хүснэгтүүд, доор нь бичвэр.
    // Нүд хүснэгтээр төгсөж болохгүй — ард нь ҮРГЭЛЖ догол мөр.
    const requests = requestSections.length ? meetingRequestXml(requestSections, extraImgs) : '';
    // «Тайлбар: …» — тод шошго + бичвэр нэг догол мөрөнд (эзний RFI хэлбэр).
    const meetingNote = workReport
      ? para(run(`${MEETING_LABEL.notesHead}: `, RPR_FOOT_B) + run(workReport, RPR_FOOT), {
          jc: 'left',
          spacing: '<w:spacing w:before="160" w:after="80"/>',
        }) + itemImagesXml(entry.meeting_doc?.note_images ?? [], extraImgs, 150, 90)
      : para('') + itemImagesXml(entry.meeting_doc?.note_images ?? [], extraImgs, 150, 90);
    const paras = meeting
      ? requests + meetingNote
      : general +
          withNotes
            .map((t) =>
              para(
                `${run(templateTeamLabel(t.team_code), RPR_NOTE_TEAM)}<w:r>${RPR_DATA}<w:tab/></w:r>${run(t.work_note ?? '')}`,
                {
                  spacing:
                    '<w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="720"/><w:spacing w:after="80"/>',
                },
              ),
            )
            .join('') +
          subs;
    /* Мөрийн өндөр — хэвлэх хуудасны хуудаслалтын Word хувилбар.  Word-д
       хэмжиж болохгүй тул ТООЦООЛНО: загварын 121мм-ээс нэмэгдсэн мөрүүдийн
       (төслийн мэдээлэл, улаан дэвтэр) ойролцоо өндрийг хасна.  atLeast тул
       агуулга урт бол өөрөө өснө.

       ⚠️ Зураг нь 2026-09-23-аас ТУСДАА хуудсанд (`photoPages`) тул энэ
          тооцоонд ОРОХГҮЙ — өмнө нь тэдний өндрийг хасдаг байсан нь бичих
          талбайг дэмий агшаадаг байв. */
    const infoMm =
      infoRows.reduce((acc, r) => acc + 4.4 * Math.max(1, Math.ceil(r.value.length / 95)), 0) +
      (infoRows.length ? 2.5 : 0);
    // Оффис уулзалтад улаан дэвтэр байхгүй; оронд нь уулзалтын мөрүүд + оролцогчид.
    const lines = (v: string | null | undefined) =>
      (v ?? '')
        .split('\n')
        .reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 95)), 0);
    const redMm = meeting
      ? 4.4 * (1 + lines(meetingPartiesText(entry)) + lines(entry.meeting_purpose)) +
        4.4 * Math.max(1, participants.length)
      : 4.4 +
        (redBook === 'verified' ? 4.4 : 0) +
        (redBookPhoto ? Math.min(90, fitMm(redBookPhoto, 120, 90).h) + 2 : 0) +
        2.5;
    const bodyTwip = Math.round(
      Math.min(
        BODY_TWIP_MAX,
        Math.max(BODY_TWIP_MIN, BODY_TWIP_MAX - (infoMm + redMm) * TWIP_PER_MM),
      ),
    );
    patchRow(ROW.workReportBody, { 0: paras || para('') }, bodyTwip);
    // Оффис уулзалтын бичих мөр хүсэлтийн хүснэгт + зурагтай тул нэг хуудаснаас
    // өндөр болдог — загварын `cantSplit` нь мөрийг бүхэлд нь дараагийн хуудас руу
    // түлхэж, хуудаснаас хэтэрсэн хэсгийг Word ТАЙРДАГ (2026-10-12 хэмжсэн).
    if (meeting) rows[ROW.workReportBody] = rows[ROW.workReportBody]!.replace('<w:cantSplit/>', '');
  }
  // 13/14 — гарын үсэг
  const signRow = (
    ri: number,
    name: string | null,
    sig: DocxImage | null,
    date: string | null | undefined,
    position = '',
  ) => {
    let sigPara = para('', { jc: 'center', rpr: RPR_SIGN });
    if (sig) {
      const f = fitSignature(sig, 42, 16);
      sigPara = para(drawingRun(sig, f.w, f.h), { jc: 'center', rpr: RPR_SIGN });
    }
    patchRow(ri, {
      1:
        (position ? para(run(position, RPR_SIGN), { jc: 'center', rpr: RPR_SIGN }) : '') +
        para(run(name || '', RPR_SIGN), { jc: 'center', rpr: RPR_SIGN }),
      2: sigPara,
      3: para(run(sigDate(date), RPR_SIGN), { jc: 'center', rpr: RPR_SIGN }),
    });
  };
  signRow(
    ROW.signArch,
    entry.sig_arch_name,
    sigArch,
    entry.sig_arch_date,
    meeting ? meetingSigner(entry).position : '',
  );
  signRow(ROW.signSite, entry.sig_site_name, sigSite, entry.sig_site_date);

  /* Хүснэгтийг мөрүүдээр нь дахин угсарна (tblPr/tblGrid хэвээр).

     ⚠️ ХОЁР бүтцийн өөрчлөлт (эзэн, 2026-09-23):
     1) ЗАГВАРЫН 6 ба 7-Р МӨР ХАСАГДАНА.  Тэдгээр нь жишээ баримтын
        «Зохиогчийн хяналтыг … гүйцэтгэлээ / Хяналт гүйцэтгэх үеийн ажлын
        явц:» бичвэрийн нүд ба «Attachment» мөр — тэр хэсэг БҮХЭЛДЭЭ
        хасагдсан.  Тухайн бичвэр (`work_report`) нь «Ажлын тайлан» блокийн
        эхний догол мөр болж орсон тул өгөгдөл алдагдахгүй.  5 ба 8-р мөр нь
        ХООСОН ЗАЙН мөр (129 + 60 twip) — маягт ба «Ажлын тайлан» блокийн
        хоорондох завсар тул ҮЛДЭНЭ.
     2) Төслийн мэдээлэл нь тусдаа хүснэгт БИШ, 0-р мөрийн (Төслийн нэр)
        ДАРАА маягтын МӨР болж нэмэгдэнэ — хэвлэх хуудасны нэг блоктой ижил.
     gridSpan-ийн нийлбэр мөр бүрт 12 хэвээр (`formRow`). */
  {
    const firstRowAt = tbl.indexOf('<w:tr');
    // Оффис уулзалтад «Шалгасан | Баталсан» ба «Уулзалтын агуулга»-ын багийн
    // чагтын мөр ХАСАГДАНА (эзэн 2026-10-08; хэвлэх хуудасны ихэр).  Маягтын
    // зузаан доод хүрээ нь 5-р (зайн) мөрийн дээд хүрээ тул хэвээр.
    const dropped: number[] = meeting
      ? [
          ROW.visitedTeams,
          ROW.photos,
          ROW.attachment,
          ROW.checkedBy,
          ROW.workReportTeams,
          // Гарын үсгийн 3 мөр → хүснэгтийн ДООРХ хөл (`meetingFooterXml`).
          ROW.signHead,
          ROW.signArch,
          ROW.signSite,
        ]
      : [ROW.photos, ROW.attachment];
    const kept = rows.filter((_, i) => !dropped.includes(i));
    const body = [
      rows[0]!,
      formTypeRow(reportTypeOf(entry), (entry.meeting_platform ?? '').trim()),
      formInfoRows(infoRows),
      ...kept.slice(1),
    ].join('');
    tbl = tbl.slice(0, firstRowAt) + body + '</w:tbl>';
  }

  // Улаан дэвтэр — маягтын ДООР (checkbox нь загварын Wingdings тэмдэг).
  const redRows: { label: string; runs: string; jc?: Jc }[] = [
    {
      label: 'Улаан дэвтэр',
      runs: `${box(redBook === 'verified')}${run(' ' + RED_BOOK_LABEL[redBook], RPR_CHECK)}`,
    },
  ];
  if (redBook === 'verified') {
    redRows.push({
      label: 'Баталгаажуулсан',
      runs: run(
        [entry.red_book_verifier_name, sigDate(formatDate(entry.red_book_verified_at))]
          .filter(Boolean)
          .join(' · '),
      ),
    });
  }
  if (redBookPhoto) {
    const f = fitMm(redBookPhoto, 120, 90);
    redRows.push({
      label: 'Дэвтрийн зураг',
      runs: drawingRun(redBookPhoto, f.w, f.h),
      jc: 'center',
    });
  }
  for (const c of entry.companions ?? []) {
    redRows.push({
      label: c.full_name ?? 'Хамт явсан',
      runs: run(RED_BOOK_LABEL[redBookStatusOf(c)]),
    });
  }
  // Оффис уулзалтад улаан дэвтэр огт гарахгүй (эзэн 2026-09-30, 0367).
  const redTable = meeting ? '' : infoTable(redRows);

  // Маягт → улаан дэвтэр → зургийн хавсралт (хэвлэх хуудасны яг тэр дараалал).
  // Оффис уулзалт — эзний RFI хэлбэрийн хөл (оролцогчид + захиалагчийн төлөөлөгч + огноо).
  const footerXml = meeting
    ? meetingFooterXml(meetingFooter(entry), entry.report_date, sigArch, sigSite)
    : '';
  doc =
    doc.slice(0, tblStart) + tbl + GAP_PARA + footerXml + redTable + photoPages + doc.slice(tblEnd);
  files['word/document.xml'] = strToU8(doc);

  /* --- header1.xml: гарчиг / Report Date / Doc. No. / Шифр (албан нэр 2026-09-28-нд хасагдсан) --- */
  {
    let hdr = read('word/header1.xml');
    const paras = hdr.match(/<w:p [\s\S]*?<\/w:p>/g) ?? [];
    // [1] гарчиг, [2] Report Date, [3] Doc. No. — загварын дараалал.
    if (paras.length < 4) throw new Error('asr-docx: толгойн бүтэц танигдсангүй');
    // [1] «Author’s Supervision Report» → «Design Author’s Supervision Report»
    // (эзэн 2026-09-28).  Загварын run-ийн rPr (Arial Narrow, тод) хэвээр —
    // зөвхөн ганц <w:t>-гийн бичвэр солигдоно.
    const titleEnP = paras[1]!.replace(
      /<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/,
      () => `<w:t xml:space="preserve">${esc(ASR_DOC_TITLE_EN)}</w:t>`,
    );
    const pPr = (p: string) => p.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? '';
    const headPara = (src: string, text: string, rpr = RPR_HEAD) =>
      `<w:p>${pPr(src)}${run(text, rpr)}</w:p>`;
    const dateP = headPara(paras[2]!, `Report Date: ${headerDate(entry.report_date)}`);
    const docNoP = headPara(
      paras[3]!,
      `Doc. No.: ${asrHeaderDocNo(entry, codeName)}`,
    );
    // ⚠️ Паспортын албан ёсны нэрийн мөр 2026-09-28-нд ХАСАГДСАН (эзэн: «Албан
    //    ёсны нэр» ЗХ-ийн баримтад гарахгүй) — хэвлэх хуудасны толгойтой ижил.
    const shifrP = shifr ? headPara(paras[3]!, `Шифр: ${shifr}`) : '';
    // Функц хэлбэр — солих текстэд `$` байвал String.replace-ийн `$&` загвар ажиллахгүй.
    hdr = hdr
      .replace(paras[1]!, () => titleEnP)
      .replace(paras[2]!, () => dateP)
      .replace(paras[3]!, () => docNoP + shifrP);
    files['word/header1.xml'] = strToU8(hdr);
  }

  /* --- зургийн part, rels, content types --- */
  if (images.length) {
    let rels = read('word/_rels/document.xml.rels');
    const relXml = images
      .map(
        (img) =>
          `<Relationship Id="${img.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${img.name}"/>`,
      )
      .join('');
    rels = rels.replace('</Relationships>', relXml + '</Relationships>');
    files['word/_rels/document.xml.rels'] = strToU8(rels);
    for (const img of images) files[`word/media/${img.name}`] = img.bytes;

    let ct = read('[Content_Types].xml');
    if (images.some((i) => i.ext === 'jpeg') && !/Extension="jpeg"/.test(ct)) {
      ct = ct.replace(
        '<Default Extension="png"',
        '<Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png"',
      );
    }
    if (!/Extension="png"/.test(ct)) {
      ct = ct
        .replace('<Types ', '<Types ><Default Extension="png" ContentType="image/png"/>')
        .replace('<Types >', '<Types ');
    }
    files['[Content_Types].xml'] = strToU8(ct);
  }

  const zipped = zipSync(files, { level: 6 });
  const blob = new Blob([zipped as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  return { blob, fileName: `${asrFileStem(entry, codeName)}.docx` };
}

/** Word баримтыг угсарч хөтчөөр татуулна (`downloadAsrPdf`-ийн хос). */
export async function downloadAsrDocx(opts: AsrDocxOptions): Promise<void> {
  const { blob, fileName } = await buildAsrDocx(opts);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
