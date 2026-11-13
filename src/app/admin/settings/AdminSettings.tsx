"use client";

import { MailForm, MusicForm, postJson, ScheduleForm, SignInForm, SiteForm } from "@/components/settings/forms";
import type { EditableSettings } from "@/install/steps";

const save = (section: string) => (value: unknown) => postJson("/api/admin/settings", { section, value }, "PUT");

export function AdminSettings({
  settings,
  redirectUris,
  adminEmail,
}: {
  settings: EditableSettings;
  redirectUris: { google: string; spotify: string; tidal: string };
  adminEmail: string;
}) {
  return (
    <div className="space-y-14">
      <Section title="Site" id="site">
        <SiteForm initial={settings.site} submit={save("site")} submitLabel="Save site" />
      </Section>
      <Section title="Sign-in" id="signin">
        <SignInForm initial={settings.signin} redirectUri={redirectUris.google} submit={save("signin")} submitLabel="Save sign-in" />
      </Section>
      <Section title="Music services" id="music">
        <MusicForm
          initial={{ spotify: settings.spotify, tidal: settings.tidal }}
          redirectUris={redirectUris}
          submit={save("music")}
          submitLabel="Save music services"
        />
      </Section>
      <Section title="Mail" id="mail">
        {!settings.mail && (
          <p className="mb-4 text-sm text-muted">Mail is not set up yet, so no weekly email goes out.</p>
        )}
        <MailForm
          initial={settings.mail}
          submit={save("mail")}
          testMail={(s, to) => postJson("/api/admin/test-mail", { settings: s, to })}
          submitLabel="Save mail settings"
          defaultTestRecipient={adminEmail}
        />
      </Section>
      <Section title="Schedule" id="schedule">
        {settings.schedule && <ScheduleForm initial={settings.schedule} submit={save("schedule")} submitLabel="Save schedule" />}
      </Section>
    </div>
  );
}

function Section({ title, id, children }: { title: string; id: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`} className="max-w-xl space-y-5">
      <h2 id={`${id}-title`} className="font-display text-2xl font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}
