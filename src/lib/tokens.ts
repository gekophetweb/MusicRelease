import { getAuth, type ProviderName } from "@/lib/auth";
import { prisma } from "@/lib/db";

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

/** Returns a usable access token, refreshing it when expired. Marks the account for reconnect on failure. */
export async function getValidAccessToken(userId: string, provider: ProviderName): Promise<string> {
  const account = await prisma.account.findFirst({ where: { userId, providerId: provider } });
  if (!account) throw new ReconnectRequiredError(userId, provider);
  try {
    const auth = await getAuth();
    const res = await auth.api.getAccessToken({ body: { accountId: account.id, userId } });
    if (!res?.accessToken) throw new Error("No access token returned");
    return res.accessToken;
  } catch (err) {
    await prisma.account.update({ where: { id: account.id }, data: { needsReconnect: true } });
    throw new ReconnectRequiredError(userId, provider, err);
  }
}
