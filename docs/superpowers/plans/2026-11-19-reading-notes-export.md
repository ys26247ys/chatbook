# 読書メモへの書き出し 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本を読んで AI にした質問と回答を、新しい Obsidian ボルトへ 1 冊 1 ファイルの Markdown として追記で書き出す。

**Architecture:** Worker に書き出し専用のエンドポイント 1 本（`GET /api/pdf/:pdfId/export?since=`）を足し、質問と回答を対にするのは純粋関数に切り出す。Obsidian の書式は `scripts/notes/` の純粋関数が持ち、`scripts/sync-reading-notes.ts` がログイン・取得・ファイルへの追記だけを担う。どこまで書いたかはノートの frontmatter の `lastExportedAt` が覚える。

**Tech Stack:** Hono / drizzle (D1) / zod / neverthrow / vitest (jsdom と workers pool) / Node 24 の type stripping

**設計:** `docs/superpowers/specs/2026-11-18-reading-notes-export-design.md`

---

## ファイル構成

| ファイル                            | 役割                                                        |
| ----------------------------------- | ----------------------------------------------------------- |
| `src/shared/schemas/export.ts`      | ワイヤの形（質問・本・`since`）                             |
| `src/server/services/bookExport.ts` | 質問と回答を対にする純粋関数                                |
| `src/server/services/pdfService.ts` | `readBookExport` を足す（D1、`ResultAsync`）                |
| `src/server/routes/pdf.ts`          | `GET /pdf/:pdfId/export` を足す                             |
| `scripts/tsconfig.json`             | `scripts/` を型チェックに入れる（今はどこにも入っていない） |
| `scripts/notes/vaultPath.ts`        | 本の名前からノートのファイル名を作る                        |
| `scripts/notes/frontmatter.ts`      | ノートが自分について覚えていることの読み・書き              |
| `scripts/notes/renderNote.ts`       | ノートの本文と質問 1 件のブロックを組む                     |
| `scripts/sync-reading-notes.ts`     | ログイン・取得・追記（I/O だけ。テストしない）              |

**`scripts/notes/` は `src/` から何も import しない。** Node の type stripping は拡張子を解決せず、`src/shared/schemas/*.ts` どうしの import は拡張子なしで書かれているため。`scripts/` の中の相対 import には `.ts` を明示する。

---

### Task 1: 質問と回答を対にする

質問と回答は別の行なので、対にする規則を純粋関数に切り出す。ここが増分の正しさの土台になる。

**Files:**

- Create: `src/shared/schemas/export.ts`
- Create: `src/server/services/bookExport.ts`
- Test: `src/server/services/bookExport.test.ts`

- [ ] **Step 1: ワイヤの形を書く**

`src/shared/schemas/export.ts`:

```ts
import { z } from "zod";

/**
 * One question of a book's reading notes, with the answer it got.
 *
 * `answer` is null for a question whose answer was never saved
 * (`CHAT_SAVE_FAILED`): what the reader asked is worth keeping even when the
 * reply is gone.
 *
 * `selectionId` null names the book's own conversation, which hangs off no
 * passage — so `quote` and `pageNumber` are null alongside it.
 */
export const exportedQuestionSchema = z.object({
  questionId: z.string(),
  question: z.string(),
  answerId: z.string().nullable(),
  answer: z.string().nullable(),
  selectionId: z.string().nullable(),
  quote: z.string().nullable(),
  pageNumber: z.number().int().positive().nullable(),
  askedAt: z.string(),
});

export type ExportedQuestion = z.infer<typeof exportedQuestionSchema>;

/** A book's questions, oldest first, as the notes script receives them. */
export const bookExportSchema = z.object({
  pdfId: z.string(),
  fileName: z.string(),
  pageCount: z.number().int().positive(),
  questions: z.array(exportedQuestionSchema),
});

export type BookExport = z.infer<typeof bookExportSchema>;

/**
 * `since` is the `askedAt` of the last question already written into the note,
 * so only what came after it is sent. Absent asks for the whole book.
 */
export const bookExportQuerySchema = z.object({
  since: z.iso.datetime().optional(),
});

export type BookExportQuery = z.infer<typeof bookExportQuerySchema>;
```

