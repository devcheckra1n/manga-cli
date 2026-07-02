// Centralized terminal-mode state so cleanup only undoes what was actually done.
// Sending the "leave alt-screen" sequence when we never *entered* it wipes a
// normal command's output on some terminals (e.g. Ghostty) — so we track it.

const ESC = "\x1b";
let altActive = false;

/** Enter the alternate screen + hide the cursor (the reader does this). */
export function enterAltScreen(): void {
  if (process.stdout.isTTY) process.stdout.write(`${ESC}[?1049h${ESC}[?25l`);
  altActive = true;
}

/** Leave the alternate screen + show the cursor. No-op if we never entered. */
export function leaveAltScreen(): void {
  if (altActive && process.stdout.isTTY) process.stdout.write(`${ESC}[?25h${ESC}[?1049l`);
  altActive = false;
}

/** Safety-net cleanup on exit/interrupt — only leaves the alt screen if we entered it. */
export function restoreTerminal(): void {
  try {
    if (altActive && process.stdout.isTTY) process.stdout.write(`${ESC}[?1049l`);
    altActive = false;
    if (process.stdout.isTTY) process.stdout.write(`${ESC}[?25h`); // always restore the cursor
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  } catch {
    // ignore
  }
}
