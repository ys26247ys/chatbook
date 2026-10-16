import { useSyncExternalStore } from "react";
import useSWR from "swr";
import { ApiError, fetcher } from "../lib/fetcher";
import { sessionHasRunOut, subscribeToSessionExpiry } from "../lib/sessionExpiry";
import { sessionSchema } from "../../shared/schemas/auth";

export const SESSION_KEY = "/api/auth/session";

/**
 * Whether the reader is signed in, and if not, whether that is because they
 * have not signed in or because the question could not be asked.
 *
 * The two are told apart because they call for different things on screen. A
 * 401 is the server saying "you are not signed in", and the answer to that is a
 * password box. Anything else — the server down, the network gone — is the
 * question going unanswered, and showing a password box there would tell the
 * reader their password is the problem when it is not.
 */
export type SessionState =
  | { state: "asking" }
  | { state: "signed-in" }
  | { state: "signed-out" }
  | { state: "unknown"; reason: string };

export function useSession(): SessionState {
  const { data, error, isLoading } = useSWR(SESSION_KEY, (url) => fetcher(url, sessionSchema), {
    // A session that has run out is only discovered by asking, and the answer
    // decides whether anything is drawn at all.
    revalidateIfStale: true,
    shouldRetryOnError: false,
  });

  // A refusal that arrived after the question was answered. The answer above is
  // cached and nothing re-asks it, so a 401 to any other request is the newer
  // fact and outranks it — that is the whole of what sends a reader whose
  // cookie ran out mid-book back to the password box.
  const ranOut = useSyncExternalStore(subscribeToSessionExpiry, sessionHasRunOut);
  if (ranOut) return { state: "signed-out" };

  if (data) return { state: "signed-in" };

  if (error instanceof ApiError && error.status === 401) return { state: "signed-out" };
  if (error) return { state: "unknown", reason: (error as Error).message };

  if (isLoading) return { state: "asking" };
  return { state: "asking" };
}
