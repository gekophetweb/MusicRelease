/** Runs once when the Next.js server starts: prints the setup token while installation is pending. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureSetupToken, logSetupBanner } = await import("@/lib/setup-token");
  const { getSetting } = await import("@/lib/settings");
  try {
    const token = await ensureSetupToken();
    if (token) logSetupBanner(token, (await getSetting("site"))?.publicUrl);
  } catch (err) {
    console.error("Could not prepare the setup token (is the database reachable?)", err);
  }
}
