"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Button, CopyField, Field, Notice, Select, TextInput, Toggle } from "@/components/ui";
import { describeSchedule, fromDailyCron, fromWeeklyCron, toDailyCron, toWeeklyCron, WEEKDAYS } from "@/install/cron-ui";
import type { MailSettings } from "@/mail/types";
import type { OAuthAppSettings, ScheduleSettings, SiteSettings } from "@/lib/settings";
import { PROVIDER_SCOPES } from "@/providers/scopes";

export type Result = { ok: true } | { ok: false; errors: Record<string, string> };
type Submit<T> = (value: T) => Promise<Result>;

function useSubmit<T>(submit: Submit<T>, onSaved?: () => void) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  async function run(value: T) {
    setBusy(true);
    setSaved(false);
    try {
      const res = await submit(value);
      if (res.ok) {
        setErrors({});
        setSaved(true);
        onSaved?.();
      } else setErrors(res.errors);
    } catch {
      setErrors({ form: "Could not reach the server. Check that the app is running and try again." });
    } finally {
      setBusy(false);
    }
  }
  return { errors, busy, saved, run };
}

function FormShell({
  onSubmit,
  children,
  errors,
  busy,
  saved,
  submitLabel,
  footer,
  submitDisabled,
}: {
  onSubmit: () => void;
  children: ReactNode;
  errors: Record<string, string>;
  busy: boolean;
  saved: boolean;
  submitLabel: string;
  footer?: ReactNode;
  submitDisabled?: boolean;
}) {
  const general = errors.form ?? errors.session ?? errors.services ?? errors.mail;
  return (
    <form
      className="space-y-6"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {children}
      {general && <Notice tone="error">{general}</Notice>}
      {saved && !general && <Notice tone="ok">Saved.</Notice>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy || submitDisabled}>
          {busy ? "Saving…" : submitLabel}
        </Button>
        {footer}
      </div>
    </form>
  );
}

// ---------------- Site ----------------

export function SiteForm({
  initial,
  detectedOrigin,
  submit,
  submitLabel,
  onSaved,
}: {
  initial: SiteSettings | null;
  detectedOrigin?: string;
  submit: Submit<SiteSettings>;
  submitLabel: string;
  onSaved?: () => void;
}) {
  const [v, setV] = useState<SiteSettings>(
    initial ?? { publicUrl: detectedOrigin ?? "", siteName: "MusicReleases", allowSignups: false },
  );
  const { errors, busy, saved, run } = useSubmit(submit, onSaved);
  return (
    <FormShell onSubmit={() => run(v)} errors={errors} busy={busy} saved={saved} submitLabel={submitLabel}>
      <Field
        label="Public URL"
        htmlFor="publicUrl"
        error={errors.publicUrl}
        hint="The address people open, for example https://releases.example.com. Spotify and TIDAL send people back here after they connect."
      >
        <TextInput
          id="publicUrl"
          type="url"
          required
          value={v.publicUrl}
          onChange={(e) => setV({ ...v, publicUrl: e.target.value })}
        />
      </Field>
      <Field label="Site name" htmlFor="siteName" error={errors.siteName}>
        <TextInput id="siteName" required value={v.siteName} onChange={(e) => setV({ ...v, siteName: e.target.value })} />
      </Field>
      <Toggle
        id="allowSignups"
        checked={v.allowSignups}
        onChange={(allowSignups) => setV({ ...v, allowSignups })}
        label="Let other people sign up"
        description="When off, only you (the admin) can use this site. Turn it on to share it with family or friends."
      />
    </FormShell>
  );
}

// ---------------- Music services ----------------

type MusicValue = { spotify: OAuthAppSettings; tidal: OAuthAppSettings };
const emptyApp: OAuthAppSettings = { enabled: false, clientId: "", clientSecret: "" };

const SERVICES = {
  spotify: {
    name: "Spotify",
    dashboard: "https://developer.spotify.com/dashboard",
    steps: "Create an app, choose Web API, and paste the redirect URI below. In Development Mode, add each listener's Spotify email under User Management.",
    permissionsHint: "Nothing to tick in the dashboard: Spotify asks each listener to approve these when they sign in.",
  },
  tidal: {
    name: "TIDAL",
    dashboard: "https://developer.tidal.com/dashboard",
    steps: "Create an app and add the redirect URI below.",
    permissionsHint: "Enable these scopes in your app's settings in the TIDAL dashboard, otherwise sign-in fails.",
  },
} as const;

