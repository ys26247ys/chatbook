import { useState } from "react";
import { asStandaloneDocument } from "../../lib/htmlDiagram";
import { DiagramPopup } from "./DiagramPopup";

/** What the link says when the fence named its diagram nothing. */
const DEFAULT_CAPTION = "図解を見る";

interface HtmlDiagramProps {
  /** The fence's contents: the document the popup renders. */
  html: string;
  /** The caption the fence wrote in its info string, or null when it wrote none. */
  caption: string | null;
}

/**
 * A ```html fence, shown as the link that opens it.
 *
 * The answer is written by a model and the reader is one person, but the fence
 * is still text out of a document: it is rendered in a frame of its own rather
 * than laid into the page, so nothing it carries can read the session it is
 * being read in.
 */
export function HtmlDiagram({ html, caption }: HtmlDiagramProps) {
  const [open, setOpen] = useState(false);
  const label = caption ?? DEFAULT_CAPTION;

  return (
    <div className="mb-2 last:mb-0">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="cursor-pointer text-blue-600 underline"
      >
        {label}
      </button>
      {open && (
        <DiagramPopup label={label} closeLabel="図解を閉じる" onClose={() => setOpen(false)}>
          {/* allow-scripts without allow-same-origin: the frame draws itself
              under an opaque origin, with no path back to the app's cookies,
              storage or DOM */}
          <iframe
            title={label}
            srcDoc={asStandaloneDocument(html)}
            sandbox="allow-scripts"
            className="h-full w-full flex-1 bg-white"
          />
        </DiagramPopup>
      )}
    </div>
  );
}
