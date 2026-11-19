"use client";

import { useActionState } from "react";
import { deleteUser, type DeleteUserState } from "./actions";

export function DeleteUserButton({ userId, name }: { userId: string; name: string }) {
  const [state, action, pending] = useActionState<DeleteUserState, FormData>(deleteUser, {});
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`Delete ${name || "this user"} and all their data? This can't be undone.`)) e.preventDefault();
      }}
      className="space-y-1"
    >
      <input type="hidden" name="userId" value={userId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md px-3 py-1.5 text-sm font-medium text-danger underline-offset-4 hover:underline disabled:opacity-50"
      >
        {pending ? "Deleting…" : "Delete"}
      </button>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
