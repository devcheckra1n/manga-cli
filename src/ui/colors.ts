// Minimal ANSI color helpers. Respects the NO_COLOR convention.

const enabled = !("NO_COLOR" in process.env);

type Paint = (s: string) => string;
function p(code: string): Paint {
  return (s) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : s);
}

export const c = {
  reset: "\x1b[0m",
  accent: p("38;2;167;139;250"), // violet
  violet: p("38;2;167;139;250"),
  cyan: p("38;2;34;211;238"),
  pink: p("38;2;244;114;182"),
  green: p("38;2;74;222;128"),
  red: p("38;2;248;113;113"),
  yellow: p("38;2;250;204;21"),
  gray: p("38;5;245"),
  dim: p("2"),
  bold: p("1"),
  italic: p("3"),
};

export const colorEnabled = enabled;
