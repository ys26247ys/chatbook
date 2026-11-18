/**
 * What a note remembers about itself.
 *
 * `lastExportedAt` is the whole increment mechanism: the next run asks the
 * endpoint for what came after it. It lives in the frontmatter rather than in
 * a state file of its own because the reader prunes the body as they
 * transcribe — what they removed must not come back, and the frontmatter is
 * the one part of the note they never touch.
 */
export interface NoteState {
  pdfId: string;
  fileName: string;
  pageCount: number;
  lastExportedAt: string;
  questionsCount: number;
}

/** The leading `---` block, body and all, as written by `renderNoteState`. */
const BLOCK = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/**
 * Reads what a note says about itself, or null when it says nothing readable.
 *
 * Null is not "nothing written yet". A note that cannot be read must be left
 * alone: treating it as empty would append the whole book on top of what is
 * already there.
 */
export function parseNoteState(text: string): NoteState | null {
  const block = BLOCK.exec(text);
  if (!block) return null;

  const fields = new Map<string, string>();
  for (const line of block[0].split(/\r?\n/)) {
    const field = /^ {2}([a-zA-Z]+): (.*)$/.exec(line);
    if (field) fields.set(field[1], unquote(field[2]));
  }

  const pdfId = fields.get("pdfId");
  const fileName = fields.get("fileName");
  const lastExportedAt = fields.get("lastExportedAt");
  const pageCount = Number(fields.get("pageCount"));
  const questionsCount = Number(fields.get("questionsCount"));
  if (pdfId === undefined || fileName === undefined || lastExportedAt === undefined) return null;
  if (!Number.isInteger(pageCount) || !Number.isInteger(questionsCount)) return null;

  return { pdfId, fileName, pageCount, lastExportedAt, questionsCount };
}

/** The block a note starts with, ending in the newline the body follows. */
export function renderNoteState(state: NoteState): string {
  return [
    "---",
    "book-chat:",
    `  pdfId: ${state.pdfId}`,
    `  fileName: ${quote(state.fileName)}`,
    `  pageCount: ${state.pageCount}`,
    `  lastExportedAt: ${quote(state.lastExportedAt)}`,
    `  questionsCount: ${state.questionsCount}`,
    "---",
    "",
  ].join("\n");
}

/** Swaps a note's block for a new one, leaving the body untouched. */
export function replaceNoteState(text: string, state: NoteState): string {
  const block = BLOCK.exec(text);
  const body = block ? text.slice(block[0].length) : text;
  return `${renderNoteState(state)}${body}`;
}

/** YAML would read a bare timestamp as a date and a bare `: ` as a mapping. */
function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function unquote(value: string): string {
  const quoted = /^'([\s\S]*)'$/.exec(value);
  return quoted ? quoted[1].replace(/''/g, "'") : value;
}
