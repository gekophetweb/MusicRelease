"use client";

import { useCallback, useEffect, useState } from "react";
import { ConnectButtons } from "@/components/ConnectButtons";
import { MailForm, MusicForm, postJson, ScheduleForm, SiteForm } from "@/components/settings/forms";
import { Button, Field, Notice, TextInput } from "@/components/ui";
import type { MailSettings } from "@/mail/types";
import type { OAuthAppSettings, ScheduleSettings, SiteSettings } from "@/lib/settings";

interface InstallState {
  authenticated: boolean;
  detectedOrigin?: string;
  redirectUris?: { spotify: string; tidal: string };
  enabledProviders?: Array<"spotify" | "tidal">;
  completedStep?: number;
  mailSkipped?: boolean;
  site?: SiteSettings | null;
  spotify?: OAuthAppSettings | null;
  tidal?: OAuthAppSettings | null;
  mail?: MailSettings | null;
  schedule?: ScheduleSettings;
}

const STEPS = [
  { key: "token", title: "Setup token" },
  { key: "site", title: "Site" },
  { key: "music", title: "Music services" },
  { key: "mail", title: "Mail" },
  { key: "schedule", title: "Schedule" },
  { key: "admin", title: "Your account" },
] as const;

export function InstallWizard({ signinError }: { signinError: boolean }) {
  const [state, setState] = useState<InstallState | null>(null);
  const [step, setStep] = useState(0);

  const load = useCallback(async (advanceTo?: number) => {
    const s = (await (await fetch("/api/install/state", { cache: "no-store" })).json()) as InstallState;
    setState(s);
    if (!s.authenticated) setStep(0);
    else if (advanceTo !== undefined) setStep(advanceTo);
    else setStep(Math.min(Math.max(s.completedStep ?? 1, 1), STEPS.length - 1));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!state) return <p className="text-muted">Loading…</p>;
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
          <MusicForm
            initial={{ spotify: state.spotify ?? null, tidal: state.tidal ?? null }}
            redirectUris={state.redirectUris}
            submit={(v) => postJson("/api/install/music", v)}
            submitLabel="Save and continue"
            onSaved={next}
          />
        )}

        {step === 3 && (
          <>
            <p className="text-muted">The weekly email with new releases is sent with these settings.</p>
            <MailForm
              initial={state.mail ?? null}
              allowSkip
              submit={(v) => postJson("/api/install/mail", v)}
              testMail={(settings, to) => postJson("/api/install/test-mail", { settings, to })}
              submitLabel="Save and continue"
              onSaved={next}
            />
          </>
        )}

        {step === 4 && state.schedule && (
          <ScheduleForm
            initial={state.schedule}
            submit={(v) => postJson("/api/install/schedule", v)}
            submitLabel="Save and continue"
            onSaved={next}
          />
        )}

        {step === 5 && (
          <div className="space-y-4">
            <p className="text-muted">
              Connect your own music account. That account becomes the admin of this site, and setup is locked after this
              step.
            </p>
            {signinError && <Notice tone="error">Connecting did not finish. Try again.</Notice>}
            <ConnectButtons providers={state.enabledProviders ?? []} callbackURL="/install/complete" />
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
