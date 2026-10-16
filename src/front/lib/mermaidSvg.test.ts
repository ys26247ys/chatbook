import { describe, it, expect } from "vite-plus/test";
import { widenSvg } from "./mermaidSvg";

/** The opening tag mermaid writes: `width="100%"` capped at the size it measured. */
const DRAWN =
  '<svg aria-roledescription="flowchart-v2" viewBox="0 0 842 1120" style="max-width: 842px;" xmlns="http://www.w3.org/2000/svg" width="100%" id="mermaid-1"><g/></svg>';

describe("widenSvg", () => {
  it("turns the size mermaid measured from a ceiling into a floor", () => {
    expect(widenSvg(DRAWN)).toContain('style="min-width: 842px; max-width: none;"');
  });

  it("keeps everything else about the drawing as mermaid wrote it", () => {
    const widened = widenSvg(DRAWN);

    expect(widened).toContain('viewBox="0 0 842 1120"');
    expect(widened).toContain('width="100%"');
    expect(widened).toContain("<g/></svg>");
  });

  it("carries a size written with a fraction", () => {
    const drawn = '<svg style="max-width: 230.46875px;" width="100%"></svg>';

    expect(widenSvg(drawn)).toBe(
      '<svg style="min-width: 230.46875px; max-width: none;" width="100%"></svg>',
    );
  });

  // A diagram drawn without mermaid's useMaxWidth carries its own width and is
  // not capped to begin with, so there is no ceiling here to lift.
  it("leaves a drawing that was never capped alone", () => {
    const drawn = '<svg width="230" height="174" viewBox="0 0 230 174"></svg>';

    expect(widenSvg(drawn)).toBe(drawn);
  });

  // The diagram's own stylesheet rides inside the svg, and the labels in it are
  // sized in the same words the root tag uses.
  it("leaves the diagram's own stylesheet alone", () => {
    const drawn = `${DRAWN.replace("<g/>", "<style>.nodeLabel{max-width: 200px;}</style>")}`;

    expect(widenSvg(drawn)).toContain(".nodeLabel{max-width: 200px;}");
  });
});
