import { describe, it, expect } from "vite-plus/test";
import { searchBook } from "./bookSearch";

/** pdfLoader が作る fullText と同じ形 (ページ区切りは \f) */
function fullTextOf(...pages: string[]): string {
  return pages.join("\f");
}

describe("searchBook", () => {
  it("says which page a word sits on", () => {
    const book = fullTextOf("まえがき", "Athena は分析の中心です", "おわりに");

    const { hits, total } = searchBook(book, "Athena", 20);

    expect(total).toBe(1);
    expect(hits).toHaveLength(1);
    expect(hits[0].pageNumber).toBe(2);
  });

  it("lists every occurrence, in the order the book reads", () => {
    const book = fullTextOf("S3 の話", "Athena の話", "S3 と Athena の話");

    const { hits, total } = searchBook(book, "S3", 20);

    expect(total).toBe(2);
    expect(hits.map((h) => h.pageNumber)).toStrictEqual([1, 3]);
  });

  it("counts a word twice when one page holds it twice", () => {
    const book = fullTextOf("Glue と Glue の間");

    expect(searchBook(book, "Glue", 20).total).toBe(2);
  });

  // pdf.js joins text items with spaces, so the extracted text breaks words in
  // places the book does not. The same reason `chatService` strips whitespace
  // before looking for a quote.
  it("ignores the whitespace the extractor put inside a word", () => {
    const book = fullTextOf("データ 分析\n基盤 の設計");

    expect(searchBook(book, "データ分析基盤", 20).total).toBe(1);
  });

  it("ignores whitespace in the query too", () => {
    const book = fullTextOf("データ分析基盤の設計");

    expect(searchBook(book, " データ 分析 ", 20).total).toBe(1);
  });

  it("matches without regard to case", () => {
    const book = fullTextOf("AWS Glue は ETL の道具です");

    expect(searchBook(book, "aws glue", 20).total).toBe(1);
  });

  // Japanese books are full of full-width latin, and a reader types the plain
  // one. Folding both to the same shape is what makes the search usable.
  it("matches full-width letters against the half-width ones a reader types", () => {
    const book = fullTextOf("ＡＷＳ の料金体系");

    expect(searchBook(book, "AWS", 20).total).toBe(1);
  });

  it("takes the snippet from the book as it reads, not from the folded text", () => {
    const book = fullTextOf("前の文です。Athena の性能特性について。後ろの文です。");

    const [hit] = searchBook(book, "Athena", 20).hits;

    expect(hit.snippet).toContain("Athena の性能特性について");
    expect(hit.text).toBe("Athena");
  });

  it("says where the match sits inside the snippet", () => {
    const book = fullTextOf("Athena の話");

    const [hit] = searchBook(book, "Athena", 20).hits;

    expect(hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength)).toBe("Athena");
  });

  it("marks a snippet cut out of a longer page with an ellipsis", () => {
    const filler = "あ".repeat(100);
    const book = fullTextOf(`${filler}Athena${filler}`);

    const [hit] = searchBook(book, "Athena", 20).hits;

    expect(hit.snippet.startsWith("…")).toBe(true);
    expect(hit.snippet.endsWith("…")).toBe(true);
    expect(hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength)).toBe("Athena");
  });

  it("leaves off the ellipsis where the page itself begins and ends", () => {
    const book = fullTextOf("Athena だけ");

    const [hit] = searchBook(book, "Athena", 20).hits;

    expect(hit.snippet.startsWith("…")).toBe(false);
    expect(hit.snippet.endsWith("…")).toBe(false);
  });

  // Each page is searched on its own: a hit cannot name two pages, and a
  // snippet taken across the break would quote text the reader cannot see
  // from the page the hit points at.
  it("does not match a phrase that runs across a page break", () => {
    const book = fullTextOf("前半はデータ", "分析基盤の話");

    expect(searchBook(book, "データ分析基盤", 20).total).toBe(0);
  });

  it("finds nothing for a query with no characters to match on", () => {
    const book = fullTextOf("何かが書いてある");

    expect(searchBook(book, "   ", 20)).toStrictEqual({ hits: [], total: 0 });
    expect(searchBook(book, "", 20)).toStrictEqual({ hits: [], total: 0 });
  });

  // The list is what the reader scrolls; the count is what tells them whether
  // the word they picked is a good way to find the passage at all.
  it("stops filling the list at the limit while still counting the rest", () => {
    const book = fullTextOf("Glue Glue Glue Glue Glue");

    const { hits, total } = searchBook(book, "Glue", 2);

    expect(hits).toHaveLength(2);
    expect(total).toBe(5);
  });
});
