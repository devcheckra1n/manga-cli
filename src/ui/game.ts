// 🕹 MANGAVANIA — a Castlevania-flavored zombie-slaying minigame.
// Ridge Racer shipped a minigame on its menu screen; manga-cli gets a whole
// campaign for bad-wifi days. Pure ANSI, no deps, no network.
//
// Five stages: graveyard → crypt → ramparts → cathedral → CASTLE DRACULA.
// Zombie variants drop weapons & power-ups, every boss gets a Persona-style
// death dialogue, and the finale is ALUCARD — who does not stay Alucard.
//
// Debug: MANGAVANIA_EZ=1 shrinks kill counts / boss HP (used by test harnesses).

import { colorEnabled } from "./colors.ts";
import { termSize } from "./protocol.ts";
import { enterAltScreen, leaveAltScreen } from "./term.ts";

const TICK_MS = 50; // 20 fps
const EZ = process.env.MANGAVANIA_EZ === "1";
const PLAYER_HP = EZ ? 9 : 5;

// Raw SGR prefixes (the Screen buffer tracks color per cell).
const sgr = (s: string): string => (colorEnabled ? `\x1b[${s}m` : "");
const COL = {
  hero: sgr("38;2;235;235;245"),
  sword: sgr("38;2;250;204;21"),
  claymore: sgr("38;2;34;211;238"),
  walker: sgr("38;2;74;222;128"),
  runner: sgr("38;2;190;242;100"),
  brute: sgr("38;2;249;115;22"),
  spitter: sgr("38;2;217;70;239"),
  mini: sgr("38;2;74;222;128"),
  flash: sgr("38;2;255;255;255"),
  boss: sgr("38;2;248;113;113"),
  alucard: sgr("38;2;186;230;253"),
  eye: sgr("38;2;250;204;21"),
  bone: sgr("2"),
  gore: sgr("38;2;134;239;172"),
  bossGore: sgr("38;2;244;114;182"),
  dim: sgr("2"),
  violet: sgr("38;2;167;139;250"),
  cyan: sgr("38;2;34;211;238"),
  red: sgr("38;2;248;113;113"),
  yellow: sgr("38;2;250;204;21"),
  green: sgr("38;2;74;222;128"),
};

// ── sprites (grid-safe: single-width glyphs only) ──────────────────────────────

const HERO = [" Ω ", "/|\\", "/ \\"];
const Z_A = [" Z ", "/|\\", "/ \\"];
const Z_B = [" Z ", "\\|/", "/ \\"];
const RUN_A = [" z ", "/|\\", "/ \\"];
const RUN_B = [" z ", "\\|/", "/ \\"];
const BRUTE_A = [" B ", "▟█▙", "▐█▌", "/ \\"];
const BRUTE_B = [" B ", "▟█▙", "▐█▌", "\\ /"];
const SPIT_A = [" S ", "/|\\", "/ \\"];
const SPIT_B = [" S ", "~|~", "/ \\"];
const MINI_A = ["z", "∧"];
const MINI_B = ["z", "∨"];
const ZOMBIE_DIE = [
  ["   ", " z ", "/| "],
  ["   ", "   ", ",z\\"],
  ["   ", "   ", "· ·"],
];
const MINI_DIE = [
  [" ", "z"],
  [" ", "·"],
  [" ", "·"],
];
const BOSS_DIE = [
  ["     ", " ▄█▄ ", "▐███▌", " ▙ ▟ "],
  ["     ", "     ", " ▄█▄ ", "▖▙▟▗ "],
  ["     ", "     ", "     ", "·▂▂· "],
];

// boss sprites (5 wide, 4 tall unless noted)
const GRAVELORD_S = [" ▄█▄ ", "▐███▌", " ███ ", " ▛ ▜ "];
const BUTCHER_S = [" ▄▄▄ ", "▟███▙", "▐███▌", " ▙ ▟ "];
const WITCH_S = ["  ▲  ", " ▟█▙ ", " ▐█▌ ", " ▞ ▚ "];
const REAPER_S = [" ▄█▄ ", "▐▀█▀▌", " ███ ", " ▚ ▞ "];
const ALUCARD_S = ["  ▲  ", " ▞█▚ ", " ▐█▌ ", " ▘ ▝ "];
const DRACULA_S = ["▚▄█▄▞", "▐███▌", " ███ ", " ▛ ▜ "];
const BAT_S = ["◣█◢", " ▾ "];
const MIST_S = ["░▒░", "▒░▒"];

// ── Persona-style portraits (10 wide, 7 rows) ──────────────────────────────────

const P_HERO = [
  "  ▄▄▄▄▄▄  ",
  " ▟██████▙ ",
  " █ ━  ━ █ ",
  " █   ╻  █ ",
  " █  ‿   █ ",
  " ▜██▄▄██▛ ",
  "   ▐██▌   ",
];
const P_GRAVELORD = [
  "  ▄▄▄▄▄▄  ",
  " ▟█▀▀▀▀█▙ ",
  " █ ✦  ✦ █ ",
  " █  ▄▄  █ ",
  " █ ▀▀▀▀ █ ",
  " ▜█▄▄▄▄█▛ ",
  "  ▝▚▄▄▞▘  ",
];
const P_BUTCHER = [
  " ▄▄▄▄▄▄▄▄ ",
  "▟████████▙",
  "█ ▬    ▬ █",
  "█    ┼   █",
  "█  ▄▄▄▄  █",
  "▜█▄▄▄▄▄▄█▛",
  "  ▐█▌▐█▌  ",
];
const P_WITCH = [
  "    ▄▄    ",
  "   ▟██▙   ",
  " ▄██████▄ ",
  " █ ◆  ◆ █ ",
  " █  ⌄   █ ",
  " ▜█▄▄▄▄█▛ ",
  "   ▚▞▚▞   ",
];
const P_REAPER = [
  "  ▄▄▄▄▄▄  ",
  " ▟█▀▀▀▀█▙ ",
  " █ ●  ● █ ",
  " █      █ ",
  " █ ─══─ █ ",
  " ▜█▄▄▄▄█▛ ",
  "   ╲  ╱   ",
];
const P_ALUCARD = [
  " ▄▄▄▄▄▄▄▄ ",
  "▟██▀▀▀▀██▙",
  "█▌ ◇  ◇ ▐█",
  "█    ‸   █",
  "█▙  ──  ▟█",
  " ▜██▄▄██▛ ",
  "  ▞▚▞▚▞▚  ",
];
const P_DRACULA = [
  " ▄▄▄▄▄▄▄▄ ",
  "▟█▀▀▀▀▀▀█▙",
  "█ ▼    ▼ █",
  "█   ▄▄   █",
  "█  ▼  ▼  █",
  "▜█▄▄▄▄▄▄█▛",
  "  ▚▄▄▄▄▞  ",
];

