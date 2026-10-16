import { useCallback, useState } from "react";
import useSWR from "swr";
import { fetcher } from "../lib/fetcher";
import { textSearchOutcomeSchema, type TextSearchOutcome } from "../../shared/schemas/textSearch";

/** Asks where a query appears in the book's own text. */
export type SearchText = (pdfId: string, query: string) => Promise<TextSearchOutcome>;

const searchKey = (pdfId: string, query: string) =>
  `/api/pdf/${pdfId}/text-search?q=${encodeURIComponent(query)}`;

export const requestTextSearch: SearchText = (pdfId, query) =>
  fetcher(searchKey(pdfId, query), textSearchOutcomeSchema);

/**
 * What the reader is looking for in the book, and where it turned up.
 *
 * The search is the server's because the book's text is: it was extracted once
 * at upload for the model to read, and asking D1 for it costs nothing the
 * browser would not pay twice over to download a second copy of a 200-page book.
 *
 * Nothing is asked until `submit`, as in `useHighlightSearch`: typing is not
 * searching, and a round trip per keystroke would run on half a Japanese word.
 */
export function useTextSearch(pdfId: string | undefined, search: SearchText = requestTextSearch) {
  /** As typed, which is not yet what is being looked for. */
  const [query, setQuery] = useState("");
  /** What the reader last asked to be searched for. */
  const [term, setTerm] = useState("");

  const submit = useCallback(() => setTerm(query.trim()), [query]);

  const searching = pdfId !== undefined && term !== "";
  const { data, error, isLoading } = useSWR(
    searching ? searchKey(pdfId, term) : null,
    () => search(pdfId as string, term),
    // The results stay put while the next search is on its way, rather than
    // flashing the outline back for a moment.
    { keepPreviousData: true },
  );

  return {
    query,
    setQuery,
    /** Runs the search for whatever is in the box, clearing it if it is empty. */
    submit,
    /** What the last search found, or null while nothing is being searched for. */
    outcome: searching ? (data ?? null) : null,
    /** Whether the panel is showing results rather than the outline. */
    searching,
    isSearching: isLoading,
    searchError: error instanceof Error ? error.message : undefined,
  };
}
