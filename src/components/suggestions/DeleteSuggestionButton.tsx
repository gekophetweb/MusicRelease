"use client";

import { removeSuggestion } from "@/app/suggestions/actions";

export function DeleteSuggestionButton({ id }: { id: string }) {
  return (
    <form
      action={removeSuggestion}
      onSubmit={(e) => {
        if (!window.confirm("Delete this suggestion and its conversation? This can't be undone.")) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="rounded-md px-4 py-2 text-sm font-medium text-danger underline-offset-4 hover:underline">
        Delete suggestion
      </button>
    </form>
  );
}
