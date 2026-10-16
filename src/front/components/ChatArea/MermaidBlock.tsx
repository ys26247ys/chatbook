import { useId, useState, type ReactNode } from "react";
import useSWRImmutable from "swr/immutable";
import { widenSvg } from "../../lib/mermaidSvg";
import { DiagramPopup } from "./DiagramPopup";

/** Names the diagram everywhere it is spoken of: there is nothing in the fence to name it with. */
const LABEL = "図";

/** The gap a block of the answer leaves under itself, unless it is the last one. */
const BLOCK_SPACING = "mb-2 last:mb-0";

/** Turns mermaid source into an SVG document. Injected so tests can skip the real drawing. */
export type RenderDiagram = (id: string, code: string) => Promise<string>;

interface MermaidBlockProps {
  /** The fence's contents, i.e. the diagram source */
  code: string;
  /** Shown until the diagram is drawn, and instead of it if the source does not parse */
  fallback: ReactNode;
  /** True while tokens are still arriving, when the diagram may yet be redrawn. */
  streaming?: boolean;
  renderDiagram?: RenderDiagram;
}

/**
 * mermaid is a megabyte of its own, and most answers have no diagram in them,
 * so it is fetched only once one shows up.
 */
const drawWithMermaid: RenderDiagram = async (id, code) => {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    // Without this, a source that does not parse leaves mermaid's own "Syntax
    // error" drawing in a <div> on <body>, where it sits under the whole page.
    // Half-streamed sources fail to parse constantly, so the fallback below is
    // what says so instead.
    suppressErrorRendering: true,
    // Labels are drawn as SVG text rather than HTML in a <foreignObject>.
    // The HTML path lays a label out with `white-space: nowrap` and
    // `max-width: 200px`, then turns wrapping on only when the measured box
    // comes back as exactly 200 -- and it measures with getBoundingClientRect,
    // which the browser's page zoom scales. At any zoom but 100% the
    // comparison misses, so the label keeps `nowrap` and is cut off where the
    // <foreignObject> ends. Japanese has no spaces, so a cut lands mid
    // sentence. SVG text is measured in user units, which zoom does not touch,
    // and wraps between characters rather than at spaces.
    htmlLabels: false,
  });
  const { svg } = await mermaid.render(id, code);
  return svg;
};

/**
 * A ```mermaid fence, drawn as a diagram.
 *
 * The answer streams in token by token, so for most of its life the source is
 * a fragment that parses into nothing. Rather than show an error for each of
 * those, an undrawable source falls back to the code block the rest of the
 * markdown would have rendered, and turns into a diagram once it completes.
 *
 * In the answer the diagram is drawn no wider than the bubble holding it, which
 * for a diagram of any size means text too small to read — on a phone, where
 * the whole chat is a sheet, for all but the plainest of them. So the finished
 * diagram is also a way into a window of its own, where it is drawn at the size
 * mermaid measured.
 */
export function MermaidBlock({
  code,
  fallback,
  streaming = false,
  renderDiagram = drawWithMermaid,
}: MermaidBlockProps) {
  // mermaid puts this in the DOM as an id, where useId's own colons would make
  // it unusable as a selector
  const id = `mermaid-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  const { data: svg } = useSWRImmutable(["mermaid", code], () => renderDiagram(id, code), {
    // Every keystroke of the stream is a new key, so retrying a source that
    // did not parse only burns work on a fragment that is already outdated
    shouldRetryOnError: false,
  });

  if (svg === undefined) return fallback;

  // A fence completes before the answer does, so a diagram can be redrawn
  // under a reader who already opened it — and when the stream ends the bubble
  // holding it is swapped for the saved answer, which would close the window
  // with it. The way in arrives with the finished answer, as the link on an
  // html fence does.
  if (streaming) return <Drawing svg={svg} className={BLOCK_SPACING} />;

  return <EnlargeableDiagram svg={svg} />;
}

/** The diagram as it sits in the answer, drawn no wider than the bubble holds. */
function Drawing({ svg, className = "" }: { svg: string; className?: string }) {
  return (
    <div
      className={`overflow-x-auto rounded bg-white p-2 ${className}`}
      // mermaid sanitizes its own output (securityLevel defaults to "strict")
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/** The finished diagram, and the window the reader can open it in. */
function EnlargeableDiagram({ svg }: { svg: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* The gap under the diagram belongs to whatever stands in the answer's
          flow, which here is the button: the drawing inside it is always a
          last child, so `last:mb-0` would zero itself there every time. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${LABEL}を拡大`}
        className={`block w-full cursor-zoom-in text-left ${BLOCK_SPACING}`}
      >
        <Drawing svg={svg} />
      </button>
      {open && (
        <DiagramPopup label={LABEL} closeLabel={`${LABEL}を閉じる`} onClose={() => setOpen(false)}>
          <div
            className="flex-1 overflow-auto bg-white p-4"
            // The same drawing mermaid sanitized, with the width it was capped
            // to turned into the width it is held at
            dangerouslySetInnerHTML={{ __html: widenSvg(svg) }}
          />
        </DiagramPopup>
      )}
    </>
  );
}
