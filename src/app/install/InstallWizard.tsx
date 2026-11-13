"use client";

import { useCallback, useState } from "react";
import { MailForm, MusicForm, postJson, ScheduleForm, SignInForm, SiteForm } from "@/components/settings/forms";
import { SignIn } from "@/components/SignIn";
import { Button, Field, Notice, TextInput } from "@/components/ui";
import type { MailSettings } from "@/mail/types";
import type { OAuthAppSettings, ScheduleSettings, SignInSettings, SiteSettings } from "@/lib/settings";
import type { SignInMethods } from "@/lib/signin";

export interface InstallState {
  authenticated: boolean;
  detectedOrigin?: string;
  redirectUris?: { google: string; spotify: string; tidal: string };
  signInMethods?: SignInMethods;
  completedStep?: number;
  mailSkipped?: boolean;
  site?: SiteSettings | null;
  signin?: SignInSettings | null;
  spotify?: OAuthAppSettings | null;
  tidal?: OAuthAppSettings | null;
  mail?: MailSettings | null;
  schedule?: ScheduleSettings;
}

const STEPS = [
  { key: "token", title: "Setup token" },
  { key: "site", title: "Site" },
  { key: "signin", title: "Sign-in" },
  { key: "music", title: "Music services" },
  { key: "mail", title: "Mail" },
  { key: "schedule", title: "Schedule" },
  { key: "admin", title: "Your account" },
] as const;

const resumeStep = (s: InstallState) =>
  s.authenticated ? Math.min(Math.max(s.completedStep ?? 1, 1), STEPS.length - 1) : 0;

export function InstallWizard({ initial, signinError }: { initial: InstallState; signinError: boolean }) {
  const [state, setState] = useState<InstallState>(initial);
  const [step, setStep] = useState(() => resumeStep(initial));

  /** Reloads the wizard state after a step is saved, then moves to `advanceTo`. */
  const load = useCallback(async (advanceTo?: number) => {
    const s = (await (await fetch("/api/install/state", { cache: "no-store" })).json()) as InstallState;
    setState(s);
    setStep(!s.authenticated ? 0 : (advanceTo ?? resumeStep(s)));
  }, []);

  const reached = state.authenticated ? Math.max(state.completedStep ?? 1, 1) : 0;
  const next = () => load(step + 1);

  return (
    <div className="grid gap-10 md:grid-cols-[12rem_1fr]">
      <nav aria-label="Setup steps" className="min-w-0">
        <ol className="flex gap-2 overflow-x-auto md:flex-col md:gap-1">
          {STEPS.map((s, i) => {
            const canOpen = state.authenticated && i >= 1 && i <= reached;
            const current = i === step;
            return (
              <li key={s.key}>
                <button
                  type="button"
                  disabled={!canOpen}
                  onClick={() => setStep(i)}
                  aria-current={current ? "step" : undefined}
                  className={`flex w-full items-center gap-3 whitespace-nowrap rounded-md px-2 py-1.5 text-left text-sm ${
                    current ? "bg-surface font-semibold text-ink" : canOpen ? "text-ink hover:bg-surface" : "text-muted"
                  }`}
                >
                  <span
                    className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                      i < reached || (i === 0 && state.authenticated)
                        ? "bg-plum text-paper"
                        : current
                          ? "bg-marigold text-[#241631]"
                          : "border border-line"
                    }`}
                  >
                    {i + 1}
                  </span>
                  {s.title}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <section aria-labelledby="step-title" className="min-w-0 max-w-xl space-y-6">
        <h2 id="step-title" className="font-display text-2xl font-semibold">
          {STEPS[step].title}
        </h2>

        {step === 0 && <TokenStep onDone={() => load(1)} />}

        {step === 1 && (
          <SiteForm
            initial={state.site ?? null}
            detectedOrigin={state.detectedOrigin}
            submit={(v) => postJson("/api/install/site", v)}
            submitLabel="Save and continue"
            onSaved={next}
          />
        )}

        {step === 2 && state.redirectUris && (
          <SignInForm
            initial={state.signin ?? null}
            redirectUri={state.redirectUris.google}
            submit={(v) => postJson("/api/install/signin", v)}
            submitLabel="Save and continue"
            onSaved={next}
          />
        )}

        {step === 3 && state.redirectUris && (
          <MusicForm
            initial={{ spotify: state.spotify ?? null, tidal: state.tidal ?? null }}
            redirectUris={state.redirectUris}
            submit={(v) => postJson("/api/install/music", v)}
            submitLabel="Save and continue"
            onSaved={next}
          />
        )}

        {step === 4 && (
          <>
            <p className="text-muted">
              The weekly email with new releases{state.signin?.emailCode.enabled ? " and the sign-in codes are" : " is"} sent with
              these settings.
            </p>
            {state.signin?.emailCode.enabled && (
              <Notice tone="info">Email sign-in codes are on, so mail is required. Turn them off in the Sign-in step to set up mail later.</Notice>
            )}
            <MailForm
              initial={state.mail ?? null}
              allowSkip={!state.signin?.emailCode.enabled}
              submit={(v) => postJson("/api/install/mail", v)}
              testMail={(settings, to) => postJson("/api/install/test-mail", { settings, to })}
              submitLabel="Save and continue"
              onSaved={next}
            />
          </>
        )}

        {step === 5 && state.schedule && (
          <ScheduleForm
            initial={state.schedule}
            submit={(v) => postJson("/api/install/schedule", v)}
            submitLabel="Save and continue"
            onSaved={next}
          />
        )}

        {step === 6 && (
          <div className="space-y-4">
            <p className="text-muted">
              Sign in with your own account. It becomes the admin of this site, and setup is locked after this step. You
              connect Spotify or TIDAL right after.
            </p>
            {signinError && <Notice tone="error">Signing in did not finish. Try again.</Notice>}
            <SignIn methods={state.signInMethods ?? { google: false, emailCode: false }} callbackURL="/install/complete" />
          </div>
        )}
      </section>
    </div>
  );
}

function TokenStep({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-6"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const res = await postJson("/api/install/token", { token });
        setBusy(false);
        if (res.ok) onDone();
        else setError(res.errors.token ?? Object.values(res.errors)[0]);
      }}
    >
      <p className="text-muted">
        This page can be opened by anyone who knows the address, so setup starts with a token that only the server shows.
        Run <code className="rounded bg-surface px-1.5 py-0.5 text-sm text-ink">docker compose logs app</code> and copy the
        setup token.
      </p>
      <Field label="Setup token" htmlFor="token" error={error}>
        <TextInput
          id="token"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="font-mono"
        />
      </Field>
      <Button type="submit" disabled={busy || !token}>
        {busy ? "Checking…" : "Start setup"}
      </Button>
    </form>
  );
}
