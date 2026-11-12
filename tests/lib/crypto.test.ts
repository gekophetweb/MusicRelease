import { decrypt, deriveSecret, encrypt } from "@/lib/crypto";

test("decrypt(encrypt(x)) returns x", () => {
  expect(decrypt(encrypt("hello wereld 🎵"))).toBe("hello wereld 🎵");
});

test("two encryptions of the same text differ (random IV)", () => {
  expect(encrypt("a")).not.toBe(encrypt("a"));
});

test("decrypt throws when the ciphertext is tampered with", () => {
  const env = encrypt("secret value");
  const parts = env.split(":");
  const ct = parts[3];
  parts[3] = (ct[0] === "A" ? "B" : "A") + ct.slice(1);
  expect(() => decrypt(parts.join(":"))).toThrow();
});

test("envelope uses the v1 format", () => {
  expect(encrypt("x")).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/);
});

test("deriveSecret is stable per purpose and differs between purposes", () => {
  expect(deriveSecret("better-auth")).toBe(deriveSecret("better-auth"));
  expect(deriveSecret("better-auth")).not.toBe(deriveSecret("other"));
  expect(deriveSecret("better-auth").length).toBeGreaterThanOrEqual(32);
});