- [ ] **Step 2: 落ちるテストを書く**

`src/server/services/bookExport.test.ts`:

```ts
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
```

- [ ] **Step 3: 落ちることを確かめる**

Run: `vp exec vitest run src/server/services/bookExport.test.ts`
Expected: FAIL — `Failed to resolve import "./bookExport"`

- [ ] **Step 4: 最小の実装を書く**

`src/server/services/bookExport.ts`:

```ts
import type { ExportedQuestion } from "../../shared/schemas/export";

/**
 * One `chat_messages` row of a book, with the passage it hangs off.
 *
 * The passage columns come from an outer join: the book's own conversation
 * hangs off nothing, so they are null there.
 */
export interface ExportRow {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  selectionId: string | null;
  selectedText: string | null;
  pageNumber: number | null;
}

/**
 * Pairs each question with the answer that followed it.
 *
 * Questions and answers are separate rows, so this walks each conversation in
 * time order: a `user` row's answer is the `assistant` row right after it, and
 * a question whose answer was never saved (`CHAT_SAVE_FAILED`) keeps a null.
 *
 * An `assistant` row with no question before it is dropped. That is what an
 * answer saved between two runs looks like from here — its question went out
 * last time, so writing the answer alone would put a reply under no question.
 *
 * `since` is compared against the question's own timestamp. The stored strings
 * come from `toISOString()`, which sorts the way the instants do, so comparing
 * them as text is deliberate rather than a shortcut.
 */
export function pairQuestions(rows: ExportRow[], since: string | null): ExportedQuestion[] {
  const conversations = new Map<string, ExportRow[]>();
  for (const row of rows) {
    // The book's own conversation has no selection id; "" cannot collide with
    // one, since every highlight id is a ULID.
    const key = row.selectionId ?? "";
    const group = conversations.get(key);
    if (group) group.push(row);
    else conversations.set(key, [row]);
  }

  const questions: ExportedQuestion[] = [];
  for (const group of conversations.values()) {
    const ordered = group.toSorted(byTime);
    for (let i = 0; i < ordered.length; i += 1) {
      const asked = ordered[i];
      if (asked.role !== "user") continue;
      const next = i + 1 < ordered.length ? ordered[i + 1] : null;
      const answer = next !== null && next.role === "assistant" ? next : null;
      questions.push({
        questionId: asked.id,
        question: asked.content,
        answerId: answer === null ? null : answer.id,
        answer: answer === null ? null : answer.content,
        selectionId: asked.selectionId,
        quote: asked.selectedText,
        pageNumber: asked.pageNumber,
        askedAt: asked.createdAt,
      });
    }
  }

  return questions
    .filter((question) => since === null || question.askedAt > since)
    .toSorted((a, b) =>
      a.askedAt === b.askedAt
        ? a.questionId.localeCompare(b.questionId)
        : a.askedAt.localeCompare(b.askedAt),
    );
}

function byTime(a: ExportRow, b: ExportRow): number {
  return a.createdAt === b.createdAt
    ? a.id.localeCompare(b.id)
    : a.createdAt.localeCompare(b.createdAt);
}
```

- [ ] **Step 5: 通ることを確かめる**

Run: `vp exec vitest run src/server/services/bookExport.test.ts`
Expected: PASS（7 件）

- [ ] **Step 6: commit**

```bash
git add src/shared/schemas/export.ts src/server/services/bookExport.ts src/server/services/bookExport.test.ts
git commit -m "✨ feat: 質問と回答を対にして書き出す形にする"
```

---

### Task 2: 書き出しのエンドポイント

**Files:**

- Modify: `src/server/services/pdfService.ts`（import に `chatMessages` を足し、`readBookExport` を追加）
- Modify: `src/server/routes/pdf.ts`（`/pdf/:pdfId/text-search` の直後に追加）
- Test: `test/worker/pdf.test.ts`

