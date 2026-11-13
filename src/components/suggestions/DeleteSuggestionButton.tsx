"use client";

import { Button } from "@/components/ui";
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
      <Button type="submit" variant="quiet" className="text-danger">
        Delete suggestion
      </Button>
    </form>
  );
}
