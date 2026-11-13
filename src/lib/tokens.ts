import { getAuth, type ProviderName } from "@/lib/auth";
import { prisma } from "@/lib/db";

/** The connection is broken for good (refresh keeps failing); the user has to connect again. */
export class ReconnectRequiredError extends Error {
  readonly provider: ProviderName;
  readonly userId: string;

  constructor(userId: string, provider: ProviderName, cause?: unknown) {
    super(`The ${provider} connection for user ${userId} needs to be reconnected`, { cause });
    this.name = "ReconnectRequiredError";
    this.provider = provider;
    this.userId = userId;
  }
}

/** No token right now (provider or network trouble); try again on the next run. */
export class TokenUnavailableError extends Error {
  constructor(userId: string, provider: ProviderName, cause?: unknown) {
    super(`Could not get a ${provider} token for user ${userId} right now`, { cause });
    this.name = "TokenUnavailableError";
  }
}

/**
 * Better Auth reports every refresh failure the same way, so a revoked token cannot be told apart from an
 * outage. Only after this many failures, spread over at least this long, is the account marked for reconnect.
 */
const FAILURES_BEFORE_RECONNECT = 3;
const FAILURE_SPAN_MS = 12 * 60 * 60 * 1000;

/** Returns a usable access token, refreshing it when expired. */
export async function getValidAccessToken(userId: string, provider: ProviderName): Promise<string> {
  const account = await prisma.account.findFirst({ where: { userId, providerId: provider } });
  if (!account) throw new ReconnectRequiredError(userId, provider);
  try {
    const auth = await getAuth();
    const res = await auth.api.getAccessToken({ body: { accountId: account.id, userId } });
    if (!res?.accessToken) throw new Error("No access token returned");
    if (account.tokenFailures > 0) {
      await prisma.account.update({ where: { id: account.id }, data: { tokenFailures: 0, tokenFailedSince: null } });
    }
    return res.accessToken;
  } catch (err) {
    const now = new Date();
    const since = account.tokenFailedSince ?? now;
    const failures = account.tokenFailures + 1;
    const broken = failures >= FAILURES_BEFORE_RECONNECT && now.getTime() - since.getTime() >= FAILURE_SPAN_MS;
    await prisma.account.update({
      where: { id: account.id },
      data: { tokenFailures: failures, tokenFailedSince: since, ...(broken ? { needsReconnect: true } : {}) },
    });
    if (broken) throw new ReconnectRequiredError(userId, provider, err);
    throw new TokenUnavailableError(userId, provider, err);
  }
}
