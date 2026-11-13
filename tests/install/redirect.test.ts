import { GET as completeInstall } from "@/app/install/complete/route";
import { redirectTo } from "@/install/http";

// Behind the Cloudflare tunnel the app sees its bind address, not the public host.
const INTERNAL = "https://0.0.0.0:3000";

test("redirectTo sends a relative Location so the browser keeps its own host", () => {
  const res = redirectTo("/releases?welcome=1", 303, { "set-cookie": "a=b" });
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("/releases?welcome=1");
  expect(res.headers.get("set-cookie")).toBe("a=b");
});

test("redirectTo refuses anything that is not a same-site path", () => {
  expect(() => redirectTo("https://evil.example/")).toThrow();
  expect(() => redirectTo("//evil.example/")).toThrow();
});

test("install/complete never redirects to the internal address", async () => {
  const res = await completeInstall(new Request(`${INTERNAL}/install/complete`));
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("/install");
});
