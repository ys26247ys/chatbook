import type { ApiError } from "./fetcher";

/**
 * Whether the reader's session has run out, as told by a request that was
 * refused rather than by asking.
 *
 * A session only ends while nothing is happening — the cookie runs out on its
 * own, in a tab that has been open on a page of a book all along. Nothing
 * re-asks `/api/auth/session` on its own account (the app refetches on nothing
 * but its own doings, which is why `revalidateOnFocus` is off), so the first
 * news of it is the 401 the reader's next request comes back with. Without
 * somewhere to put that news it ends as a line of red text in whichever panel
 * made the request, and the reader — who cannot know that reloading would fix
 * it — is left with no password box anywhere on screen.
 *
 * It is a module store rather than an atom because the refusal arrives in
 * `fetcher`, below every store: the reader's own atoms are made and thrown away
 * one book at a time, and the gate sits above all of them.
 */
let ranOut = false;

const watchers = new Set<() => void>();

/**
 * Take in a refusal and decide whether it says anything about the session.
 *
 * The one place in the app where 401 means something, so no caller has to read
 * a status and work out what it implies. Every refusal is worded by
 * `readRefusal`, including the two requests that read a response themselves —
 * the chat stream and the PDF binary — so handing them all to this covers every
 * way a request can be refused.
 *
 * Only 401 counts. A server that broke, or one that never answered, says
 * nothing about whether the reader is signed in, and asking for a password
 * there would blame the reader for something that is not theirs.
 */
export function reportRefusal(error: ApiError): void {
  if (error.status !== 401 || ranOut) return;
  ranOut = true;
  for (const watcher of watchers) watcher();
}

/** Whether a refusal since has said the session is no longer good. */
export function sessionHasRunOut(): boolean {
  return ranOut;
}

/**
 * Forget it, which is what signing in again does.
 *
 * Also how a test puts the store back, since it outlives any one render.
 */
export function forgetSessionExpiry(): void {
  if (!ranOut) return;
  ranOut = false;
  for (const watcher of watchers) watcher();
}

/** Subscribe, in the shape `useSyncExternalStore` asks for. */
export function subscribeToSessionExpiry(onChange: () => void): () => void {
  watchers.add(onChange);
  return () => watchers.delete(onChange);
}
