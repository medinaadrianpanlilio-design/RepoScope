import Link from "next/link";
import { readyExamples } from "@/lib/examples/queries";

/** Real analyses anyone can open. Shows nothing until at least one has finished. */
export async function ExampleRepositories() {
  const examples = await readyExamples().catch(() => []);
  if (examples.length === 0) return null;

  return (
    <section aria-labelledby="examples-heading" className="mt-10">
      <h2 id="examples-heading" className="text-sm font-medium">
        Or open an example
      </h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {examples.map((example) => (
          <li key={example.repositoryId}>
            <Link
              href={`/repositories/${example.repositoryId}/architecture`}
              className="block h-full rounded-md border border-line bg-card p-4 hover:border-accent"
            >
              <span className="block font-mono text-sm">{example.fullName}</span>
              <span className="mt-1 block text-sm text-muted">{example.about}</span>
              <span className="mt-2 block text-xs text-muted">
                {example.sourceFiles.toLocaleString("en-US")} source{" "}
                {example.sourceFiles === 1 ? "file" : "files"} ·{" "}
                {example.dependencies.toLocaleString("en-US")}{" "}
                {example.dependencies === 1 ? "dependency" : "dependencies"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
