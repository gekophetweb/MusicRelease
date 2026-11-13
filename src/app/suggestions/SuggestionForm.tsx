"use client";

import { useActionState, useState } from "react";
import { Button, Field } from "@/components/ui";
import { sendSuggestion, type SuggestionState } from "./actions";

const KINDS = [
  { value: "idea", label: "Idea", hint: "Something that would make the site better" },
  { value: "problem", label: "Problem", hint: "Something that doesn't work or is confusing" },
] as const;

/** "Send another" remounts the form with fresh state, keeping the page the user came from. */
export function SuggestionForm({ page }: { page: string | null }) {
  const [round, setRound] = useState(0);
  return <SuggestionFormRound key={round} page={page} onAnother={() => setRound(round + 1)} />;
}

function SuggestionFormRound({ page, onAnother }: { page: string | null; onAnother: () => void }) {
  const [state, action, pending] = useActionState<SuggestionState, FormData>(sendSuggestion, {});
  if (state.ok) {
    return (
      <div role="status" className="space-y-3 rounded-lg border border-ok/40 px-5 py-4">
        <p className="text-ok">Thanks! The admin will read this. You can follow it under My suggestions.</p>
        <Button type="button" variant="quiet" className="px-0" onClick={onAnother}>
          Send another
        </Button>
      </div>
    );
  }
  return (
    <form key={state.attempt ?? 0} action={action} className="space-y-5">
      <input type="hidden" name="page" value={page ?? ""} />
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">What is it?</legend>
        {KINDS.map((k, i) => (
          <label key={k.value} className="flex cursor-pointer items-start gap-3 rounded-md border border-line bg-surface px-4 py-3 has-[:checked]:border-plum">
            <input type="radio" name="kind" value={k.value} defaultChecked={state.kind ? state.kind === k.value : i === 0} className="mt-1 accent-plum" />
            <span>
              <span className="block font-medium">{k.label}</span>
              <span className="block text-sm text-muted">{k.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <Field label="Message" htmlFor="suggestion-message" error={state.error}>
        <textarea
          id="suggestion-message"
          name="message"
          required
          maxLength={2000}
          rows={6}
          defaultValue={state.message}
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink placeholder:text-muted/70 focus:border-plum focus:outline-none"
        />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send suggestion"}
      </Button>
    </form>
  );
}
