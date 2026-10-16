import { describe, it, expect, vi } from "vite-plus/test";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MermaidBlock } from "./MermaidBlock";
import { SwrTestCache } from "../../../test/swrTestCache";

/** Stands in for mermaid, which needs the SVG layout a browser has and jsdom does not. */
const drawSource = (_id: string, code: string) =>
  Promise.resolve(`<svg aria-label="diagram"><text>${code}</text></svg>`);

/** The same, capped at a measured size the way mermaid caps its own drawings. */
const drawCappedSource = (_id: string, code: string) =>
  Promise.resolve(
    `<svg aria-label="diagram" style="max-width: 842px;" width="100%"><text>${code}</text></svg>`,
  );

/** What the bubble shows when the source cannot be drawn: the code as typed. */
function codeFallback() {
  return (
    <pre>
      <code>graph TD</code>
    </pre>
  );
}

function renderBlock(
  renderDiagram: (id: string, code: string) => Promise<string>,
  code = "graph TD",
  streaming = false,
) {
  return render(
    <SwrTestCache>
      <MermaidBlock
        code={code}
        fallback={codeFallback()}
        renderDiagram={renderDiagram}
        streaming={streaming}
      />
    </SwrTestCache>,
  );
}

/** Draws the diagram, then opens it, handing back the reader who did it. */
async function openDiagram(draw = drawCappedSource) {
  const user = userEvent.setup();
  renderBlock(draw);

  await user.click(await screen.findByRole("button", { name: "図を拡大" }));

  return user;
}

describe("MermaidBlock", () => {
  it("shows the diagram mermaid drew from the source it was given", async () => {
    const { container } = renderBlock(drawSource, "flowchart LR");

    await waitFor(() =>
      expect(container.querySelector("svg")?.outerHTML).toBe(
        '<svg aria-label="diagram"><text>flowchart LR</text></svg>',
      ),
    );
  });

  it("draws under an id that can be written as a css selector", async () => {
    const ids: string[] = [];
    renderBlock((id, code) => {
      ids.push(id);
      return drawSource(id, code);
    });

    await waitFor(() => expect(ids).toHaveLength(1));
    // mermaid puts this id in the DOM and looks it back up, so the colons
    // React's own useId hands out would make it an invalid selector
    expect(ids[0]).toMatch(/^mermaid-[a-zA-Z0-9]+$/);
  });

  // While the answer streams in, the fence arrives a token at a time, so the
  // source is unparsable for most of its life
  it("shows the code block when mermaid cannot parse the source", async () => {
    renderBlock(() => Promise.reject(new Error("Parse error")));

    // let the rejection settle, so this is the failure and not the wait for it
    await act(async () => {});
    expect(screen.getByText("graph TD").tagName).toBe("CODE");
  });

  it("shows the code block while the diagram is still being drawn", () => {
    renderBlock(() => new Promise<string>(() => {}));

    expect(screen.getByText("graph TD").tagName).toBe("CODE");
  });
});

describe("MermaidBlock, enlarged", () => {
  it("opens the diagram when the reader takes it", async () => {
    await openDiagram();

    expect(screen.getByRole("dialog", { name: "図" })).toBeInTheDocument();
  });

  it("keeps the diagram closed until the reader takes it", async () => {
    renderBlock(drawCappedSource);

    expect(await screen.findByRole("button", { name: "図を拡大" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // The cap is what keeps the drawing inside the bubble, and also what makes a
  // crowded diagram unreadable there: lifted, the drawing is laid out at the
  // size mermaid measured and the box it is in scrolls.
  it("draws the diagram at the size mermaid measured, in a box that scrolls", async () => {
    await openDiagram();

    // by the stand-in's own name: the close and maximize icons in the header
    // are svg too, and come first
    const drawn = screen.getByRole("dialog").querySelector('svg[aria-label="diagram"]');
    expect(drawn?.getAttribute("style")).toBe("min-width: 842px; max-width: none;");
    expect(drawn?.parentElement?.className).toContain("overflow-auto");
  });

  it("leaves the diagram in the answer sized to the bubble", async () => {
    const { container } = renderBlock(drawCappedSource);
    await screen.findByRole("button", { name: "図を拡大" });

    expect(container.querySelector("svg")?.getAttribute("style")).toBe("max-width: 842px;");
  });

  it("closes the diagram on escape", async () => {
    const user = await openDiagram();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the diagram when the backdrop is clicked", async () => {
    const user = await openDiagram();

    const backdrop = screen.getByRole("dialog").parentElement;
    if (backdrop === null) throw new Error("the dialog has no backdrop");
    await user.click(backdrop);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays open when the reader clicks inside the diagram", async () => {
    const user = await openDiagram();

    await user.click(screen.getByRole("heading", { name: "図" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  // The page-turn keys are read from `window`, one step further out than the
  // document the popup listens on, so a diagram being read does not take the
  // page out from under it.
  it("keeps the page-turn keys from reaching the page while it is open", async () => {
    const pageTurns = vi.fn();
    window.addEventListener("keydown", pageTurns);
    const user = await openDiagram();

    await user.keyboard("{ArrowRight}");

    window.removeEventListener("keydown", pageTurns);
    expect(pageTurns).not.toHaveBeenCalled();
  });

  it("lets the page-turn keys through once the diagram is closed", async () => {
    const pageTurns = vi.fn();
    window.addEventListener("keydown", pageTurns);
    const user = await openDiagram();
    await user.click(screen.getByRole("button", { name: "図を閉じる" }));

    await user.keyboard("{ArrowRight}");

    window.removeEventListener("keydown", pageTurns);
    expect(pageTurns).toHaveBeenCalled();
  });

  // A fence completes while the tokens are still arriving, so the diagram in
  // front of the reader may still be redrawn — and the bubble holding it is
  // swapped for the saved answer the moment the stream ends, which would take
  // an open popup away with it.
  it("offers no way in while the answer is still being written", async () => {
    const { container } = renderBlock(drawCappedSource, "graph TD", true);

    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
    expect(screen.queryByRole("button", { name: "図を拡大" })).toBeNull();
  });
});
