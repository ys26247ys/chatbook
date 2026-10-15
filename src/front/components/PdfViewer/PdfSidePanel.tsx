import { PdfOutline } from "./PdfOutline";
import { TextSearchResults } from "./TextSearchResults";
import { useTextSearch, type SearchText } from "../../hooks/useTextSearch";
import { isSubmitKey } from "../../lib/isSubmitKey";
import type { OutlineEntry } from "../../hooks/usePdfOutline";

const SEARCH_INPUT_CLASS =
  "rounded border border-gray-300 px-2 py-1 text-sm text-gray-700 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none";

/**
 * The column beside the page: where the book is indexed, and where it is
 * searched.
 *
 * The two share one panel because they answer the same question — which page
 * holds the thing the reader is after — and because a book has only one column
 * of room beside it. The box stays put while the list below it swaps: the
 * outline when nothing is being searched for, the hits when something is.
 *
 * Searching the book is not the same as searching what the reader marked; that
 * one lives on the other side, in `HighlightListPanel`.
 */
export function PdfSidePanel({
  pdfId,
  outline,
  outlineError,
  currentPage,
  onJump,
  onJumpToHit,
  search,
}: {
  pdfId: string | undefined;
  outline: OutlineEntry[] | null;
  outlineError: string | null;
  currentPage: number;
  /** Where an outline entry sends the reader. */
  onJump: (pageNumber: number) => void;
  /** Where a hit sends them, and the words the viewer marks once there. */
  onJumpToHit: (pageNumber: number, text: string) => void;
  search?: SearchText;
}) {
  const { query, setQuery, submit, outcome, searching, isSearching, searchError } = useTextSearch(
    pdfId,
    search,
  );

  return (
    <div className="flex w-60 shrink-0 flex-col border-r border-gray-200 bg-white">
      <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-3 py-2">
        <input
          type="search"
          aria-label="本文を検索"
          placeholder="本文を検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          // Enter runs it too, but not the Enter that confirms a Japanese
          // word: that one belongs to the IME, and searching there would run
          // on half a phrase.
          onKeyDown={(e) => {
            if (isSubmitKey(e.nativeEvent as unknown as KeyboardEvent)) {
              e.preventDefault();
              submit();
            }
          }}
          className={`min-w-0 flex-1 ${SEARCH_INPUT_CLASS}`}
        />
        <button
          type="button"
          onClick={submit}
          className="shrink-0 cursor-pointer rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
        >
          検索
        </button>
      </div>

      {searchError !== undefined && (
        <p role="alert" className="m-2 rounded-md bg-red-50 p-2 text-xs text-red-600">
          検索に失敗しました: {searchError}
        </p>
      )}

      {searching && searchError === undefined ? (
        <TextSearchResults
          hits={outcome?.hits ?? []}
          total={outcome?.total ?? 0}
          isSearching={isSearching}
          onPick={onJumpToHit}
        />
      ) : (
        <PdfOutline
          outline={outline}
          error={outlineError}
          currentPage={currentPage}
          onJump={onJump}
        />
      )}
    </div>
  );
}
