import { setupServer } from "msw/node";

/** One MSW server per test file; unhandled requests fail the test so nothing reaches the network. */
export function useMsw() {
  const server = setupServer();
  beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
  return server;
}
