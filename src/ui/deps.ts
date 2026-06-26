// System dependency detection (fzf, chafa) + platform-aware install hints.

import { c } from "./colors.ts";

export function hasCommand(cmd: string): boolean {
  return Bun.which(cmd) !== null;
}

async function linuxDistro(): Promise<"debian" | "fedora" | "arch" | "unknown"> {
  try {
    const text = await Bun.file("/etc/os-release").text();
    const field = (key: string): string => {
      const line = text.split("\n").find((l) => l.startsWith(key + "="));
      return line ? line.slice(key.length + 1).replace(/"/g, "").toLowerCase() : "";
    };
    const id = field("ID") + " " + field("ID_LIKE");
    if (/debian|ubuntu|mint|pop/.test(id)) return "debian";
    if (/fedora|rhel|centos|rocky|alma/.test(id)) return "fedora";
    if (/arch|manjaro|endeavour/.test(id)) return "arch";
  } catch {
    // /etc/os-release missing — unknown distro.
  }
  return "unknown";
}

/** The right install command for the current platform. */
export async function installCommand(pkgs: string[]): Promise<string> {
  const list = pkgs.join(" ");
  if (process.platform === "darwin") return `brew install ${list}`;
  switch (await linuxDistro()) {
    case "debian":
      return `sudo apt install ${list}`;
    case "fedora":
      return `sudo dnf install ${list}`;
    case "arch":
      return `sudo pacman -S ${list}`;
    default:
      return `# install with your package manager:  ${list}`;
  }
}

/** Verify required CLIs exist. If any are missing, print install help and exit(1). */
export async function ensureDeps(required: string[]): Promise<void> {
  const missing = required.filter((cmd) => !hasCommand(cmd));
  if (missing.length === 0) return;

  const cmd = await installCommand(missing);
  const noun = missing.length > 1 ? "tools" : "tool";
  process.stderr.write(
    "\n" +
      c.red(`✗ Missing required ${noun}: `) +
      c.bold(missing.join(", ")) +
      "\n\n" +
      c.dim(`manga-cli needs these to run. Install with:\n`) +
      "  " +
      c.cyan(cmd) +
      "\n\n",
  );
  process.exit(1);
}