// ── data tables ────────────────────────────────────────────────────────────────

type ZKind = "walker" | "runner" | "brute" | "spitter" | "mini";
interface ZDef {
  hp: number;
  speed: number;
  color: string;
  frames: [string[], string[]];
  die: string[][];
  touch: number;
  kb: number; // knockback dealt to the player
  ranged?: boolean;
}
const ZOMBIES: Record<ZKind, ZDef> = {
  walker: { hp: 3, speed: 0.24, color: COL.walker, frames: [Z_A, Z_B], die: ZOMBIE_DIE, touch: 1.5, kb: 3 },
  runner: { hp: 1, speed: 0.48, color: COL.runner, frames: [RUN_A, RUN_B], die: ZOMBIE_DIE, touch: 1.5, kb: 3 },
  brute: { hp: 6, speed: 0.15, color: COL.brute, frames: [BRUTE_A, BRUTE_B], die: ZOMBIE_DIE, touch: 2, kb: 6 },
  spitter: { hp: 2, speed: 0.14, color: COL.spitter, frames: [SPIT_A, SPIT_B], die: ZOMBIE_DIE, touch: 1.5, kb: 3, ranged: true },
  mini: { hp: 1, speed: 0.5, color: COL.mini, frames: [MINI_A, MINI_B], die: MINI_DIE, touch: 1, kb: 2 },
};

type WeaponId = "sword" | "whip" | "claymore";
interface Weapon {
  id: WeaponId;
  name: string;
  icon: string;
  reach: number;
  dmg: number;
  blade: (facing: number) => string;
  color: string;
}
const WEAPONS: Record<WeaponId, Weapon> = {
  sword: { id: "sword", name: "sword", icon: "╾", reach: 5, dmg: 1, blade: (f) => (f === 1 ? "━━━╾" : "╼━━━"), color: COL.sword },
  whip: { id: "whip", name: "vampire killer", icon: "~", reach: 8, dmg: 1, blade: (f) => (f === 1 ? "──────╸" : "╺──────"), color: COL.sword },
  claymore: { id: "claymore", name: "claymore", icon: "†", reach: 4, dmg: 2, blade: (f) => (f === 1 ? "▬▬▶" : "◀▬▬"), color: COL.claymore },
};

type PickKind = "heart" | "boots" | "power" | "star" | "whip" | "claymore";
const PICKUPS: Record<PickKind, { ch: string; color: string; label: string }> = {
  heart: { ch: "♥", color: COL.red, label: "+1 ♥" },
  boots: { ch: "»", color: COL.cyan, label: "swift boots!" },
  power: { ch: "◊", color: COL.violet, label: "double damage!" },
  star: { ch: "☆", color: COL.yellow, label: "invincible!" },
  whip: { ch: "~", color: COL.yellow, label: "the VAMPIRE KILLER!" },
  claymore: { ch: "†", color: COL.cyan, label: "a CLAYMORE!" },
};

type BossId = "gravelord" | "butcher" | "witch" | "reaper" | "alucard" | "dracula";
interface BossDef {
  id: BossId;
  name: string;
  hp: number;
  color: string;
  sprite: string[];
  portrait: string[];
  touch: number;
}
const BOSSES: Record<BossId, BossDef> = {
  gravelord: { id: "gravelord", name: "GRAVELORD", hp: EZ ? 2 : 15, color: COL.boss, sprite: GRAVELORD_S, portrait: P_GRAVELORD, touch: 2.5 },
  butcher: { id: "butcher", name: "THE BUTCHER", hp: EZ ? 2 : 18, color: COL.brute, sprite: BUTCHER_S, portrait: P_BUTCHER, touch: 2.5 },
  witch: { id: "witch", name: "BONE WITCH", hp: EZ ? 2 : 16, color: COL.spitter, sprite: WITCH_S, portrait: P_WITCH, touch: 2 },
  reaper: { id: "reaper", name: "THE REAPER", hp: EZ ? 2 : 22, color: COL.hero, sprite: REAPER_S, portrait: P_REAPER, touch: 2.5 },
  alucard: { id: "alucard", name: "ALUCARD", hp: EZ ? 2 : 20, color: COL.alucard, sprite: ALUCARD_S, portrait: P_ALUCARD, touch: 2 },
  dracula: { id: "dracula", name: "DRACULA", hp: EZ ? 3 : 26, color: COL.boss, sprite: DRACULA_S, portrait: P_DRACULA, touch: 2.5 },
};

interface StageDef {
  name: string;
  flavor: string;
  kills: number;
  spawn: Array<[ZKind, number]>; // kind, weight
  maxAlive: number;
  boss: BossId;
}
const STAGES: StageDef[] = [
  { name: "THE GRAVEYARD", flavor: "the dead are restless tonight", kills: EZ ? 1 : 8, spawn: [["walker", 1]], maxAlive: 4, boss: "gravelord" },
  { name: "THE CRYPT", flavor: "something skitters between the coffins", kills: EZ ? 1 : 10, spawn: [["walker", 3], ["runner", 2], ["spitter", 1]], maxAlive: 4, boss: "butcher" },
  { name: "THE RAMPARTS", flavor: "the wind smells of old bones", kills: EZ ? 1 : 12, spawn: [["walker", 2], ["runner", 2], ["brute", 1], ["spitter", 1]], maxAlive: 5, boss: "witch" },
  { name: "THE CATHEDRAL", flavor: "even the gargoyles look away", kills: EZ ? 1 : 14, spawn: [["runner", 2], ["brute", 2], ["spitter", 2], ["walker", 1]], maxAlive: 5, boss: "reaper" },
  { name: "CASTLE DRACULA", flavor: "the final chapter", kills: 0, spawn: [], maxAlive: 0, boss: "alucard" },
];

