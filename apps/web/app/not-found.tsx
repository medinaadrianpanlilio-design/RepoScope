import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-24 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="mt-1 text-sm text-muted">That page or repository doesn&apos;t exist.</p>
      <Link href="/" className="mt-4 text-sm text-accent hover:underline">
        Back to RepoScope
      </Link>
    </main>
  );
}
