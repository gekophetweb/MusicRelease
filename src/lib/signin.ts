import { getSetting, type SignInSettings } from "@/lib/settings";

export type SignInMethods = { google: boolean; emailCode: boolean };

export const LOCKOUT_ERROR = "This would leave no way to sign in. Keep Google on, or set up mail for email codes.";

/** Which sign-in methods actually work: Google needs a client id, email codes need mail. */
export function availableMethods(signin: SignInSettings | null, mailConfigured: boolean): SignInMethods {
  return {
    google: !!signin?.google.enabled && !!signin.google.clientId,
    emailCode: !!signin?.emailCode.enabled && mailConfigured,
  };
}

export async function getSignInMethods(): Promise<SignInMethods> {
  const [signin, mail] = await Promise.all([getSetting("signin"), getSetting("mail")]);
  return availableMethods(signin, !!mail);
}
