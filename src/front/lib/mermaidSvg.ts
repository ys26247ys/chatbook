/**
 * The size mermaid measured, as it writes it on the drawing's opening tag.
 *
 * `useMaxWidth` is on by default, which gives the svg `width="100%"` and a
 * `max-width` of the size the diagram came out at. Nothing else on that tag is
 * written in these words, and the diagram's own stylesheet — which sizes labels
 * the same way — rides further in, so the opening tag is matched as a whole
 * rather than searched through.
 */
const CAPPED_OPENING_TAG = /^(\s*<svg\b[^>]*?)max-width:\s*([\d.]+)px;?/;

/**
 * Lets a diagram be drawn at the size mermaid measured, rather than the size of
 * the box it is put in.
 *
 * In the bubble that cap is what keeps a diagram inside the answer, but it also
 * means the drawing shrinks to whatever holds it: in the sheet on a phone, to a
 * few hundred pixels, which is where a diagram of many nodes stops being
 * readable. Turning the ceiling into a floor keeps the drawing filling a box
 * that is wider than it needs, and holds it at its measured size when the box
 * is narrower — leaving the box to scroll, where before the text just got
 * smaller.
 */
export function widenSvg(svg: string): string {
  // A diagram drawn without `useMaxWidth` carries its own width and was never
  // capped, so there is no ceiling to lift and it is handed back as it came.
  return svg.replace(
    CAPPED_OPENING_TAG,
    (_match, before: string, width: string) => `${before}min-width: ${width}px; max-width: none;`,
  );
}
