import { describe, it, expect } from "vite-plus/test";
import { noteFileName } from "./vaultPath.ts";

describe("noteFileName", () => {
  it("names the note after the book", () => {
    expect(noteFileName("達人プログラマー.pdf")).toBe("達人プログラマー.md");
  });

  it("drops the extension whatever its case", () => {
    expect(noteFileName("達人プログラマー.PDF")).toBe("達人プログラマー.md");
  });

  it("turns a path separator into a space rather than a folder", () => {
    expect(noteFileName("達人/プログラマー.pdf")).toBe("達人 プログラマー.md");
  });

  it("collapses the spaces a replacement leaves behind", () => {
    expect(noteFileName("達人//プログラマー.pdf")).toBe("達人 プログラマー.md");
  });

  it("keeps a note that would be hidden out of hiding", () => {
    expect(noteFileName(".隠れた本.pdf")).toBe("隠れた本.md");
  });

  it("falls back to a name when the book's leaves nothing", () => {
    expect(noteFileName(".pdf")).toBe("untitled.md");
  });
});
