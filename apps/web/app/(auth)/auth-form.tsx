"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { AuthState } from "./actions";

type Props = {
  mode: "login" | "signup";
  action: (state: AuthState, formData: FormData) => Promise<AuthState>;
  initialError?: string;
};

export function AuthForm({ mode, action, initialError }: Props) {
  const [state, formAction, pending] = useActionState(action, { error: initialError });
  const isLogin = mode === "login";

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold">
          {isLogin ? "Sign in to RepoScope" : "Create your account"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {isLogin
            ? "Your saved repositories are on your dashboard."
            : "An account saves repositories to your dashboard."}
        </p>

        <form action={formAction} className="mt-6 space-y-4">
          <label className="block text-sm">
            <span className="text-muted">Email</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              className="field mt-1"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">Password</span>
            <input
              name="password"
              type="password"
              required
              minLength={8}
              maxLength={72}
              autoComplete={isLogin ? "current-password" : "new-password"}
              className="field mt-1"
            />
          </label>

          {state.error && (
            <p role="alert" className="text-sm text-danger">
              {state.error}
            </p>
          )}
          {state.notice && (
            <p role="status" className="text-sm text-accent">
              {state.notice}
            </p>
          )}

          <button type="submit" disabled={pending} className="button-primary w-full">
            {pending ? "Working…" : isLogin ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-sm text-muted">
          {isLogin ? "New here? " : "Already have an account? "}
          <Link href={isLogin ? "/signup" : "/login"} className="text-accent hover:underline">
            {isLogin ? "Create an account" : "Sign in"}
          </Link>
        </p>
      </div>
    </main>
  );
}