- [ ] **Step 1: 落ちるテストを書く**

`test/worker/pdf.test.ts` の末尾、`describe("GET /api/pdf/:pdfId/search", ...)` の後ろに足す:

```ts
describe("GET /api/pdf/:pdfId/export", () => {
  /** Inserts a message the way a finished turn stores one. */
  async function addMessage(fields: {
    id: string;
    pdfId: string;
    selectionId: string | null;
    role: "user" | "assistant";
    content: string;
    createdAt: string;
  }) {
    await env.DB.prepare(
      "INSERT INTO chat_messages (id, selection_id, pdf_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(
        fields.id,
        fields.selectionId,
        fields.pdfId,
        fields.role,
        fields.content,
        fields.createdAt,
      )
      .run();
  }

  async function exportNotes(pdfId: string, since?: string) {
    const query = since === undefined ? "" : `?since=${encodeURIComponent(since)}`;
    return apiFetch(`https://example.com/api/pdf/${pdfId}/export${query}`);
  }

  it("hands over a highlight's question with the passage and page it hangs off", async () => {
    const book = await uploadBook({
      tag: "export-one",
      fileName: "export-one.pdf",
      pages: ["一ページ目", "直交性とは、ある一つの変更が他に波及しないことを言う。"],
    });
    const selection = (await (
      await postSelection(book.id, {
        selectedText: "直交性とは、ある一つの変更が他に波及しないことを言う。",
        pageNumber: 2,
        positionData: { rects: [{ x: 0, y: 0, width: 10, height: 10 }] },
      })
    ).json()) as { id: string };
    await addMessage({
      id: "export-q1",
      pdfId: book.id,
      selectionId: selection.id,
      role: "user",
      content: "直交性と疎結合はどう違うんですか？",
      createdAt: "2026-11-01T00:00:00.000Z",
    });
    await addMessage({
      id: "export-a1",
      pdfId: book.id,
      selectionId: selection.id,
      role: "assistant",
      content: "疎結合は……",
      createdAt: "2026-11-01T00:00:05.000Z",
    });

    const response = await exportNotes(book.id);

    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({
      pdfId: book.id,
      fileName: "export-one.pdf",
      pageCount: 2,
      questions: [
        {
          questionId: "export-q1",
          question: "直交性と疎結合はどう違うんですか？",
          answerId: "export-a1",
          answer: "疎結合は……",
          selectionId: selection.id,
          quote: "直交性とは、ある一つの変更が他に波及しないことを言う。",
          pageNumber: 2,
          askedAt: "2026-11-01T00:00:00.000Z",
        },
      ],
    });
  });

  it("carries a question about the book itself with no passage under it", async () => {
    const book = await uploadBook({ tag: "export-book-chat", fileName: "export-book-chat.pdf" });
    await addMessage({
      id: "export-q-book",
      pdfId: book.id,
      selectionId: null,
      role: "user",
      content: "この本の主張を3つに",
      createdAt: "2026-11-01T00:00:00.000Z",
    });

    const { questions } = (await (await exportNotes(book.id)).json()) as {
      questions: Record<string, unknown>[];
    };

    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      questionId: "export-q-book",
      selectionId: null,
      quote: null,
      pageNumber: null,
    });
  });

  it("leaves out the questions the note already holds", async () => {
    const book = await uploadBook({ tag: "export-since", fileName: "export-since.pdf" });
    await addMessage({
      id: "export-old",
      pdfId: book.id,
      selectionId: null,
      role: "user",
      content: "古い質問",
      createdAt: "2026-11-01T00:00:00.000Z",
    });
    await addMessage({
      id: "export-new",
      pdfId: book.id,
      selectionId: null,
      role: "user",
      content: "新しい質問",
      createdAt: "2026-11-02T00:00:00.000Z",
    });

    const { questions } = (await (
      await exportNotes(book.id, "2026-11-01T00:00:00.000Z")
    ).json()) as { questions: { questionId: string }[] };

    expect(questions.map((q) => q.questionId)).toStrictEqual(["export-new"]);
  });

  it("leaves another book's questions out of the answer", async () => {
    const mine = await uploadBook({ tag: "export-scope-a", fileName: "export-scope-a.pdf" });
    const other = await uploadBook({ tag: "export-scope-b", fileName: "export-scope-b.pdf" });
    await addMessage({
      id: "export-other",
      pdfId: other.id,
      selectionId: null,
      role: "user",
      content: "よその本の質問",
      createdAt: "2026-11-01T00:00:00.000Z",
    });

    const { questions } = (await (await exportNotes(mine.id)).json()) as { questions: unknown[] };

    expect(questions).toStrictEqual([]);
  });

  it("says the book is missing when it is not there", async () => {
    const response = await exportNotes("does-not-exist");

    expect(response.status).toBe(404);
    expect(await response.json()).toStrictEqual({
      error: { code: "PDF_NOT_FOUND", message: "PDF not found" },
    });
  });

  it("refuses a since that is not a timestamp", async () => {
    const book = await uploadBook({ tag: "export-bad-since", fileName: "export-bad-since.pdf" });

    const response = await exportNotes(book.id, "きのう");

    expect(response.status).toBe(400);
    const { error } = (await response.json()) as { error: { code: string; message: string } };
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toContain("since");
  });
});
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `vp exec vitest run -c vitest.workers.config.ts -t "GET /api/pdf/:pdfId/export"`
Expected: FAIL — 6 件すべて。`/export` は定義されていないので `ROUTE_NOT_FOUND` の 404 が返る