// ── dialogue ───────────────────────────────────────────────────────────────────

interface DlgLine {
  name: string;
  color: string;
  portrait: string[];
  text: string;
}
const say = (name: string, color: string, portrait: string[], text: string): DlgLine => ({ name, color, portrait, text });
const HERO_SAYS = (t: string): DlgLine => say("THE READER", COL.cyan, P_HERO, t);

const DEATH_DIALOGUE: Partial<Record<BossId, DlgLine[]>> = {
  gravelord: [
    say("GRAVELORD", COL.boss, P_GRAVELORD, "Impossible... felled by a mere reader..."),
    say("GRAVELORD", COL.boss, P_GRAVELORD, "The Crypt will swallow you whole. They are already digging..."),
    HERO_SAYS("Chapter one. Closed."),
  ],
  butcher: [
    say("THE BUTCHER", COL.brute, P_BUTCHER, "Hah... good meat on you, little reader..."),
    say("THE BUTCHER", COL.brute, P_BUTCHER, "The cleaver... dulls... at last..."),
    HERO_SAYS("Stay down this time."),
  ],
  witch: [
    say("BONE WITCH", COL.spitter, P_WITCH, "My bones! My beautiful bones!!"),
    say("BONE WITCH", COL.spitter, P_WITCH, "The Master will drink your marrow, reader..."),
    HERO_SAYS("Tell him I'm on my way."),
  ],
  reaper: [
    say("THE REAPER", COL.hero, P_REAPER, "Even Death... can die...?"),
    HERO_SAYS("Everyone reads their last page eventually."),
    HERO_SAYS("The castle. He's waiting."),
  ],
  alucard: [
    say("ALUCARD", COL.alucard, P_ALUCARD, "Enough. ENOUGH!"),
    say("ALUCARD", COL.alucard, P_ALUCARD, "You force my hand, reader... behold the blood that runs in me—"),
    say("DRACULA", COL.boss, P_DRACULA, "I AM DRACULA. LORD OF THIS CASTLE."),
    say("DRACULA", COL.boss, P_DRACULA, "What is a reader?! A miserable little pile of secrets!"),
  ],
  dracula: [
    say("DRACULA", COL.boss, P_DRACULA, "This... cannot be... my castle... my manga..."),
    say("DRACULA", COL.boss, P_DRACULA, "Perhaps... in the sequel..."),
    HERO_SAYS("No continues for you."),
  ],
};
const ALUCARD_INTRO: DlgLine[] = [
  say("ALUCARD", COL.alucard, P_ALUCARD, "So. The one who has been thinning my father's flock."),
  say("ALUCARD", COL.alucard, P_ALUCARD, "I am ALUCARD, keeper of this castle."),
  say("ALUCARD", COL.alucard, P_ALUCARD, "Turn back, reader. The final chapter is not kind."),
  HERO_SAYS("I never skip to the end."),
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

  fillRow(y: number, chr: string, color = ""): void {
    for (let x = 0; x < this.w; x++) this.put(x, y, chr, color);
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

// ── entities ───────────────────────────────────────────────────────────────────

interface Mob {
  kind: ZKind;
  x: number;
  hp: number;
  hitFlash: number;
  dying: number;
  cool: number; // ranged cooldown
}
interface Boss {
  def: BossDef;
  x: number;
  air: number; // rows above the ground (bat flight)
  hp: number;
  hitFlash: number;
  dying: number;
  t: number; // personal timer
  lunge: number;
  ethereal: number;
  sweep: number;
  form: "human" | "bat" | "mist"; // dracula shapeshifting
  formT: number;
}
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}
interface Proj {
  x: number;
  y: number; // absolute row (float)
  vx: number;
  vy: number;
  ch: string;
  color: string;
}
interface Pickup {
  kind: PickKind;
  x: number;
  ttl: number;
}

type Phase = "title" | "select" | "play" | "cutscene" | "dead" | "win";

// ── the game ───────────────────────────────────────────────────────────────────

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
  let stage = 0;
  let px = 0;
  let pvx = 0;
  let jumpY = 0;
  let vy = 0;
  let facing = 1;
  let hp = PLAYER_HP;
  let invuln = 0;
  let attack = 0;
  let weapon: Weapon = WEAPONS.sword;
  let boots = 0;
  let power = 0;
  let star = 0;
  let kills = 0; // this stage
  let totalKills = 0;
  let ticks = 0;
  let anim = 0;
  let alertText = "";
  let alertT = 0;
  let flashMsg = "";
  let flashT = 0;
  let intro = 0; // stage-card overlay ticks
  let cutT = -1; // castle-steps cutscene timer (-1 = not running)
  let sel = 0; // chapter-select cursor
  let mobs: Mob[] = [];
  let boss: Boss | null = null;
  let particles: Particle[] = [];
  let projs: Proj[] = [];
  let pickups: Pickup[] = [];
  let bones: Array<{ x: number; y: number }> = [];
  let spawnCooldown = 0;
  let bossSpawned = false;

  // dialogue overlay
  let dlg: DlgLine[] | null = null;
  let dlgI = 0;
  let dlgChars = 0;
  let dlgDone: () => void = () => {};

  const alert = (t: string, ticks_ = 40): void => {
    alertText = t;
    alertT = ticks_;
  };
  const flash = (t: string): void => {
    flashMsg = t;
    flashT = 30;
  };
  const startDialogue = (lines: DlgLine[], done: () => void): void => {
    dlg = lines;
    dlgI = 0;
    dlgChars = 0;
    dlgDone = done;
  };

  const spawnBoss = (id: BossId, w: number): void => {
    const def = BOSSES[id];
    boss = { def, x: px < w / 2 ? w - 10 : 4, air: 0, hp: def.hp, hitFlash: 0, dying: 0, t: 0, lunge: 0, ethereal: 0, sweep: 0, form: "human", formT: 0 };
    bossSpawned = true;
    alert(`⌁ ${def.name} ⌁`, 40);
    hp = Math.min(PLAYER_HP, hp + 1); // wall meat, as tradition demands
  };

  const startStage = (n: number, w: number): void => {
    stage = n;
    kills = 0;
    mobs = [];
    boss = null;
    projs = [];
    pickups = [];
    bones = [];
    bossSpawned = false;
    spawnCooldown = 10;
    hp = PLAYER_HP;
    px = Math.floor(w / 2);
    pvx = 0;
    jumpY = 0;
    vy = 0;
    if (n === 4) {
      phase = "cutscene";
      cutT = 0;
    } else {
      phase = "play";
      intro = 70;
    }
  };

  const reset = (w: number): void => {
    hp = PLAYER_HP;
    invuln = 0;
    attack = 0;
    boots = 0;
    power = 0;
    star = 0;
    weapon = weapon; // weapons survive death — small mercies
    if (stage === 0) {
      totalKills = 0;
      ticks = 0;
    }
    startStage(stage, w); // retry restarts the CURRENT stage
  };

  const gore = (x: number, y: number, color: string, n = 3): void => {
    for (let i = 0; i < n; i++) {
      particles.push({ x, y, vx: (Math.random() - 0.5) * 1.6, vy: -0.4 - Math.random() * 0.8, life: 8, color });
    }
  };

  const damagePlayer = (fromX: number, kb: number, ground: number): void => {
    if (invuln > 0 || star > 0 || phase !== "play") return;
    hp--;
    invuln = 22;
    pvx = Math.sign(px - fromX) * kb || kb;
    gore(px + 1, ground - 2, COL.red, 4);
    if (hp <= 0) phase = "dead";
  };

  const dropPickup = (x: number): void => {
    if (Math.random() > 0.3) return;
    const pool: PickKind[] = ["heart", "heart", "heart", "boots", "boots", "power", "power", "star"];
    if (weapon.id !== "whip") pool.push("whip", "whip");
    if (weapon.id !== "claymore") pool.push("claymore");
    pickups.push({ kind: pool[Math.floor(Math.random() * pool.length)], x, ttl: 240 });
  };

  const pickZombie = (def: StageDef): ZKind => {
    const total = def.spawn.reduce((a, [, w]) => a + w, 0);
    let r = Math.random() * total;
    for (const [kind, w] of def.spawn) {
      r -= w;
      if (r <= 0) return kind;
    }
    return "walker";
  };

  const swing = (ground: number): void => {
    attack = 4;
    const dmg = weapon.dmg * (power > 0 ? 2 : 1);
    for (const m of mobs) {
      if (m.dying > 0) continue;
      const zd = ZOMBIES[m.kind];
      const dx = m.x + 1 - (px + 1);
      if (Math.sign(dx) === facing && Math.abs(dx) <= weapon.reach && jumpY <= 2) {
        m.hp -= dmg;
        m.hitFlash = 3;
        m.x += facing * 2;
        gore(m.x + 1, ground - 2, COL.gore);
        if (m.hp <= 0) {
          m.dying = 1;
          kills++;
          totalKills++;
          dropPickup(m.x + 1);
        }
      }
    }
    if (boss && boss.dying === 0 && boss.ethereal === 0 && boss.form !== "mist") {
      const dx = boss.x + 2 - (px + 1);
      const vertOk = Math.abs(boss.air - jumpY) <= 2;
      if (Math.sign(dx) === facing && Math.abs(dx) <= weapon.reach + 1 && vertOk) {
        boss.hp -= dmg;
        boss.hitFlash = 3;
        boss.x += facing;
        gore(boss.x + 2, ground - 3 - boss.air, COL.bossGore);
        if (boss.def.id === "witch" && boss.hp > 0 && Math.random() < 0.3) {
          boss.x = 4 + Math.random() * (scr.w - 12); // blink away
          gore(boss.x + 2, ground - 2, COL.spitter, 5);
        }
        if (boss.hp <= 0) {
          boss.dying = 1;
          totalKills++;
        }
      }
    }
  };

  while (true) {
    const { cols, rows } = termSize();
    const w = Math.max(50, cols);
    const h = Math.max(16, rows);
    const ground = h - 3;
    scr.begin(w, h);
    anim++;

    // ── input ──────────────────────────────────────────────────────────────
    const pressed = keys.splice(0, keys.length).flatMap(splitKeys);
    for (const k of pressed) {
      if (k === "\x03") return;
      // dialogue eats every key: finish the line, then advance.
      if (dlg) {
        const line = (dlg as DlgLine[])[dlgI];
        if (dlgChars < line.text.length) dlgChars = line.text.length;
        else if (dlgI < (dlg as DlgLine[]).length - 1) {
          dlgI++;
          dlgChars = 0;
        } else {
          const done = dlgDone;
          dlg = null;
          done();
        }
        continue;
      }
      if (k === "q" || k === "\x1b") return;
      if (phase === "title") {
        phase = "select";
        continue;
      }
      if (phase === "select") {
        const beginRun = (n: number): void => {
          totalKills = 0;
          ticks = 0;
          // starting past chapter I packs the vampire killer (you came prepared)
          weapon = n > 0 ? WEAPONS.whip : WEAPONS.sword;
          startStage(n, w);
        };
        if (k === "\x1b[A" || k === "\x1b[D" || k === "k" || k === "h" || k === "a") sel = (sel + STAGES.length - 1) % STAGES.length;
        else if (k === "\x1b[B" || k === "\x1b[C" || k === "j" || k === "l" || k === "d" || k === "s") sel = (sel + 1) % STAGES.length;
        else if (/^[1-5]$/.test(k)) beginRun(Number(k) - 1);
        else if (k === "\r" || k === " " || k === "x") beginRun(sel);
        continue;
      }
      if (phase === "win") return;
      if (phase === "dead") {
        if (k === "r") reset(w);
        continue;
      }
      if (phase === "cutscene") {
        cutT = 999; // skip the walk
        continue;
      }
      if (intro > 0) {
        intro = 0;
        continue;
      }
      const spd = boots > 0 ? 2.0 : 1.4;
      if (k === "\x1b[D" || k === "a" || k === "h") {
        pvx = -spd;
        facing = -1;
      } else if (k === "\x1b[C" || k === "d" || k === "l") {
        pvx = spd;
        facing = 1;
      } else if ((k === " " || k === "\x1b[A" || k === "w" || k === "z") && jumpY === 0) {
        vy = 1.7;
      } else if ((k === "x" || k === "f" || k === "\r") && attack === 0) {
        swing(ground);
      }
    }

    // ── non-play phases ────────────────────────────────────────────────────
    if (phase === "title") {
      drawTitle(scr, h);
      scr.flush();
      await sleep(TICK_MS);
      continue;
    }
    if (phase === "select") {
      drawSelect(scr, h, sel, anim);
      scr.flush();
      await sleep(TICK_MS);
      continue;
    }
    if (phase === "dead" || phase === "win") {
      drawEnd(scr, h, phase, stage, totalKills, ticks, hp);
      scr.flush();
      await sleep(TICK_MS);
      continue;
    }
    if (phase === "cutscene") {
      // the long walk up the castle steps
      if (!dlg) cutT++;
      drawCutscene(scr, w, h, ground, cutT, anim);
      if (cutT >= 110 && !dlg) {
        startDialogue(ALUCARD_INTRO, () => {
          phase = "play";
          spawnBoss("alucard", w);
        });
      }
      if (dlg) drawDialogue(scr, w, h, dlg[dlgI], dlgChars, anim);
      scr.flush();
      dlgChars += 2;
      await sleep(TICK_MS);
      continue;
    }

    // ── simulate (paused during dialogue / stage intro) ────────────────────
    const paused = dlg !== null || intro > 0;
    const def = STAGES[stage];
    if (!paused) {
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
      if (alertT > 0) alertT--;
      if (flashT > 0) flashT--;
      if (boots > 0) boots--;
      if (power > 0) power--;
      if (star > 0) star--;

      // spawn zombies until it's boss time
      if (kills < def.kills && !bossSpawned) {
        const alive = mobs.filter((m) => m.dying === 0).length;
        const maxAlive = Math.min(2 + Math.floor(kills / 3), def.maxAlive);
        if (alive < maxAlive && spawnCooldown-- <= 0) {
          const fromLeft = Math.random() < 0.5;
          mobs.push({ kind: pickZombie(def), x: fromLeft ? 1 : w - 5, hp: 0, hitFlash: 0, dying: 0, cool: 30 });
          mobs[mobs.length - 1].hp = ZOMBIES[mobs[mobs.length - 1].kind].hp;
          spawnCooldown = 18;
        }
      } else if (kills >= def.kills && !bossSpawned && stage < 4) {
        spawnBoss(def.boss, w);
      }

      // mob AI
      for (const m of mobs) {
        if (m.dying > 0) {
          m.dying++;
          continue;
        }
        const zd = ZOMBIES[m.kind];
        if (m.hitFlash > 0) m.hitFlash--;
        const dist = px - m.x;
        if (zd.ranged && Math.abs(dist) < 18) {
          // spitters hold their ground and spit
          if (Math.abs(dist) < 12) m.x -= Math.sign(dist) * zd.speed * 0.5;
          if (--m.cool <= 0) {
            m.cool = 45;
            projs.push({ x: m.x + 1, y: ground - 2, vx: Math.sign(dist) * 0.9, vy: 0, ch: "•", color: COL.spitter });
          }
        } else {
          m.x += Math.sign(dist) * (zd.speed + Math.random() * 0.05);
        }
        const mh = zd.frames[0].length;
        if (Math.abs(m.x + 1 - (px + 1)) <= zd.touch && jumpY < mh - 1) damagePlayer(m.x, zd.kb, ground);
      }
      mobs = mobs.filter((m) => {
        if (m.dying > 9) {
          bones.push({ x: m.x + 1, y: ground - 1 });
          if (bones.length > 24) bones.shift();
          return false;
        }
        return true;
      });

      // boss AI
      const b = boss as Boss | null;
      if (b !== null) {
        if (b.dying === 0) {
          updateBoss(b, px, w, ground, projs, mobs, anim, (kb) => damagePlayer(b.x, kb, ground));
        } else {
          b.dying++;
          if (b.dying > 12) {
            bones.push({ x: b.x + 2, y: ground - 1 });
            boss = null;
            const lines = DEATH_DIALOGUE[b.def.id];
            const after = (): void => {
              if (b.def.id === "alucard") {
                spawnBoss("dracula", w);
              } else if (b.def.id === "dracula") {
                phase = "win";
              } else {
                startStage(stage + 1, w);
              }
            };
            if (lines) startDialogue(lines, after);
            else after();
          }
        }
      }

      // projectiles
      for (const p of projs) {
        p.x += p.vx;
        p.y += p.vy;
        const ptop = ground - 3 - Math.round(jumpY);
        if (p.y >= ptop && p.y <= ptop + 2 && Math.abs(p.x - (px + 1)) <= 1.2) {
          damagePlayer(p.x - p.vx * 5, 3, ground);
          p.x = -99;
        }
      }
      projs = projs.filter((p) => p.x > 0 && p.x < w && p.y < ground + 1);

      // pickups
      for (const pk of pickups) {
        pk.ttl--;
        if (Math.abs(pk.x - (px + 1)) <= 1.5 && jumpY < 1) {
          const info = PICKUPS[pk.kind];
          if (pk.kind === "heart") hp = Math.min(PLAYER_HP, hp + 1);
          else if (pk.kind === "boots") boots = 240;
          else if (pk.kind === "power") power = 200;
          else if (pk.kind === "star") star = 120;
          else if (pk.kind === "whip") weapon = WEAPONS.whip;
          else if (pk.kind === "claymore") weapon = WEAPONS.claymore;
          flash(info.label);
          pk.ttl = 0;
        }
      }
      pickups = pickups.filter((pk) => pk.ttl > 0);

      // particles
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.18;
        p.life--;
      }
      particles = particles.filter((p) => p.life > 0 && p.y < ground);
    }

    // ── draw ───────────────────────────────────────────────────────────────
    drawBackdrop(scr, w, ground, stage);
    for (const b of bones) scr.text(b.x, b.y, "·", COL.bone);

    for (const pk of pickups) {
      const info = PICKUPS[pk.kind];
      if (pk.ttl > 40 || anim % 2 === 0) scr.put(pk.x, ground - 1, info.ch, info.color);
    }

    for (const m of mobs) {
      const zd = ZOMBIES[m.kind];
      const mh = zd.frames[0].length;
      const top = ground - mh;
      if (m.dying > 0) {
        const f = Math.min(zd.die.length - 1, Math.floor((m.dying - 1) / 3));
        scr.sprite(m.x, ground - zd.die[f].length, zd.die[f], COL.bone);
      } else {
        const color = m.hitFlash > 0 ? COL.flash : zd.color;
        scr.sprite(m.x, top, zd.frames[anim % 16 < 8 ? 0 : 1], color);
      }
    }

    if (boss) drawBoss(scr, boss, ground, anim);

    // player (flickers while invulnerable; glows under star power)
    const ptop = ground - 3 - Math.round(jumpY);
    const heroCol = star > 0 ? (anim % 2 === 0 ? COL.yellow : COL.hero) : COL.hero;
    if (invuln === 0 || anim % 2 === 0) scr.sprite(px, ptop, HERO, heroCol);
    if (attack > 0) {
      const blade = weapon.blade(facing);
      scr.text(facing === 1 ? px + 3 : px + 1 - blade.length, ptop + 1, blade, weapon.color);
    }

    for (const p of projs) scr.put(p.x, p.y, p.ch, p.color);
    for (const p of particles) scr.put(p.x, p.y, "·", p.color);

    // HUD
    drawHud(scr, w, h, { hp, stage, kills, need: def.kills, weapon, boots, power, star, boss, ticks });
    if (alertT > 0 && anim % 4 < 2) scr.center(2, alertText, COL.red);
    if (flashT > 0) scr.center(3, flashMsg, COL.yellow);
    scr.center(h - 1, "←→ move · space jump · x attack · q flee", COL.dim);

    if (intro > 0) {
      intro--;
      drawStageCard(scr, h, stage);
    }
    if (dlg) {
      drawDialogue(scr, w, h, dlg[dlgI], dlgChars, anim);
      dlgChars += 2;
    }

    scr.flush();
    await sleep(TICK_MS);
  }
}

