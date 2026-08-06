import type { PageRecord } from "../types.js";

/**
 * v0 topic extraction: headings are the strongest structural signal of what
 * a page is "about" without needing NLP. Real semantic clustering (synonyms,
 * "how much does X cost" vs "X pricing") is deferred to the AI layer
 * (ai/brief.ts) where it can be reasoned about and labeled. What lives here
 * — canonicalizeTopic — is a cheap, deterministic step below that: it only
 * collapses topics that are the same words in a different order or form
 * ("Memory Care Pricing" / "Pricing for Memory Care"), so the gap list
 * doesn't double-count the obvious case before AI ever gets involved.
 */
export function extractPageTopics(page: PageRecord): string[] {
  const headings = [...page.h2, ...page.h3];
  const source = headings.length > 0 ? headings : page.h1.length > 0 ? page.h1 : titleAsTopic(page.title);
  return dedupe(source.map(normalizeTopic).filter(Boolean));
}

export function normalizeTopic(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[|:–—-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set([
  "a", "an", "the", "of", "for", "to", "in", "on", "with", "and", "or", "vs", "versus", "by", "at", "as",
  "how", "what", "why", "when", "where", "who", "which",
  "is", "are", "was", "were", "be", "being", "been", "do", "does", "did", "can", "will", "should",
  "near", "me", "your", "you", "our", "we", "it", "its", "this", "that", "these", "those",
]);

/**
 * A bag-of-words key for grouping near-duplicate topic phrasings: strips
 * stopwords, lightly stems plurals, and sorts the remaining words. Two
 * headings collapse to the same key regardless of word order or trivial
 * pluralization, but stay distinct if they're about different things.
 */
export function canonicalizeTopic(topic: string): string {
  const words = normalizeTopic(topic)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((word) => !STOPWORDS.has(word))
    .map(naiveStem)
    .sort();
  return words.join(" ");
}

function naiveStem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function titleAsTopic(title: string | null): string[] {
  return title ? [title] : [];
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}
