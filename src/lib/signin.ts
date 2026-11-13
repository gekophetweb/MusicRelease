import { getSetting, isInstalled, type SignInSettings } from "@/lib/settings";
import { isMailConfigured } from "@/mail";

export type SignInMethods = { google: boolean; emailCode: boolean };

export const LOCKOUT_ERROR = "This would leave no way to sign in. Keep Google on, or set up mail for email codes.";

/**
 * Sites installed before sign-in settings existed have none stored: they default to email codes, so existing
 * users can sign in with a code to their account email right after upgrading.
 */
export const UPGRADE_DEFAULT: SignInSettings = {
  google: { enabled: false, clientId: "", clientSecret: "" },
  emailCode: { enabled: true },
};

export function effectiveSignIn(stored: SignInSettings | null, installed: boolean): SignInSettings | null {
  return stored ?? (installed ? UPGRADE_DEFAULT : null);
}

/** Which sign-in methods actually work: Google needs a client id, email codes need mail. */
export function availableMethods(signin: SignInSettings | null, mailConfigured: boolean): SignInMethods {
  return {
    google: !!signin?.google.enabled && !!signin.google.clientId,
    emailCode: !!signin?.emailCode.enabled && mailConfigured,
  };
}

export async function getSignInMethods(): Promise<SignInMethods> {
  const [signin, mail, installed] = await Promise.all([getSetting("signin"), getSetting("mail"), isInstalled()]);
  return availableMethods(effectiveSignIn(signin, installed), isMailConfigured(mail));
}
