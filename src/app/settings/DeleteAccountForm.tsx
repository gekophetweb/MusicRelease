"use client";

import { useActionState, useState } from "react";
import { Field, Notice, TextInput } from "@/components/ui";
import { deleteMyAccount, type DeleteState } from "./actions";

export function DeleteAccountForm() {
  const [state, action, pending] = useActionState<DeleteState, FormData>(deleteMyAccount, {});
  const [confirm, setConfirm] = useState("");
  return (
    <form action={action} className="space-y-5">
      <Field label="Type DELETE to confirm" htmlFor="confirm">
        <TextInput id="confirm" name="confirm" autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <button
        type="submit"
        disabled={confirm !== "DELETE" || pending}
        className="rounded-md bg-danger px-4 py-2 font-medium text-paper transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Deleting…" : "Delete my account"}
      </button>
    </form>
  );
}