- [ ] **Step 3: service を書く**

`src/server/services/pdfService.ts` の import を直す。既存の schema の import に
`chatMessages` を足す（`pdfs, selections` だけになっている）:

```ts
import { pdfs, selections, chatMessages } from "../db/schema";
```

`serviceError` の import の下に 2 行足す。**`BookExport` は `book.ts` ではなく `export.ts` に
あるので、`book.ts` からの `import type { ... }` の一覧には入れない**:

```ts
import type { BookExport } from "../../shared/schemas/export";
import { pairQuestions } from "./bookExport";
```

ファイル末尾に足す:

```ts
/**
 * The book's questions and the answers they got, for the reading notes.
 *
 * The whole conversation of the book is read rather than only the rows after
 * `since`: a question and its answer are separate rows, so a window cutting
 * between them would hand back an answer with no question. One book's chat is
 * tens of rows, so folding them here costs less than that would.
 *
 * The join is outer because the book's own conversation hangs off no passage.
 */
export function readBookExport(
  db: D1Database,
  pdfId: string,
  since: string | null,
): ResultAsync<BookExport, ServiceError> {
  return ResultAsync.fromPromise(findBookExport(db, pdfId, since), storageFailure).andThen(
    (found) => (found ? ok(found) : err(notFound())),
  );
}

async function findBookExport(
  db: D1Database,
  pdfId: string,
  since: string | null,
): Promise<BookExport | null> {
  const d1Db = drizzle(db);
  const book = await d1Db
    .select({ id: pdfs.id, fileName: pdfs.fileName, pageCount: pdfs.pageCount })
    .from(pdfs)
    .where(eq(pdfs.id, pdfId))
    .get();
  if (!book) return null;

  const rows = await d1Db
    .select({
      id: chatMessages.id,
      role: chatMessages.role,
      content: chatMessages.content,
      createdAt: chatMessages.createdAt,
      selectionId: chatMessages.selectionId,
      selectedText: selections.selectedText,
      pageNumber: selections.pageNumber,
    })
    .from(chatMessages)
    .leftJoin(selections, eq(selections.id, chatMessages.selectionId))
    .where(eq(chatMessages.pdfId, pdfId))
    .all();

  // The outer join makes the two passage columns nullable, which is exactly
  // `ExportRow`; a drift between them is a type error here rather than a
  // surprise in the note.
  return {
    pdfId: book.id,
    fileName: book.fileName,
    pageCount: book.pageCount,
    questions: pairQuestions(rows, since),
  };
}
```

