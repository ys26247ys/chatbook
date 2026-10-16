import { describe, it, expect, afterEach, vi } from "vite-plus/test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { z } from "zod";
import { RequireSession } from "./RequireSession";
import { SwrTestCache } from "../../test/swrTestCache";
import { resultFetcher } from "../lib/fetcher";
import { forgetSessionExpiry } from "../lib/sessionExpiry";

const SHELF = "本棚の中身";
const READ = "本を読む";

function renderGate(children: ReactNode = <p>{SHELF}</p>) {
  return render(
    <SwrTestCache>
      <RequireSession>{children}</RequireSession>
    </SwrTestCache>,
  );
}

/**
 * The app behind the gate, with something for the reader to ask the server for.
 *
 * The button stands for every request a reader makes while reading — a page, a
 * highlight, an answer — all of which arrive at the same refusal.
 */
function Reading() {
  return (
    <div>
      <p>{SHELF}</p>
      <button
        type="button"
        onClick={() => {
          void resultFetcher("/api/pdf/b1", z.object({ id: z.string() }));
        }}
      >
        {READ}
      </button>
    </div>
  );
}

/**
 * A server that knows the reader by a cookie that has already gone: it still
 * remembers answering the session question, but refuses everything else.
 */
function serverWhoseSessionRanOut(refusalStatus: number): typeof fetch {
  const fetchFn = (url: string) => {
    if (url.endsWith("/api/auth/session")) {
      return Promise.resolve(new Response(JSON.stringify({ signedIn: true }), { status: 200 }));
    }
    if (url.endsWith("/api/auth/login")) {
      return Promise.resolve(new Response(JSON.stringify({ signedIn: true }), { status: 200 }));
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          error: {
            code: refusalStatus === 401 ? "UNAUTHORIZED" : "INTERNAL_ERROR",
            message: refusalStatus === 401 ? "ログインしてください" : "Unexpected server error",
          },
        }),
        { status: refusalStatus, headers: { "Content-Type": "application/json" } },
      ),
    );
  };
  return fetchFn as unknown as typeof fetch;
}

/** A server that refuses until the right password arrives, then lets them in. */
function serverWithPassword(password: string) {
  let signedIn = false;
  const fetchFn = (url: string, init?: RequestInit) => {
    if (url.endsWith("/api/auth/login")) {
      // The gate only ever sends a JSON string here, which is what it is read as
      const sent = typeof init?.body === "string" ? init.body : "{}";
      const body = JSON.parse(sent) as { password: string };
      if (body.password !== password) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code: "UNAUTHORIZED", message: "ユーザー名かパスワードが違います" },
            }),
            { status: 401, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      signedIn = true;
      return Promise.resolve(new Response(JSON.stringify({ signedIn: true }), { status: 200 }));
    }

    return Promise.resolve(
      signedIn
        ? new Response(JSON.stringify({ signedIn: true }), { status: 200 })
        : new Response(
            JSON.stringify({ error: { code: "UNAUTHORIZED", message: "ログインしてください" } }),
            { status: 401, headers: { "Content-Type": "application/json" } },
          ),
    );
  };
  return fetchFn as unknown as typeof fetch;
}

