import { describe, it, expect } from "vite-plus/test";
import {
  questionHeading,
  renderNoteBody,
  renderQuestion,
  type NoteBook,
  type NoteQuestion,
} from "./renderNote.ts";

const BASE = "https://chatbook.example.workers.dev";

const BOOK: NoteBook = { pdfId: "01KZ8XYZ", fileName: "達人プログラマー.pdf", pageCount: 449 };

function question(fields: Partial<NoteQuestion> = {}): NoteQuestion {
  return {
    questionId: "01KY4ABC",
    question: "直交性と疎結合はどう違うんですか？",
    answer: "疎結合は……",
    selectionId: "01KY4SEL",
    quote: "直交性とは、ある一つの変更が他に波及しないことを言う。",
    pageNumber: 112,
    askedAt: "2026-11-01T00:00:00.000Z",
    ...fields,
  };
}

describe("renderNoteBody", () => {
  it("opens a new note with the book and a way into the reader", () => {
    expect(renderNoteBody(BOOK, "達人プログラマー", BASE)).toBe(
      [
        "# 達人プログラマー",
        "",
        `[リーダーで開く](${BASE}/books/01KZ8XYZ)`,
        "",
        "## 質問",
        "",
        "",
      ].join("\n"),
    );
  });
});

describe("renderQuestion", () => {
  it("writes the question as a section with the passage above the answer", () => {
    expect(renderQuestion(BOOK, question(), BASE)).toBe(
      [
        "### 直交性と疎結合はどう違うんですか？",
        "",
        "> 直交性とは、ある一つの変更が他に波及しないことを言う。",
        "",
        "疎結合は……",
        "",
        `— p.112 [開く](${BASE}/books/01KZ8XYZ?page=112&selection=01KY4SEL) ^q-01ky4abc`,
        "",
        "---",
        "",
        "",
      ].join("\n"),
    );
  });

  it("says the question was about the whole book when nothing hangs under it", () => {
    const block = renderQuestion(
      BOOK,
      question({ selectionId: null, quote: null, pageNumber: null }),
      BASE,
    );

    expect(block).toContain(`— 本全体 [開く](${BASE}/books/01KZ8XYZ)`);
    expect(block).not.toContain(">");
  });

  it("pushes the answer's own headings below the question's", () => {
    const block = renderQuestion(
      BOOK,
      question({ answer: "まとめです。\n\n## Sources\n[1] 「引用」" }),
      BASE,
    );

    expect(block).toContain("\n##### Sources\n");
    expect(block).not.toContain("\n## Sources\n");
  });

  it("leaves a heading inside a fence as the text it is", () => {
    const answer = "図です。\n\n```html\n<h1>題</h1>\n# これは見出しではない\n```";

    expect(renderQuestion(BOOK, question({ answer }), BASE)).toContain(
      "\n# これは見出しではない\n",
    );
  });

  it("says so rather than going quiet when the answer was never saved", () => {
    expect(renderQuestion(BOOK, question({ answer: null }), BASE)).toContain(
      "（回答は保存されていません）",
    );
  });
});

describe("questionHeading", () => {
  it("keeps a question that fits", () => {
    expect(questionHeading("直交性とは？")).toBe("直交性とは？");
  });

  it("cuts a question too long to be a heading", () => {
    const long = "あ".repeat(80);

    expect(questionHeading(long)).toBe(`${"あ".repeat(60)}…`);
  });

  it("leaves out what an embed link cannot carry", () => {
    expect(questionHeading("これは #見出し や [[リンク]] や | を含む")).toBe(
      "これは 見出し や リンク や を含む",
    );
  });

  it("puts a question written over two lines on one", () => {
    expect(questionHeading("前半\n後半")).toBe("前半 後半");
  });
});