export function MusicForm({
  initial,
  redirectUris,
  submit,
  submitLabel,
  onSaved,
}: {
  initial: { spotify: OAuthAppSettings | null; tidal: OAuthAppSettings | null };
  redirectUris: { spotify: string; tidal: string };
  submit: Submit<MusicValue>;
  submitLabel: string;
  onSaved?: () => void;
}) {
  const [v, setV] = useState<MusicValue>({ spotify: initial.spotify ?? emptyApp, tidal: initial.tidal ?? emptyApp });
  const { errors, busy, saved, run } = useSubmit(submit, onSaved);
  return (
    <FormShell onSubmit={() => run(v)} errors={errors} busy={busy} saved={saved} submitLabel={submitLabel}>
      {(["spotify", "tidal"] as const).map((key) => {
        const s = v[key];
        const meta = SERVICES[key];
        const set = (patch: Partial<OAuthAppSettings>) => setV({ ...v, [key]: { ...s, ...patch } });
        return (
          <fieldset key={key} className="space-y-4 rounded-lg border border-line bg-surface p-4">
            <legend className="px-1 font-display text-lg font-semibold">{meta.name}</legend>
            <Toggle id={`${key}-enabled`} checked={s.enabled} onChange={(enabled) => set({ enabled })} label={`Use ${meta.name}`} />
            {s.enabled && (
              <div className="space-y-4">
                <p className="text-sm text-muted">
                  Open the{" "}
                  <a href={meta.dashboard} target="_blank" rel="noreferrer" className="text-plum underline underline-offset-2">
                    {meta.name} developer dashboard
                  </a>
                  . {meta.steps}
                </p>
                <div className="space-y-1.5">
                  <p id={`${key}-scopes-label`} className="text-sm font-medium">
                    Permissions (scopes)
                  </p>
                  <ul aria-labelledby={`${key}-scopes-label`} className="space-y-1 text-sm">
                    {PROVIDER_SCOPES[key].map((s) => (
                      <li key={s.scope}>
                        <code className="rounded bg-paper px-1.5 py-0.5 font-mono text-xs">{s.scope}</code>{" "}
                        <span className="text-muted">to {s.reason}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-sm text-muted">{meta.permissionsHint}</p>
                </div>
                <Field label="Redirect URI" htmlFor={`${key}-redirect`}>
                  <CopyField id={`${key}-redirect`} value={redirectUris[key]} />
                </Field>
                <Field label="Client ID" htmlFor={`${key}-clientId`} error={errors[`${key}.clientId`]}>
                  <TextInput id={`${key}-clientId`} value={s.clientId} onChange={(e) => set({ clientId: e.target.value })} autoComplete="off" />
                </Field>
                <Field label="Client secret" htmlFor={`${key}-clientSecret`} error={errors[`${key}.clientSecret`]}>
                  <TextInput
                    id={`${key}-clientSecret`}
                    type="password"
                    value={s.clientSecret}
                    onChange={(e) => set({ clientSecret: e.target.value })}
                    onFocus={(e) => e.target.value === "••••••" && set({ clientSecret: "" })}
                    autoComplete="off"
                  />
                </Field>
              </div>
            )}
          </fieldset>
        );
      })}
    </FormShell>
  );
}

// ---------------- Mail ----------------

const MAIL_DEFAULTS: Record<MailSettings["provider"], MailSettings> = {
  resend: { provider: "resend", from: { email: "", name: "MusicReleases" }, apiKey: "" },
  mailgun: { provider: "mailgun", from: { email: "", name: "MusicReleases" }, domain: "", apiKey: "", region: "eu" },
  smtp: { provider: "smtp", from: { email: "", name: "MusicReleases" }, host: "", port: 587, security: "starttls", user: "", pass: "" },
};
const SMTP_PORTS = { tls: 465, starttls: 587, none: 25 } as const;

function SecretInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <TextInput
      id={id}
      type="password"
      autoComplete="off"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => value === "••••••" && onChange("")}
    />
  );
}