- [ ] **Step 4: route を書く**

`src/server/routes/pdf.ts` の import に足す:

```ts
import { bookExportQuerySchema } from "../../shared/schemas/export";
```

`pdfService` からの import に `readBookExport` を足し、`.get("/pdf/:pdfId/text-search", ...)` の直後（`.put("/pdf/:pdfId/reading-state", ...)` の前）に足す:

```ts
      // The reading notes: a book's questions and the answers they got, for the
      // script that writes them into the Obsidian vault. `since` is how a note
      // says what it already holds, so a second run adds only what came after.
      .get("/pdf/:pdfId/export", validate("query", bookExportQuerySchema), async (c) => {
        const exported = await readBookExport(
          c.env.DB,
          c.req.param("pdfId"),
          c.req.valid("query").since ?? null,
        );

        return exported.match(
          (found) => c.json(found),
          (failure) => serviceFailureResponse(c, failure, PDF_NOT_FOUND),
        );
      })
```

- [ ] **Step 5: 通ることを確かめる**

Run: `vp exec vitest run -c vitest.workers.config.ts -t "GET /api/pdf/:pdfId/export"`
Expected: PASS（6 件）

- [ ] **Step 6: 他を壊していないか確かめる**

Run: `pnpm run test:worker`
Expected: 既存のテストも全部 PASS

- [ ] **Step 7: commit**

```bash
git add src/server/services/pdfService.ts src/server/routes/pdf.ts test/worker/pdf.test.ts
git commit -m "✨ feat: 本の質問と回答を書き出すエンドポイントを足す"
```

---

### Task 3: `scripts/` を型チェックに入れる

`scripts/` は今どの tsconfig にも入っていない（`tsconfig.node.json` の `include` は設定ファイル 3 つだけ）。先に通しておかないと、以降のタスクのコードを `vp check` が見ない。

**Files:**

- Create: `scripts/tsconfig.json`
- Modify: `tsconfig.json`

- [ ] **Step 1: 今は見られていないことを確かめる**

```bash
mkdir -p scripts/notes
printf 'export const broken: number = "not a number";\n' > scripts/notes/typecheck-probe.ts
vp check
```

Expected: 型エラーは**出ない**（`scripts/` がどのプロジェクトにも入っていないため）

- [ ] **Step 2: tsconfig を足す**

`scripts/tsconfig.json`:

```json
{
  "extends": "../tsconfig.node.json",
  "compilerOptions": {
    "tsBuildInfoFile": "../node_modules/.tmp/tsconfig.scripts.tsbuildinfo",
    "types": ["node"]
  },
  "include": ["./**/*.ts"]
}
```

`tsconfig.json` の `references` に足す:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.worker.json" },
    { "path": "./scripts/tsconfig.json" },
    { "path": "./test/worker/tsconfig.json" },
    { "path": "./e2e/tsconfig.json" }
  ]
}
```

- [ ] **Step 3: 見られるようになったことを確かめる**

Run: `vp check`
Expected: FAIL — `scripts/notes/typecheck-probe.ts` で `Type 'string' is not assignable to type 'number'`

- [ ] **Step 4: 当て馬を消す**

```bash
rm scripts/notes/typecheck-probe.ts
vp check
```

Expected: PASS

- [ ] **Step 5: commit**

```bash
git add scripts/tsconfig.json tsconfig.json
git commit -m "🔧 chore: scripts/ を型チェックに入れる"
```

---

### Task 4: ノートのファイル名

**Files:**

- Create: `scripts/notes/vaultPath.ts`
- Test: `scripts/notes/vaultPath.test.ts`

- [ ] **Step 1: 落ちるテストを書く**

`scripts/notes/vaultPath.test.ts`:

```ts
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
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `vp exec vitest run scripts/notes/vaultPath.test.ts`
Expected: FAIL — `Failed to resolve import "./vaultPath.ts"`

- [ ] **Step 3: 実装を書く**

`scripts/notes/vaultPath.ts`:

```ts
/**
 * The note file for a book, named after the book itself.
 *
 * The name comes from the uploaded file name, which is all the app knows a
 * book as. What a file name cannot hold becomes a space and runs of space
 * collapse, so one book does not turn into a folder; a leading dot goes,
 * since a hidden note is invisible in Obsidian.
 */
export function noteFileName(fileName: string): string {
  const cleaned = fileName
    .replace(/\.pdf$/i, "")
    .replace(/[/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .trim();
  return `${cleaned === "" ? "untitled" : cleaned}.md`;
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `vp exec vitest run scripts/notes/vaultPath.test.ts`
Expected: PASS（6 件）

- [ ] **Step 5: commit**

```bash
git add scripts/notes/vaultPath.ts scripts/notes/vaultPath.test.ts
git commit -m "✨ feat: 本の名前からノートのファイル名を作る"
```

---

### Task 5: ノートが自分について覚えていること

**Files:**

- Create: `scripts/notes/frontmatter.ts`
- Test: `scripts/notes/frontmatter.test.ts`

- [ ] **Step 1: 落ちるテストを書く**

`scripts/notes/frontmatter.test.ts`:

```ts
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
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `vp exec vitest run scripts/notes/frontmatter.test.ts`
Expected: FAIL — `Failed to resolve import "./frontmatter.ts"`

- [ ] **Step 3: 実装を書く**

`scripts/notes/frontmatter.ts`:

```ts
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
```

- [ ] **Step 4: 通ることを確かめる**

Run: `vp exec vitest run scripts/notes/frontmatter.test.ts`
Expected: PASS（8 件）

- [ ] **Step 5: commit**

```bash
git add scripts/notes/frontmatter.ts scripts/notes/frontmatter.test.ts
git commit -m "✨ feat: ノートがどこまで書き出したかを覚える"
```

---

### Task 6: Markdown を組む

**Files:**

- Create: `scripts/notes/renderNote.ts`
- Test: `scripts/notes/renderNote.test.ts`

- [ ] **Step 1: 落ちるテストを書く**

`scripts/notes/renderNote.test.ts`:

