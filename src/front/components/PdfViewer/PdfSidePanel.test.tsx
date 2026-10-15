import { describe, it, expect, vi } from "vite-plus/test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PdfSidePanel } from "./PdfSidePanel";
import { SwrTestCache } from "../../../test/swrTestCache";
import type { OutlineEntry } from "../../hooks/usePdfOutline";
import type { TextSearchOutcome } from "../../../shared/schemas/textSearch";

const OUTLINE: OutlineEntry[] = [
  { title: "第1章 制約とアーキテクチャ", pageNumber: 10, children: [] },
  { title: "第2章 AWSサービスとその特性", pageNumber: 16, children: [] },
];

function hit(overrides: Partial<TextSearchOutcome["hits"][number]> = {}) {
  return {
    pageNumber: 18,
    snippet: "…Athena の性能特性について…",
    matchStart: 1,
    matchLength: 6,
    text: "Athena",
    ...overrides,
  };
}

function renderPanel(props: {
  search?: (pdfId: string, query: string) => Promise<TextSearchOutcome>;
  onJumpToHit?: (pageNumber: number, text: string) => void;
  onJump?: (pageNumber: number) => void;
  outline?: OutlineEntry[] | null;
}) {
  const search = props.search ?? (async () => ({ hits: [], total: 0 }));

  return render(
    <SwrTestCache>
      <PdfSidePanel
        pdfId="book-1"
        outline={props.outline ?? OUTLINE}
        outlineError={null}
        currentPage={1}
        onJump={props.onJump ?? (() => {})}
        onJumpToHit={props.onJumpToHit ?? (() => {})}
        search={search}
      />
    </SwrTestCache>,
  );
}

describe("PdfSidePanel", () => {
  it("shows the outline until the reader searches for something", async () => {
    renderPanel({});

    expect(screen.getByRole("button", { name: /第1章/ })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "本文の検索結果" })).not.toBeInTheDocument();
  });

  // Typing is not searching: a round trip per keystroke would run on half a
  // Japanese word. The same reason the highlight search waits for 検索.
  it("does not search while the reader is still typing", async () => {
    const search = vi.fn(async () => ({ hits: [hit()], total: 1 }));
    renderPanel({ search });

    await userEvent.type(screen.getByLabelText("本文を検索"), "Athena");

    expect(search).not.toHaveBeenCalled();
  });

  it("lists what the search found, with the page each hit sits on", async () => {
    const search = async () => ({
      hits: [hit({ pageNumber: 18 }), hit({ pageNumber: 31, snippet: "…Athena の測定結果…" })],
      total: 2,
    });
    renderPanel({ search });

    await userEvent.type(screen.getByLabelText("本文を検索"), "Athena");
    await userEvent.click(screen.getByRole("button", { name: "検索" }));

    expect(await screen.findByText("p.18")).toBeInTheDocument();
    expect(screen.getByText("p.31")).toBeInTheDocument();
    expect(screen.getByText(/性能特性/)).toBeInTheDocument();
  });

  it("takes the reader to the page a hit sits on, with the words to mark", async () => {
    const onJumpToHit = vi.fn();
    const search = async () => ({ hits: [hit({ pageNumber: 18, text: "Athena" })], total: 1 });
    renderPanel({ search, onJumpToHit });

    await userEvent.type(screen.getByLabelText("本文を検索"), "Athena");
    await userEvent.click(screen.getByRole("button", { name: "検索" }));
    await userEvent.click(await screen.findByRole("button", { name: /p\.18/ }));

    expect(onJumpToHit).toHaveBeenCalledWith(18, "Athena");
  });

  it("says so when the book does not hold what was searched for", async () => {
    renderPanel({ search: async () => ({ hits: [], total: 0 }) });

    await userEvent.type(screen.getByLabelText("本文を検索"), "Kubernetes");
    await userEvent.click(screen.getByRole("button", { name: "検索" }));

    expect(await screen.findByText("見つかりませんでした")).toBeInTheDocument();
  });

  // A reader who searches "の" needs to know the list is a hundred of four
  // hundred, not all of them, or they will trust a list that cannot be trusted.
  it("says how many hits the list is showing of the whole book's", async () => {
    const search = async () => ({ hits: [hit(), hit({ pageNumber: 20 })], total: 412 });
    renderPanel({ search });

    await userEvent.type(screen.getByLabelText("本文を検索"), "の");
    await userEvent.click(screen.getByRole("button", { name: "検索" }));

    expect(await screen.findByText("412件中 2件")).toBeInTheDocument();
  });

  it("brings the outline back when the box is emptied and searched again", async () => {
    const search = async () => ({ hits: [hit()], total: 1 });
    renderPanel({ search });

    const box = screen.getByLabelText("本文を検索");
    await userEvent.type(box, "Athena");
    await userEvent.click(screen.getByRole("button", { name: "検索" }));
    expect(await screen.findByText("p.18")).toBeInTheDocument();

    await userEvent.clear(box);
    await userEvent.click(screen.getByRole("button", { name: "検索" }));

    expect(screen.getByRole("button", { name: /第1章/ })).toBeInTheDocument();
    expect(screen.queryByText("p.18")).not.toBeInTheDocument();
  });

  it("reports a search that failed instead of showing an empty list", async () => {
    const search = async () => {
      throw new Error("Server exploded");
    };
    renderPanel({ search });

    await userEvent.type(screen.getByLabelText("本文を検索"), "Athena");
    await userEvent.click(screen.getByRole("button", { name: "検索" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "検索に失敗しました: Server exploded",
    );
  });
});