// ── boss brains ────────────────────────────────────────────────────────────────

function updateBoss(
  b: Boss,
  px: number,
  w: number,
  ground: number,
  projs: Proj[],
  mobs: Mob[],
  anim: number,
  hurtPlayer: (kb: number) => void,
): void {
  b.t++;
  if (b.hitFlash > 0) b.hitFlash--;
  if (b.ethereal > 0) b.ethereal--;
  const dist = px - b.x;
  const dir = Math.sign(dist) || 1;
  let speed = 0.2;

  switch (b.def.id) {
    case "gravelord":
      speed = 0.26;
      if (b.lunge > 0) {
        b.lunge--;
        speed = 0.7;
      } else if (b.t % 60 === 0) b.lunge = 10;
      break;
    case "butcher":
      speed = 0.2;
      if (b.lunge > 0) {
        b.lunge--;
        speed = 1.0; // the charge
      } else if (b.t % 90 === 0) b.lunge = 8;
      if (b.t % 55 === 0) {
        projs.push({ x: b.x + 2, y: ground - 2, vx: dir * 0.9, vy: 0, ch: dir === 1 ? "»" : "«", color: COL.yellow });
      }
      break;
    case "witch":
      speed = 0.15;
      b.air = anim % 20 < 10 ? 1 : 0; // uneasy hover
      if (b.t % 60 === 0) {
        for (const vy of [-0.12, 0, 0.12]) {
          projs.push({ x: b.x + 2, y: ground - 3, vx: dir * 0.8, vy, ch: "─", color: COL.hero });
        }
      }
      if (b.t % 130 === 0 && mobs.filter((m) => m.dying === 0).length < 2) {
        mobs.push({ kind: "runner", x: b.x, hp: ZOMBIES.runner.hp, hitFlash: 0, dying: 0, cool: 30 });
      }
      break;
    case "reaper":
      speed = 0.32;
      b.air = 1 + Math.round(Math.sin(b.t / 8));
      if (b.t % 70 === 0) b.ethereal = 24; // fades beyond the veil
      if (b.sweep > 0) {
        b.sweep--;
        if (b.sweep === 3 && Math.abs(dist) <= 7) hurtPlayer(4); // the scythe falls
      } else if (b.t % 45 === 0 && Math.abs(dist) < 10) b.sweep = 10;
      break;
    case "alucard":
      speed = 0.3;
      if (b.t % 50 === 0) {
        b.x = px + (Math.random() < 0.5 ? -9 : 9); // dash-step
        b.x = Math.min(Math.max(2, b.x), w - 7);
      }
      if (b.t % 65 === 0) {
        projs.push({ x: b.x + 2, y: ground - 2, vx: dir * 1.1, vy: 0, ch: "∿", color: COL.alucard });
      }
      break;
    case "dracula": {
      // shapeshifting: human → bat → human → mist → …
      b.formT++;
      if (b.form === "human" && b.formT > 160) {
        b.form = "bat";
        b.formT = 0;
      } else if (b.form === "bat" && b.formT > 100) {
        b.form = "human";
        b.formT = 0;
      } else if (b.form === "human" && b.t % 400 > 320 && b.formT > 80) {
        b.form = "mist";
        b.formT = 0;
      } else if (b.form === "mist" && b.formT > 60) {
        b.form = "human";
        b.formT = 0;
      }
      if (b.form === "human") {
        speed = 0.22;
        b.air = 0;
        if (b.t % 55 === 0) {
          for (const vy of [-0.15, 0, 0.15]) {
            projs.push({ x: b.x + 2, y: ground - 3, vx: dir * 0.85, vy, ch: "●", color: COL.red });
          }
        }
        if (b.t % 110 === 0 && mobs.filter((m) => m.kind === "mini" && m.dying === 0).length < 3) {
          mobs.push({ kind: "mini", x: b.x + (Math.random() < 0.5 ? -2 : 6), hp: 1, hitFlash: 0, dying: 0, cool: 30 });
        }
      } else if (b.form === "bat") {
        speed = 0.5;
        // swoop: high flight, diving at the player's head every few beats
        const cycle = b.formT % 50;
        b.air = cycle < 30 ? 5 + Math.round(Math.sin(b.formT / 5)) : Math.max(0, 5 - Math.round((cycle - 30) / 2));
      } else {
        speed = 0.12; // mist drifts, untouchable and harmless
        b.air = 1;
      }
      break;
    }
  }

  b.x += dir * speed;
  b.x = Math.min(Math.max(1, b.x), w - 7);

  // contact damage (mist is harmless; bats bite only when low)
  const harmless = b.form === "mist" || b.ethereal > 0;
  if (!harmless && Math.abs(b.x + 2 - (px + 1)) <= b.def.touch && b.air <= 2) hurtPlayer(4);
}

