"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ManualSearch({ disabled, onSearch }: { disabled: boolean; onSearch: (name: string) => void }) {
  const [query, setQuery] = useState("");
  return (
    <form
      role="search"
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (query.trim().length >= 2) onSearch(query.trim());
      }}
    >
      <label className="flex-1">
        <span className="sr-only">Card name</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Type a card name"
          autoComplete="off"
          enterKeyHint="search"
          maxLength={80}
          className="h-11 w-full rounded-lg border border-border bg-card px-3"
        />
      </label>
      <Button type="submit" disabled={disabled || query.trim().length < 2}>Search</Button>
    </form>
  );
}
