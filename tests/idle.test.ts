import {
  detectionInterval,
  idleActionForButton,
  idleMinutes,
  idleWindowStart,
  idleWorthAsking,
} from "../src/idle";

test("the absence began an interval before Chrome said idle, and never before the timer", () => {
  const fired = new Date("2026-09-18T10:30:00Z").getTime();
  expect(idleWindowStart(fired, 600, "2026-09-18T09:00:00Z")).toBe(
    fired - 600_000,
  );
  expect(idleWindowStart(fired, 600, "2026-09-18T10:25:00Z")).toBeNull();
  expect(idleWindowStart(fired, 600, null)).toBeNull();
});

test("the heading rounds to whole minutes and never says zero", () => {
  expect(idleMinutes(13 * 60)).toBe(13);
  expect(idleMinutes(13 * 60 + 29)).toBe(13);
  expect(idleMinutes(13 * 60 + 31)).toBe(14);
  expect(idleMinutes(20)).toBe(1);
  expect(idleMinutes(0)).toBe(1);
});

test("the first button removes and keeps timing, the second removes and stops", () => {
  expect(idleActionForButton(0)).toBe("discard_keep");
  expect(idleActionForButton(1)).toBe("discard_stop");
});

test("the detection interval is the setting in seconds, floored at what Chrome accepts", () => {
  expect(detectionInterval(10)).toBe(600);
  expect(detectionInterval(0.1)).toBe(15);
});

test("an absence is asked about only with a fresh answer, a running timer, and one that predates the absence (board #333)", () => {
  const since = Date.parse("2026-09-20T10:00:00Z");
  const fresh = { fetchedAt: Date.now() };
  expect(
    idleWorthAsking(since, {
      ...fresh,
      running: { timer_started_at: "2026-09-20T09:00:00Z" },
    }),
  ).toBe(true);
  // the fetch failed: the cache may still say running for a timer stopped elsewhere
  expect(
    idleWorthAsking(since, {
      fetchedAt: 0,
      running: { timer_started_at: "2026-09-20T09:00:00Z" },
    }),
  ).toBe(false);
  // stopped elsewhere while away
  expect(idleWorthAsking(since, { ...fresh, running: null })).toBe(false);
  // stopped and restarted elsewhere while away: none of that time was this machine's
  expect(
    idleWorthAsking(since, {
      ...fresh,
      running: { timer_started_at: "2026-09-20T10:30:00Z" },
    }),
  ).toBe(false);
  expect(
    idleWorthAsking(since, { ...fresh, running: { timer_started_at: null } }),
  ).toBe(false);
});
