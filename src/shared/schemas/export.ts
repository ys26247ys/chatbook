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
