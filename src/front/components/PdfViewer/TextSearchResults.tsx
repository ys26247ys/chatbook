import type { TextSearchHit } from "../../../shared/schemas/textSearch";

/**
 * Where a query turned up in the book.
 *
 * The matched words are marked inside the snippet rather than found again by
 * searching it: the query matched a folded form of the text — whitespace gone,
 * case and full-width forms folded — so the snippet need not contain the query
 * as the reader typed it. The server says where it sits instead.
 */
function Snippet({ hit }: { hit: TextSearchHit }) {
  const before = hit.snippet.slice(0, hit.matchStart);
  const matched = hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength);
  const after = hit.snippet.slice(hit.matchStart + hit.matchLength);

  return (
    <span className="line-clamp-3 text-xs text-gray-600">
      {before}
      <mark className="bg-yellow-200 text-gray-900">{matched}</mark>
      {after}
    </span>
  );
}

export function TextSearchResults({
  hits,
  total,
  isSearching,
  onPick,
}: {
  hits: TextSearchHit[];
  total: number;
  isSearching: boolean;
  /** The page to turn to, and the words for the viewer to mark once it is there. */
  onPick: (pageNumber: number, text: string) => void;
}) {
  if (isSearching && hits.length === 0) {
    return <p className="p-3 text-xs text-gray-400">検索中...</p>;
  }

  if (hits.length === 0) {
    return <p className="p-3 text-xs text-gray-400">見つかりませんでした</p>;
  }

  return (
    <>
      {/* What the list holds, against what the book holds. A reader who
          searched for a common word needs to know the list is not all of it. */}
      <p className="shrink-0 px-3 py-1 text-xs text-gray-500">
        {total > hits.length ? `${total}件中 ${hits.length}件` : `${total}件`}
      </p>
      <ul aria-label="本文の検索結果" className="flex-1 overflow-y-auto pb-1">
        {hits.map((hit, i) => (
          <li key={`${hit.pageNumber}-${hit.matchStart}-${i}`}>
            <button
              type="button"
              onClick={() => onPick(hit.pageNumber, hit.text)}
              className="flex w-full cursor-pointer flex-col gap-0.5 px-3 py-2 text-left hover:bg-gray-50"
            >
              <span className="text-xs font-medium text-blue-600">p.{hit.pageNumber}</span>
              <Snippet hit={hit} />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