export function MailForm({
  initial,
  submit,
  testMail,
  submitLabel,
  allowSkip,
  onSaved,
  defaultTestRecipient,
}: {
  initial: MailSettings | null;
  submit: Submit<{ skip: boolean; settings?: MailSettings }>;
  testMail: (settings: MailSettings, to: string) => Promise<Result>;
  submitLabel: string;
  allowSkip?: boolean;
  onSaved?: () => void;
  defaultTestRecipient?: string;
}) {
  const [v, setV] = useState<MailSettings>(initial && initial.provider in MAIL_DEFAULTS ? initial : MAIL_DEFAULTS.resend);
  const [skip, setSkip] = useState(false);
  const [to, setTo] = useState(defaultTestRecipient ?? "");
  const [tested, setTested] = useState<string | null>(initial ? JSON.stringify(initial) : null);
  const [testState, setTestState] = useState<{ busy: boolean; error?: string; ok?: boolean }>({ busy: false });
  const { errors, busy, saved, run } = useSubmit(submit, onSaved);
  const current = JSON.stringify(v);
  const testPassed = tested === current;
  const e = (k: string) => errors[`mail.${k}`];

  const set = (patch: Partial<MailSettings>) => setV({ ...v, ...patch } as MailSettings);

  async function sendTest() {
    setTestState({ busy: true });
    const res = await testMail(v, to).catch(() => ({ ok: false as const, errors: { mail: "Could not reach the server." } }));
    if (res.ok) {
      setTested(current);
      setTestState({ busy: false, ok: true });
    } else {
      setTestState({ busy: false, error: Object.values(res.errors)[0] });
    }
  }

  return (
    <FormShell
      onSubmit={() => run(skip ? { skip: true } : { skip: false, settings: v })}
      errors={errors}
      busy={busy}
      saved={saved}
      submitLabel={submitLabel}
      submitDisabled={!skip && !testPassed}
    >
      {allowSkip && (
        <Toggle
          id="mail-skip"
          checked={skip}
          onChange={setSkip}
          label="Set up mail later"
          description="The weekly email stays off until mail works. You can add it later under Admin settings."
        />
      )}
      {!skip && (
        <>
          <Field label="Send mail with" htmlFor="mail-provider">
            <Select
              id="mail-provider"
              value={v.provider}
              onChange={(ev) => {
                const p = ev.target.value as MailSettings["provider"];
                setV({ ...MAIL_DEFAULTS[p], from: v.from } as MailSettings);
              }}
            >
              <option value="resend">Resend</option>
              <option value="mailgun">Mailgun</option>
              <option value="smtp">Custom SMTP server</option>
            </Select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="From name" htmlFor="mail-from-name" error={e("from.name")}>
              <TextInput id="mail-from-name" value={v.from.name ?? ""} onChange={(ev) => set({ from: { ...v.from, name: ev.target.value } })} />
            </Field>
            <Field label="From email" htmlFor="mail-from-email" error={e("from.email")}>
              <TextInput
                id="mail-from-email"
                type="email"
                required
                value={v.from.email}
                onChange={(ev) => set({ from: { ...v.from, email: ev.target.value } })}
              />
            </Field>
          </div>

          {v.provider === "resend" && (
            <Field
              label="Resend API key"
              htmlFor="mail-resend-key"
              error={e("apiKey")}
              hint="Create one in Resend under API Keys. The from email's domain must be verified under Domains."
            >
              <SecretInput id="mail-resend-key" value={v.apiKey} onChange={(apiKey) => set({ apiKey })} />
            </Field>
          )}

          {v.provider === "mailgun" && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Sending domain" htmlFor="mail-mg-domain" error={e("domain")} hint="For example mg.example.com">
                  <TextInput id="mail-mg-domain" value={v.domain} onChange={(ev) => set({ domain: ev.target.value })} />
                </Field>
                <Field label="Region" htmlFor="mail-mg-region">
                  <Select id="mail-mg-region" value={v.region} onChange={(ev) => set({ region: ev.target.value as "us" | "eu" })}>
                    <option value="eu">EU</option>
                    <option value="us">US</option>
                  </Select>
                </Field>
              </div>
              <Field label="Mailgun API key" htmlFor="mail-mg-key" error={e("apiKey")}>
                <SecretInput id="mail-mg-key" value={v.apiKey} onChange={(apiKey) => set({ apiKey })} />
              </Field>
            </>
          )}

          {v.provider === "smtp" && (
            <>
              <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
                <Field label="SMTP host" htmlFor="mail-smtp-host" error={e("host")}>
                  <TextInput id="mail-smtp-host" value={v.host} onChange={(ev) => set({ host: ev.target.value })} />
                </Field>
                <Field label="Port" htmlFor="mail-smtp-port" error={e("port")}>
                  <TextInput
                    id="mail-smtp-port"
                    type="number"
                    value={v.port}
                    onChange={(ev) => set({ port: Number(ev.target.value) })}
                  />
                </Field>
              </div>
              <Field label="Encryption" htmlFor="mail-smtp-security">
                <Select
                  id="mail-smtp-security"
                  value={v.security}
                  onChange={(ev) => {
                    const security = ev.target.value as keyof typeof SMTP_PORTS;
                    set({ security, port: SMTP_PORTS[security] });
                  }}
                >
                  <option value="starttls">STARTTLS (usually port 587)</option>
                  <option value="tls">TLS (usually port 465)</option>
                  <option value="none">None (only for a local relay)</option>
                </Select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Username" htmlFor="mail-smtp-user">
                  <TextInput id="mail-smtp-user" autoComplete="off" value={v.user ?? ""} onChange={(ev) => set({ user: ev.target.value })} />
                </Field>
                <Field label="Password" htmlFor="mail-smtp-pass">
                  <SecretInput id="mail-smtp-pass" value={v.pass ?? ""} onChange={(pass) => set({ pass })} />
                </Field>
              </div>
            </>
          )}

          <div className="space-y-3 rounded-lg border border-line bg-surface p-4">
            <Field label="Send a test email to" htmlFor="mail-test-to">
              <TextInput id="mail-test-to" type="email" value={to} onChange={(ev) => setTo(ev.target.value)} />
            </Field>
            <Button type="button" variant="secondary" disabled={testState.busy || !to} onClick={sendTest}>
              {testState.busy ? "Sending…" : "Send test email"}
            </Button>
            {testState.error && <Notice tone="error">{testState.error}</Notice>}
            {testPassed && testState.ok && <Notice tone="ok">Test email sent. Check the inbox of {to}.</Notice>}
            {!testPassed && <p className="text-sm text-muted">Send a test email with these settings before saving.</p>}
          </div>
        </>
      )}
    </FormShell>
  );
}

