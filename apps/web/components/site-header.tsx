import Link from "next/link";
import { Suspense } from "react";
import { signOut } from "@/app/(auth)/actions";
import { getOptionalUser } from "@/lib/auth";

export function SiteHeader() {
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          RepoScope
        </Link>
        <Suspense>
          <Account />
        </Suspense>
      </div>
    </header>
  );
}

async function Account() {
  const user = await getOptionalUser();

  if (!user) {
    return (
      <nav className="flex items-center gap-4 text-sm">
        <Link href="/login" className="text-muted hover:text-foreground">
          Sign in
        </Link>
        <Link href="/signup" className="button-secondary">
          Create account
        </Link>
      </nav>
    );
  }

  return (
    <nav className="flex items-center gap-4 text-sm">
      <Link href="/dashboard" className="text-muted hover:text-foreground">
        Dashboard
      </Link>
      <form action={signOut}>
        <button type="submit" className="text-muted hover:text-foreground">
          Sign out
        </button>
      </form>
    </nav>
  );
}
