"use client";

import { useActionState } from "react";
import { Button, TextInput } from "@/components/ui";
import { updateUserEmail, type EmailState } from "./actions";

export function EmailForm({ userId, email, name }: { userId: string; email: string | null; name: string }) {
  const [state, action, pending] = useActionState<EmailState, FormData>(updateUserEmail, {});
  const id = `email-${userId}`;
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="userId" value={userId} />
      <div className="flex gap-2">
        <label htmlFor={id} className="sr-only">
          Email for {name}
        </label>
        <TextInput id={id} name="email" type="email" required defaultValue={email ?? ""} placeholder="name@example.com" className="min-w-0 flex-1" />
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p role="status" className="text-sm text-ok">
          Saved. They can now sign in with a code sent to this address.
        </p>
      )}
    </form>
  );
}
