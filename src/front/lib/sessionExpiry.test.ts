import { describe, it, expect, afterEach } from "vite-plus/test";
import { forgetSessionExpiry, sessionHasRunOut, subscribeToSessionExpiry } from "./sessionExpiry";
import { networkFailure, readRefusal } from "./fetcher";

/** The refusal shape every route in this app answers with. */
function refusal(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("sessionExpiry", () => {
  afterEach(forgetSessionExpiry);

  it("takes a 401 from any request as the session having run out", async () => {
    // Every path into this app words its refusals through `readRefusal` — the
    // two that read a response themselves (the chat stream and the PDF binary)
    // included — so reporting from there is what covers all of them at once.
    await readRefusal("/api/pdf/b1/chats", refusal(401, "UNAUTHORIZED", "ログインしてください"));

    expect(sessionHasRunOut()).toBe(true);
  });

  it("leaves the session alone when the server failed for its own reasons", async () => {
    await readRefusal("/api/pdf/b1", refusal(500, "INTERNAL_ERROR", "Unexpected server error"));

    expect(sessionHasRunOut()).toBe(false);
  });

  it("leaves the session alone when the request never reached the server", () => {
    networkFailure("/api/pdf/b1", new TypeError("Failed to fetch"));

    expect(sessionHasRunOut()).toBe(false);
  });

  it("tells whoever is watching, and stops once they have let go", async () => {
    let told = 0;
    const release = subscribeToSessionExpiry(() => {
      told += 1;
    });

    await readRefusal("/api/pdfs", refusal(401, "UNAUTHORIZED", "ログインしてください"));
    release();
    forgetSessionExpiry();

    expect(told).toBe(1);
  });

  it("forgets it once the reader has signed in again", async () => {
    await readRefusal("/api/pdfs", refusal(401, "UNAUTHORIZED", "ログインしてください"));

    forgetSessionExpiry();

    expect(sessionHasRunOut()).toBe(false);
  });
});
