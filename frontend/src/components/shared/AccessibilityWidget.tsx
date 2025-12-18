import { useEffect, useRef } from "react";

// Vendor notice: the Cloudflare Pages URL may be unavailable; jsDelivr is the recommended CDN.
const SIENNA_SOURCES = [
  "https://cdn.jsdelivr.net/npm/sienna-accessibility@latest/dist/sienna-accessibility.umd.js",
  // Legacy/fallback (may be 404 depending on upstream hosting):
  "https://accessibility-widget.pages.dev/sienna.min.js"
] as const;

const SCRIPT_ID = "sienna-accessibility-script";

export default function AccessibilityWidget() {
  const initializedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let script: HTMLScriptElement | null = null;

    const w = window as Window & { __siennaInitDone?: boolean };

    const dedupeDom = () => {
      const nodes = Array.from(document.querySelectorAll(".asw-container"));
      if (nodes.length <= 1) return;
      // Keep the most recently added instance.
      for (let i = 0; i < nodes.length - 1; i++) nodes[i]?.parentNode?.removeChild(nodes[i]);
    };

    const init = () => {
      if (cancelled) return;
      if (initializedRef.current) return;
      if (w.__siennaInitDone) {
        initializedRef.current = true;
        dedupeDom();
        return;
      }
      if (!window.sienna || typeof window.sienna.init !== "function") return;

      initializedRef.current = true;
      try {
        window.sienna.init({
          iconPosition: "bottom-left",
          primaryColor: "#3b82f6"
        });
        w.__siennaInitDone = true;
      } catch (e) {
        // Don't crash the app if the widget fails.
        console.warn("[AccessibilityWidget] Failed to init sienna widget:", e);
      } finally {
        // React StrictMode or double script execution can cause duplicates; keep UI clean.
        window.setTimeout(dedupeDom, 0);
      }
    };

    const loadAt = (idx: number) => {
      if (cancelled) return;
      const src = SIENNA_SOURCES[idx];
      if (!src) return;

      script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = src;
      script.defer = true;
      script.onload = () => {
        init();
        window.setTimeout(dedupeDom, 0);
      };
      script.onerror = () => {
        if (cancelled) return;
        // Try next source if available.
        if (idx + 1 < SIENNA_SOURCES.length) {
          try {
            if (script && script.parentNode) script.parentNode.removeChild(script);
          } catch {
            // ignore
          }
          loadAt(idx + 1);
          return;
        }
        console.warn(`[AccessibilityWidget] Failed to load: ${src}`);
      };

      document.body.appendChild(script);
    };

    // If already available (e.g., cached or injected by another mount), init immediately.
    if (window.sienna) {
      init();
      return () => {
        cancelled = true;
      };
    }

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      script = existing;
      // Attach a one-time load handler in case it hasn't loaded yet.
      const onLoad = () => init();
      existing.addEventListener("load", onLoad, { once: true });
      // Also try init immediately in case it already loaded but window.sienna is late-bound.
      init();
      return () => {
        cancelled = true;
        existing.removeEventListener("load", onLoad);
        // Cleanup per spec to avoid duplicates during hot reloads.
        if (existing.parentNode) existing.parentNode.removeChild(existing);
      };
    }

    loadAt(0);

    return () => {
      cancelled = true;
      initializedRef.current = false;
      w.__siennaInitDone = false;
      // Cleanup to prevent duplicate injections during hot reloads.
      if (script && script.parentNode) script.parentNode.removeChild(script);
      // Also remove any widget DOM that may have been injected.
      document.querySelectorAll(".asw-container").forEach((n) => n.parentNode?.removeChild(n));
    };
  }, []);

  return null;
}

/*
4.1 Verification Steps

Visual Check:
- Reload the application.
- Verify a floating "Accessibility" icon appears in the bottom-left corner of the screen.

Functionality Check:
- Click the icon.
- Verify the menu opens with options (Text Size, Contrast, Saturation).
- Test "High Contrast" mode. Ensure the MediVoice UI colors adjust accordingly.

Console Check:
- Open Chrome DevTools Console.
- Ensure there are no 404 errors related to sienna.min.js.
- Ensure no TypeScript errors regarding window.sienna property access.
*/


