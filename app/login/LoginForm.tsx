"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const response = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!response.ok) {
      setError("Incorrect password");
      return;
    }
    router.push(search.get("next") || "/");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-sm items-center px-5">
      <form onSubmit={submit} className="w-full space-y-4">
        <h1 className="text-2xl font-semibold">Enter the playground</h1>
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="h-12 w-full rounded-lg border border-border bg-card px-3 text-foreground" placeholder="Password" autoComplete="current-password" required />
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        <button className="h-12 w-full rounded-lg bg-primary px-4 text-white">Unlock</button>
      </form>
    </main>
  );
}
