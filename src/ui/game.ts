// 🕹 MANGAVANIA — a tiny Castlevania-flavored zombie-slaying minigame.
// Ridge Racer shipped a minigame on its menu screen; manga-cli gets one for
// bad-wifi days. Pure ANSI, no deps, no network. ← → move · space jump ·
// x attack. Zombies take 3 hits and crumble into bones; slay enough and the
// GRAVELORD rises.

import { colorEnabled } from "./colors.ts";
import { termSize } from "./protocol.ts";
import { enterAltScreen, leaveAltScreen } from "./term.ts";

const TICK_MS = 50; // 20 fps
const KILLS_FOR_BOSS = 8;
const PLAYER_HP = 3;
const ZOMBIE_HP = 3;
const BOSS_HP = 15;

// Raw SGR prefixes (the Screen buffer tracks color per cell).
const sgr = (s: string): string => (colorEnabled ? `\x1b[${s}m` : "");
const COL = {
  hero: sgr("38;2;235;235;245"),
  sword: sgr("38;2;250;204;21"),
  zombie: sgr("38;2;74;222;128"),
  flash: sgr("38;2;255;255;255"),
  boss: sgr("38;2;248;113;113"),
  eye: sgr("38;2;250;204;21"),
  bone: sgr("2"),
  gore: sgr("38;2;134;239;172"),
  bossGore: sgr("38;2;244;114;182"),
  dim: sgr("2"),
  violet: sgr("38;2;167;139;250"),
  cyan: sgr("38;2;34;211;238"),
  red: sgr("38;2;248;113;113"),
  yellow: sgr("38;2;250;204;21"),
};

// ── sprites (grid-safe: single-width glyphs only) ──────────────────────────────

const HERO = [" Ω ", "/|\\", "/ \\"];
const ZOMBIE_A = [" Z ", "/|\\", "/ \\"];
const ZOMBIE_B = [" Z ", "\\|/", "/ \\"];
const ZOMBIE_DIE = [
  ["   ", " z ", "/| "],
  ["   ", "   ", ",z\\"],
  ["   ", "   ", "· ·"],
];
const BOSS = [" ▄█▄ ", "▐███▌", " ███ ", " ▛ ▜ "];
const BOSS_DIE = [
  ["     ", " ▄█▄ ", "▐███▌", " ▙ ▟ "],
  ["     ", "     ", " ▄█▄ ", "▖▙▟▗ "],
  ["     ", "     ", "     ", "·▂▂· "],
];

// ── screen buffer (full repaint per tick — flicker-free single write) ──────────

class Screen {
  w = 0;
  h = 0;
  private ch: string[] = [];
  private co: string[] = [];

  begin(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.ch = new Array<string>(w * h).fill(" ");
    this.co = new Array<string>(w * h).fill("");
  }

  put(x: number, y: number, chr: string, color = ""): void {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return;
    this.ch[yi * this.w + xi] = chr;
    this.co[yi * this.w + xi] = color;
  }

  text(x: number, y: number, s: string, color = "", skipSpaces = true): void {
    let i = 0;
    for (const chr of s) {
      if (!skipSpaces || chr !== " ") this.put(x + i, y, chr, color);
      i++;
    }
  }

  sprite(x: number, y: number, rows: readonly string[], color = ""): void {
    rows.forEach((r, i) => this.text(x, y + i, r, color));
  }

  center(y: number, s: string, color = ""): void {
    this.text(Math.floor((this.w - s.length) / 2), y, s, color, false);
  }

  flush(): void {
    let out = "";
    for (let y = 0; y < this.h; y++) {
      out += `\x1b[${y + 1};1H`;
      let cur = "";
      for (let x = 0; x < this.w; x++) {
        const col = this.co[y * this.w + x];
        if (col !== cur) {
          out += "\x1b[0m" + col;
          cur = col;
        }
        out += this.ch[y * this.w + x];
      }
      out += "\x1b[0m";
    }
    process.stdout.write(out);
  }
}

// ── game state ─────────────────────────────────────────────────────────────────