describe("RequireSession", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    forgetSessionExpiry();
    // One test reads a book at an address of its own; the gate is meant to
    // leave the address alone, so nothing else puts it back.
    window.history.replaceState({}, "", "/");
  });

  it("shows the reader's books once the server says they are signed in", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(new Response(JSON.stringify({ signedIn: true }), { status: 200 })),
    );

    renderGate();

    expect(await screen.findByText(SHELF)).toBeInTheDocument();
  });

  it("asks for a password instead when the server turns the reader away", async () => {
    vi.stubGlobal("fetch", serverWithPassword("open-sesame"));

    renderGate();

    expect(await screen.findByLabelText("パスワード")).toBeInTheDocument();
    expect(screen.queryByText(SHELF)).toBeNull();
  });

  it("opens the app on the password that works, without changing the address", async () => {
    // The gate stands in place rather than sending the reader to /login, so a
    // link into a page and a highlight survives having to sign in first.
    const before = window.location.href;
    vi.stubGlobal("fetch", serverWithPassword("open-sesame"));
    renderGate();
    await screen.findByLabelText("パスワード");

    await userEvent.type(screen.getByLabelText("ユーザー名"), "demo");
    await userEvent.type(screen.getByLabelText("パスワード"), "open-sesame");
    await userEvent.click(screen.getByRole("button", { name: "ログイン" }));

    expect(await screen.findByText(SHELF)).toBeInTheDocument();
    expect(window.location.href).toBe(before);
  });

  it("says the password was wrong and keeps the box open to try again", async () => {
    vi.stubGlobal("fetch", serverWithPassword("open-sesame"));
    renderGate();
    await screen.findByLabelText("パスワード");

    await userEvent.type(screen.getByLabelText("ユーザー名"), "demo");
    await userEvent.type(screen.getByLabelText("パスワード"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "ログイン" }));

    expect(await screen.findByText("ユーザー名かパスワードが違います")).toBeInTheDocument();
    expect(screen.getByLabelText("パスワード")).toBeInTheDocument();
  });

  it("says a server that answered wrongly could not be asked, rather than asking for a password", async () => {
    // The other half of "401 and everything else are different": a deploy whose
    // secrets were never set answers 500, and the password box would invite the
    // reader to keep typing at a server that cannot check any of it.
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: { code: "CONFIG_ERROR", message: "サーバーにログイン情報が設定されていません" },
          }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    renderGate();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /^ログイン状態を確認できませんでした: サーバーにログイン情報が設定されていません$/,
    );
    expect(screen.queryByLabelText("パスワード")).toBeNull();
  });

  it("asks for the password again when a request answers 401 while the reader is reading", async () => {
    // The tab was opened while the cookie was still good, so the gate has a
    // signed-in answer cached and nothing re-asks the question on its own.
    // The refusal the reader's next request comes back with is the only news
    // there is, and without it the reader is left with an error message in a
    // panel and nowhere to type a password.
    vi.stubGlobal("fetch", serverWhoseSessionRanOut(401));
    renderGate(<Reading />);
    await screen.findByText(SHELF);

    await userEvent.click(screen.getByRole("button", { name: READ }));

    expect(await screen.findByLabelText("パスワード")).toBeInTheDocument();
    expect(screen.queryByText(SHELF)).toBeNull();
  });

  it("keeps the reader in the book when a request fails for the server's own reasons", async () => {
    // A password box here would tell the reader their password is the problem
    // when the server is the one that came apart.
    vi.stubGlobal("fetch", serverWhoseSessionRanOut(500));
    renderGate(<Reading />);
    await screen.findByText(SHELF);

    await userEvent.click(screen.getByRole("button", { name: READ }));

    expect(screen.queryByLabelText("パスワード")).toBeNull();
    expect(screen.getByText(SHELF)).toBeInTheDocument();
  });

  it("keeps the reader in the book when a request never reached the server", async () => {
    vi.stubGlobal("fetch", (url: string) =>
      url.endsWith("/api/auth/session")
        ? Promise.resolve(new Response(JSON.stringify({ signedIn: true }), { status: 200 }))
        : Promise.reject(new TypeError("Failed to fetch")),
    );
    renderGate(<Reading />);
    await screen.findByText(SHELF);

    await userEvent.click(screen.getByRole("button", { name: READ }));

    expect(screen.queryByLabelText("パスワード")).toBeNull();
    expect(screen.getByText(SHELF)).toBeInTheDocument();
  });

  it("comes back to the page and the highlight the reader was on once they sign in again", async () => {
    // What makes signing in again cost the reader nothing: their place is in
    // the address, and the gate never moved it.
    window.history.replaceState({}, "", "/books/b1?page=7&selection=01KZSELECTION");
    vi.stubGlobal("fetch", serverWhoseSessionRanOut(401));
    renderGate(<Reading />);
    await screen.findByText(SHELF);
    await userEvent.click(screen.getByRole("button", { name: READ }));
    await screen.findByLabelText("パスワード");

    await userEvent.type(screen.getByLabelText("ユーザー名"), "demo");
    await userEvent.type(screen.getByLabelText("パスワード"), "demo");
    await userEvent.click(screen.getByRole("button", { name: "ログイン" }));

    expect(await screen.findByText(SHELF)).toBeInTheDocument();
    expect(window.location.search).toBe("?page=7&selection=01KZSELECTION");
    expect(window.location.pathname).toBe("/books/b1");
  });

  it("says the server could not be reached rather than asking for a password", async () => {
    // A password box here would blame the reader for the server being down.
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));

    renderGate();

    // The reason is part of the message: without it the reader is told only
    // that something went wrong, which is the same as not being told.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /^ログイン状態を確認できませんでした: Failed to fetch$/,
    );
    expect(screen.queryByLabelText("パスワード")).toBeNull();
  });
});
