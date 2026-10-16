import { z } from "zod";

/**
 * The most hits one response carries. The count still reports the rest.
 *
 * Not to be confused with the highlight search (`selection.ts`), which looks
 * through what the reader marked and said; this one looks through the book.
 */
export const TEXT_SEARCH_HIT_LIMIT = 100;

/** The longest query the server will look for, so a pasted page is refused. */
export const TEXT_SEARCH_QUERY_MAX = 200;

export const textSearchQuerySchema = z.object({
  q: z.string().min(1).max(TEXT_SEARCH_QUERY_MAX),
});

export type TextSearchQuery = z.infer<typeof textSearchQuerySchema>;

/**
 * One place a query appears in a book.
 *
 * `snippet` is the book's own text around the match, with runs of whitespace
 * collapsed; `matchStart` / `matchLength` say where inside it the match sits,
 * since the match cannot be found again by searching the snippet (the query
 * matched a folded form of the text, not the text).
 *
 * `text` is the matched passage as the book spells it, which is what the
 * viewer hands `citedPassageOnPage` to put a mark on the page.
 */
export const textSearchHitSchema = z.object({
  pageNumber: z.number().int().positive(),
  snippet: z.string(),
  matchStart: z.number().int().nonnegative(),
  matchLength: z.number().int().nonnegative(),
  text: z.string(),
});

export type TextSearchHit = z.infer<typeof textSearchHitSchema>;

/** `total` counts every match in the book; `hits` stops at `TEXT_SEARCH_HIT_LIMIT`. */
export const textSearchOutcomeSchema = z.object({
  hits: z.array(textSearchHitSchema),
  total: z.number().int().nonnegative(),
});

export type TextSearchOutcome = z.infer<typeof textSearchOutcomeSchema>;
