// Reading statistics derived from history.json (all local, no network).
// History records the latest position per title, so figures reflect progress
// reached rather than cumulative re-reads.

import type { HistoryEntry } from "./history.ts";

export interface Stats {
  titles: number;
  chaptersProgressed: number;
  finished: number;
  inProgress: number;
  topTitles: Array<{ title: string; chapters: number; total: number; pct: number }>;
  weekday: number[]; // length 7, Sun..Sat — count of titles last read that day
  activeDays: number;
  longestStreak: number;
  currentStreak: number;
  since?: string;
  lastReadTitle?: string;
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function streaks(days: Set<string>): { longest: number; current: number } {
  if (days.size === 0) return { longest: 0, current: 0 };
  const times = [...days]
    .map((k) => {
      const [y, m, d] = k.split("-").map(Number);
      return new Date(y, m - 1, d).getTime();
    })
    .sort((a, b) => a - b);
  const DAY = 86_400_000;
  let longest = 1;
  let run = 1;
  for (let i = 1; i < times.length; i++) {
    const gap = Math.round((times[i] - times[i - 1]) / DAY);
    run = gap === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  // current streak: consecutive days ending today or yesterday
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let current = 0;
  let cursor = today.getTime();
  const has = (t: number): boolean => days.has(dayKey(new Date(t).toISOString()));
  if (!has(cursor)) cursor -= DAY; // allow "yesterday" to count
  while (has(cursor)) {
    current++;
    cursor -= DAY;
  }
  return { longest, current };
}

export function computeStats(history: HistoryEntry[]): Stats {
  const titles = history.length;
  let chaptersProgressed = 0;
  let finished = 0;
  let inProgress = 0;
  const weekday = [0, 0, 0, 0, 0, 0, 0];
  const days = new Set<string>();
  let since: string | undefined;

  for (const h of history) {
    const reached = Math.max(h.lastChapterIndex + 1, h.lastChapterNumber || 0);
    chaptersProgressed += Math.max(0, h.lastChapterIndex + 1);
    if (h.totalChapters > 0 && reached >= h.totalChapters) finished++;
    else inProgress++;
    const d = new Date(h.lastReadAt);
    if (!Number.isNaN(d.getTime())) {
      weekday[d.getDay()]++;
      days.add(dayKey(h.lastReadAt));
      if (!since || h.lastReadAt < since) since = h.lastReadAt;
    }
  }

  const topTitles = [...history]
    .map((h) => {
      const chapters = Math.max(h.lastChapterIndex + 1, 0);
      const total = h.totalChapters || chapters;
      return { title: h.title, chapters, total, pct: total ? Math.round((chapters / total) * 100) : 0 };
    })
    .sort((a, b) => b.chapters - a.chapters)
    .slice(0, 8);

  const { longest, current } = streaks(days);

  return {
    titles,
    chaptersProgressed,
    finished,
    inProgress,
    topTitles,
    weekday,
    activeDays: days.size,
    longestStreak: longest,
    currentStreak: current,
    since,
    lastReadTitle: history[0]?.title,
  };
}
