/**
 * A question as `GET /api/pdf/:pdfId/export` hands it over.
 *
 * Declared here rather than imported from `src/shared/schemas/export.ts`:
 * Node strips types without resolving extensions, and the shared schemas
 * import one another without them. `test/worker/pdf.test.ts` pins the shape
 * the endpoint answers with, and the script throws on a missing field rather
 * than writing a note with a hole in it.
 */
export interface NoteQuestion {
  questionId: string;
  question: string;
  answer: string | null;
  selectionId: string | null;
  quote: string | null;
  pageNumber: number | null;
  askedAt: string;
}

/** The book a note is about. */
export interface NoteBook {
  pdfId: string;
  fileName: string;
  pageCount: number;
}

/** How much of a question becomes its heading, so the embed link stays usable. */
const HEADING_MAX_CHARS = 60;

/** What stands in for an answer that was never saved. */
const ANSWER_MISSING = "（回答は保存されていません）";

/**
 * The heading a question gets.
 *
 * Obsidian embeds a section by its heading (`![[note#heading]]`), so the
 * characters that link cannot carry — `#`, the brackets, the pipe — come out,
 * and the heading is put on one line and cut.
 */
export function questionHeading(question: string): string {
  const oneLine = question
    .replace(/[#[\]|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return oneLine.length <= HEADING_MAX_CHARS ? oneLine : `${oneLine.slice(0, HEADING_MAX_CHARS)}…`;
}

/** What a new note starts with: the book, and the heading questions go under. */
export function renderNoteBody(book: NoteBook, title: string, baseUrl: string): string {
  return lines([
    `# ${title}`,
    "",
    `[リーダーで開く](${bookUrl(book, baseUrl)})`,
    "",
    "## 質問",
    "",
  ]);
}

/**
 * One question, ready to append.
 *
 * The link carries `?page=` and `?selection=`, the reader's own URL contract,
 * so pressing it in Obsidian opens the book at the passage. The block id at
 * the end names this one answer for when the heading is not unique.
 */
export function renderQuestion(book: NoteBook, question: NoteQuestion, baseUrl: string): string {
  const block = [`### ${questionHeading(question.question)}`, ""];
  if (question.quote !== null) {
    block.push(`> ${question.quote.replace(/\s+/g, " ").trim()}`, "");
  }
  block.push(
    question.answer === null ? ANSWER_MISSING : nestHeadings(question.answer),
    "",
    `${placeLabel(question)} [開く](${passageUrl(book, question, baseUrl)}) ^q-${blockId(question.questionId)}`,
    "",
    "---",
    "",
  );
  return lines(block);
}

/** The start of a fenced block, which heading-looking lines inside are not. */
const FENCE = /^\s*(`{3,}|~{3,})/;

/**
 * Pushes the answer's own headings below the question's.
 *
 * Every answer writes `## Sources`, and a model may write any heading it
 * likes. Left alone they sit above the question in the note's outline: the
 * question's `###` section ends at the first of them, so embedding that
 * section (`![[note#question]]`) would drop the rest of the answer — the
 * sources included — and the outline would fill with every answer's headings.
 *
 * A heading inside a fenced block is text rather than a heading, and the
 * answers carry mermaid and html fences, so fences are counted through.
 */
function nestHeadings(answer: string): string {
  let fence: string | null = null;
  return answer
    .split("\n")
    .map((line) => {
      const fenced = FENCE.exec(line);
      if (fenced) {
        const marker = fenced[1][0];
        if (fence === null) fence = marker;
        else if (marker === fence) fence = null;
        return line;
      }
      if (fence !== null) return line;
      const heading = /^(#{1,6})\s/.exec(line);
      if (!heading) return line;
      // One level below the question's `###`, and never past `######`.
      const depth = Math.min(6, heading[1].length + 3);
      return `${"#".repeat(depth)}${line.slice(heading[1].length)}`;
    })
    .join("\n");
}

function lines(parts: string[]): string {
  return `${parts.join("\n")}\n`;
}

function bookUrl(book: NoteBook, baseUrl: string): string {
  return `${baseUrl}/books/${book.pdfId}`;
}

function passageUrl(book: NoteBook, question: NoteQuestion, baseUrl: string): string {
  const url = new URL(bookUrl(book, baseUrl));
  if (question.pageNumber !== null) url.searchParams.set("page", String(question.pageNumber));
  if (question.selectionId !== null) url.searchParams.set("selection", question.selectionId);
  return url.toString();
}

function placeLabel(question: NoteQuestion): string {
  return question.pageNumber === null ? "— 本全体" : `— p.${question.pageNumber}`;
}

/** Obsidian block ids hold letters, digits and dashes, and ignore case. */
function blockId(questionId: string): string {
  return questionId.toLowerCase().replace(/[^a-z0-9-]/g, "");
}
