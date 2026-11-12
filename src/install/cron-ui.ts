export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function splitTime(time: string): [number, number] {
  const [h, m] = time.split(":").map(Number);
  return [h || 0, m || 0];
}

const pad = (n: number) => String(n).padStart(2, "0");

export function toDailyCron(time: string): string {
  const [h, m] = splitTime(time);
  return `${m} ${h} * * *`;
}

export function toWeeklyCron(day: number, time: string): string {
  const [h, m] = splitTime(time);
  return `${m} ${h} * * ${day}`;
}

const PLAIN = /^(\d{1,2}) (\d{1,2}) \* \* (\*|\d)$/;

export function fromDailyCron(expr: string): { time: string } | null {
  const m = PLAIN.exec(expr.trim());
  if (!m || m[3] !== "*") return null;
  return { time: `${pad(Number(m[2]))}:${pad(Number(m[1]))}` };
}

export function fromWeeklyCron(expr: string): { day: number; time: string } | null {
  const m = PLAIN.exec(expr.trim());
  if (!m || m[3] === "*") return null;
  return { day: Number(m[3]) % 7, time: `${pad(Number(m[2]))}:${pad(Number(m[1]))}` };
}

export function describeSchedule(s: { syncCron: string; digestCron: string; timezone: string }): string {
  const daily = fromDailyCron(s.syncCron);
  const weekly = fromWeeklyCron(s.digestCron);
  const sync = daily ? `every day at ${daily.time}` : `on schedule "${s.syncCron}"`;
  const digest = weekly ? `every ${WEEKDAYS[weekly.day]} at ${weekly.time}` : `on schedule "${s.digestCron}"`;
  return `Sync ${sync}, digest ${digest} (${s.timezone})`;
}
