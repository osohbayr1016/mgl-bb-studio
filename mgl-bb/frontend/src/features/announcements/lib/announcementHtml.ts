/**
 * Мэдээллийн HTML-ийн ХАДГАЛАХ ↔ ХАРУУЛАХ хэлбэр.
 *
 * DB-д зураг `/media/<key>` гэсэн ХАРЬЦАНГУЙ замаар хадгалагдана: SPA нь
 * Pages дээр, Worker (`/media`) нь өөр хост дээр тул `<img src="/media/…">`
 * шууд ажиллахгүй — харуулахын өмнө `mediaUrl()`-ээр абсолют болгоно.
 * Харьцангуй хадгалснаар домэйн солигдоход (2026-08-20-ны нүүдэл шиг) хуучин
 * мэдээллийн зураг эвдэрдэггүй.
 *
 * Засварлагч (`contentEditable`) нь абсолют URL-тай `<img>` үүсгэдэг тул
 * хадгалахын өмнө `toStoredHtml` буцаан харьцангуй болгоно.  Сервер
 * (`lib/announcements.ts sanitizeHtml`) нь https-ийг ч зөвшөөрдөг тул энэ
 * хөрвүүлэлт нь аюулгүй байдлын биш, ЗӨӨВРИЙН асуудал.
 */
import { getMediaBaseUrl, mediaUrl } from '@/shared/api/client';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Абсолют `<host>/media/<key>` → `/media/<key>` (зөвхөн ӨӨРИЙН Worker-ийн хост). */
export function toStoredHtml(html: string, base: string = getMediaBaseUrl()): string {
  if (!base) return html;
  const re = new RegExp(`(src=["'])${escapeRe(base.replace(/\/$/, ''))}(/media/[^"']+)`, 'g');
  return html.replace(re, '$1$2');
}

/** `/media/<key>` → абсолют URL (харуулах, засварлагчид ачаалах). */
export function toDisplayHtml(html: string): string {
  return html.replace(/(src=["'])(\/media\/[^"']+)/g, (_m, pre: string, path: string) => `${pre}${mediaUrl(path)}`);
}

/** HTML → цэвэр текст (уртын шалгалт, хоосон эсэх). */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr|hr)\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Бие хоосон уу — зураг л байвал ч агуулгатай. */
export function isBodyEmpty(html: string): boolean {
  return htmlToPlainText(html).length === 0 && !/<img\b/i.test(html);
}

/**
 * Урьдчилан харагдацын (админы ӨӨРИЙН хөтөч) хамгаалалт — `<script>`/`<style>`
 * блок ба `on*` атрибутыг л хасна.  ЖИНХЭНЭ цэвэрлэгч нь сервер
 * (`backend/src/lib/announcements.ts sanitizeHtml`, хадгалах бүрд); энэ нь
 * хадгалаагүй ноорогийг харахад буулгасан (paste) HTML өөрт нь гүйхээс
 * хамгаалах давхарга — цагаан жагсаалтын хуулбар БИШ.
 */
export function stripDangerousHtml(html: string): string {
  return html
    .replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|style|iframe|object|embed)\b[^>]*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["']?)\s*javascript:[^"'>\s]*\2/gi, '$1=$2$2');
}
