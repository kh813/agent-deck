import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { openUrl } from "@tauri-apps/plugin-opener";
import "@xterm/xterm/css/xterm.css";
import { computeFitSize } from "../lib/terminalFit";
import { registerWrappedUrlLinkProvider } from "../lib/wrappedUrlLinkProvider";
import { MIN_CONTRAST_RATIO, TerminalTheme } from "../utils/themes";
import { hasText, isManualPasteKey, pickImageFile } from "../lib/imageAttach";
import {
  attachWebglRenderer,
  recordTerminalRender,
  reportActiveRenderer,
} from "../lib/terminalRenderer";

const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);

interface TerminalViewProps {
  onData?: (data: string) => void;
  terminalRef: React.MutableRefObject<Terminal | null>;
  onResize?: (size: { rows: number; cols: number }) => void;
  theme: TerminalTheme;
  fontFamily?: string;
  fontSize?: number;
  /** Whether this terminal tab is currently visible (only the active tab holds a WebGL context). */
  active?: boolean;
  /** Whether hardware-accelerated WebGL rendering is enabled (user fallback toggle). */
  webglEnabled?: boolean;
  // Image pasted via the webview's paste event (macOS Cmd+V).
  onImagePaste?: (file: File) => void;
  // Save the OS clipboard's image, if any; true = an image was attached
  // (then no text is pasted). See lib/imageAttach.ts isManualPasteKey.
  onNativeImagePaste?: () => Promise<boolean>;
}

