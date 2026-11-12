import { http, HttpResponse } from "msw";
import { fetchWithRetry, ProviderHttpError } from "@/providers/http";
import { setupMsw } from "../helpers/msw";

const server = setupMsw();
const URL = "https://api.example.test/thing";

afterEach(() => vi.useRealTimers());

test("retries after Retry-After on 429 then succeeds", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  let calls = 0;
  server.use(
    http.get(URL, () => {
      calls++;
      return calls === 1 ? new HttpResponse(null, { status: 429, headers: { "Retry-After": "2" } }) : HttpResponse.json({ ok: 1 });
    }),
  );
  const p = fetchWithRetry(URL, {});
  await vi.advanceTimersByTimeAsync(1999);
  expect(calls).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  const res = await p;
  expect(res.status).toBe(200);
  expect(calls).toBe(2);
});

test("throws ProviderHttpError after maxRetries 5xx", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  let calls = 0;
  server.use(
    http.get(URL, () => {
      calls++;
      return new HttpResponse(null, { status: 503 });
    }),
  );
  const p = fetchWithRetry(URL, {}).catch((e) => e);
  await vi.advanceTimersByTimeAsync(10_000);
  const err = await p;
  expect(err).toBeInstanceOf(ProviderHttpError);
  expect(err.status).toBe(503);
  expect(err.url).toBe(URL);
  expect(calls).toBe(4);
});

test("does not retry 401", async () => {
  let calls = 0;
  server.use(
    http.get(URL, () => {
      calls++;
      return new HttpResponse(null, { status: 401 });
    }),
  );
  const err = await fetchWithRetry(URL, {}).catch((e) => e);
  expect(err).toBeInstanceOf(ProviderHttpError);
  expect(err.status).toBe(401);
  expect(calls).toBe(1);
});

test("does not retry other 4xx", async () => {
  let calls = 0;
  server.use(
    http.get(URL, () => {
      calls++;
      return new HttpResponse(null, { status: 404 });
    }),
  );
  await expect(fetchWithRetry(URL, {})).rejects.toMatchObject({ status: 404 });
  expect(calls).toBe(1);
});

test("caps a huge Retry-After at 60 seconds", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  let calls = 0;
  server.use(
    http.get(URL, () => {
      calls++;
      return calls === 1 ? new HttpResponse(null, { status: 429, headers: { "Retry-After": "86400" } }) : HttpResponse.json({});
    }),
  );
  const p = fetchWithRetry(URL, {});
  await vi.advanceTimersByTimeAsync(60_000);
  expect((await p).status).toBe(200);
});
