import { describeSchedule, fromDailyCron, fromWeeklyCron, toDailyCron, toWeeklyCron } from "@/install/cron-ui";

test("time pickers become cron strings", () => {
  expect(toDailyCron("06:00")).toBe("0 6 * * *");
  expect(toDailyCron("23:45")).toBe("45 23 * * *");
  expect(toWeeklyCron(5, "18:00")).toBe("0 18 * * 5");
});

test("cron strings become time pickers again", () => {
  expect(fromDailyCron("0 6 * * *")).toEqual({ time: "06:00" });
  expect(fromWeeklyCron("30 9 * * 1")).toEqual({ day: 1, time: "09:30" });
});

test("unparsable cron returns null so the form can fall back", () => {
  expect(fromDailyCron("*/5 * * * *")).toBeNull();
  expect(fromWeeklyCron("0 18 * * 1-5")).toBeNull();
});

test("schedule preview sentence", () => {
  expect(describeSchedule({ syncCron: "0 6 * * *", digestCron: "0 18 * * 5", timezone: "Europe/Amsterdam" })).toBe(
    "Sync every day at 06:00, digest every Friday at 18:00 (Europe/Amsterdam)",
  );
});
