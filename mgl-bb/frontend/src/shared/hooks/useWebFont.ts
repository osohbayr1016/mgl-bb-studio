import { useEffect } from 'react';

/**
 * Ганц маршрутын гэр бүлд л хэрэгтэй display фонтын Google Fonts
 * stylesheet-ийг ЗӨВХӨН тэр маршрут mount хийгдэхэд ачаална.
 *
 * ЯАГААД: `index.html` дэх фонтын link нь render-блоклогч бөгөөд БҮХ
 * маршрутын критик замд байдаг. Manrope-г 17 газар л, зөвхөн нийтийн
 * landing / client гадаргуу дээр хэрэглэдэг — гэтэл апп руу нэвтэрсэн
 * хэрэглэгч бүр (тэдгээр хуудсыг хэзээ ч харахгүй) түүнийг татаж байв.
 *
 * `href`-ээр дедупчилнэ. Устгахгүй: stylesheet кэшлэгдсэн бөгөөд буцаж
 * ирэхэд дахин FOUT үзүүлэх нь илүү муу.
 */
export function useWebFont(href: string) {
  useEffect(() => {
    if (document.querySelector(`link[data-webfont="${href}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.webfont = href;
    document.head.appendChild(link);
  }, [href]);
}

/**
 * Manrope — landing/marketing-ийн display нүүр (`font-grotesk`).
 * Жин: 600/700/800 (landing нь semibold/bold/extrabold л хэрэглэдэг;
 * 500 нь хаана ч хэрэглэгдээгүй тул хасав).
 */
export const MANROPE_HREF =
  'https://fonts.googleapis.com/css2?family=Manrope:wght@600;700;800&display=swap';

/**
 * Inter Tight — захиалагчийн порталын display нүүр (`font-display`).
 * Inter-ийн нягт хувилбар: том, нимгэн (300) гарчиг архитектурын студийн
 * editorial хэв маягийг өгнө.  `cyrillic-ext` subset-тэй тул монгол Ө/Ү
 * зөв зурагдана.  Зөвхөн `/client*` маршрутууд ачаална.
 */
export const INTER_TIGHT_HREF =
  'https://fonts.googleapis.com/css2?family=Inter+Tight:wght@300;400;500;600&display=swap';