```ts
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
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `vp exec vitest run scripts/notes/renderNote.test.ts`
Expected: FAIL — `Failed to resolve import "./renderNote.ts"`

- [ ] **Step 3: 実装を書く**

`scripts/notes/renderNote.ts`:

```ts
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
    question.answer ?? ANSWER_MISSING,
    "",
    `${placeLabel(question)} [開く](${passageUrl(book, question, baseUrl)}) ^q-${blockId(question.questionId)}`,
    "",
    "---",
    "",
  );
  return lines(block);
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
```

- [ ] **Step 4: 通ることを確かめる**

Run: `vp exec vitest run scripts/notes/renderNote.test.ts`
Expected: PASS（8 件）

- [ ] **Step 5: commit**

```bash
git add scripts/notes/renderNote.ts scripts/notes/renderNote.test.ts
git commit -m "✨ feat: 質問を Obsidian のノートの形に組む"
```

---

### Task 7: 書き出すスクリプト

ここは I/O だけなので薄く保ち、単体テストは書かない（Task 8 で手で確かめる）。

**Files:**

- Create: `scripts/sync-reading-notes.ts`
- Modify: `package.json`

- [ ] **Step 1: スクリプトを書く**

`scripts/sync-reading-notes.ts`:

```ts
/**
 * Writes the questions of every book into the reading-notes vault.
 *
 *     pnpm run notes:sync
 *
 * Needs Node 24 — this file is TypeScript handed straight to node, and type
 * stripping is only unflagged from 23.6 (see `.nvmrc`). The relative imports
 * carry their `.ts` for the same reason: stripping does not resolve
 * extensions.
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
```

- [ ] **Step 2: `package.json` に足す**

`"pdfjs:assets"` の下に足す:

```json
    "notes:sync": "node scripts/sync-reading-notes.ts",
```

- [ ] **Step 3: 型とフォーマットを確かめる**

Run: `vp check`
Expected: PASS（`--fix` で整形してよい）

- [ ] **Step 4: 単体テストが全部通ることを確かめる**

Run: `pnpm test`
Expected: PASS（`scripts/notes/**` の 3 ファイルも拾われる）

- [ ] **Step 5: commit**

```bash
git add scripts/sync-reading-notes.ts package.json
git commit -m "✨ feat: 読書メモを Obsidian のボルトへ書き出す"
```

---

### Task 8: ボルトを作って手で確かめる

**Files:**

- Create: `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/reading/books/`（ディレクトリ）

- [ ] **Step 1: ローカルの dev サーバーに対して走らせる**

デプロイを待たずに全経路を確かめられる。ローカルは `.dev.vars` の `demo` / `demo`。

```bash
export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" && node --version
```

Expected: `v24.19.0`

```bash
CHATBOOK_URL=http://localhost:5173 CHATBOOK_PASSWORD=demo pnpm run notes:sync
```

Expected: 質問のある本について `N 件: /Users/.../reading/books/<本>.md` が出る。
質問が 1 件も無ければ何も出ない（その場合はアプリで 1 問聞いてから再実行する）。

- [ ] **Step 2: 書かれたノートを読む**

```bash
ls -1 ~/Library/Mobile\ Documents/iCloud~md~obsidian/Documents/reading/books/
cat ~/Library/Mobile\ Documents/iCloud~md~obsidian/Documents/reading/books/*.md | head -40
```

確かめること:

- frontmatter に `pdfId` / `lastExportedAt` / `questionsCount` がある
- `### <質問>` の下に `> 引用` と回答が並んでいる
- `— p.N [開く](http://localhost:5173/books/...?page=N&selection=...)` が付いている
- 末尾に `^q-...` のブロック ID がある

- [ ] **Step 3: 2 回目が何も足さないことを確かめる（追記の冪等性）**

```bash
md5 -q ~/Library/Mobile\ Documents/iCloud~md~obsidian/Documents/reading/books/*.md > /tmp/notes-before
CHATBOOK_URL=http://localhost:5173 CHATBOOK_PASSWORD=demo pnpm run notes:sync
md5 -q ~/Library/Mobile\ Documents/iCloud~md~obsidian/Documents/reading/books/*.md > /tmp/notes-after
diff /tmp/notes-before /tmp/notes-after && echo "変わっていない"
```

Expected: `変わっていない`（新しい質問が無いので何も書かれない）

- [ ] **Step 4: 削った質問が復活しないことを確かめる**

ノートから `### ...` のブロックを 1 つ手で消して保存し、もう一度走らせる。

Expected: 消したブロックは戻ってこない（`lastExportedAt` は frontmatter に残っているため）

- [ ] **Step 5: Obsidian で開く**

Obsidian の「フォルダをボルトとして開く」で
`~/Library/Mobile Documents/iCloud~md~obsidian/Documents/reading` を開く。

確かめること:

- ノートが見える
- `[リーダーで開く]` が押せる
- 本番ノートを 1 つ作り、`![[<本>#<質問の見出し>]]` で 1 問だけ埋め込めること

- [ ] **Step 6: 結果を報告する**

ボルトのパス・書き出された本と件数・埋め込みが動いたかを伝える。
リモート（公開 URL）に対して走らせるのは、`wrangler secret put` が済んでいて
Keychain に項目を入れたあと。

---

## 残っていること（この計画の外）

- **リモートに対する初回実行**。公開 URL のデプロイと `AUTH_*` の secret、そして
  Keychain への項目追加が要る。経路自体は Task 8 のローカル実行で確かめ済み
- **CLAUDE.md の更新**。`findSelections` の `db.prepare()` が「service で唯一 drizzle を
  通らない箇所」である記述は変わらない（`readBookExport` は drizzle の `leftJoin` を使う）が、
  `scripts/` が型チェックに入ったことと `notes:sync` は書き足す価値がある
- **launchd での定期実行**。手で叩く形が馴染んでから
