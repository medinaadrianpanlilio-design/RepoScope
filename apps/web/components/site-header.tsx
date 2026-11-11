import Link from "next/link";
import { Suspense } from "react";
import { signOut } from "@/app/(auth)/actions";
import { getOptionalUser } from "@/lib/auth";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 md:px-8">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center gap-2 font-mono text-[17px] font-bold tracking-tight"
        >
          <BrandMark />
          RepoScope
        </Link>
        <Suspense>
          <Account />
        </Suspense>
      </div>
    </header>
  );
}

/** Three files and the imports between them. */
function BrandMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={24}
      height={24}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-accent"
      aria-hidden
    >
      <circle cx="6" cy="6" r="3" />
      <circle cx="18" cy="12" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M9 6h2a4 4 0 0 1 4 4M9 18h2a4 4 0 0 0 4-4" />
    </svg>
  );
}

const quietLink =
  "inline-flex min-h-11 items-center px-2 font-medium whitespace-nowrap text-muted transition-colors duration-150 hover:text-foreground";

async function Account() {
  const user = await getOptionalUser();

  if (!user) {
    return (
      <nav aria-label="Account" className="flex items-center gap-2 text-sm">
        <Link href="/login" className={quietLink}>
          Sign in
        </Link>
        <Link href="/signup" className="button-primary">
          Create account
        </Link>
      </nav>
    );
  }

  return (
    <nav aria-label="Account" className="flex items-center gap-2 text-sm">
      <Link href="/dashboard" className={quietLink}>
        Dashboard
      </Link>
      <form action={signOut}>
        <button type="submit" className="button-secondary">
          Sign out
        </button>
      </form>
    </nav>
  );
}