interface Mob {
  x: number;
  hp: number;
  boss: boolean;
  hitFlash: number;
  dying: number; // 0 = alive, >0 = death-animation tick counter
  lunge: number;
}
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

type Phase = "title" | "play" | "dead" | "win";

export async function runGame(): Promise<void> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.log("the minigame needs an interactive terminal");
    return;
  }
  const scr = new Screen();
  const keys: string[] = [];
  const onData = (b: Buffer): void => {
    keys.push(b.toString("utf8"));
  };

  enterAltScreen();
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", onData);

  try {
    await gameLoop(scr, keys);
  } finally {
    process.stdin.off("data", onData);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    leaveAltScreen();
  }
}

async function gameLoop(scr: Screen, keys: string[]): Promise<void> {
  let phase: Phase = "title";
  let px = 0;
  let pvx = 0;
  let jumpY = 0; // rows above the ground
  let vy = 0;
  let facing = 1;
  let hp = PLAYER_HP;
  let invuln = 0;
  let attack = 0; // swing ticks remaining
  let kills = 0;
  let ticks = 0;
  let bossAlerted = 0;
  let winDelay = 0;
  let mobs: Mob[] = [];
  let particles: Particle[] = [];
  let bones: Array<{ x: number; y: number }> = [];
  let spawnCooldown = 0;
  let anim = 0;

  const reset = (w: number): void => {
    phase = "play";
    px = Math.floor(w / 2);
    pvx = 0;
    jumpY = 0;
    vy = 0;
    facing = 1;
    hp = PLAYER_HP;
    invuln = 0;
    attack = 0;
    kills = 0;
    ticks = 0;
    bossAlerted = 0;
    winDelay = 0;
    mobs = [];
    particles = [];
    bones = [];
    spawnCooldown = 0;
  };

  const gore = (x: number, y: number, color: string, n = 3): void => {
    for (let i = 0; i < n; i++) {
      particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 1.6,
        vy: -0.4 - Math.random() * 0.8,
        life: 8,
        color,
      });
    }
  };

  while (true) {
    const { cols, rows } = termSize();
    const w = Math.max(40, cols);
    const h = Math.max(14, rows);
    const ground = h - 3;
    scr.begin(w, h);
    anim++;

    // ── input ──────────────────────────────────────────────────────────────
    const pressed = keys.splice(0, keys.length).flatMap(splitKeys);
    for (const k of pressed) {
      if (k === "q" || k === "\x03" || k === "\x1b") return;
      if (phase === "title" || phase === "win") {
        if (phase === "win") return;
        reset(w);
        continue;
      }
      if (phase === "dead") {
        if (k === "r") reset(w);
        continue;
      }
      if (k === "\x1b[D" || k === "a" || k === "h") {
        pvx = -1.4;
        facing = -1;
      } else if (k === "\x1b[C" || k === "d" || k === "l") {
        pvx = 1.4;
        facing = 1;
      } else if ((k === " " || k === "\x1b[A" || k === "w" || k === "z") && jumpY === 0 && phase === "play") {
        vy = 1.7;
      } else if ((k === "x" || k === "f" || k === "\r") && attack === 0) {
        attack = 4;
        // Instant swing: hit every living mob in the sword arc once.
        for (const m of mobs) {
          if (m.dying > 0) continue;
          const dx = m.x - px;
          const reach = m.boss ? 6 : 5;
          if (Math.sign(dx) === facing && Math.abs(dx) <= reach && jumpY <= 2) {
            m.hp--;
            m.hitFlash = 3;
            m.x += facing * (m.boss ? 1 : 2);
            gore(m.x + 1, ground - 1 - (m.boss ? 2 : 1), m.boss ? COL.bossGore : COL.gore);
            if (m.hp <= 0) {
              m.dying = 1;
              if (m.boss) winDelay = 14;
              else kills++;
            }
          }
        }
      }
    }

    if (phase === "title") {
      drawTitle(scr, h);
      scr.flush();
      await sleep(TICK_MS);
      continue;
    }
    if (phase === "dead" || phase === "win") {
      drawEnd(scr, h, phase, kills, ticks, hp);
      scr.flush();
      await sleep(TICK_MS);
      continue;
    }

    // ── simulate ───────────────────────────────────────────────────────────
    ticks++;
    px = Math.min(Math.max(2, px + pvx), w - 5);
    pvx *= 0.55;
    if (jumpY > 0 || vy > 0) {
      jumpY += vy;
      vy -= 0.35;
      if (jumpY <= 0) {
        jumpY = 0;
        vy = 0;
      }
    }
    if (invuln > 0) invuln--;
    if (attack > 0) attack--;
    if (bossAlerted > 0) bossAlerted--;

    // spawn zombies until it's boss time
    const bossUp = mobs.some((m) => m.boss);
    if (kills < KILLS_FOR_BOSS && !bossUp) {
      const alive = mobs.filter((m) => m.dying === 0).length;
      const maxAlive = Math.min(2 + Math.floor(kills / 3), 4);
      if (alive < maxAlive && spawnCooldown-- <= 0) {
        const fromLeft = Math.random() < 0.5;
        mobs.push({ x: fromLeft ? 1 : w - 5, hp: ZOMBIE_HP, boss: false, hitFlash: 0, dying: 0, lunge: 0 });
        spawnCooldown = 18;
      }
    } else if (kills >= KILLS_FOR_BOSS && !bossUp && winDelay === 0 && !mobs.some((m) => m.boss)) {
      mobs.push({ x: px < w / 2 ? w - 8 : 2, hp: BOSS_HP, boss: true, hitFlash: 0, dying: 0, lunge: 0 });
      bossAlerted = 36;
      hp = Math.min(PLAYER_HP, hp + 1); // wall meat before the boss, as tradition demands
    }

    // mob AI + contact damage
    for (const m of mobs) {
      if (m.dying > 0) {
        m.dying++;
        continue;
      }
      if (m.hitFlash > 0) m.hitFlash--;
      let speed = m.boss ? 0.26 : 0.22 + Math.random() * 0.08;
      if (m.boss) {
        if (m.lunge > 0) {
          m.lunge--;
          speed = 0.7;
        } else if (ticks % 60 === 0) m.lunge = 10;
      }
      m.x += Math.sign(px - m.x) * speed;
      const width = m.boss ? 2.5 : 1.5;
      if (Math.abs(m.x + 1 - px - 1) <= width && jumpY < 2 && invuln === 0) {
        hp--;
        invuln = 22;
        pvx = Math.sign(px - m.x) * 3 || 3;
        gore(px + 1, ground - 2, COL.red, 4);
        if (hp <= 0) phase = "dead";
      }
    }
    // sweep finished deaths into bone piles
    mobs = mobs.filter((m) => {
      if (m.dying > 9) {
        bones.push({ x: m.x + 1, y: ground - 1 });
        if (bones.length > 24) bones.shift();
        return false;
      }
      return true;
    });
    if (winDelay > 0 && --winDelay === 0) phase = "win";

    // particles
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.18;
      p.life--;
    }
    particles = particles.filter((p) => p.life > 0 && p.y < ground);

    // ── draw ───────────────────────────────────────────────────────────────
    // backdrop: moon + gravestones + ground
    scr.text(w - 8, 1, "☾", COL.yellow + COL.dim);
    for (let gx = 6; gx < w - 6; gx += 17) scr.text(gx, ground - 1, "∩", COL.dim);
    for (let x = 0; x < w; x++) scr.put(x, ground, "▀", COL.dim);

    for (const b of bones) scr.text(b.x, b.y, "·", COL.bone);

    for (const m of mobs) {
      const mh = m.boss ? 4 : 3;
      const top = ground - mh;
      if (m.dying > 0) {
        const frames = m.boss ? BOSS_DIE : ZOMBIE_DIE;
        const f = Math.min(frames.length - 1, Math.floor((m.dying - 1) / 3));
        scr.sprite(m.x, top, frames[f], COL.bone);
      } else {
        const color = m.hitFlash > 0 ? COL.flash : m.boss ? COL.boss : COL.zombie;
        if (m.boss) {
          scr.sprite(m.x, top, BOSS, color);
          scr.put(m.x + 1, top + 1, "•", COL.eye);
          scr.put(m.x + 3, top + 1, "•", COL.eye);
        } else {
          scr.sprite(m.x, top, anim % 16 < 8 ? ZOMBIE_A : ZOMBIE_B, color);
        }
      }
    }

    // player (flickers while invulnerable)
    const ptop = ground - 3 - Math.round(jumpY);
    if (invuln === 0 || anim % 2 === 0) scr.sprite(px, ptop, HERO, COL.hero);
    if (attack > 0) {
      const blade = facing === 1 ? "━━╾" : "╼━━";
      scr.text(facing === 1 ? px + 3 : px - 3, ptop + 1, blade, COL.sword);
    }

    for (const p of particles) scr.put(p.x, p.y, "·", p.color);

    // HUD
    const hearts = Array.from({ length: PLAYER_HP }, (_, i) => (i < hp ? "♥" : "·")).join(" ");
    scr.text(2, 0, hearts, COL.red);
    scr.text(10, 0, `† ${Math.min(kills, KILLS_FOR_BOSS)}/${KILLS_FOR_BOSS}`, COL.violet);
    const boss = mobs.find((m) => m.boss && m.dying === 0);
    if (boss) {
      const bw = 14;
      const fill = Math.max(0, Math.round((boss.hp / BOSS_HP) * bw));
      scr.text(w - bw - 13, 0, "GRAVELORD ", COL.red);
      scr.text(w - bw - 3, 0, "█".repeat(fill) + "░".repeat(bw - fill), COL.red);
    } else {
      scr.text(w - 8, 0, fmtTime(ticks), COL.dim);
    }
    if (bossAlerted > 0 && anim % 4 < 2) scr.center(2, "⌁ THE GRAVELORD RISES ⌁", COL.red);
    scr.center(h - 1, "←→ move · space jump · x attack · q flee", COL.dim);

    scr.flush();
    await sleep(TICK_MS);
  }
}