export function TerminalView({
  onData,
  terminalRef,
  onResize,
  theme,
  fontFamily,
  fontSize,
  active = true,
  webglEnabled = true,
  onImagePaste,
  onNativeImagePaste,
}: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [termInstance, setTermInstance] = useState<Terminal | null>(null);
  // Refs, so the terminal (created once) always calls the latest handlers.
  const onImagePasteRef = useRef(onImagePaste);
  onImagePasteRef.current = onImagePaste;
  const onNativeImagePasteRef = useRef(onNativeImagePaste);
  onNativeImagePasteRef.current = onNativeImagePaste;

  useEffect(() => {
    if (!containerRef.current) return;

    // Initialize xterm.js Terminal
    const term = new Terminal({
      cursorBlink: true,
      theme: theme,
      fontSize: fontSize || 13,
      fontFamily: fontFamily || "Menlo, Monaco, 'Courier New', monospace",
      allowProposedApi: true,
      // CLIs (e.g. Charm/lipgloss-based agents) often emit explicit 24-bit
      // truecolor grays for dim/secondary text, assuming a dark terminal
      // background. That bypasses the 16-color theme palette entirely, so
      // on light themes those grays can end up nearly invisible. This
      // forces xterm to adjust any foreground color to a minimum contrast
      // against the actual background, regardless of theme (see
      // MIN_CONTRAST_RATIO for why it's 3, not 4.5).
      minimumContrastRatio: MIN_CONTRAST_RATIO,
    });

    // Custom link provider instead of the stock WebLinksAddon: it also
    // detects URLs wrapped by the underlying CLI itself (via cursor
    // positioning rather than terminal auto-wrap), which the stock addon
    // misses since it only follows xterm's own `isWrapped` flag.
    const linkProvider = registerWrappedUrlLinkProvider(term, (_event, uri) => {
      openUrl(uri);
    });
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";

    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      const mod = event.ctrlKey || event.metaKey;

      // Ctrl+Shift+C (or Cmd+Shift+C) - Explicit Copy
      if (mod && event.shiftKey && event.key.toLowerCase() === "c") {
        if (term.hasSelection()) {
          navigator.clipboard.writeText(term.getSelection());
        }
        return false;
      }

      // Paste handled by the app: Ctrl/Cmd+Shift+V everywhere, and plain
      // Ctrl+V on Windows/Linux (xterm.js would send it as ^V, and no paste
      // event would fire). An image on the clipboard is attached as a file
      // path; otherwise the text is pasted (term.paste keeps bracketed paste).
      if (isManualPasteKey(event, IS_MAC)) {
        void (async () => {
          try {
            if (onNativeImagePasteRef.current && (await onNativeImagePasteRef.current())) return;
          } catch (err) {
            console.error("Failed to attach clipboard image:", err);
          }
          try {
            const text = await navigator.clipboard.readText();
            if (text) term.paste(text);
          } catch (err) {
            console.error("Failed to read clipboard:", err);
          }
        })();
        return false;
      }

      // Ctrl+Shift+A (or Cmd+Shift+A) - Select All
      if (mod && event.shiftKey && event.key.toLowerCase() === "a") {
        term.selectAll();
        return false;
      }

      // Ctrl+C (or Cmd+C) - Fallback Copy on selection, otherwise let SIGINT pass through to PTY
      if (mod && !event.shiftKey && event.key.toLowerCase() === "c" && term.hasSelection()) {
        navigator.clipboard.writeText(term.getSelection());
        return false;
      }

      return true;
    });

    // Open terminal in the container DOM element
    term.open(containerRef.current);

    const fitToContentBox = (widthPx: number, heightPx: number) => {
      const size = computeFitSize(term, widthPx, heightPx);
      if (size && (size.cols !== term.cols || size.rows !== term.rows)) {
        term.resize(size.cols, size.rows);
      }
    };

    // clientWidth/clientHeight are the container's own content-box size
    // (padding included, border/scrollbar excluded), independent of
    // whatever xterm renders inside it.
    const style = window.getComputedStyle(containerRef.current);
    const paddingX = parseInt(style.paddingLeft, 10) + parseInt(style.paddingRight, 10);
    const paddingY = parseInt(style.paddingTop, 10) + parseInt(style.paddingBottom, 10);
    fitToContentBox(containerRef.current.clientWidth - paddingX, containerRef.current.clientHeight - paddingY);

    terminalRef.current = term;
    setTermInstance(term);

    const renderListener = term.onRender(() => {
      recordTerminalRender();
    });

    let lastReportedSize = { rows: term.rows, cols: term.cols };
    onResize?.(lastReportedSize);

    // Only notify the PTY when the row/col grid actually changes - a resize
    // (SIGWINCH-equivalent) makes agy redraw its whole UI from scratch, and
    // ResizeObserver can fire many times for sub-character-cell pixel
    // changes that don't change the grid at all. Reporting those as resizes
    // triggers redundant agy redraws that can race with each other and
    // briefly leave a duplicated row (e.g. the bottom status bar) on screen.
    const reportSizeIfChanged = () => {
      if (term.rows !== lastReportedSize.rows || term.cols !== lastReportedSize.cols) {
        lastReportedSize = { rows: term.rows, cols: term.cols };
        onResize?.(lastReportedSize);
      }
    };

    // Native paste event (macOS Cmd+V, Edit -> Paste): an image becomes an
    // attached file path. Captured before xterm's own textarea handler.
    const pasteTarget = containerRef.current;
    const onPasteEvent = (e: ClipboardEvent) => {
      const file = pickImageFile(e.clipboardData?.items);
      if (file && onImagePasteRef.current) {
        e.preventDefault();
        e.stopImmediatePropagation();
        onImagePasteRef.current(file);
        return;
      }
      // Some webviews hand over a copied screenshot without exposing it as
      // a file item: no text either -> ask the OS clipboard directly.
      if (!hasText(e.clipboardData) && onNativeImagePasteRef.current) {
        e.preventDefault();
        e.stopImmediatePropagation();
        void onNativeImagePasteRef.current().catch((err) => console.error("Failed to attach clipboard image:", err));
      }
    };
    pasteTarget.addEventListener("paste", onPasteEvent, true);

    // Handle user inputs directly typed inside the debug terminal
    const dataListener = term.onData((data) => {
      if (onData) {
        onData(data);
      }
    });

    // Resize observer to auto-fit terminal on container layout changes.
    // Debounced so a burst of layout events (e.g. window drag-resize, or
    // panels settling right after mount) coalesces into a single fit/resize
    // once things stop moving, instead of one PTY resize per intermediate
    // frame. Uses the ResizeObserver entry's own contentRect (the box that
    // triggered this callback) rather than re-measuring the DOM afterward,
    // so resizing the terminal can never feed back into another observed
    // size change of its own container.
    let resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;

      if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
      resizeDebounceTimer = setTimeout(() => {
        resizeDebounceTimer = null;
        try {
          fitToContentBox(width, height);
          reportSizeIfChanged();
        } catch (e) {
          // Suppress layout errors
        }
      }, 120);
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      pasteTarget.removeEventListener("paste", onPasteEvent, true);
      dataListener.dispose();
      renderListener.dispose();
      linkProvider.dispose();
      resizeObserver.disconnect();
      if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
      setTermInstance(null);
      term.dispose();
      terminalRef.current = null;
    };
  }, [onData, terminalRef, onResize]);

  // Attach WebGL renderer only while this tab is active and hardware
  // acceleration is enabled (app_specs.md 5.7.5). Disposing on tab switch
  // keeps active WebGL contexts <= 1 across up to 6 concurrent tabs.
  useEffect(() => {
    if (!termInstance) return;
    if (!active) return;
    if (!webglEnabled) {
      reportActiveRenderer("dom");
      return;
    }
    const handle = attachWebglRenderer(termInstance, {
      onFallback: (reason, err) => {
        reportActiveRenderer("dom");
        if (reason === "context-loss") {
          console.warn("WebGL terminal context lost; falling back to DOM renderer.");
        } else if (err) {
          console.warn("WebGL terminal renderer unavailable; using DOM renderer:", err);
        }
      },
    });
    reportActiveRenderer(handle.kind);
    return () => {
      handle.dispose();
    };
  }, [termInstance, active, webglEnabled]);

  // Handle dynamic theme changes without re-creating terminal instance
  useEffect(() => {
    if (terminalRef.current && theme) {
      terminalRef.current.options.theme = theme;
      terminalRef.current.clearTextureAtlas();
    }
  }, [theme, terminalRef]);

  // Handle dynamic font changes and trigger cell refit
  useEffect(() => {
    if (terminalRef.current && containerRef.current) {
      let changed = false;
      if (fontSize && terminalRef.current.options.fontSize !== fontSize) {
        terminalRef.current.options.fontSize = fontSize;
        changed = true;
      }
      if (fontFamily && terminalRef.current.options.fontFamily !== fontFamily) {
        terminalRef.current.options.fontFamily = fontFamily;
        changed = true;
      }
      if (changed) {
        terminalRef.current.clearTextureAtlas();
        // Force refit for new cell metrics
        const style = window.getComputedStyle(containerRef.current);
        const paddingX = parseInt(style.paddingLeft, 10) + parseInt(style.paddingRight, 10);
        const paddingY = parseInt(style.paddingTop, 10) + parseInt(style.paddingBottom, 10);
        const size = computeFitSize(terminalRef.current, containerRef.current.clientWidth - paddingX, containerRef.current.clientHeight - paddingY);
        if (size) {
          terminalRef.current.resize(size.cols, size.rows);
          onResize?.({ rows: size.rows, cols: size.cols });
        }
      }
    }
  }, [fontSize, fontFamily, terminalRef, onResize]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: theme.background,
        padding: "5px",
        borderRadius: "5px",
        overflow: "hidden",
        transition: "background-color 0.2s ease",
      }}
    />
  );
}
