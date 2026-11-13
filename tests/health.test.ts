import { GET } from "@/app/api/health/route";

test("health reports ok when db reachable", async () => {
  const res = await GET();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: "ok", db: "ok" });
});
