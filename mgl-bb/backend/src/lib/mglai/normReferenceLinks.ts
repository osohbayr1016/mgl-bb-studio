/**
 * MGL AI · norm LINKS-FIRST fallback for technical questions without a
 * verified applicable answer. The L1 registry is a locator, never a source
 * of numerical/compliance claims. In particular, "closest BM25 clause"
 * must not be presented as an answer when NORM-INTEL says NO_VERIFIED_MATCH.
 *
 * The caller MUST only use this after norm-intelligence's evidence gate,
 * never over an authoritative norm decision, a document-status answer,
 * a named missing clause or a topic switch.
 */
import type { LocalNormTopicRoute } from './localNorm';
import type { TrustedContract } from './trustedFacts';
import { linkLabel, normDocumentsData } from './normDocuments';

type Lang = 'mn-Cyrl' | 'en';

/** Links must resolve to official government/Legalinfo hosts, never client-supplied arbitrary HTTPS domains. */
export function isOfficialNormUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    const h = u.hostname.toLowerCase();
    return u.protocol === 'https:' && !u.username && !u.password &&
      (h === 'legalinfo.mn' || h.endsWith('.legalinfo.mn') || h === 'gov.mn' || h.endsWith('.gov.mn'));
  } catch { return false; }
}

/** Curated, validated HTTPS links from the L1 registry; no web guesses. */
export function renderNormReferenceLinks(route: LocalNormTopicRoute | null, lang: Lang): string | null {
  // A fallback-to-all registry result is not relevant enough to recommend.
  if (!route || route.detection === 'none' || route.detectedTopics.length === 0 || route.results.length === 0) return null;
  const docs = normDocumentsData(route, lang).all_documents.filter((d) => isOfficialNormUrl(d.url)).slice(0, 5);
  if (!docs.length) return null;
  const en = lang === 'en';
  const lines = [
    en
      ? 'I could not verify the exact requirement or its applicability from the available clause evidence. Here are **related registry links for you to check**, not a compliance answer:'
      : 'Энэ асуултын яг тохирох шаардлага, заалтыг баталгаажуулж чадсангүй. Доорх нь **өөрөө нягтлахад зориулсан холбогдох нормын бүртгэлийн холбоосууд** болохоос нийцлийн дүгнэлт биш:',
    '',
  ];
  for (const doc of docs) {
    const code = doc.code ? `**${doc.code}** — ` : '';
    const status = en
      ? doc.status === 'ACTIVE' ? 'MCIS register: in force; amendments not rechecked' : doc.status === 'SUPERSEDED' ? 'Superseded' : 'Current status not verified'
      : doc.status === 'ACTIVE' ? 'MCIS бүртгэлд хүчинтэй; нэмэлт өөрчлөлт дахин шалгаагүй' : doc.status === 'SUPERSEDED' ? 'Солигдсон' : 'Одоогийн төлөв баталгаажаагүй';
    lines.push(`- ${code}${doc.title} — [${linkLabel(doc.url, lang)}](${doc.url}) · ${status}`);
  }
  lines.push('', en
    ? 'Check the original PDF or official page for the exact clause, edition, building type and conditions before making a design decision.'
    : 'Зураг төслийн шийдвэр гаргахаасаа өмнө эх PDF/албан хуудсаас тухайн заалт, хувилбар, барилгын зориулалт болон хэрэглэгдэх нөхцөлийг нягтална уу.');
  return lines.join('\n');
}

/**
 * This intentionally replaces an unrelated "closest clause" response only
 * when intelligence classified the turn NO_VERIFIED_MATCH. It has no model
 * generation; no unverified norm claim can be promoted by a language model.
 */
export function withNormReferenceLinks(
  contract: TrustedContract,
  route: LocalNormTopicRoute | null,
  lang: Lang,
  eligible: boolean,
): TrustedContract {
  if (!eligible) return contract;
  const template = renderNormReferenceLinks(route, lang);
  if (template === null) return contract;
  return {
    ...contract,
    answerMode: 'refusal',
    risk: 'high',
    facts: [],
    allowedNumbers: null, // Document codes and URLs contain identifiers, not regulatory measured values.
    allowedCategories: [],
    requiredSentence: null,
    trailerText: null,
    noMatch: true,
    template,
    templateOnly: true,
    reason: `${contract.reason} · norm_reference_links_only`,
  };
}
