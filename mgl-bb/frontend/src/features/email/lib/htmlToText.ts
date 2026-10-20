/**
 * Strip dangerous markup from the rich-text editor's HTML before it goes out
 * as an email body — removes script/style/iframe/etc, on* handler attributes,
 * and javascript: URLs.  It's our own outbound content, but pasted markup can
 * carry anything, so keep it clean.
 */
export function sanitizeHtml(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc
    .querySelectorAll('script, style, iframe, object, embed, link, meta, title')
    .forEach((el) => el.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      else if ((name === 'href' || name === 'src') && value.startsWith('javascript:')) {
        el.removeAttribute(attr.name);
      }
    }
  });
  return doc.body.innerHTML;
}

/**
 * Convert the rich-text editor's HTML into a readable plain-text version —
 * used for the correspondence ledger body + list snippet (which stay
 * plain-text), while the HTML itself goes out as the email body.
 */
export function htmlToText(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // <br> → newline.
  doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  // Block elements end with a newline so paragraphs/list items don't run together.
  doc.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, h5, h6').forEach((el) => {
    el.append('\n');
  });
  const text = doc.body.textContent ?? '';
  return text
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
