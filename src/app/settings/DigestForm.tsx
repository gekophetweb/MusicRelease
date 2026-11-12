"use client";

import { useActionState, useState } from "react";
import { Button, Field, Notice, TextInput, Toggle } from "@/components/ui";
import { saveDigestSettings, type SaveState } from "./actions";

export function DigestForm({ email, enabled, mailConfigured }: { email: string; enabled: boolean; mailConfigured: boolean }) {
  const [state, action, pending] = useActionState<SaveState, FormData>(saveDigestSettings, {});
  const [on, setOn] = useState(enabled);
  return (
    <form action={action} className="space-y-5">
      <Toggle
        id="digestEnabled"
        checked={on}
        onChange={setOn}
        label="Send me the weekly email"
        description="A list of the albums and singles released in the past week, with links to listen."
      />
      <input type="hidden" name="digestEnabled" value={on ? "on" : "off"} />
      <Field
        label="Email address"
        htmlFor="digestEmail"
        error={state.errors?.digestEmail}
        hint={email ? undefined : "Your music service did not share an email address, so enter one to get the weekly email."}
      >
        <TextInput id="digestEmail" name="digestEmail" type="email" defaultValue={email} autoComplete="email" />
      </Field>
      {!mailConfigured && <Notice tone="info">The site admin has not set up mail yet, so no emails go out for now.</Notice>}
      {state.ok && <Notice tone="ok">Saved.</Notice>}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save email settings"}
      </Button>
    </form>
  );
}
