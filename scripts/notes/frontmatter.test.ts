import { describe, it, expect } from "vite-plus/test";
import {
  parseNoteState,
  renderNoteState,
  replaceNoteState,
  type NoteState,
} from "./frontmatter.ts";

const STATE: NoteState = {
  pdfId: "01KZ8XYZ",
  fileName: "達人プログラマー.pdf",
  pageCount: 449,
  lastExportedAt: "2026-11-18T09:12:03.411Z",
  questionsCount: 12,
};

describe("renderNoteState", () => {
  it("writes the block a note starts with", () => {
    expect(renderNoteState(STATE)).toBe(
      [
        "---",
        "book-chat:",
        "  pdfId: 01KZ8XYZ",
        "  fileName: '達人プログラマー.pdf'",
        "  pageCount: 449",
        "  lastExportedAt: '2026-11-18T09:12:03.411Z'",
        "  questionsCount: 12",
        "---",
        "",
      ].join("\n"),
    );
  });

  it("quotes a name holding a quote rather than breaking the block", () => {
    expect(renderNoteState({ ...STATE, fileName: "it's here.pdf" })).toContain(
      "  fileName: 'it''s here.pdf'",
    );
  });
});

describe("parseNoteState", () => {
  it("reads back what it wrote", () => {
    expect(parseNoteState(`${renderNoteState(STATE)}# 達人プログラマー\n`)).toStrictEqual(STATE);
  });

  it("says nothing readable for a note with no block at all", () => {
    expect(parseNoteState("# 達人プログラマー\n")).toBeNull();
  });

  it("says nothing readable when the timestamp is gone", () => {
    const without = renderNoteState(STATE).replace(/ {2}lastExportedAt: .*\n/, "");

    expect(parseNoteState(without)).toBeNull();
  });

  it("says nothing readable when a count is not a number", () => {
    const broken = renderNoteState(STATE).replace("questionsCount: 12", "questionsCount: たくさん");

    expect(parseNoteState(broken)).toBeNull();
  });
});

describe("replaceNoteState", () => {
  it("swaps the block and leaves the body alone", () => {
    const note = `${renderNoteState(STATE)}# 達人プログラマー\n\n### 質問\n`;

    const swapped = replaceNoteState(note, { ...STATE, questionsCount: 13 });

    expect(swapped).toContain("  questionsCount: 13");
    expect(swapped).not.toContain("  questionsCount: 12");
    expect(swapped.endsWith("# 達人プログラマー\n\n### 質問\n")).toBe(true);
  });

  it("puts a block in front of a note that had none", () => {
    expect(replaceNoteState("# 達人プログラマー\n", STATE)).toBe(
      `${renderNoteState(STATE)}# 達人プログラマー\n`,
    );
  });
});
