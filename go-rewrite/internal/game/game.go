// Package game: 🕹 MANGAVANIA — the Castlevania-flavored zombie-slaying
// campaign, ported from the TS version. Five chapters, zombie variants,
// weapon/power-up drops, Persona-style boss dialogues, a castle-steps
// cutscene, and ALUCARD → DRACULA at the top. Pure ANSI, zero network.
//
// Debug: MANGAVANIA_EZ=1 shrinks kill counts / boss HP (test harnesses).
package game

import (
	"fmt"
	"math"
	"math/rand"
	"os"
	"strings"
	"time"

	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/ui"
)

const tickMS = 50 // 20 fps

var ez = os.Getenv("MANGAVANIA_EZ") == "1"

func playerHP() int {
	if ez {
		return 9
	}
	return 5
}

// ── colors (raw SGR prefixes; the Screen tracks color per cell) ────────────────

func sgr(s string) string {
	if !ui.ColorEnabled {
		return ""
	}
	return "\x1b[" + s + "m"
}

var (
	cHero     = sgr("38;2;235;235;245")
	cSword    = sgr("38;2;250;204;21")
	cClaym    = sgr("38;2;34;211;238")
	cWalker   = sgr("38;2;74;222;128")
	cRunner   = sgr("38;2;190;242;100")
	cBrute    = sgr("38;2;249;115;22")
	cSpitter  = sgr("38;2;217;70;239")
	cFlash    = sgr("38;2;255;255;255")
	cBoss     = sgr("38;2;248;113;113")
	cAlucard  = sgr("38;2;186;230;253")
	cEye      = sgr("38;2;250;204;21")
	cBone     = sgr("2")
	cGore     = sgr("38;2;134;239;172")
	cBossGore = sgr("38;2;244;114;182")
	cDim      = sgr("2")
	cViolet   = sgr("38;2;167;139;250")
	cCyan     = sgr("38;2;34;211;238")
	cRed      = sgr("38;2;248;113;113")
	cYellow   = sgr("38;2;250;204;21")
)

// ── sprites (grid-safe: single-width glyphs only) ──────────────────────────────

var (
	sprHero   = []string{" Ω ", "/|\\", "/ \\"}
	sprZA     = []string{" Z ", "/|\\", "/ \\"}
	sprZB     = []string{" Z ", "\\|/", "/ \\"}
	sprRunA   = []string{" z ", "/|\\", "/ \\"}
	sprRunB   = []string{" z ", "\\|/", "/ \\"}
	sprBruteA = []string{" B ", "▟█▙", "▐█▌", "/ \\"}
	sprBruteB = []string{" B ", "▟█▙", "▐█▌", "\\ /"}
	sprSpitA  = []string{" S ", "/|\\", "/ \\"}
	sprSpitB  = []string{" S ", "~|~", "/ \\"}
	sprMiniA  = []string{"z", "∧"}
	sprMiniB  = []string{"z", "∨"}

	dieZombie = [][]string{
		{"   ", " z ", "/| "},
		{"   ", "   ", ",z\\"},
		{"   ", "   ", "· ·"},
	}
	dieMini = [][]string{{" ", "z"}, {" ", "·"}, {" ", "·"}}
	dieBoss = [][]string{
		{"     ", " ▄█▄ ", "▐███▌", " ▙ ▟ "},
		{"     ", "     ", " ▄█▄ ", "▖▙▟▗ "},
		{"     ", "     ", "     ", "·▂▂· "},
	}

	sprGravelord = []string{" ▄█▄ ", "▐███▌", " ███ ", " ▛ ▜ "}
	sprButcher   = []string{" ▄▄▄ ", "▟███▙", "▐███▌", " ▙ ▟ "}
	sprWitch     = []string{"  ▲  ", " ▟█▙ ", " ▐█▌ ", " ▞ ▚ "}
	sprReaper    = []string{" ▄█▄ ", "▐▀█▀▌", " ███ ", " ▚ ▞ "}
	sprAlucard   = []string{"  ▲  ", " ▞█▚ ", " ▐█▌ ", " ▘ ▝ "}
	sprDracula   = []string{"▚▄█▄▞", "▐███▌", " ███ ", " ▛ ▜ "}
	sprBat       = []string{"◣█◢", " ▾ "}
	sprMist      = []string{"░▒░", "▒░▒"}
)

// ── Persona-style portraits (10 wide, 7 rows) ──────────────────────────────────

var (
	pHero = []string{
		"  ▄▄▄▄▄▄  ", " ▟██████▙ ", " █ ━  ━ █ ", " █   ╻  █ ", " █  ‿   █ ", " ▜██▄▄██▛ ", "   ▐██▌   ",
	}
	pGravelord = []string{
		"  ▄▄▄▄▄▄  ", " ▟█▀▀▀▀█▙ ", " █ ✦  ✦ █ ", " █  ▄▄  █ ", " █ ▀▀▀▀ █ ", " ▜█▄▄▄▄█▛ ", "  ▝▚▄▄▞▘  ",
	}
	pButcher = []string{
		" ▄▄▄▄▄▄▄▄ ", "▟████████▙", "█ ▬    ▬ █", "█    ┼   █", "█  ▄▄▄▄  █", "▜█▄▄▄▄▄▄█▛", "  ▐█▌▐█▌  ",
	}
	pWitch = []string{
		"    ▄▄    ", "   ▟██▙   ", " ▄██████▄ ", " █ ◆  ◆ █ ", " █  ⌄   █ ", " ▜█▄▄▄▄█▛ ", "   ▚▞▚▞   ",
	}
	pReaper = []string{
		"  ▄▄▄▄▄▄  ", " ▟█▀▀▀▀█▙ ", " █ ●  ● █ ", " █      █ ", " █ ─══─ █ ", " ▜█▄▄▄▄█▛ ", "   ╲  ╱   ",
	}
	pAlucard = []string{
		" ▄▄▄▄▄▄▄▄ ", "▟██▀▀▀▀██▙", "█▌ ◇  ◇ ▐█", "█    ‸   █", "█▙  ──  ▟█", " ▜██▄▄██▛ ", "  ▞▚▞▚▞▚  ",
	}
	pDracula = []string{
		" ▄▄▄▄▄▄▄▄ ", "▟█▀▀▀▀▀▀█▙", "█ ▼    ▼ █", "█   ▄▄   █", "█  ▼  ▼  █", "▜█▄▄▄▄▄▄█▛", "  ▚▄▄▄▄▞  ",
	}
)