// ---------------- Schedule ----------------

export function ScheduleForm({
  initial,
  submit,
  submitLabel,
  onSaved,
}: {
  initial: ScheduleSettings;
  submit: Submit<ScheduleSettings>;
  submitLabel: string;
  onSaved?: () => void;
}) {
  const daily = fromDailyCron(initial.syncCron) ?? { time: "06:00" };
  const weekly = fromWeeklyCron(initial.digestCron) ?? { day: 5, time: "18:00" };
  const [syncTime, setSyncTime] = useState(daily.time);
  const [digestDay, setDigestDay] = useState(weekly.day);
  const [digestTime, setDigestTime] = useState(weekly.time);
  const [timezone, setTimezone] = useState(initial.timezone);
  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return [initial.timezone];
    }
  }, [initial.timezone]);
  const value: ScheduleSettings = { syncCron: toDailyCron(syncTime), digestCron: toWeeklyCron(digestDay, digestTime), timezone };
  const { errors, busy, saved, run } = useSubmit(submit, onSaved);

  return (
    <FormShell onSubmit={() => run(value)} errors={errors} busy={busy} saved={saved} submitLabel={submitLabel}>
      <Field label="Check for new releases every day at" htmlFor="syncTime" error={errors.syncCron}>
        <TextInput id="syncTime" type="time" required value={syncTime} onChange={(e) => setSyncTime(e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Send the weekly email on" htmlFor="digestDay" error={errors.digestCron}>
          <Select id="digestDay" value={digestDay} onChange={(e) => setDigestDay(Number(e.target.value))}>
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="At" htmlFor="digestTime">
          <TextInput id="digestTime" type="time" required value={digestTime} onChange={(e) => setDigestTime(e.target.value)} />
        </Field>
      </div>
      <Field label="Timezone" htmlFor="timezone" error={errors.timezone}>
        <Select id="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </Select>
      </Field>
      <p className="text-sm text-muted">{describeSchedule(value)}</p>
    </FormShell>
  );
}

// ---------------- helpers for callers ----------------

export async function postJson(url: string, body: unknown, method = "POST"): Promise<Result> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({ ok: false, errors: { form: `Request failed (${res.status})` } }))) as Result;
  return data;
}
