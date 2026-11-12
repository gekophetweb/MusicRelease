import { betterAuth, type BetterAuthOptions, type BetterAuthPlugin } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { deriveSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { getSetting, getSettingsVersion, isInstalled, type OAuthAppSettings, type SiteSettings } from "@/lib/settings";

export type ProviderName = "spotify" | "tidal";

/** TIDAL OAuth 2.1 (Authorization Code + PKCE) and user endpoint. */
export const TIDAL_OAUTH = {
  authorizationUrl: "https://login.tidal.com/authorize",
  tokenUrl: "https://auth.tidal.com/v1/oauth2/token",
  userInfoUrl: "https://openapi.tidal.com/v2/users/me",
  scopes: ["user.read", "collection.read"],
};

export const SPOTIFY_SCOPES = ["user-follow-read", "user-read-email"];

/** Used when a provider (e.g. TIDAL) returns no email; never used for sending mail. */
export const PLACEHOLDER_EMAIL_DOMAIN = "users.noreply.invalid";
export const isPlaceholderEmail = (email: string | null | undefined) =>
  !email || email.endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);

export class SignupsClosedError extends Error {
  constructor() {
    super("Sign-ups are closed. Ask the admin to open them.");
    this.name = "SignupsClosedError";
  }
}

export async function assertSignupAllowed(): Promise<void> {
  if (!(await isInstalled())) return;
  const site = await getSetting("site");
  if (site?.allowSignups) return;
  if ((await prisma.user.count()) === 0) return;
  throw new SignupsClosedError();
}

export interface AuthConfigInput {
  site: SiteSettings | null;
  spotify: OAuthAppSettings | null;
  tidal: OAuthAppSettings | null;
}

const isOn = (s: OAuthAppSettings | null): s is OAuthAppSettings => !!s?.enabled && !!s.clientId;

async function fetchTidalUser(accessToken: string) {
  const res = await fetch(TIDAL_OAUTH.userInfoUrl, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/vnd.api+json" },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    data?: { id: string; attributes?: { username?: string; email?: string; firstName?: string } };
  };
  const d = body.data;
  if (!d?.id) return null;
  const email = d.attributes?.email;
  return {
    id: d.id,
    name: d.attributes?.firstName || d.attributes?.username || "TIDAL user",
    email: email || `tidal-${d.id}@${PLACEHOLDER_EMAIL_DOMAIN}`,
    emailVerified: !!email,
  };
}

export function buildAuthOptions(cfg: AuthConfigInput): BetterAuthOptions {
  const publicUrl = cfg.site?.publicUrl;
  const plugins: BetterAuthPlugin[] = [];
  if (isOn(cfg.tidal)) {
    plugins.push(
      // Generic OAuth providers sign in through the standard signIn.social + /api/auth/callback/:id.
      genericOAuth({
        config: [
          {
            providerId: "tidal",
            clientId: cfg.tidal.clientId,
            clientSecret: cfg.tidal.clientSecret,
            authorizationUrl: TIDAL_OAUTH.authorizationUrl,
            tokenUrl: TIDAL_OAUTH.tokenUrl,
            scopes: TIDAL_OAUTH.scopes,
            pkce: true,
            getUserInfo: async (tokens) => (tokens.accessToken ? fetchTidalUser(tokens.accessToken) : null),
          },
        ],
      }) as unknown as BetterAuthPlugin,
    );
  }

  return {
    appName: cfg.site?.siteName ?? "MusicReleases",
    baseURL: publicUrl,
    trustedOrigins: publicUrl ? [publicUrl] : [],
    secret: deriveSecret("better-auth"),
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    socialProviders: isOn(cfg.spotify)
      ? {
          spotify: {
            clientId: cfg.spotify.clientId,
            clientSecret: cfg.spotify.clientSecret,
            scope: SPOTIFY_SCOPES,
            disableDefaultScope: true,
          },
        }
      : {},
    account: {
      encryptOAuthTokens: true,
      // Signing in with Spotify and later with TIDAL links both to the same user when emails match.
      accountLinking: { enabled: true, trustedProviders: ["spotify", "tidal"] },
    },
    user: { additionalFields: { role: { type: "string", defaultValue: "user", input: false } } },
    databaseHooks: {
      user: {
        create: {
          before: async () => {
            try {
              await assertSignupAllowed();
            } catch (err) {
              if (err instanceof SignupsClosedError) throw new APIError("FORBIDDEN", { message: err.message });
              throw err;
            }
          },
          after: async (user) => {
            await prisma.userSettings.upsert({
              where: { userId: user.id },
              create: { userId: user.id, digestEmail: isPlaceholderEmail(user.email) ? null : user.email },
              update: {},
            });
          },
        },
      },
      account: {
        update: {
          // A successful sign-in or refresh stores new tokens: the account works again.
          after: async (account) => {
            if (account.accessToken) {
              await prisma.account.updateMany({ where: { id: account.id, needsReconnect: true }, data: { needsReconnect: false } });
            }
          },
        },
      },
    },
    plugins,
  };
}

function createAuth(cfg: AuthConfigInput) {
  return betterAuth(buildAuthOptions(cfg));
}
export type Auth = ReturnType<typeof createAuth>;

const cache: { version?: string; auth?: Auth } = {};

/** Better Auth built from the current settings; rebuilt when settings change. */
export async function getAuth(): Promise<Auth> {
  const version = await getSettingsVersion();
  if (cache.auth && cache.version === version) return cache.auth;
  const [site, spotify, tidal] = await Promise.all([getSetting("site"), getSetting("spotify"), getSetting("tidal")]);
  cache.auth = createAuth({ site, spotify, tidal });
  cache.version = version;
  return cache.auth;
}

export async function getEnabledProviders(): Promise<ProviderName[]> {
  const [spotify, tidal] = await Promise.all([getSetting("spotify"), getSetting("tidal")]);
  const out: ProviderName[] = [];
  if (isOn(spotify)) out.push("spotify");
  if (isOn(tidal)) out.push("tidal");
  return out;
}