function drawBoss(scr: Screen, b: Boss, ground: number, anim: number): void {
  if (b.dying > 0) {
    const f = Math.min(BOSS_DIE.length - 1, Math.floor((b.dying - 1) / 4));
    scr.sprite(b.x, ground - 4, BOSS_DIE[f], COL.bone);
    return;
  }
  let sprite = b.def.sprite;
  let color = b.hitFlash > 0 ? COL.flash : b.def.color;
  if (b.def.id === "dracula" && b.form === "bat") sprite = BAT_S;
  if (b.def.id === "dracula" && b.form === "mist") {
    sprite = MIST_S;
    color = COL.dim;
  }
  if (b.ethereal > 0) color = COL.dim;
  const top = ground - sprite.length - b.air;
  scr.sprite(b.x, top, sprite, color);
  if (b.def.id !== "dracula" || b.form === "human") {
    scr.put(b.x + 1, top + 1, "•", COL.eye);
    scr.put(b.x + 3, top + 1, "•", COL.eye);
  }
  if (b.sweep > 0 && b.sweep <= 6) {
    // the reaper's scythe arc
    const arc = "≈≈≈≈≈≈";
    scr.text(b.x - arc.length, ground - 2, arc, COL.hero);
    scr.text(b.x + 5, ground - 2, arc, COL.hero);
  }
  void anim;
}

