// oxlint-disable-next-line no-restricted-imports -- document への keydown 購読 (Escape で図を閉じる) に必要
import { useState, useEffect, type ReactNode } from "react";

/** Both header buttons: the tap target this app gives a finger, and the same hover. */
const HEADER_BUTTON =
  "flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-gray-500 hover:text-gray-800";

/** Corner brackets, pointing out while the figure is not yet filling the screen. */
function MaximizeIcon({ maximized }: { maximized: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-5 w-5 fill-none stroke-current stroke-[1.7]"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path
        d={
          maximized
            ? "M4 9h5V4M20 9h-5V4M20 15h-5v5M4 15h5v5"
            : "M9 4H4v5M15 4h5v5M15 20h5v-5M9 20H4v-5"
        }
      />
    </svg>
  );
}

interface DiagramPopupProps {
  /** Names the popup and its heading. */
  label: string;
  /** Names the button that closes it, in the words of what is being closed. */
  closeLabel: string;
  onClose: () => void;
  /** The figure itself, which brings its own box: this is only the frame around it. */
  children: ReactNode;
}

/**
 * The window a figure out of an answer is read in.
 *
 * Shared by both kinds of figure — the document an html fence holds and the
 * diagram a mermaid fence describes — because what makes this a window rather
 * than a div is all in the ways out of it: escape, the backdrop, the close
 * button, and keeping the keys it does not use from reaching the page behind.
 */
export function DiagramPopup({ label, closeLabel, onClose, children }: DiagramPopupProps) {
  // Nowhere to keep this: the popup is thrown away when it closes, so the next
  // one opens at the size the figure was given rather than the one the reader
  // last chose — the same as the chat's maximize toggle.
  const [maximized, setMaximized] = useState(false);

  // Escape is read off the document rather than off this panel, the way
  // ConfirmDialog reads it off itself: a click on the header leaves focus on
  // the body, which no wrapper's onKeyDown ever sees. (A click inside a
  // sandboxed frame is out of reach either way — keys in another document never
  // reach its parent — so the close button is the way out that always works.)
  //
  // The same listener stops what it does not use. The viewer reads the
  // page-turn keys from `window`, one step further out than this, so a figure
  // open over the page does not turn the page underneath it while the reader
  // is looking at something else.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      e.stopPropagation();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`flex flex-col overflow-hidden rounded-lg bg-white shadow-xl ${
          // Filling the backdrop's box leaves its gutter, and with it the
          // click-outside way out, rather than covering the screen entirely
          maximized ? "h-full w-full" : "h-[80dvh] w-full md:w-4/5"
        }`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 pl-4">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-800">{label}</h2>
          <button
            type="button"
            onClick={() => setMaximized((maximized) => !maximized)}
            aria-label="最大化"
            aria-pressed={maximized}
            className={HEADER_BUTTON}
          >
            <MaximizeIcon maximized={maximized} />
          </button>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            aria-label={closeLabel}
            className={HEADER_BUTTON}
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="h-5 w-5 fill-none stroke-current stroke-[1.7]"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
