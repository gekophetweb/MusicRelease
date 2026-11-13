"use client";

import { useActionState } from "react";
import { Button, Field } from "@/components/ui";
import { sendReply, type ReplyState } from "@/app/suggestions/actions";

export function ReplyForm({ suggestionId }: { suggestionId: string }) {
  const [state, action, pending] = useActionState<ReplyState, FormData>(sendReply, {});
  return (
    <form key={state.attempt ?? 0} action={action} className="space-y-3">
      <input type="hidden" name="id" value={suggestionId} />
      <Field label="Reply" htmlFor="reply-message" error={state.error}>
        <textarea
          id="reply-message"
          name="message"
          required
          maxLength={2000}
          rows={4}
          defaultValue={state.message}
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink placeholder:text-muted/70 focus:border-plum focus:outline-none"
        />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send reply"}
      </Button>
    </form>
  );
}