// ── overlays & screens ─────────────────────────────────────────────────────────

function drawBackdrop(scr: Screen, w: number, ground: number, stage: number): void {
  scr.text(w - 8, 1, "☾", COL.yellow + COL.dim);
  if (stage <= 1) {
    for (let gx = 6; gx < w - 6; gx += 17) scr.text(gx, ground - 1, "∩", COL.dim);
  } else if (stage === 2) {
    for (let gx = 8; gx < w - 6; gx += 21) {
      scr.text(gx, ground - 2, "▌", COL.dim);
      scr.text(gx, ground - 1, "▌", COL.dim);
    }
  } else if (stage === 3) {
    for (let gx = 5; gx < w - 8; gx += 25) {
      scr.text(gx, ground - 3, "╫", COL.dim);
      scr.text(gx, ground - 2, "║", COL.dim);
      scr.text(gx, ground - 1, "║", COL.dim);
    }
  } else {
    // castle interior: candelabra
    for (let gx = 9; gx < w - 6; gx += 23) {
      scr.text(gx, ground - 3, "ⁿ", COL.yellow);
      scr.text(gx, ground - 2, "┃", COL.dim);
      scr.text(gx, ground - 1, "┻", COL.dim);
    }
  }
  for (let x = 0; x < w; x++) scr.put(x, ground, "▀", COL.dim);
}

