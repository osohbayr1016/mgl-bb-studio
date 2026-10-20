/**
 * Ноорогийг АЖИЛТНЫ харагдах хуудсууд болгож задлах.
 *
 * ⚠️ Энэ нь `AssessmentFillPage`-ийн `buildPages`-тэй ЯГ ижил дүрмээр ажиллах
 * ёстой — админ засварлагч дээр харсан хуудаслалт ажилтны талд өөр гарвал
 * бүх редакцийн ажил утгагүй болно.  Дүрэм:
 *
 *   1. `schema.intro` хоосон биш бол ХАМГИЙН ЭХНИЙ хуудас = танилцуулга,
 *   2. `part.paging === 'section'` → хэсэг тус бүр тусдаа хуудас,
 *   3. `part.paging === 'part'`    → тухайн part бүхэлдээ нэг хуудас.
 */

import type { DraftNodeRef, DraftPart, DraftSection, SchemaDraft } from './schemaDraft';

/**
 * Засварлагч дээр одоо сонгогдсон зүйл.
 *
 * Модны зангилаанууд (`DraftNodeRef`) дээр нэмээд танилцуулга блок орно —
 * тэр нь схемийн модонд БАЙХГҮЙ тул тусад нь ялгав.
 */
export type EditorSelection = DraftNodeRef | { kind: 'intro'; key: string };

export type EditorPage =
  | { kind: 'intro'; key: string; label: string }
  | {
      kind: 'sections';
      key: string;
      part: DraftPart;
      sections: DraftSection[];
      /** Outline-д харагдах богино нэр. */
      label: string;
    };

export function buildEditorPages(draft: SchemaDraft, introLabel: string): EditorPage[] {
  const pages: EditorPage[] = [];
  if (draft.intro.length > 0) pages.push({ kind: 'intro', key: 'intro', label: introLabel });

  for (const part of draft.parts) {
    if (part.paging === 'section') {
      for (const section of part.sections) {
        pages.push({
          kind: 'sections',
          key: `${part.key}::${section.key}`,
          part,
          sections: [section],
          label: section.title.trim() || section.code || '—',
        });
      }
      // Хэсэггүй part ч хуудас эзэлнэ — эс бөгөөс админ түүн рүү очиж
      // хэсэг нэмэх боломжгүй болно (outline-д харагдахгүй).
      if (part.sections.length === 0) {
        pages.push({
          kind: 'sections',
          key: part.key,
          part,
          sections: [],
          label: part.title.trim() || '—',
        });
      }
    } else {
      pages.push({
        kind: 'sections',
        key: part.key,
        part,
        sections: part.sections,
        label: part.title.trim() || '—',
      });
    }
  }
  return pages;
}

/** Тухайн хэсэг/бүлэг/мөр аль хуудсанд байгааг олно (сонголт хийхэд шилжинэ). */
export function pageIndexOfSection(pages: EditorPage[], sectionKey: string): number {
  return pages.findIndex(
    (page) => page.kind === 'sections' && page.sections.some((s) => s.key === sectionKey),
  );
}
