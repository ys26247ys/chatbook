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
