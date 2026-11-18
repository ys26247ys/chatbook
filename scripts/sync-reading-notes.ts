/**
 * Writes the questions of every book into the reading-notes vault.
 *
 *     pnpm run notes:sync
 *
 * Needs Node 24 — this file is TypeScript handed straight to node, and type
 * stripping is only unflagged from 23.6 (see `.nvmrc`). The relative imports
 * carry their `.ts` for the same reason: stripping does not resolve
 * extensions, which is also why nothing here comes from `src/`.
 *
 * Reads the deployment named by CHATBOOK_URL (default: the local dev server),
 * signing in as CHATBOOK_USER with the password from CHATBOOK_PASSWORD or, with
 * that unset, the login keychain:
 *
 *     security add-generic-password -s chatbook -a <user> -w
 *
 * Notes land in CHATBOOK_VAULT, one file per book, appended to.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { noteFileName } from "./notes/vaultPath.ts";
import {
  renderNoteBody,
  renderQuestion,
  type NoteBook,
  type NoteQuestion,
} from "./notes/renderNote.ts";
import {
  parseNoteState,
  renderNoteState,
  replaceNoteState,
  type NoteState,
} from "./notes/frontmatter.ts";

const BASE_URL = (process.env.CHATBOOK_URL ?? "http://localhost:5173").replace(/\/+$/, "");
const USER = process.env.CHATBOOK_USER ?? "demo";
const KEYCHAIN_SERVICE = process.env.CHATBOOK_KEYCHAIN ?? "chatbook";
const VAULT =
  process.env.CHATBOOK_VAULT ??
  path.join(os.homedir(), "Library/Mobile Documents/iCloud~md~obsidian/Documents/reading/books");

interface BookRow {
  id: string;
  fileName: string;
}

interface BookExportResponse {
  pdfId: string;
  fileName: string;
  pageCount: number;
  questions: NoteQuestion[];
}

function password(): string {
  const given = process.env.CHATBOOK_PASSWORD;
  if (given !== undefined && given !== "") return given;
  return execFileSync(
    "security",
    ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", USER, "-w"],
    { encoding: "utf8" },
  ).trim();
}

async function logIn(): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: password() }),
  });
  if (!response.ok) {
    throw new Error(`ログインできませんでした (${BASE_URL}): ${response.status}`);
  }
  const cookie = response.headers
    .getSetCookie()
    .map((header) => header.split(";")[0])
    .join("; ");
  if (cookie === "") throw new Error("セッションの Cookie が返りませんでした");
  return cookie;
}

async function readJson(cookie: string, url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { Cookie: cookie } });
  if (!response.ok) throw new Error(`${url} が ${response.status} を返しました`);
  return response.json();
}

async function listBooks(cookie: string): Promise<BookRow[]> {
  const { books } = (await readJson(cookie, `${BASE_URL}/api/pdfs`)) as { books: BookRow[] };
  return books;
}

async function exportBook(
  cookie: string,
  pdfId: string,
  since: string | null,
): Promise<BookExportResponse> {
  const url = new URL(`${BASE_URL}/api/pdf/${pdfId}/export`);
  if (since !== null) url.searchParams.set("since", since);
  return (await readJson(cookie, url.toString())) as BookExportResponse;
}

/** Fails loudly rather than writing a note with a hole where a field should be. */
function checked(question: NoteQuestion, fileName: string): NoteQuestion {
  if (
    typeof question.questionId !== "string" ||
    typeof question.question !== "string" ||
    typeof question.askedAt !== "string"
  ) {
    throw new Error(`${fileName}: 応答の質問にフィールドが足りません`);
  }
  return question;
}

function latestAskedAt(questions: NoteQuestion[]): string {
  return questions.reduce((latest, q) => (q.askedAt > latest ? q.askedAt : latest), "");
}

async function syncBook(cookie: string, book: BookRow): Promise<void> {
  const file = path.join(VAULT, noteFileName(book.fileName));
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;

  let state: NoteState | null = null;
  if (existing !== null) {
    state = parseNoteState(existing);
    if (state === null) {
      console.error(`飛ばしました（frontmatter が読めません）: ${file}`);
      return;
    }
  }

  const exported = await exportBook(cookie, book.id, state === null ? null : state.lastExportedAt);
  const questions = exported.questions.map((q) => checked(q, book.fileName));
  if (questions.length === 0) return;

  const noteBook: NoteBook = {
    pdfId: exported.pdfId,
    fileName: exported.fileName,
    pageCount: exported.pageCount,
  };
  const title = noteFileName(exported.fileName).replace(/\.md$/, "");
  const blocks = questions.map((q) => renderQuestion(noteBook, q, BASE_URL)).join("");
  const nextState: NoteState = {
    pdfId: exported.pdfId,
    fileName: exported.fileName,
    pageCount: exported.pageCount,
    lastExportedAt: latestAskedAt(questions),
    // Counted up rather than read off the note: the reader prunes the body.
    questionsCount: (state === null ? 0 : state.questionsCount) + questions.length,
  };

  const note =
    existing === null
      ? `${renderNoteState(nextState)}${renderNoteBody(noteBook, title, BASE_URL)}${blocks}`
      : replaceNoteState(
          `${existing.endsWith("\n") ? existing : `${existing}\n`}${blocks}`,
          nextState,
        );
  fs.writeFileSync(file, note);
  console.log(`${questions.length} 件: ${file}`);
}

async function main(): Promise<void> {
  fs.mkdirSync(VAULT, { recursive: true });
  const cookie = await logIn();
  for (const book of await listBooks(cookie)) {
    await syncBook(cookie, book);
  }
}

await main();