function drawStageCard(scr: Screen, h: number, stage: number): void {
  const def = STAGES[stage];
  const mid = Math.floor(h / 2);
  scr.center(mid - 2, `— STAGE ${stage + 1} —`, COL.dim);
  scr.center(mid, def.name, COL.violet);
  scr.center(mid + 2, def.flavor, COL.dim);
}

function drawCutscene(scr: Screen, w: number, h: number, ground: number, t: number, anim: number): void {
  // castle silhouette, top right
  const cx = w - 24;
  const castle = ["  ▟▙   ▟▙   ▟▙  ", "  ██▄▄▄██▄▄▄██  ", "  ████████████  ", "  ███▐▌██▐▌███  ", "  ████████████  "];
  scr.sprite(cx, 2, castle, COL.dim);
  scr.text(w - 6, 1, "☾", COL.yellow);
  if (anim % 14 < 7) scr.put(cx + 8, 3, "▪", COL.yellow); // a light in the window

  // the steps, rising to the right
  const steps = 9;
  for (let i = 0; i < steps; i++) {
    const sx = 6 + i * 5;
    const sy = ground - i;
    for (let j = sx; j < Math.min(w, sx + (steps - i) * 5); j++) scr.put(j, sy, "▄", COL.dim);
  }
  for (let x = 0; x < Math.min(w, 6); x++) scr.put(x, ground, "▀", COL.dim);

  // the reader climbs
  const prog = Math.min(1, t / 100);
  const step = Math.floor(prog * (steps - 1));
  const hx = 4 + step * 5 + Math.floor((prog * (steps - 1) - step) * 5);
  const hy = ground - step - 1;
  scr.sprite(hx, hy - 2, HERO, COL.hero);

  scr.center(h - 1, t < 100 ? "the last chapter awaits … (any key to hurry)" : "", COL.dim);
}

