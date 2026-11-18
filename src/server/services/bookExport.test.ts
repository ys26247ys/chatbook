import { describe, it, expect } from "vite-plus/test";
import { pairQuestions, type ExportRow } from "./bookExport";

const QUOTE = "直交性とは、ある一つの変更が他に波及しないことを言う。";

/** A `chat_messages` row as the join hands it over, defaulting to a highlight's. */
function row(fields: {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  selectionId?: string | null;
  selectedText?: string | null;
  pageNumber?: number | null;
}): ExportRow {
  return {
    id: fields.id,
    role: fields.role,
    content: fields.content,
    createdAt: fields.createdAt,
    selectionId: fields.selectionId === undefined ? "sel-1" : fields.selectionId,
    selectedText: fields.selectedText === undefined ? QUOTE : fields.selectedText,
    pageNumber: fields.pageNumber === undefined ? 112 : fields.pageNumber,
  };
}

describe("pairQuestions", () => {
  it("pairs a question with the answer that followed it", () => {
    const paired = pairQuestions(
      [
        row({
          id: "q1",
          role: "user",
          content: "直交性と疎結合はどう違う？",
          createdAt: "2026-11-01T00:00:00.000Z",
        }),
        row({
          id: "a1",
          role: "assistant",
          content: "疎結合は……",
          createdAt: "2026-11-01T00:00:05.000Z",
        }),
      ],
      null,
    );

    expect(paired).toStrictEqual([
      {
        questionId: "q1",
        question: "直交性と疎結合はどう違う？",
        answerId: "a1",
        answer: "疎結合は……",
        selectionId: "sel-1",
        quote: QUOTE,
        pageNumber: 112,
        askedAt: "2026-11-01T00:00:00.000Z",
      },
    ]);
  });

  it("leaves the answer null when none was ever saved", () => {
    const paired = pairQuestions(
      [row({ id: "q1", role: "user", content: "これは？", createdAt: "2026-11-01T00:00:00.000Z" })],
      null,
    );

    expect(paired).toHaveLength(1);
    expect(paired[0].answerId).toBeNull();
    expect(paired[0].answer).toBeNull();
  });

  it("carries no passage for a question about the book itself", () => {
    const paired = pairQuestions(
      [
        row({
          id: "q1",
          role: "user",
          content: "この本の主張を3つに",
          createdAt: "2026-11-01T00:00:00.000Z",
          selectionId: null,
          selectedText: null,
          pageNumber: null,
        }),
      ],
      null,
    );

    expect(paired[0]).toMatchObject({ selectionId: null, quote: null, pageNumber: null });
  });

  it("keeps two conversations apart when their turns interleave in time", () => {
    const paired = pairQuestions(
      [
        row({ id: "q1", role: "user", content: "一つ目", createdAt: "2026-11-01T00:00:00.000Z" }),
        row({
          id: "q2",
          role: "user",
          content: "二つ目",
          createdAt: "2026-11-01T00:00:01.000Z",
          selectionId: "sel-2",
        }),
        row({
          id: "a1",
          role: "assistant",
          content: "一つ目の答え",
          createdAt: "2026-11-01T00:00:02.000Z",
        }),
        row({
          id: "a2",
          role: "assistant",
          content: "二つ目の答え",
          createdAt: "2026-11-01T00:00:03.000Z",
          selectionId: "sel-2",
        }),
      ],
      null,
    );

    expect(paired.map((q) => [q.questionId, q.answerId])).toStrictEqual([
      ["q1", "a1"],
      ["q2", "a2"],
    ]);
  });

  it("drops an answer whose question went out in an earlier run", () => {
    const paired = pairQuestions(
      [
        row({
          id: "a1",
          role: "assistant",
          content: "答えだけ",
          createdAt: "2026-11-01T00:00:05.000Z",
        }),
      ],
      null,
    );

    expect(paired).toStrictEqual([]);
  });

  it("leaves out the questions the note already holds", () => {
    const paired = pairQuestions(
      [
        row({ id: "q1", role: "user", content: "古い", createdAt: "2026-11-01T00:00:00.000Z" }),
        row({ id: "q2", role: "user", content: "新しい", createdAt: "2026-11-02T00:00:00.000Z" }),
      ],
      "2026-11-01T00:00:00.000Z",
    );

    expect(paired.map((q) => q.questionId)).toStrictEqual(["q2"]);
  });

  it("puts the oldest question first however the rows arrived", () => {
    const paired = pairQuestions(
      [
        row({ id: "late", role: "user", content: "あと", createdAt: "2026-11-01T00:00:02.000Z" }),
        row({
          id: "early",
          role: "user",
          content: "さき",
          createdAt: "2026-11-01T00:00:01.000Z",
          selectionId: "sel-2",
        }),
      ],
      null,
    );

    expect(paired.map((q) => q.questionId)).toStrictEqual(["early", "late"]);
  });
});