// ── data tables ────────────────────────────────────────────────────────────────

type zKind int

const (
	zWalker zKind = iota
	zRunner
	zBrute
	zSpitter
	zMini
)

type zDef struct {
	hp     int
	speed  float64
	color  string
	frames [2][]string
	die    [][]string
	touch  float64
	kb     float64
	ranged bool
}

var zombies = map[zKind]zDef{
	zWalker:  {3, 0.24, cWalker, [2][]string{sprZA, sprZB}, dieZombie, 1.5, 3, false},
	zRunner:  {1, 0.48, cRunner, [2][]string{sprRunA, sprRunB}, dieZombie, 1.5, 3, false},
	zBrute:   {6, 0.15, cBrute, [2][]string{sprBruteA, sprBruteB}, dieZombie, 2, 6, false},
	zSpitter: {2, 0.14, cSpitter, [2][]string{sprSpitA, sprSpitB}, dieZombie, 1.5, 3, true},
	zMini:    {1, 0.5, cWalker, [2][]string{sprMiniA, sprMiniB}, dieMini, 1, 2, false},
}

type weapon struct {
	name  string
	icon  string
	reach float64
	dmg   int
	color string
	right string
	left  string
}

var (
	wSword    = weapon{"sword", "╾", 5, 1, cSword, "━━━╾", "╼━━━"}
	wWhip     = weapon{"vampire killer", "~", 8, 1, cSword, "──────╸", "╺──────"}
	wClaymore = weapon{"claymore", "†", 4, 2, cClaym, "▬▬▶", "◀▬▬"}
)

type pickKind int

const (
	pkHeart pickKind = iota
	pkBoots
	pkPower
	pkStar
	pkWhip
	pkClaymore
)

var pickups = map[pickKind]struct {
	ch    string
	color string
	label string
}{
	pkHeart:    {"♥", cRed, "+1 ♥"},
	pkBoots:    {"»", cCyan, "swift boots!"},
	pkPower:    {"◊", cViolet, "double damage!"},
	pkStar:     {"☆", cYellow, "invincible!"},
	pkWhip:     {"~", cYellow, "the VAMPIRE KILLER!"},
	pkClaymore: {"†", cCyan, "a CLAYMORE!"},
}

type bossID int

const (
	bGravelord bossID = iota
	bButcher
	bWitch
	bReaper
	bAlucard
	bDracula
)

type bossDef struct {
	name     string
	hp       int
	color    string
	sprite   []string
	portrait []string
	touch    float64
}

func bhp(normal int) int {
	if ez {
		return 2
	}
	return normal
}

