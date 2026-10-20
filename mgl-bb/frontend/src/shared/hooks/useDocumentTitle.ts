import { useEffect } from 'react';
import { useBrand } from '@/shared/config/useBrand';

/**
 * Keep `document.title` in sync with the current page. Without this every
 * page (and the public marketing site) is titled "MGL" / the static index.html
 * value — bad for tabs, history, bookmarks and screen-reader page identification.
 *
 *   useDocumentTitle('Төслүүд')  →  "Төслүүд · MGL"
 *
 * Pass an empty/falsy title to fall back to the bare app name. The previous
 * title is restored on unmount so transient routes don't leak their title.
 */
export function useDocumentTitle(title: string | null | undefined) {
  // Байгууллагын нэр нь `shared/config/brand.ts`-ээс ирнэ.  `useBrand()`-ээр
  // захиалснаар админ нэрээ солиход нээлттэй байгаа таб шууд шинэчлэгдэнэ.
  const appName = useBrand().nameShort;
  useEffect(() => {
    const previous = document.title;
    document.title = title ? `${title} · ${appName}` : appName;
    return () => {
      document.title = previous;
    };
  }, [title, appName]);
}
