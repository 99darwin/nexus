import { useEffect } from "react";

/**
 * Pins `--app-height` to the *visible* viewport so layout tracks the on-screen
 * keyboard. iOS Safari overlays the keyboard without shrinking 100dvh — the
 * input ends up behind it. visualViewport.height does shrink, so body height
 * follows it (see base.css) and the chat form stays pinned above the keyboard.
 *
 * The scroll listener covers iOS's habit of panning the page under the
 * keyboard (offsetTop drift): body is overflow-hidden, so snapping window
 * scroll back to 0 keeps the layout anchored.
 */
export function useVisualViewportHeight(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const update = () => {
      document.documentElement.style.setProperty("--app-height", `${viewport.height}px`);
      window.scrollTo(0, 0);
    };

    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      document.documentElement.style.removeProperty("--app-height");
    };
  }, []);
}