function drawTitle(scr: Screen, h: number): void {
  const mid = Math.floor(h / 2);
  scr.center(mid - 5, "M A N G A V A N I A", COL.violet);
  scr.center(mid - 3, "the manga-cli minigame · for bad-wifi days", COL.dim);
  scr.center(mid - 1, `slay ${KILLS_FOR_BOSS} zombies (3 hits each) — then face the GRAVELORD`, COL.cyan);
  scr.center(mid + 1, "← →  move      space  jump      x  attack", "");
  scr.center(mid + 3, "press any key to begin · q to flee", COL.dim);
}

function drawEnd(scr: Screen, h: number, phase: Phase, kills: number, ticks: number, hp: number): void {
  const mid = Math.floor(h / 2);
  if (phase === "win") {
    scr.center(mid - 3, "☩  Y O U   W I N  ☩", COL.yellow);
    scr.center(mid - 1, "the GRAVELORD crumbles to dust", COL.violet);
    scr.center(mid + 1, `cleared in ${fmtTime(ticks)} · ${hp}/${PLAYER_HP} ♥ remaining`, COL.cyan);
    scr.center(mid + 3, "the wifi is probably back by now — press any key", COL.dim);
  } else {
    scr.center(mid - 3, "☠  G A M E   O V E R  ☠", COL.red);
    scr.center(mid - 1, `slain by the horde · ${kills} zombies down · ${fmtTime(ticks)}`, COL.dim);
    scr.center(mid + 1, "r  retry      q  give up", "");
  }
}

/** Split a stdin chunk into individual keys (held arrows arrive batched). */
function splitKeys(chunk: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < chunk.length) {
    if (chunk[i] === "\x1b" && chunk[i + 1] === "[" && i + 2 < chunk.length) {
      out.push(chunk.slice(i, i + 3));
      i += 3;
    } else {
      out.push(chunk[i]);
      i++;
    }
  }
  return out;
}

function fmtTime(ticks: number): string {
  const s = Math.floor((ticks * TICK_MS) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
