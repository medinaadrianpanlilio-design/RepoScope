import { Suspense } from "react";
import { ExampleRepositories } from "@/components/example-repositories";
import { ImportForm } from "@/components/import-form";

const steps = [
  {
    title: "Paste a public repository",
    body: "No account needed. RepoScope reads public GitHub repositories and never runs their code.",
  },
  {
    title: "Analysis maps the code",
    body: "Imports and exports are parsed from the source, so every connection comes from real code.",
  },
  {
    title: "Explore how it connects",
    body: "Follow dependencies on an interactive graph, and give coding agents the same knowledge.",
  },
];

export default function Home() {
  return (
    <main className="flex-1">
      <section className="mx-auto max-w-3xl px-4 pt-24 pb-16">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Understand Any Codebase. Visually.
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-muted">
          Turn GitHub repositories into interactive architecture maps. Explore dependencies,
          understand project structure, and discover how code connects.
        </p>
        <div className="mt-8">
          <ImportForm example="https://github.com/medinaadrianpanlilio-design/portfolio-site" />
        </div>
        <p className="mt-6 text-sm text-muted">
          RepoScope is in early development. JavaScript and TypeScript analysis works today; the
          interactive graph is being built next.
        </p>
        <Suspense fallback={null}>
          <ExampleRepositories />
        </Suspense>
      </section>

      <section className="border-t border-line">
        <ol className="mx-auto grid max-w-5xl gap-8 px-4 py-16 sm:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title}>
              <span className="font-mono text-sm text-accent">0{index + 1}</span>
              <h2 className="mt-2 font-medium">{step.title}</h2>
              <p className="mt-1 text-sm text-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
