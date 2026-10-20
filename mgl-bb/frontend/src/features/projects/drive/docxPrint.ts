/**
 * Word (.docx) баримтыг A4 хуудсаар хэвлэх / PDF болгох ГАНЦ дүрэм — хоёр хуудас хуваалцана:
 *   • `DrivePrintPage` (`/app/drive-print/...`) — ажилтан хөтчөөрөө хэвлэнэ / PDF хадгална;
 *   • `PublicSigningPrintPage` (`/sign/:token/print`) — сервер (Browser Rendering) гаднын хүний
 *     гарын үсэгтэй баримтыг PDF болгоно (зурсан хүнд .docx очихгүй — 2026-10-12).
 *
 * navy дэвсгэрийн «Автомат» бичвэрийг Word шиг цагаан болгоод (`docxAutoText.ts`, эх файл
 * хөндөгдөхгүй) `docx-preview`-ээр зурна — Word-ийн хадгалсан хуудасны хил
 * (`lastRenderedPageBreak`) хэрэглэгдэнэ.
 */

/** AGFutura Mon (компанийн загварын фонт) суугаагүй компьютерт Word нь fontTable-ийн altName =
 *  Calibri-г хэрэглэдэг (2026-09-30-нд хэмжсэн) — хөтөч ч ИЖИЛ орлуулгыг хийнэ, эс бөгөөс serif
 *  (Times) болно.  Calibri өөрөө ч байхгүй орчинд (Cloudflare Browser Rendering — Arial, Liberation,
 *  DejaVu л суусан) Carlito → Arial руу унана. */
export const DOCX_PRINT_STYLES = `
@font-face { font-family: 'AGFutura Mon'; font-weight: 400; src: local('AGFutura Mon'), local('AGFutura Mon Regular'), local('AGFuturaMon-Regular'), local('Calibri'), local('Carlito'), local('Arial'); }
@font-face { font-family: 'AGFutura Mon'; font-weight: 700; src: local('AGFutura Mon Bold'), local('AGFuturaMon-Bold'), local('Calibri Bold'), local('Calibri-Bold'), local('Carlito Bold'), local('Arial Bold'); }
@font-face { font-family: 'Calibri'; font-weight: 400; src: local('Calibri'), local('Carlito'), local('Arial'); }
@font-face { font-family: 'Calibri'; font-weight: 700; src: local('Calibri Bold'), local('Calibri-Bold'), local('Carlito Bold'), local('Arial Bold'); }
@page { size: A4; margin: 0; }
html, body { background: #e5e7eb; }
.drive-print-doc .docx-wrapper { background: transparent; padding: 16px 0; }
/* Хүснэгтийн нүдэн дэх зургийг Word шиг нүдэнд багтаана — docx-preview эх хэмжээгээр (жишээ нь
   766pt өргөн дэлгэцийн зураг) зурж хүснэгтийг хуудаснаас 1.6 дахин өргөн болгодог байв (2026-10-12,
   бодит RFI) → PDF-д баруун багана (гарын үсэг) тасарч байв. */
.drive-print-doc td img { max-width: 100% !important; height: auto !important; }
.drive-print-doc td div:has(> img) { max-width: 100% !important; height: auto !important; }
.drive-print-doc .docx-wrapper > section.docx { margin-bottom: 16px; box-shadow: 0 1px 4px rgba(0,0,0,.18); }
@media print {
  html, body { background: #fff !important; }
  .drive-print-toolbar { display: none !important; }
  /* index.css-ийн глобал хэвлэх дүрэм зөвхөн .print-area-г харуулж, түүнд absolute + 1 см
     зай өгдөг — баримт өөрөө Word-ийн захын зайтай тул тэрийг дарна. */
  .drive-print-doc.print-area { position: static !important; padding: 0 !important; width: auto !important; }
  .drive-print-doc .docx-wrapper { padding: 0 !important; background: #fff !important; }
  .drive-print-doc .docx-wrapper > section.docx { box-shadow: none !important; margin: 0 !important; break-after: page; }
  .drive-print-doc .docx-wrapper > section.docx:last-child { break-after: auto; }
}
`;