var bosses = map[bossID]bossDef{
	bGravelord: {"GRAVELORD", bhp(15), cBoss, sprGravelord, pGravelord, 2.5},
	bButcher:   {"THE BUTCHER", bhp(18), cBrute, sprButcher, pButcher, 2.5},
	bWitch:     {"BONE WITCH", bhp(16), cSpitter, sprWitch, pWitch, 2},
	bReaper:    {"THE REAPER", bhp(22), cHero, sprReaper, pReaper, 2.5},
	bAlucard:   {"ALUCARD", bhp(20), cAlucard, sprAlucard, pAlucard, 2},
	bDracula:   {"DRACULA", bhp(26) + boolInt(ez), cBoss, sprDracula, pDracula, 2.5},
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

type spawnW struct {
	kind zKind
	w    int
}

type stageDef struct {
	name     string
	flavor   string
	kills    int
	spawn    []spawnW
	maxAlive int
	boss     bossID
}

func kq(n int) int {
	if ez {
		return 1
	}
	return n
}

var stages = []stageDef{
	{"THE GRAVEYARD", "the dead are restless tonight", kq(8), []spawnW{{zWalker, 1}}, 4, bGravelord},
	{"THE CRYPT", "something skitters between the coffins", kq(10), []spawnW{{zWalker, 3}, {zRunner, 2}, {zSpitter, 1}}, 4, bButcher},
	{"THE RAMPARTS", "the wind smells of old bones", kq(12), []spawnW{{zWalker, 2}, {zRunner, 2}, {zBrute, 1}, {zSpitter, 1}}, 5, bWitch},
	{"THE CATHEDRAL", "even the gargoyles look away", kq(14), []spawnW{{zRunner, 2}, {zBrute, 2}, {zSpitter, 2}, {zWalker, 1}}, 5, bReaper},
	{"CASTLE DRACULA", "the final chapter", 0, nil, 0, bAlucard},
}

// ── dialogue ───────────────────────────────────────────────────────────────────

type dlgLine struct {
	name     string
	color    string
	portrait []string
	text     string
}

func hero(t string) dlgLine { return dlgLine{"THE READER", cCyan, pHero, t} }

var deathDialogue = map[bossID][]dlgLine{
	bGravelord: {
		{"GRAVELORD", cBoss, pGravelord, "Impossible... felled by a mere reader..."},
		{"GRAVELORD", cBoss, pGravelord, "The Crypt will swallow you whole. They are already digging..."},
		hero("Chapter one. Closed."),
	},
	bButcher: {
		{"THE BUTCHER", cBrute, pButcher, "Hah... good meat on you, little reader..."},
		{"THE BUTCHER", cBrute, pButcher, "The cleaver... dulls... at last..."},
		hero("Stay down this time."),
	},
	bWitch: {
		{"BONE WITCH", cSpitter, pWitch, "My bones! My beautiful bones!!"},
		{"BONE WITCH", cSpitter, pWitch, "The Master will drink your marrow, reader..."},
		hero("Tell him I'm on my way."),
	},
	bReaper: {
		{"THE REAPER", cHero, pReaper, "Even Death... can die...?"},
		hero("Everyone reads their last page eventually."),
		hero("The castle. He's waiting."),
	},
	bAlucard: {
		{"ALUCARD", cAlucard, pAlucard, "Enough. ENOUGH!"},
		{"ALUCARD", cAlucard, pAlucard, "You force my hand, reader... behold the blood that runs in me—"},
		{"DRACULA", cBoss, pDracula, "I AM DRACULA. LORD OF THIS CASTLE."},
		{"DRACULA", cBoss, pDracula, "What is a reader?! A miserable little pile of secrets!"},
	},
	bDracula: {
		{"DRACULA", cBoss, pDracula, "This... cannot be... my castle... my manga..."},
		{"DRACULA", cBoss, pDracula, "Perhaps... in the sequel..."},
		hero("No continues for you."),
	},
}

var alucardIntro = []dlgLine{
	{"ALUCARD", cAlucard, pAlucard, "So. The one who has been thinning my father's flock."},
	{"ALUCARD", cAlucard, pAlucard, "I am ALUCARD, keeper of this castle."},
	{"ALUCARD", cAlucard, pAlucard, "Turn back, reader. The final chapter is not kind."},
	hero("I never skip to the end."),
}

// ── screen buffer (full repaint per tick — flicker-free single write) ──────────

type screen struct {
	w, h int
	ch   []string
	co   []string
}

func (s *screen) begin(w, h int) {
	s.w, s.h = w, h
	n := w * h
	if cap(s.ch) < n {
		s.ch = make([]string, n)
		s.co = make([]string, n)
	}
	s.ch = s.ch[:n]
	s.co = s.co[:n]
	for i := range s.ch {
		s.ch[i] = " "
		s.co[i] = ""
	}
}

func (s *screen) put(x, y float64, chr, color string) {
	xi, yi := int(x+0.5), int(y+0.5)
	if xi < 0 || yi < 0 || xi >= s.w || yi >= s.h {
		return
	}
	s.ch[yi*s.w+xi] = chr
	s.co[yi*s.w+xi] = color
}

func (s *screen) text(x, y float64, str, color string, skipSpaces bool) {
	i := 0.0
	for _, chr := range str {
		if !skipSpaces || chr != ' ' {
			s.put(x+i, y, string(chr), color)
		}
		i++
	}
}

func (s *screen) sprite(x, y float64, rows []string, color string) {
	for i, r := range rows {
		s.text(x, y+float64(i), r, color, true)
	}
}

func (s *screen) center(y int, str, color string) {
	s.text(float64((s.w-len([]rune(str)))/2), float64(y), str, color, false)
}

func (s *screen) fillRow(y int, chr, color string) {
	for x := 0; x < s.w; x++ {
		s.put(float64(x), float64(y), chr, color)
	}
}

func (s *screen) flush() {
	var b strings.Builder
	for y := 0; y < s.h; y++ {
		fmt.Fprintf(&b, "\x1b[%d;1H", y+1)
		cur := ""
		for x := 0; x < s.w; x++ {
			col := s.co[y*s.w+x]
			if col != cur {
				b.WriteString("\x1b[0m" + col)
				cur = col
			}
			b.WriteString(s.ch[y*s.w+x])
		}
		b.WriteString("\x1b[0m")
	}
	os.Stdout.WriteString(b.String())
}

// ── entities ───────────────────────────────────────────────────────────────────

type mob struct {
	kind     zKind
	x        float64
	hp       int
	hitFlash int
	dying    int
	cool     int
}

type boss struct {
	def      bossDef
	id       bossID
	x        float64
	air      float64
	hp       int
	hitFlash int
	dying    int
	t        int
	lunge    int
	ethereal int
	sweep    int
	form     int // 0 human · 1 bat · 2 mist
	formT    int
}

type particle struct {
	x, y, vx, vy float64
	life         int
	color        string
}

type proj struct {
	x, y, vx, vy float64
	ch, color    string
}

type pickup struct {
	kind pickKind
	x    float64
	ttl  int
}

type phase int

const (
	phTitle phase = iota
	phSelect
	phPlay
	phCutscene
	phDead
	phWin
)

// ── the game ───────────────────────────────────────────────────────────────────

// Run opens MANGAVANIA. Terminal state is managed here.
func Run() error {
	if !ui.IsTTY() {
		fmt.Println("the minigame needs an interactive terminal")
		return nil
	}
	if err := ui.RawOn(); err != nil {
		return err
	}
	ui.EnterAlt()
	defer func() {
		ui.LeaveAlt()
		ui.RawOff()
	}()

	keys := make(chan ui.Key, 64)
	go func() {
		kr := &ui.KeyReader{}
		for {
			k, err := kr.Next()
			if err != nil {
				close(keys)
				return
			}
			keys <- k
		}
	}()
	g := &game{scr: &screen{}, keys: keys}
	g.reset()
	return g.loop()
}

type game struct {
	scr  *screen
	keys chan ui.Key

	ph    phase
	stage int
	sel   int

	px, pvx, jumpY, vy float64
	facing             float64
	hp                 int
	invuln, attack     int
	weap               weapon
	boots, power, star int

	kills, totalKills, ticks, anim int
	alertText                      string
	alertT, flashT                 int
	flashMsg                       string
	intro, cutT                    int

	mobs      []*mob
	bz        *boss
	particles []particle
	projs     []proj
	picks     []pickup
	bones     [][2]float64
	spawnCD   int
	bossUp    bool
	winDelay  int

	dlg      []dlgLine
	dlgI     int
	dlgChars int
	dlgDone  func()
}

func (g *game) reset() {
	g.ph = phTitle
	g.weap = wSword
	g.facing = 1
	g.hp = playerHP()
}

func (g *game) alert(t string, ticks int) { g.alertText, g.alertT = t, ticks }
func (g *game) flash(t string)            { g.flashMsg, g.flashT = t, 30 }

func (g *game) startDialogue(lines []dlgLine, done func()) {
	g.dlg, g.dlgI, g.dlgChars, g.dlgDone = lines, 0, 0, done
}

func (g *game) spawnBoss(id bossID, w int) {
	def := bosses[id]
	x := 4.0
	if g.px < float64(w)/2 {
		x = float64(w) - 10
	}
	g.bz = &boss{def: def, id: id, x: x, hp: def.hp}
	g.bossUp = true
	g.alert("⌁ "+def.name+" ⌁", 40)
	g.hp = min(playerHP(), g.hp+1) // wall meat, as tradition demands
}

func (g *game) startStage(n, w int) {
	g.stage = n
	g.kills = 0
	g.mobs = nil
	g.bz = nil
	g.projs = nil
	g.picks = nil
	g.bones = nil
	g.bossUp = false
	g.winDelay = 0
	g.spawnCD = 10
	g.hp = playerHP()
	g.px = float64(w) / 2
	g.pvx, g.jumpY, g.vy = 0, 0, 0
	if n == 4 {
		g.ph = phCutscene
		g.cutT = 0
	} else {
		g.ph = phPlay
		g.intro = 70
	}
}

func (g *game) beginRun(n, w int) {
	g.totalKills, g.ticks = 0, 0
	g.weap = wSword
	if n > 0 {
		g.weap = wWhip // you came prepared
	}
	g.boots, g.power, g.star = 0, 0, 0
	g.startStage(n, w)
}

func (g *game) gore(x, y float64, color string, n int) {
	for i := 0; i < n; i++ {
		g.particles = append(g.particles, particle{
			x: x, y: y, vx: (rand.Float64() - 0.5) * 1.6, vy: -0.4 - rand.Float64()*0.8,
			life: 8, color: color,
		})
	}
}

func (g *game) damagePlayer(fromX float64, kb float64, ground int) {
	if g.invuln > 0 || g.star > 0 || g.ph != phPlay {
		return
	}
	g.hp--
	g.invuln = 22
	dir := 1.0
	if g.px < fromX {
		dir = -1
	}
	g.pvx = dir * kb
	g.gore(g.px+1, float64(ground-2), cRed, 4)
	if g.hp <= 0 {
		g.ph = phDead
	}
}

func (g *game) dropPickup(x float64) {
	if rand.Float64() > 0.3 {
		return
	}
	pool := []pickKind{pkHeart, pkHeart, pkHeart, pkBoots, pkBoots, pkPower, pkPower, pkStar}
	if g.weap.name != wWhip.name {
		pool = append(pool, pkWhip, pkWhip)
	}
	if g.weap.name != wClaymore.name {
		pool = append(pool, pkClaymore)
	}
	g.picks = append(g.picks, pickup{pool[rand.Intn(len(pool))], x, 240})
}

func (g *game) pickZombie() zKind {
	def := stages[g.stage]
	total := 0
	for _, s := range def.spawn {
		total += s.w
	}
	r := rand.Intn(max(total, 1))
	for _, s := range def.spawn {
		r -= s.w
		if r < 0 {
			return s.kind
		}
	}
	return zWalker
}

func (g *game) swing(ground, w int) {
	g.attack = 4
	dmg := g.weap.dmg
	if g.power > 0 {
		dmg *= 2
	}
	for _, m := range g.mobs {
		if m.dying > 0 {
			continue
		}
		dx := m.x + 1 - (g.px + 1)
		if sign(dx) == g.facing && abs(dx) <= g.weap.reach && g.jumpY <= 2 {
			m.hp -= dmg
			m.hitFlash = 3
			m.x += g.facing * 2
			g.gore(m.x+1, float64(ground-2), cGore, 3)
			if m.hp <= 0 {
				m.dying = 1
				g.kills++
				g.totalKills++
				g.dropPickup(m.x + 1)
			}
		}
	}
	if b := g.bz; b != nil && b.dying == 0 && b.ethereal == 0 && b.form != 2 {
		dx := b.x + 2 - (g.px + 1)
		vertOK := abs(b.air-g.jumpY) <= 2
		if sign(dx) == g.facing && abs(dx) <= g.weap.reach+1 && vertOK {
			b.hp -= dmg
			b.hitFlash = 3
			b.x += g.facing
			g.gore(b.x+2, float64(ground-3)-b.air, cBossGore, 3)
			if b.id == bWitch && b.hp > 0 && rand.Float64() < 0.3 {
				b.x = 4 + rand.Float64()*float64(w-12) // blink away
				g.gore(b.x+2, float64(ground-2), cSpitter, 5)
			}
			if b.hp <= 0 {
				b.dying = 1
				g.totalKills++
			}
		}
	}
}

func sign(f float64) float64 {
	if f < 0 {
		return -1
	}
	if f > 0 {
		return 1
	}
	return 0
}

func abs(f float64) float64 {
	if f < 0 {
		return -f
	}
	return f
}

// ── the main loop ──────────────────────────────────────────────────────────────

func (g *game) loop() error {
	ticker := time.NewTicker(tickMS * time.Millisecond)
	defer ticker.Stop()
	for {
		w, h := ui.Size()
		if w < 50 {
			w = 50
		}
		if h < 16 {
			h = 16
		}
		ground := h - 3
		g.scr.begin(w, h)
		g.anim++

		if quit := g.input(w, ground); quit {
			return nil
		}

		switch g.ph {
		case phTitle:
			g.drawTitle(h)
		case phSelect:
			g.drawSelect(h)
		case phDead, phWin:
			g.drawEnd(h)
		case phCutscene:
			if g.dlg == nil {
				g.cutT++
			}
			g.drawCutscene(w, h, ground)
			if g.cutT >= 110 && g.dlg == nil {
				g.startDialogue(alucardIntro, func() {
					g.ph = phPlay
					g.spawnBoss(bAlucard, w)
				})
			}
			if g.dlg != nil {
				g.drawDialogue(w, h)
				g.dlgChars += 2
			}
		case phPlay:
			paused := g.dlg != nil || g.intro > 0
			if !paused {
				g.simulate(w, ground)
			}
			g.draw(w, h, ground)
			if g.intro > 0 {
				g.intro--
				g.drawStageCard(h)
			}
			if g.dlg != nil {
				g.drawDialogue(w, h)
				g.dlgChars += 2
			}
		}

		g.scr.flush()
		<-ticker.C
	}
}

// input drains buffered keys; returns true to quit the game.
func (g *game) input(w, ground int) bool {
	for {
		select {
		case k, ok := <-g.keys:
			if !ok || k == ui.KeyCtrlC {
				return true
			}
			if g.handleKey(k, w, ground) {
				return true
			}
		default:
			return false
		}
	}
}

func (g *game) handleKey(k ui.Key, w, ground int) bool {
	// Dialogue eats every key: finish the line, then advance.
	if g.dlg != nil {
		line := g.dlg[g.dlgI]
		switch {
		case g.dlgChars < len([]rune(line.text)):
			g.dlgChars = len([]rune(line.text))
		case g.dlgI < len(g.dlg)-1:
			g.dlgI++
			g.dlgChars = 0
		default:
			done := g.dlgDone
			g.dlg = nil
			done()
		}
		return false
	}
	if k == "q" || k == ui.KeyEsc {
		return true
	}
	switch g.ph {
	case phTitle:
		g.ph = phSelect
		return false
	case phSelect:
		switch k {
		case ui.KeyUp, ui.KeyLeft, "k", "h", "a":
			g.sel = (g.sel + len(stages) - 1) % len(stages)
		case ui.KeyDown, ui.KeyRight, "j", "l", "d", "s":
			g.sel = (g.sel + 1) % len(stages)
		case "1", "2", "3", "4", "5":
			g.beginRun(int(k[0]-'1'), w)
		case ui.KeyEnter, ui.KeySpace, "x":
			g.beginRun(g.sel, w)
		}
		return false
	case phWin:
		return true
	case phDead:
		if k == "r" {
			g.hp = playerHP()
			g.invuln, g.attack = 0, 0
			g.boots, g.power, g.star = 0, 0, 0
			g.startStage(g.stage, w) // retry restarts the current chapter
		}
		return false
	case phCutscene:
		g.cutT = 999 // skip the walk
		return false
	}
	if g.intro > 0 {
		g.intro = 0
		return false
	}
	spd := 1.4
	if g.boots > 0 {
		spd = 2.0
	}
	switch k {
	case ui.KeyLeft, "a", "h":
		g.pvx = -spd
		g.facing = -1
	case ui.KeyRight, "d", "l":
		g.pvx = spd
		g.facing = 1
	case ui.KeySpace, ui.KeyUp, "w", "z":
		if g.jumpY == 0 {
			g.vy = 1.7
		}
	case "x", "f", ui.KeyEnter:
		if g.attack == 0 {
			g.swing(ground, w)
		}
	}
	return false
}

// ── simulation ─────────────────────────────────────────────────────────────────

func (g *game) simulate(w, ground int) {
	g.ticks++
	g.px = clamp(g.px+g.pvx, 2, float64(w-5))
	g.pvx *= 0.55
	if g.jumpY > 0 || g.vy > 0 {
		g.jumpY += g.vy
		g.vy -= 0.35
		if g.jumpY <= 0 {
			g.jumpY, g.vy = 0, 0
		}
	}
	decr(&g.invuln)
	decr(&g.attack)
	decr(&g.alertT)
	decr(&g.flashT)
	decr(&g.boots)
	decr(&g.power)
	decr(&g.star)

	def := stages[g.stage]
	// spawn zombies until it's boss time
	if g.kills < def.kills && !g.bossUp {
		alive := 0
		for _, m := range g.mobs {
			if m.dying == 0 {
				alive++
			}
		}
		maxAlive := min(2+g.kills/3, def.maxAlive)
		g.spawnCD--
		if alive < maxAlive && g.spawnCD <= 0 {
			x := 1.0
			if rand.Float64() < 0.5 {
				x = float64(w - 5)
			}
			kind := g.pickZombie()
			g.mobs = append(g.mobs, &mob{kind: kind, x: x, hp: zombies[kind].hp, cool: 30})
			g.spawnCD = 18
		}
	} else if g.kills >= def.kills && !g.bossUp && g.stage < 4 {
		g.spawnBoss(def.boss, w)
	}

	// mob AI
	for _, m := range g.mobs {
		if m.dying > 0 {
			m.dying++
			continue
		}
		zd := zombies[m.kind]
		if m.hitFlash > 0 {
			m.hitFlash--
		}
		dist := g.px - m.x
		if zd.ranged && abs(dist) < 18 {
			if abs(dist) < 12 {
				m.x -= sign(dist) * zd.speed * 0.5
			}
			m.cool--
			if m.cool <= 0 {
				m.cool = 45
				g.projs = append(g.projs, proj{x: m.x + 1, y: float64(ground - 2),
					vx: sign(dist) * 0.9, ch: "•", color: cSpitter})
			}
		} else {
			m.x += sign(dist) * (zd.speed + rand.Float64()*0.05)
		}
		mh := len(zd.frames[0])
		if abs(m.x+1-(g.px+1)) <= zd.touch && g.jumpY < float64(mh-1) {
			g.damagePlayer(m.x, zd.kb, ground)
		}
	}
	// sweep finished deaths into bone piles
	var alive []*mob
	for _, m := range g.mobs {
		if m.dying > 9 {
			g.bones = append(g.bones, [2]float64{m.x + 1, float64(ground - 1)})
			if len(g.bones) > 24 {
				g.bones = g.bones[1:]
			}
			continue
		}
		alive = append(alive, m)
	}
	g.mobs = alive

	// boss AI
	if b := g.bz; b != nil {
		if b.dying == 0 {
			g.updateBoss(b, w, ground)
		} else {
			b.dying++
			if b.dying > 12 {
				g.bones = append(g.bones, [2]float64{b.x + 2, float64(ground - 1)})
				id := b.id
				g.bz = nil
				after := func() {
					switch id {
					case bAlucard:
						g.spawnBoss(bDracula, w)
					case bDracula:
						g.ph = phWin
					default:
						g.startStage(g.stage+1, w)
					}
				}
				if lines, ok := deathDialogue[id]; ok {
					g.startDialogue(lines, after)
				} else {
					after()
				}
			}
		}
	}

	// projectiles
	ptop := float64(ground-3) - g.jumpY
	var keptP []proj
	for _, p := range g.projs {
		p.x += p.vx
		p.y += p.vy
		if p.y >= ptop && p.y <= ptop+2 && abs(p.x-(g.px+1)) <= 1.2 {
			g.damagePlayer(p.x-p.vx*5, 3, ground)
			continue
		}
		if p.x > 0 && p.x < float64(w) && p.y < float64(ground+1) {
			keptP = append(keptP, p)
		}
	}
	g.projs = keptP

	// pickups
	var keptK []pickup
	for _, pk := range g.picks {
		pk.ttl--
		if abs(pk.x-(g.px+1)) <= 1.5 && g.jumpY < 1 {
			info := pickups[pk.kind]
			switch pk.kind {
			case pkHeart:
				g.hp = min(playerHP(), g.hp+1)
			case pkBoots:
				g.boots = 240
			case pkPower:
				g.power = 200
			case pkStar:
				g.star = 120
			case pkWhip:
				g.weap = wWhip
			case pkClaymore:
				g.weap = wClaymore
			}
			g.flash(info.label)
			continue
		}
		if pk.ttl > 0 {
			keptK = append(keptK, pk)
		}
	}
	g.picks = keptK

	// particles
	var keptPt []particle
	for _, p := range g.particles {
		p.x += p.vx
		p.y += p.vy
		p.vy += 0.18
		p.life--
		if p.life > 0 && p.y < float64(ground) {
			keptPt = append(keptPt, p)
		}
	}
	g.particles = keptPt
}

func decr(v *int) {
	if *v > 0 {
		*v--
	}
}

func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// ── boss brains ────────────────────────────────────────────────────────────────

func (g *game) updateBoss(b *boss, w, ground int) {
	b.t++
	if b.hitFlash > 0 {
		b.hitFlash--
	}
	if b.ethereal > 0 {
		b.ethereal--
	}
	dist := g.px - b.x
	dir := sign(dist)
	if dir == 0 {
		dir = 1
	}
	speed := 0.2

	switch b.id {
	case bGravelord:
		speed = 0.26
		if b.lunge > 0 {
			b.lunge--
			speed = 0.7
		} else if b.t%60 == 0 {
			b.lunge = 10
		}
	case bButcher:
		speed = 0.2
		if b.lunge > 0 {
			b.lunge--
			speed = 1.0 // the charge
		} else if b.t%90 == 0 {
			b.lunge = 8
		}
		if b.t%55 == 0 {
			ch := "»"
			if dir < 0 {
				ch = "«"
			}
			g.projs = append(g.projs, proj{x: b.x + 2, y: float64(ground - 2), vx: dir * 0.9, ch: ch, color: cYellow})
		}
	case bWitch:
		speed = 0.15
		b.air = 0
		if g.anim%20 < 10 {
			b.air = 1 // uneasy hover
		}
		if b.t%60 == 0 {
			for _, vy := range []float64{-0.12, 0, 0.12} {
				g.projs = append(g.projs, proj{x: b.x + 2, y: float64(ground - 3), vx: dir * 0.8, vy: vy, ch: "─", color: cHero})
			}
		}
		if b.t%130 == 0 {
			alive := 0
			for _, m := range g.mobs {
				if m.dying == 0 {
					alive++
				}
			}
			if alive < 2 {
				g.mobs = append(g.mobs, &mob{kind: zRunner, x: b.x, hp: zombies[zRunner].hp, cool: 30})
			}
		}
	case bReaper:
		speed = 0.32
		b.air = 1 + math.Sin(float64(b.t)/8) // gentle float
		if b.t%70 == 0 {
			b.ethereal = 24 // fades beyond the veil
		}
		if b.sweep > 0 {
			b.sweep--
			if b.sweep == 3 && abs(dist) <= 7 {
				g.damagePlayer(b.x, 4, ground) // the scythe falls
			}
		} else if b.t%45 == 0 && abs(dist) < 10 {
			b.sweep = 10
		}
	case bAlucard:
		speed = 0.3
		if b.t%50 == 0 {
			off := 9.0
			if rand.Float64() < 0.5 {
				off = -9
			}
			b.x = clamp(g.px+off, 2, float64(w-7)) // dash-step
		}
		if b.t%65 == 0 {
			g.projs = append(g.projs, proj{x: b.x + 2, y: float64(ground - 2), vx: dir * 1.1, ch: "∿", color: cAlucard})
		}
	case bDracula:
		// shapeshifting: human → bat → human → mist → …
		b.formT++
		switch {
		case b.form == 0 && b.formT > 160:
			b.form, b.formT = 1, 0
		case b.form == 1 && b.formT > 100:
			b.form, b.formT = 0, 0
		case b.form == 0 && b.t%400 > 320 && b.formT > 80:
			b.form, b.formT = 2, 0
		case b.form == 2 && b.formT > 60:
			b.form, b.formT = 0, 0
		}
		switch b.form {
		case 0: // human
			speed = 0.22
			b.air = 0
			if b.t%55 == 0 {
				for _, vy := range []float64{-0.15, 0, 0.15} {
					g.projs = append(g.projs, proj{x: b.x + 2, y: float64(ground - 3), vx: dir * 0.85, vy: vy, ch: "●", color: cRed})
				}
			}
			if b.t%110 == 0 {
				minis := 0
				for _, m := range g.mobs {
					if m.kind == zMini && m.dying == 0 {
						minis++
					}
				}
				if minis < 3 {
					off := 6.0
					if rand.Float64() < 0.5 {
						off = -2
					}
					g.mobs = append(g.mobs, &mob{kind: zMini, x: b.x + off, hp: 1, cool: 30})
				}
			}
		case 1: // bat — swoop: high flight, diving at the player's head
			speed = 0.5
			cycle := b.formT % 50
			if cycle < 30 {
				b.air = 5 + math.Sin(float64(b.formT)/5)
			} else {
				b.air = clamp(5-float64(cycle-30)/2, 0, 5)
			}
		default: // mist drifts, untouchable and harmless
			speed = 0.12
			b.air = 1
		}
	}

	b.x = clamp(b.x+dir*speed, 1, float64(w-7))

	// contact damage (mist is harmless; bats bite only when low)
	harmless := b.form == 2 || b.ethereal > 0
	if !harmless && abs(b.x+2-(g.px+1)) <= b.def.touch && b.air <= 2 {
		g.damagePlayer(b.x, 4, ground)
	}
}

// ── drawing ────────────────────────────────────────────────────────────────────

func (g *game) draw(w, h, ground int) {
	g.drawBackdrop(w, ground)
	for _, b := range g.bones {
		g.scr.text(b[0], b[1], "·", cBone, true)
	}
	for _, pk := range g.picks {
		info := pickups[pk.kind]
		if pk.ttl > 40 || g.anim%2 == 0 {
			g.scr.put(pk.x, float64(ground-1), info.ch, info.color)
		}
	}
	for _, m := range g.mobs {
		zd := zombies[m.kind]
		mh := len(zd.frames[0])
		top := float64(ground - mh)
		if m.dying > 0 {
			f := min(len(zd.die)-1, (m.dying-1)/3)
			g.scr.sprite(m.x, float64(ground-len(zd.die[f])), zd.die[f], cBone)
		} else {
			color := zd.color
			if m.hitFlash > 0 {
				color = cFlash
			}
			fi := 0
			if g.anim%16 >= 8 {
				fi = 1
			}
			g.scr.sprite(m.x, top, zd.frames[fi], color)
		}
	}
	if g.bz != nil {
		g.drawBoss(ground)
	}

	// player (flickers while invulnerable; glows under star power)
	ptop := float64(ground-3) - g.jumpY
	heroCol := cHero
	if g.star > 0 && g.anim%2 == 0 {
		heroCol = cYellow
	}
	if g.invuln == 0 || g.anim%2 == 0 {
		g.scr.sprite(g.px, ptop, sprHero, heroCol)
	}
	if g.attack > 0 {
		blade := g.weap.right
		x := g.px + 3
		if g.facing < 0 {
			blade = g.weap.left
			x = g.px + 1 - float64(len([]rune(blade)))
		}
		g.scr.text(x, ptop+1, blade, g.weap.color, true)
	}
	for _, p := range g.projs {
		g.scr.put(p.x, p.y, p.ch, p.color)
	}
	for _, p := range g.particles {
		g.scr.put(p.x, p.y, "·", p.color)
	}
	g.drawHud(w)
	if g.alertT > 0 && g.anim%4 < 2 {
		g.scr.center(2, g.alertText, cRed)
	}
	if g.flashT > 0 {
		g.scr.center(3, g.flashMsg, cYellow)
	}
	g.scr.center(h-1, "←→ move · space jump · x attack · q flee", cDim)
}

func (g *game) drawBackdrop(w, ground int) {
	g.scr.text(float64(w-8), 1, "☾", cYellow+cDim, true)
	switch {
	case g.stage <= 1:
		for gx := 6; gx < w-6; gx += 17 {
			g.scr.text(float64(gx), float64(ground-1), "∩", cDim, true)
		}
	case g.stage == 2:
		for gx := 8; gx < w-6; gx += 21 {
			g.scr.text(float64(gx), float64(ground-2), "▌", cDim, true)
			g.scr.text(float64(gx), float64(ground-1), "▌", cDim, true)
		}
	case g.stage == 3:
		for gx := 5; gx < w-8; gx += 25 {
			g.scr.text(float64(gx), float64(ground-3), "╫", cDim, true)
			g.scr.text(float64(gx), float64(ground-2), "║", cDim, true)
			g.scr.text(float64(gx), float64(ground-1), "║", cDim, true)
		}
	default: // castle interior: candelabra
		for gx := 9; gx < w-6; gx += 23 {
			g.scr.text(float64(gx), float64(ground-3), "ⁿ", cYellow, true)
			g.scr.text(float64(gx), float64(ground-2), "┃", cDim, true)
			g.scr.text(float64(gx), float64(ground-1), "┻", cDim, true)
		}
	}
	for x := 0; x < w; x++ {
		g.scr.put(float64(x), float64(ground), "▀", cDim)
	}
}

func (g *game) drawBoss(ground int) {
	b := g.bz
	if b.dying > 0 {
		f := min(len(dieBoss)-1, (b.dying-1)/4)
		g.scr.sprite(b.x, float64(ground-4), dieBoss[f], cBone)
		return
	}
	sprite := b.def.sprite
	color := b.def.color
	if b.hitFlash > 0 {
		color = cFlash
	}
	if b.id == bDracula && b.form == 1 {
		sprite = sprBat
	}
	if b.id == bDracula && b.form == 2 {
		sprite = sprMist
		color = cDim
	}
	if b.ethereal > 0 {
		color = cDim
	}
	top := float64(ground-len(sprite)) - b.air
	g.scr.sprite(b.x, top, sprite, color)
	if b.id != bDracula || b.form == 0 {
		g.scr.put(b.x+1, top+1, "•", cEye)
		g.scr.put(b.x+3, top+1, "•", cEye)
	}
	if b.sweep > 0 && b.sweep <= 6 {
		arc := "≈≈≈≈≈≈"
		g.scr.text(b.x-6, float64(ground-2), arc, cHero, true)
		g.scr.text(b.x+5, float64(ground-2), arc, cHero, true)
	}
}

func (g *game) drawHud(w int) {
	hearts := make([]string, playerHP())
	for i := range hearts {
		if i < g.hp {
			hearts[i] = "♥"
		} else {
			hearts[i] = "·"
		}
	}
	g.scr.text(2, 0, strings.Join(hearts, " "), cRed, true)
	x := float64(2 + playerHP()*2 + 2)
	g.scr.text(x, 0, fmt.Sprintf("S%d", g.stage+1), cViolet, true)
	x += 4
	def := stages[g.stage]
	if def.kills > 0 {
		g.scr.text(x, 0, fmt.Sprintf("† %d/%d", min(g.kills, def.kills), def.kills), cViolet, true)
		x += 8
	}
	g.scr.text(x, 0, g.weap.icon+" "+g.weap.name, g.weap.color, true)
	x += float64(len(g.weap.name) + 4)
	if g.boots > 0 {
		g.scr.text(x, 0, fmt.Sprintf("»%d", (g.boots+19)/20), cCyan, true)
		x += 4
	}
	if g.power > 0 {
		g.scr.text(x, 0, fmt.Sprintf("◊%d", (g.power+19)/20), cViolet, true)
		x += 4
	}
	if g.star > 0 {
		g.scr.text(x, 0, fmt.Sprintf("☆%d", (g.star+19)/20), cYellow, true)
	}
	if b := g.bz; b != nil && b.dying == 0 {
		const bw = 14
		fill := max(0, b.hp*bw/b.def.hp)
		label := b.def.name + " "
		g.scr.text(float64(w-bw-len(label)-3), 0, label, b.def.color, true)
		g.scr.text(float64(w-bw-3), 0, strings.Repeat("█", fill)+strings.Repeat("░", bw-fill), b.def.color, false)
	} else {
		g.scr.text(float64(w-8), 0, fmtTime(g.ticks), cDim, true)
	}
}

func (g *game) drawStageCard(h int) {
	def := stages[g.stage]
	mid := h / 2
	g.scr.center(mid-2, fmt.Sprintf("— STAGE %d —", g.stage+1), cDim)
	g.scr.center(mid, def.name, cViolet)
	g.scr.center(mid+2, def.flavor, cDim)
}

func (g *game) drawCutscene(w, h, ground int) {
	cx := w - 24
	castle := []string{"  ▟▙   ▟▙   ▟▙  ", "  ██▄▄▄██▄▄▄██  ", "  ████████████  ", "  ███▐▌██▐▌███  ", "  ████████████  "}
	g.scr.sprite(float64(cx), 2, castle, cDim)
	g.scr.text(float64(w-6), 1, "☾", cYellow, true)
	if g.anim%14 < 7 {
		g.scr.put(float64(cx+8), 3, "▪", cYellow) // a light in the window
	}
	const steps = 9
	for i := 0; i < steps; i++ {
		sx := 6 + i*5
		sy := ground - i
		for j := sx; j < min(w, sx+(steps-i)*5); j++ {
			g.scr.put(float64(j), float64(sy), "▄", cDim)
		}
	}
	for x := 0; x < min(w, 6); x++ {
		g.scr.put(float64(x), float64(ground), "▀", cDim)
	}
	prog := clamp(float64(g.cutT)/100, 0, 1)
	step := int(prog * float64(steps-1))
	hx := 4 + step*5 + int((prog*float64(steps-1)-float64(step))*5)
	hy := ground - step - 1
	g.scr.sprite(float64(hx), float64(hy-2), sprHero, cHero)
	if g.cutT < 100 {
		g.scr.center(h-1, "the last chapter awaits … (any key to hurry)", cDim)
	}
}

func wrapText(s string, width int) []string {
	var lines []string
	cur := ""
	for _, word := range strings.Fields(s) {
		switch {
		case cur == "":
			cur = word
		case len(cur)+len(word)+1 > width:
			lines = append(lines, cur)
			cur = word
		default:
			cur += " " + word
		}
	}
	if cur != "" {
		lines = append(lines, cur)
	}
	return lines
}

func (g *game) drawDialogue(w, h int) {
	line := g.dlg[g.dlgI]
	const boxH = 11
	top := h - boxH
	for y := top; y < h; y++ {
		g.scr.fillRow(y, " ", "")
	}
	g.scr.fillRow(top, "─", cDim)

	// portrait, Persona-style close-up
	g.scr.sprite(3, float64(top+2), line.portrait, line.color)

	// name + typewriter text
	tX := 16
	tW := max(16, w-tX-4)
	g.scr.text(float64(tX), float64(top+2), line.name, line.color, false)
	g.scr.text(float64(tX), float64(top+3), strings.Repeat("─", min(tW, len(line.name)+2)), cDim, false)
	runes := []rune(line.text)
	shown := string(runes[:min(g.dlgChars, len(runes))])
	for i, l := range wrapText(shown, tW) {
		if i >= 5 {
			break
		}
		g.scr.text(float64(tX), float64(top+5+i), l, "", false)
	}
	if g.dlgChars >= len(runes) && g.anim%12 < 7 {
		g.scr.text(float64(w-6), float64(h-2), "▼", cDim, true)
	}
}

func (g *game) drawTitle(h int) {
	mid := h / 2
	g.scr.center(mid-6, "M A N G A V A N I A", cViolet)
	g.scr.center(mid-4, "the manga-cli minigame · for bad-wifi days", cDim)
	g.scr.center(mid-2, "five chapters of the restless dead — and HIM, waiting in the castle", cCyan)
	g.scr.center(mid, "zombies drop hearts, boots, power … and better weapons", cDim)
	g.scr.center(mid+2, "← →  move      space  jump      x  attack", "")
	g.scr.center(mid+4, "press any key for chapter select · q to flee", cDim)
}

var roman = []string{"I", "II", "III", "IV", "V"}

func (g *game) drawSelect(h int) {
	top := max(1, h/2-6)
	g.scr.center(top, "— CHAPTER SELECT —", cViolet)
	for i, s := range stages {
		marker := " "
		color := cDim
		if i == g.sel {
			marker = "▸"
			color = cCyan
		}
		label := fmt.Sprintf("%s %-4s%-16s", marker, roman[i], s.name)
		g.scr.center(top+2+i, label, color)
	}
	cur := stages[g.sel]
	bz := bosses[cur.boss]
	g.scr.center(top+8, cur.flavor, cDim)
	warn := fmt.Sprintf("%d kills, then %s", cur.kills, bz.name)
	if cur.kills == 0 {
		warn = "only " + bz.name + " awaits … and what comes after"
	}
	color := cDim
	if g.anim%16 < 8 {
		color = cRed
	}
	g.scr.center(top+9, warn, color)
	g.scr.center(top+11, "↑↓ / 1-5 choose · enter begin · q flee", cDim)
	g.scr.center(top+12, "chapters past I pack the VAMPIRE KILLER", cYellow+cDim)
}

func (g *game) drawEnd(h int) {
	mid := h / 2
	if g.ph == phWin {
		g.scr.center(mid-4, "☩  Y O U   W I N  ☩", cYellow)
		g.scr.center(mid-2, "DRACULA crumbles to dust — the castle sleeps again", cViolet)
		g.scr.center(mid, fmt.Sprintf("cleared in %s · %d slain · %d/%d ♥ remaining",
			fmtTime(g.ticks), g.totalKills, g.hp, playerHP()), cCyan)
		g.scr.center(mid+2, "the wifi is probably back by now — press any key", cDim)
	} else {
		g.scr.center(mid-3, "☠  G A M E   O V E R  ☠", cRed)
		g.scr.center(mid-1, fmt.Sprintf("fallen at chapter %d: %s · %d slain · %s",
			g.stage+1, stages[g.stage].name, g.totalKills, fmtTime(g.ticks)), cDim)
		g.scr.center(mid+1, "r  retry this chapter      q  give up", "")
	}
}

func fmtTime(ticks int) string {
	s := ticks * tickMS / 1000
	return fmt.Sprintf("%d:%02d", s/60, s%60)
}
