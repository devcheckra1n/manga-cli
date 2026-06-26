// Lightweight ANSI spinner (no deps).

import { c } from "./colors.ts";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class Spinner {
  private i = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private text: string) {}

  start(): this {
    if (!process.stdout.isTTY) return this;
    process.stdout.write("\x1b[?25l"); // hide cursor
    this.timer = setInterval(() => {
      const frame = FRAMES[this.i++ % FRAMES.length];
      process.stdout.write(`\r\x1b[2K${c.cyan(frame)} ${this.text}`);
    }, 80);
    return this;
  }

  update(text: string): void {
    this.text = text;
  }

  stop(final?: string): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (process.stdout.isTTY) process.stdout.write("\r\x1b[2K\x1b[?25h"); // clear + show cursor
    if (final) process.stdout.write(final + "\n");
  }
}

/** Run an async task under a spinner, always cleaning up. */
export async function withSpinner<T>(text: string, fn: () => Promise<T>): Promise<T> {
  const sp = new Spinner(text).start();
  try {
    return await fn();
  } finally {
    sp.stop();
  }
}
