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
