/** Pure UTC calendar scheduling helpers: CSV parsing/export and anti-spam slot staggering. */
import type { ScheduledItem } from "./config-store";

export interface CsvScheduleParseResult {
  items: Array<{
    title: string;
    date: string;
    time: string;
    platforms: string[];
  }>;
  skippedLines: Array<{ lineNumber: number; reason: string }>;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})/;

/** Converts YYYY-MM-DD + HH:MM (UTC) to UTC epoch minutes for location-agnostic sorting & arithmetic. */
export function parseUtcSlotMinutes(dateStr: string, timeStr: string): number | null {
  const dm = DATE_RE.exec(dateStr.trim());
  const tm = TIME_RE.exec(timeStr.replace(/\s*UTC$/i, "").trim());
  if (!dm || !tm) return null;
  const year = Number(dm[1]);
  const month = Number(dm[2]);
  const day = Number(dm[3]);
  const hour = Number(tm[1]);
  const minute = Number(tm[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return null;
  }
  const ms = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 60_000);
}

export function formatUtcSlotFromMinutes(totalMinutes: number): { date: string; time: string } {
  const d = new Date(totalMinutes * 60_000);
  const year = String(d.getUTCFullYear()).padStart(4, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hour = String(d.getUTCHours()).padStart(2, "0");
  const minute = String(d.getUTCMinutes()).padStart(2, "0");
  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute} UTC`,
  };
}

export function addUtcMinutes(
  dateStr: string,
  timeStr: string,
  deltaMinutes: number,
): { date: string; time: string } {
  const base = parseUtcSlotMinutes(dateStr, timeStr);
  if (base === null) {
    return { date: dateStr, time: timeStr };
  }
  return formatUtcSlotFromMinutes(base + Math.round(deltaMinutes));
}

export function parseScheduleCsv(csvText: string): CsvScheduleParseResult {
  const lines = csvText.split(/\r?\n/);
  const items: CsvScheduleParseResult["items"] = [];
  const skippedLines: CsvScheduleParseResult["skippedLines"] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw || raw.startsWith("#") || raw.toLowerCase().startsWith("title,")) continue;
    const parts = raw.split(",").map((p) => p.trim());
    if (parts.length < 4) {
      skippedLines.push({
        lineNumber: i + 1,
        reason: "Expected at least 4 comma-separated fields: Title, YYYY-MM-DD, HH:MM UTC, platform...",
      });
      continue;
    }
    const [title, date, rawTime, ...rest] = parts;
    const platforms = rest.filter(Boolean);
    if (!title || platforms.length === 0) {
      skippedLines.push({ lineNumber: i + 1, reason: "Missing title or target platform IDs." });
      continue;
    }
    const normalizedTime = /UTC$/i.test(rawTime) ? rawTime : `${rawTime} UTC`;
    if (parseUtcSlotMinutes(date, normalizedTime) === null) {
      skippedLines.push({
        lineNumber: i + 1,
        reason: `Invalid UTC date/time "${date} ${rawTime}" (use YYYY-MM-DD, HH:MM UTC).`,
      });
      continue;
    }
    items.push({
      title,
      date,
      time: normalizedTime,
      platforms,
    });
  }

  return { items, skippedLines };
}

export function formatScheduleToCsv(items: ScheduledItem[]): string {
  const header = "Title, Date, Time, Platforms";
  const rows = items.map((item) => {
    const safeTitle = item.title.replace(/,/g, " ").trim();
    return `${safeTitle}, ${item.date}, ${item.time}, ${item.platforms.join(", ")}`;
  });
  return [header, ...rows].join("\n");
}

/**
 * Ensures scheduled items have at least `minGapMinutes` spacing between consecutive drops
 * so simultaneous dispatches do not trigger social platform anti-spam bursts.
 */
export function staggerScheduledSlots(
  items: ScheduledItem[],
  minGapMinutes: number,
): { items: ScheduledItem[]; shiftedCount: number } {
  const gap = Math.max(1, Math.round(minGapMinutes));
  const indexed = items.map((item, idx) => ({
    item,
    idx,
    slot: parseUtcSlotMinutes(item.date, item.time) ?? Number.MAX_SAFE_INTEGER,
  }));

  indexed.sort((a, b) => a.slot - b.slot || a.idx - b.idx);

  let shiftedCount = 0;
  let prevSlot: number | null = null;
  const updated: ScheduledItem[] = [];

  for (const entry of indexed) {
    if (entry.slot === Number.MAX_SAFE_INTEGER) {
      updated.push(entry.item);
      continue;
    }
    let nextSlot = entry.slot;
    if (prevSlot !== null && nextSlot < prevSlot + gap) {
      nextSlot = prevSlot + gap;
      shiftedCount++;
    }
    prevSlot = nextSlot;
    const formatted = formatUtcSlotFromMinutes(nextSlot);
    updated.push({
      ...entry.item,
      date: formatted.date,
      time: formatted.time,
    });
  }

  return { items: updated, shiftedCount };
}
