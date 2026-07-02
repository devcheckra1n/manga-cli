// ASCII banner with a diagonal violet → pink → cyan truecolor gradient.

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

// Three gradient stops, swept diagonally (top-left → bottom-right).
const STOPS: Array<[number, number, number]> = [
  [149, 76, 233], // violet
  [244, 114, 182], // pink
  [34, 211, 238], // cyan
];

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/** Sample the 3-stop gradient at t ∈ [0,1]. */
function gradient(t: number): [number, number, number] {
  const seg = t < 0.5 ? 0 : 1;
  const local = (t - seg * 0.5) * 2;
  const [a, b] = [STOPS[seg], STOPS[seg + 1]];
  return [lerp(a[0], b[0], local), lerp(a[1], b[1], local), lerp(a[2], b[2], local)];
}

export function banner(version?: string): string {
  const H = ART.length;
  const W = Math.max(...ART.map((l) => l.length));
  // Diagonal sweep: rows count ~2.2 columns each so the angle looks natural
  // with terminal cells being taller than they are wide.
  const span = W + 2.2 * (H - 1);

  const lines = ART.map((line, y) => {
    if (!colorEnabled) return line;
    let out = "";
    let last = "";
    for (let x = 0; x < line.length; x++) {
      const chr = line[x];
      if (chr === " ") {
        out += chr;
        continue;
      }
      const [r, g, b] = gradient(Math.min(1, (x + 2.2 * y) / span));
      const code = `\x1b[38;2;${r};${g};${b}m`;
      if (code !== last) {
        out += code;
        last = code;
      }
      out += chr;
    }
    return out + "\x1b[0m";
  });

  const text = `terminal manga reader 🎲${version ? ` · v${version}` : ""}`;
  const pad = " ".repeat(Math.max(0, Math.floor((W - text.length) / 2)));
  const tagline = colorEnabled ? `${pad}\x1b[2m${text}\x1b[0m` : pad + text;
  return "\n" + lines.join("\n") + "\n" + tagline + "\n";
}

/** Banner is shown only on an interactive TTY, unless explicitly disabled. */
export function shouldShowBanner(configShow: boolean): boolean {
  if (process.env.MANGA_CLI_NO_BANNER === "1") return false;
  if (!process.stdout.isTTY) return false;
  return configShow;
}
