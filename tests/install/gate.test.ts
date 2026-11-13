import { gateDecision } from "@/install/gate";

test("before install every app page redirects to the installer", () => {
  expect(gateDecision("/releases", false)).toBe("redirect:/install");
  expect(gateDecision("/", false)).toBe("redirect:/install");
  expect(gateDecision("/admin/settings", false)).toBe("redirect:/install");
});

test("before install the installer, auth, health and assets stay reachable", () => {
  expect(gateDecision("/install", false)).toBe("next");
  expect(gateDecision("/install/complete", false)).toBe("next");
  expect(gateDecision("/api/install/site", false)).toBe("next");
  expect(gateDecision("/api/auth/callback/spotify", false)).toBe("next");
  expect(gateDecision("/api/health", false)).toBe("next");
  expect(gateDecision("/_next/static/chunk.js", false)).toBe("next");
  expect(gateDecision("/favicon.ico", false)).toBe("next");
});

test("before install other API routes answer 503 instead of redirecting", () => {
  expect(gateDecision("/api/sync", false)).toBe("unavailable");
});

test("after install the installer is gone for everyone", () => {
  expect(gateDecision("/install", true)).toBe("notfound");
  expect(gateDecision("/install/complete", true)).toBe("notfound");
  expect(gateDecision("/api/install/site", true)).toBe("notfound");
  expect(gateDecision("/api/install/token", true)).toBe("notfound");
});

test("after install normal pages pass", () => {
  expect(gateDecision("/releases", true)).toBe("next");
  expect(gateDecision("/", true)).toBe("next");
  expect(gateDecision("/api/health", true)).toBe("next");
});

test("paths that only start with 'install' are not the installer", () => {
  expect(gateDecision("/installer-guide", true)).toBe("next");
});

test("installed check never serves a stale 'not installed' right after setup completes", async () => {
  const { createInstalledCheck } = await import("@/install/gate");
  let installed = false;
  let calls = 0;
  const check = createInstalledCheck(async () => {
    calls++;
    return installed;
  });
  expect(await check()).toBe(false);
  installed = true; // completeInstall ran; the very next request must see it
  expect(await check()).toBe(true);
  expect(await check()).toBe(true);
  expect(calls).toBe(2); // once installed, the answer is cached for good
});