/** `raw` .docx-ийг `body`-д A4 хуудсаар зурна (`style` — docx-preview-ийн загварын сав). */
export async function renderDocxForPrint(raw: Blob, body: HTMLElement, style: HTMLElement): Promise<void> {
  const { fixDocxBlob } = await import('./docxAutoText');
  const blob = (await fixDocxBlob(raw).catch(() => ({ blob: raw }))).blob;
  const { renderAsync } = await import('docx-preview');
  body.replaceChildren();
  style.replaceChildren();
  await renderAsync(blob, body, style, {
    className: 'docx',
    inWrapper: true,
    breakPages: true,
    ignoreLastRenderedPageBreak: false,
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    useBase64URL: true,
  });
}

/** Фонт, зураг бүрэн ачаалагдтал хүлээнэ — эс бөгөөс хэвлэл/PDF-д зураг (гарын үсэг) дутна.
 *  Дараа нь хуудаснаас өргөн хэвээр үлдсэн агуулгыг багтаана (`fitOverflowingPages`). */
export async function waitForPrintAssets(body: HTMLElement): Promise<void> {
  await document.fonts.ready.catch(() => undefined);
  await Promise.all(
    [...body.querySelectorAll('img')].map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => undefined))),
  );
  fitOverflowingPages(body);
}

/**
 * Хуудасны (A4) өргөнөөс хэтэрсэн агуулгыг тэр хуудсанд л жижигрүүлж багтаана.  Хэвлэх/PDF-д
 * хуудасны хилээс гарсан хэсэг ТАСАРДАГ — гарын үсгийн багана ихэвчлэн хамгийн баруун талд байдаг.
 * Word-оор нээхэд ийм илүүдэл гардаггүй (тэр нүдэнд багтааж зурдаг), тиймээс энэ нь зөвхөн
 * хөтчийн зурагчийн зөрүүг нөхнө.
 */
export function fitOverflowingPages(body: HTMLElement): void {
  for (const section of body.querySelectorAll<HTMLElement>('section.docx')) {
    section.style.zoom = '';
    // Word шиг хүснэгт баруун захын зай руу орж болно — зөвхөн хуудасны ИРМЭГЭЭС гарвал жижигрүүлнэ.
    const margin = Math.max(0, (parseFloat(getComputedStyle(section).paddingRight) || 0) - 4);
    for (const part of section.querySelectorAll<HTMLElement>(':scope > article, :scope > header, :scope > footer')) {
      part.style.zoom = '';
      const need = part.scrollWidth;
      const have = part.clientWidth;
      if (have > 0 && need > have + margin) part.style.zoom = String(Math.max(0.4, (have + margin) / need));
    }
    // Нэг section = Word-ын нэг хуудас (`lastRenderedPageBreak`).  Хөтөч заримдаа Word-оос өндөр зурдаг
    // (фонт, зургийн хэмжээ) — тэгвэл хуудас 2 A4 болж, хоёр дахь нь бараг хоосон гардаг байв.  Бага
    // зэрэг өндөр бол тэр хуудсыг бүхэлд нь жижигрүүлж НЭГ A4-т багтаана; хэт урт (60%-иас доош
    // жижигрүүлэх шаардлагатай) бол уншигдахуйц хэвээр нь дараагийн хуудас руу урсгана.
    const minH = parseFloat(getComputedStyle(section).minHeight);
    const page = minH > 0 ? minH : (section.offsetWidth * 297) / 210;
    const height = section.getBoundingClientRect().height;
    if (page > 0 && height > page + 1) {
      // 8px нөөц: zoom-ын бутархай + хэвлэх горимын бөөрөнхийлөлтөөр хэдэн px илүүдэж хоосон хуудас үүсгэдэг.
      const z = (page - 8) / height;
      if (z >= 0.6) section.style.zoom = String(z);
    }
  }
}
