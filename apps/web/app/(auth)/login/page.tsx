import type { Metadata } from "next";
import { Suspense } from "react";
import { signIn } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <Suspense>
      <Login searchParams={searchParams} />
    </Suspense>
  );
}

async function Login({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { error } = await searchParams;
  return (
    <AuthForm
      mode="login"
      action={signIn}
      initialError={
        error === "confirmation" ? "That confirmation link is invalid or has expired." : undefined
      }
    />
  );
}
