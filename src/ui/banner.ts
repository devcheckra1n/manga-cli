// ASCII banner with a violet -> cyan truecolor gradient.

import { colorEnabled } from "./colors.ts";

const ART = [
  " ███╗   ███╗ █████╗ ███╗   ██╗ ██████╗  █████╗ ",
  " ████╗ ████║██╔══██╗████╗  ██║██╔════╝ ██╔══██╗",
  " ██╔████╔██║███████║██╔██╗ ██║██║  ███╗███████║",
  " ██║╚██╔╝██║██╔══██║██║╚██╗██║██║   ██║██╔══██║",
  " ██║ ╚═╝ ██║██║  ██║██║ ╚████║╚██████╔╝██║  ██║",
  " ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝",
  "          ██████╗██╗     ██╗                   ",
  "         ██╔════╝██║     ██║                    ",
  "         ██║     ██║     ██║                    ",
  "         ██║     ██║     ██║                    ",
  "         ╚██████╗███████╗██║                    ",
  "          ╚═════╝╚══════╝╚═╝                    ",
];

const START: [number, number, number] = [149, 76, 233]; // violet
const END: [number, number, number] = [34, 211, 238]; // cyan

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

export function banner(): string {
  const n = ART.length - 1;
  const lines = ART.map((line, i) => {
    if (!colorEnabled) return line;
    const t = n <= 0 ? 0 : i / n;
    const r = lerp(START[0], END[0], t);
    const g = lerp(START[1], END[1], t);
    const b = lerp(START[2], END[2], t);
    return `\x1b[38;2;${r};${g};${b}m${line}\x1b[0m`;
  });
  const tagline = colorEnabled
    ? "\x1b[2m         terminal manga reader · atsu.moe\x1b[0m"
    : "         terminal manga reader · atsu.moe";
  return "\n" + lines.join("\n") + "\n" + tagline + "\n";
}

/** Banner is shown only on an interactive TTY, unless explicitly disabled. */
export function shouldShowBanner(configShow: boolean): boolean {
  if (process.env.MANGA_CLI_NO_BANNER === "1") return false;
  if (!process.stdout.isTTY) return false;
  return configShow;
}