function wrapText(s: string, width: number): string[] {
  const words = s.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    if (cur && cur.length + word.length + 1 > width) {
      lines.push(cur);
      cur = word;
    } else cur = cur ? cur + " " + word : word;
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawDialogue(scr: Screen, w: number, h: number, line: DlgLine, chars: number, anim: number): void {
  const boxH = 11;
  const top = h - boxH;
  // clear the box area + a rule on top
  for (let y = top; y < h; y++) scr.fillRow(y, " ");
  scr.fillRow(top, "─", COL.dim);

  // portrait, Persona-style close-up
  const pX = 3;
  scr.sprite(pX, top + 2, line.portrait, line.color);

  // name + typewriter text
  const tX = pX + 13;
  const tW = Math.max(16, w - tX - 4);
  scr.text(tX, top + 2, line.name, line.color, false);
  scr.text(tX, top + 3, "─".repeat(Math.min(tW, line.name.length + 2)), COL.dim);
  const shown = line.text.slice(0, chars);
  wrapText(shown, tW).slice(0, 5).forEach((l, i) => scr.text(tX, top + 5 + i, l, "", false));
  if (chars >= line.text.length && anim % 12 < 7) scr.text(w - 6, h - 2, "▼", COL.dim);
}

function drawTitle(scr: Screen, h: number): void {
  const mid = Math.floor(h / 2);
  scr.center(mid - 6, "M A N G A V A N I A", COL.violet);
  scr.center(mid - 4, "the manga-cli minigame · for bad-wifi days", COL.dim);
  scr.center(mid - 2, "five stages of the restless dead — and HIM, waiting in the castle", COL.cyan);
  scr.center(mid, "zombies drop hearts, boots, power … and better weapons", COL.dim);
  scr.center(mid + 2, "← →  move      space  jump      x  attack", "");
  scr.center(mid + 4, "press any key for chapter select · q to flee", COL.dim);
}

const ROMAN = ["I", "II", "III", "IV", "V"];

function drawSelect(scr: Screen, h: number, sel: number, anim: number): void {
  const top = Math.max(1, Math.floor(h / 2) - 6);
  scr.center(top, "— CHAPTER SELECT —", COL.violet);
  STAGES.forEach((s, i) => {
    const label = `${i === sel ? "▸" : " "} ${ROMAN[i].padEnd(4)}${s.name.padEnd(16)}`;
    scr.center(top + 2 + i, label, i === sel ? COL.cyan : COL.dim);
  });
  const cur = STAGES[sel];
  const boss = BOSSES[cur.boss];
  scr.center(top + 8, cur.flavor, COL.dim);
  scr.center(
    top + 9,
    cur.kills > 0 ? `${cur.kills} kills, then ${boss.name}` : `only ${boss.name} awaits … and what comes after`,
    anim % 16 < 8 ? COL.red : COL.dim,
  );
  scr.center(top + 11, "↑↓ / 1-5 choose · enter begin · q flee", COL.dim);
  scr.center(top + 12, "chapters past I pack the VAMPIRE KILLER", COL.yellow + COL.dim);
}

function drawEnd(scr: Screen, h: number, phase: Phase, stage: number, kills: number, ticks: number, hp: number): void {
  const mid = Math.floor(h / 2);
  if (phase === "win") {
    scr.center(mid - 4, "☩  Y O U   W I N  ☩", COL.yellow);
    scr.center(mid - 2, "DRACULA crumbles to dust — the castle sleeps again", COL.violet);
    scr.center(mid, `cleared in ${fmtTime(ticks)} · ${kills} slain · ${hp}/${PLAYER_HP} ♥ remaining`, COL.cyan);
    scr.center(mid + 2, "the wifi is probably back by now — press any key", COL.dim);
  } else {
    scr.center(mid - 3, "☠  G A M E   O V E R  ☠", COL.red);
    scr.center(mid - 1, `fallen at stage ${stage + 1}: ${STAGES[stage].name} · ${kills} slain · ${fmtTime(ticks)}`, COL.dim);
    scr.center(mid + 1, "r  retry this stage      q  give up", "");
  }
}

interface HudState {
  hp: number;
  stage: number;
  kills: number;
  need: number;
  weapon: Weapon;
  boots: number;
  power: number;
  star: number;
  boss: Boss | null;
  ticks: number;
}

function drawHud(scr: Screen, w: number, h: number, s: HudState): void {
  const hearts = Array.from({ length: PLAYER_HP }, (_, i) => (i < s.hp ? "♥" : "·")).join(" ");
  scr.text(2, 0, hearts, COL.red);
  let x = 2 + PLAYER_HP * 2 + 2;
  scr.text(x, 0, `S${s.stage + 1}`, COL.violet);
  x += 4;
  if (s.need > 0) {
    scr.text(x, 0, `† ${Math.min(s.kills, s.need)}/${s.need}`, COL.violet);
    x += 8;
  }
  scr.text(x, 0, `${s.weapon.icon} ${s.weapon.name}`, s.weapon.color);
  x += s.weapon.name.length + 4;
  if (s.boots > 0) {
    scr.text(x, 0, `»${Math.ceil(s.boots / 20)}`, COL.cyan);
    x += 4;
  }
  if (s.power > 0) {
    scr.text(x, 0, `◊${Math.ceil(s.power / 20)}`, COL.violet);
    x += 4;
  }
  if (s.star > 0) {
    scr.text(x, 0, `☆${Math.ceil(s.star / 20)}`, COL.yellow);
    x += 4;
  }
  if (s.boss && s.boss.dying === 0) {
    const bw = 14;
    const fill = Math.max(0, Math.round((s.boss.hp / s.boss.def.hp) * bw));
    const label = s.boss.def.name + " ";
    scr.text(w - bw - label.length - 3, 0, label, s.boss.def.color);
    scr.text(w - bw - 3, 0, "█".repeat(fill) + "░".repeat(bw - fill), s.boss.def.color);
  } else {
    scr.text(w - 8, 0, fmtTime(s.ticks), COL.dim);
  }
  void h;
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