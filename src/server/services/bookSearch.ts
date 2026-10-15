import type { TextSearchHit, TextSearchOutcome } from "../../shared/schemas/textSearch";

/** `pdfLoader` joins the pages it extracted with this, as `chatService` reads them. */
const PAGE_DELIMITER = "\f";

/** How much of the book to show on either side of a match. */
const CONTEXT_CHARS = 40;

/**
 * A page folded into the shape matching happens in, with the way back out.
 *
 * Three things are folded away, each because the reader's query and the
 * extracted text disagree about it rather than about the words:
 *
 * - whitespace, which pdf.js inserts between text items and so lands inside
 *   words (the reason `chatService.findPageNumber` strips it too)
 * - case, since nobody types `AWS` to avoid matching `aws`
 * - compatibility forms, so the full-width latin a Japanese book is typeset
 *   with answers to the half-width letters a reader types
 *
 * `sources` holds, for each character of `folded`, the index in the original
 * page it came from. Without it a match could only be reported as folded text,
 * which is not what the book says.
 */
interface FoldedPage {
  folded: string;
  sources: number[];
}

function fold(text: string): FoldedPage {
  let folded = "";
  const sources: number[] = [];
  let index = 0;

  // Iterating the string itself walks code points, so a surrogate pair is one
  // character here and `index` still counts the UTF-16 units `slice` wants.
  for (const char of text) {
    const at = index;
    index += char.length;
    if (/\s/.test(char)) continue;

    // NFKC can turn one character into several (a ligature, a full-width
    // bracket); every one of them points back at the character it came from.
    for (const mapped of char.normalize("NFKC").toLowerCase()) {
      folded += mapped;
      sources.push(at);
    }
  }

  return { folded, sources };
}

/** How many UTF-16 units the character starting at `index` takes. */
function charLengthAt(text: string, index: number): number {
  const code = text.codePointAt(index);
  return code !== undefined && code > 0xffff ? 2 : 1;
}

/** Runs of whitespace become single spaces, so a snippet reads as one line. */
function collapse(text: string): string {
  return text.replace(/\s+/g, " ");
}

function hitAt(pageNumber: number, page: string, start: number, end: number): TextSearchHit {
  const from = Math.max(0, start - CONTEXT_CHARS);
  const to = Math.min(page.length, end + CONTEXT_CHARS);

  const before = (from > 0 ? "…" : "") + collapse(page.slice(from, start)).trimStart();
  const matched = collapse(page.slice(start, end));
  const after = collapse(page.slice(end, to)).trimEnd() + (to < page.length ? "…" : "");

  return {
    pageNumber,
    snippet: before + matched + after,
    matchStart: before.length,
    matchLength: matched.length,
    text: matched,
  };
}

/**
 * Every place a query appears in a book, with the page each one sits on.
 *
 * Pages are searched one at a time, so a phrase broken by a page break is not
 * found: a hit names one page, and a snippet taken across the break would quote
 * text the reader cannot see from the page the hit points at.
 *
 * `total` counts every match while `hits` stops at `limit`, because the count
 * is what tells a reader whether the word they picked narrows the book down at
 * all — a list capped at 50 of 400 looks the same as one capped at 50 of 51.
 */
export function searchBook(fullText: string, query: string, limit: number): TextSearchOutcome {
  const needle = fold(query).folded;
  if (!needle) return { hits: [], total: 0 };

  const hits: TextSearchHit[] = [];
  let total = 0;

  fullText.split(PAGE_DELIMITER).forEach((page, index) => {
    const { folded, sources } = fold(page);

    for (let at = folded.indexOf(needle); at >= 0; at = folded.indexOf(needle, at + 1)) {
      total += 1;
      if (hits.length >= limit) continue;

      const start = sources[at];
      const lastChar = sources[at + needle.length - 1];
      hits.push(hitAt(index + 1, page, start, lastChar + charLengthAt(page, lastChar)));
    }
  });

  return { hits, total };
}
