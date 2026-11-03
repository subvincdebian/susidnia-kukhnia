const kyivClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
function wallTime(instant: number): number {
  const parts = Object.fromEntries(kyivClock.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
}

/** PostgreSQL TIMESTAMP values in this schema are Kyiv wall times, regardless of the visitor's OS zone. */
export function parseKyivTimestamp(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) throw new Error("Invalid database timestamp");
  const wall = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]));
  // Both adjacent offsets cover DST changes. Like PostgreSQL AT TIME ZONE,
  // prefer the later instant for an ambiguous or nonexistent wall time.
  const candidates = [-86400000, 86400000].map((distance) => {
    const sample = wall + distance;
    return wall - (wallTime(sample) - sample);
  });
  const matching = candidates.filter((instant) => wallTime(instant) === wall);
  const instant = Math.max(...(matching.length ? matching : candidates));
  return new Date(instant + Number((match[7] ?? "").padEnd(3, "0").slice(0, 3)));
}
