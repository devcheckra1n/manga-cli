// Terminal capability detection: which inline-image protocol to use.

import type { ReaderMode } from "../utils/config.ts";

export type ImageProtocol = "kitty" | "iterm2" | "chafa";

/**
 * Probe terminal support in a fixed priority order (do not guess — this mirrors
 * the documented behavior of each terminal).
 */
export function detectImageProtocol(): ImageProtocol {
  const term = process.env.TERM ?? "";
  const termProgram = process.env.TERM_PROGRAM ?? "";

  // Ghostty: TERM=xterm-ghostty, TERM_PROGRAM=ghostty. Complete Kitty graphics impl.
  if (termProgram === "ghostty" || term === "xterm-ghostty") return "kitty";
  // kitty itself
  if (term === "xterm-kitty") return "kitty";
  // WezTerm supports the Kitty graphics protocol
  if (termProgram === "WezTerm") return "kitty";
  // iTerm2 has its own inline image protocol (OSC 1337)
  if (termProgram === "iTerm.app") return "iterm2";
  // Konsole supports the Kitty protocol since v23.04
  if (process.env.KONSOLE_VERSION) return "kitty";
  // Everything else (Alacritty, xterm, plain TTY, ...) falls back to chafa symbols.
  return "chafa";
}

/** Resolve a configured reader mode to a concrete protocol. */
export function resolveProtocol(mode: ReaderMode): ImageProtocol {
  return mode === "auto" ? detectImageProtocol() : mode;
}

/** Map a protocol to the corresponding chafa `--format`. */
export function chafaFormat(proto: ImageProtocol): "kitty" | "iterm" | "symbols" {
  if (proto === "kitty") return "kitty";
  if (proto === "iterm2") return "iterm";
  return "symbols";
}

export function termSize(): { cols: number; rows: number } {
  return { cols: process.stdout.columns || 80, rows: process.stdout.rows || 24 };
}

export function inTmux(): boolean {
  return Boolean(process.env.TMUX);
}
