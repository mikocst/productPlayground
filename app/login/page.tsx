"use client";

import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="mx-auto min-h-[70vh] max-w-sm px-5" />}>
      <LoginForm />
    </Suspense>
  );
}
