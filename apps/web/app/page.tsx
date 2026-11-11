import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { ImportForm } from "@/components/import-form";
import { FileNode } from "@/components/landing/file-node";
import { GraphClip } from "@/components/landing/graph-clip";
import { HeroPicture } from "@/components/landing/hero-picture";
import { Languages } from "@/components/landing/languages";
import { LayoutShowcase } from "@/components/landing/layout-showcase";
import { Reveal } from "@/components/landing/reveal";
import { readyExamples, type ReadyExample } from "@/lib/examples/queries";
import "./landing.css";

/**
 * Real files from pmndrs/zustand's analysis, with the counts RepoScope found: how many files use
 * each one, and how many it uses. They make the band that crosses the page.
 */
const ZUSTAND_FILES = [
  { name: "vanilla.ts", incoming: 17, outgoing: 0 },
  { name: "index.ts", incoming: 11, outgoing: 2 },
  { name: "middleware.ts", incoming: 8, outgoing: 6 },
  { name: "devtools.ts", incoming: 2, outgoing: 1 },
  { name: "immer.ts", incoming: 2, outgoing: 1 },
  { name: "shallow.ts", incoming: 2, outgoing: 2 },
  { name: "traditional.ts", incoming: 2, outgoing: 1 },
  { name: "combine.ts", incoming: 1, outgoing: 1 },
  { name: "persist.ts", incoming: 1, outgoing: 1 },
  { name: "redux.ts", incoming: 1, outgoing: 2 },
  { name: "ssrSafe.ts", incoming: 1, outgoing: 1 },
  { name: "react.ts", incoming: 1, outgoing: 1 },
];

/** Pictures of each example's real graph, taken from RepoScope itself. */
const EXAMPLE_PICTURES: Record<string, { src: string; layout: string; kind: string }> = {
  "vercel/ms": { src: "/landing/example-ms.webp", layout: "layered", kind: "Tiny library" },
  "sindresorhus/ky": { src: "/landing/example-ky.webp", layout: "layered", kind: "HTTP client" },
  "pmndrs/zustand": { src: "/landing/example-zustand.webp", layout: "by folder", kind: "React state" },
  "colinhacks/zod": { src: "/landing/example-zod.webp", layout: "by folder, closed", kind: "Monorepo" },
};

export default function Home() {
  return (
    <main id="main" tabIndex={-1} className="landing">
      <Reveal />
      <Hero />
      <Suspense fallback={<LayoutShowcase kyHref={null} />}>
        <ShowcaseWithExample />
      </Suspense>
      <HowItWorks />
      <Features />
      <NodeBand />
      <LanguagesSection />
      <Suspense fallback={null}>
        <Examples />
      </Suspense>
      <Closing />
      <Footer />
    </main>
  );
}

async function examplesOrNone(): Promise<ReadyExample[]> {
  return readyExamples().catch(() => []);
}

function Hero() {
  return (
    <section aria-labelledby="hero-heading" className="hero" id="analyze">
      <div className="hero-card">
        <div className="hero-band" aria-hidden>
          {ZUSTAND_FILES.slice(0, 6).map((file) => (
            <FileNode key={file.name} name={file.name} language="TypeScript" />
          ))}
        </div>
        <div className="hero-body">
          <h1 id="hero-heading" className="type-xl">
            See how code connects
          </h1>
          <p className="hero-lede">
            Paste a public GitHub repository. RepoScope reads every import, never runs the code, and maps which
            files depend on which.
          </p>
          <div className="hero-form">
            <ImportForm example="https://github.com/pmndrs/zustand" />
          </div>
          <nav aria-label="On this page" className="hero-links">
            <a href="#how">How it works</a>
            <a href="#languages">Languages</a>
            <a href="#examples">Examples</a>
          </nav>
        </div>
      </div>
      <div className="hero-room">
        <HeroPicture />
      </div>
    </section>
  );
}

async function ShowcaseWithExample() {
  const ky = (await examplesOrNone()).find((example) => example.fullName === "sindresorhus/ky");
  return <LayoutShowcase kyHref={ky ? `/repositories/${ky.repositoryId}/architecture` : null} />;
}

/** One real run of sindresorhus/ky, shown at each step. */
const STEPS = [
  {
    clause: "First it downloads the code, and never runs it.",
    status: "Fetching",
    detail: "Reading the archive from GitHub",
    done: 1,
  },
  {
    clause: "Then it reads every import in every file.",
    status: "Parsing",
    detail: "98 source files",
    done: 2,
  },
  {
    clause: "Then each import is matched to a real file.",
    status: "Resolving",
    detail: "Paths, tsconfig aliases and packages",
    done: 3,
  },
  {
    clause: "Then the map is yours, and it stays current.",
    status: "Completed",
    detail: "98 files · 184 dependencies · no cycles",
    done: 4,
  },
];

function HowItWorks() {
  return (
    <section aria-labelledby="how-heading" id="how" className="steps reveal">
      {STEPS.map((step, index) => (
        <div key={step.status} className="step">
          {index === 0 && (
            <h2 id="how-heading" className="step-heading type-m">
              How it works
            </h2>
          )}
          <div data-ui className="run-card" role="img" aria-label={`Analysis of sindresorhus/ky: ${step.status}, ${step.detail}`}>
            <span className="run-card-repo">sindresorhus/ky</span>
            <span className="run-card-status">
              <span className={`run-card-light ${step.done === 4 ? "is-done" : ""}`} />
              {step.status}
            </span>
            <span className="run-card-detail">{step.detail}</span>
            <span className="run-card-track">
              {[1, 2, 3, 4].map((part) => (
                <span key={part} className={part <= step.done ? "is-filled" : ""} />
              ))}
            </span>
          </div>
          <p className="step-clause type-m">{step.clause}</p>
        </div>
      ))}
    </section>
  );
}

function Features() {
  return (
    <section aria-labelledby="features-heading" className="board reveal">
      <div className="tile tile-heading">
        <h2 id="features-heading" className="type-l">
          Facts, not guesses
        </h2>
        <p className="tile-heading-text">
          Every line on the map is an import RepoScope found in the source. What it can&apos;t match to a file, it
          lists instead of guessing.
        </p>
      </div>

      <div className="tile tile-wide tile-tall tile-clip">
        <GraphClip />
        <TileCaption title="Follow every import" text="Pick a file to see what it uses and everything that uses it." />
      </div>

      <div className="tile tile-narrow tile-tall tile-field-2">
        <div className="tile-macro tile-macro-stack" data-ui>
          <FileNode name="middleware.ts" language="TypeScript" state="impacted" />
          <FileNode name="index.ts" language="TypeScript" state="impacted" />
        </div>
        <TileCaption title="See what a change reaches" text="Every file that depends on it, nearest first." />
      </div>

      <div className="tile tile-narrow tile-tall tile-field-3">
        <div className="tile-macro" data-ui>
          <span className="ui-chip ui-chip-private">Private</span>
        </div>
        <TileCaption title="Private repositories" text="Through a read-only GitHub App you choose repositories for." />
      </div>

      <div className="tile tile-narrow tile-short tile-field-2">
        <div className="tile-macro" data-ui>
          <code className="ui-code">get_file_context</code>
        </div>
        <TileCaption title="The same map for agents" text="Coding agents ask over MCP before they edit." />
      </div>

      <div className="tile tile-narrow tile-short tile-field-1">
        <div className="tile-macro" data-ui>
          <span className="ui-chip ui-chip-ai">Summarize this file</span>
        </div>
        <TileCaption title="AI on your computer" text="A local model explains files. The facts stay the analysis's." />
      </div>

      <div className="tile tile-wide tile-short tile-field-3">
        <div className="tile-macro" data-ui>
          <span className="ui-cycle">
            <FileNode name="core.ts" language="TypeScript" />
            <span className="ui-cycle-arrows" aria-hidden>
              ⇄
            </span>
            <FileNode name="util.ts" language="TypeScript" />
          </span>
        </div>
        <TileCaption title="Import cycles, found" text="colinhacks/zod has one, between these two files." />
      </div>

      <div className="tile tile-wide tile-short tile-field-2">
        <div className="tile-macro" data-ui>
          <code className="ui-code">app/** must not import lib/db/**</code>
        </div>
        <TileCaption title="Rules you write" text="Checked against every real import, every time it syncs." />
      </div>
    </section>
  );
}

function TileCaption({ title, text }: { title: string; text: string }) {
  return (
    <p className="tile-caption">
      <span className="tile-caption-title">{title}</span>
      <span className="tile-caption-text">{text}</span>
    </p>
  );
}

/** The one full-width band: real zustand files, crossing the page like a row of the graph. */
function NodeBand() {
  return (
    <div className="node-band" aria-hidden>
      <div className="node-band-row">
        {[...ZUSTAND_FILES, ...ZUSTAND_FILES].map((file, index) => (
          <FileNode
            key={`${file.name}-${index}`}
            name={file.name}
            language="TypeScript"
            incoming={file.incoming}
            outgoing={file.outgoing}
          />
        ))}
      </div>
    </div>
  );
}

function LanguagesSection() {
  return (
    <section aria-labelledby="languages-heading" id="languages" className="languages-section reveal">
      <div className="languages-head">
        <h2 id="languages-heading" className="type-l">
          <span className="text-muted">Reads JavaScript</span>
          <br />
          and TypeScript
        </h2>
        <a href="#analyze" className="node-button">
          <span className="node-button-dot" aria-hidden />
          Analyze a repository
        </a>
      </div>
      <Languages />
    </section>
  );
}

async function Examples() {
  const examples = await examplesOrNone();
  if (examples.length === 0) return null;

  return (
    <section aria-labelledby="examples-heading" id="examples" className="folders reveal">
      <h2 id="examples-heading" className="type-l folders-heading">
        Real examples
      </h2>
      {examples.map((example, index) => {
        const picture = EXAMPLE_PICTURES[example.fullName];
        return (
          <article
            key={example.repositoryId}
            className={`folder folder-tone-${index % 4}`}
            style={{ top: `${index * 64}px` }}
          >
            <div className="folder-strip">
              <h3 className="folder-tab type-m">{example.fullName}</h3>
              {picture && <span className="folder-kind">{picture.kind}</span>}
            </div>
            <div className="folder-body">
              {picture && (
                <Image
                  src={picture.src}
                  alt={`RepoScope's graph of ${example.fullName}, ${picture.layout}`}
                  width={1600}
                  height={1000}
                  sizes="(min-width: 1024px) 55vw, 100vw"
                  className="folder-picture"
                />
              )}
              <div className="folder-text">
                <p>{example.about}</p>
                <p className="folder-figures">
                  {example.sourceFiles.toLocaleString("en-US")} source{" "}
                  {example.sourceFiles === 1 ? "file" : "files"}, {example.dependencies.toLocaleString("en-US")}{" "}
                  imports between them.
                </p>
                <Link href={`/repositories/${example.repositoryId}/architecture`} className="node-button">
                  <span className="node-button-dot" aria-hidden />
                  Open the map
                </Link>
              </div>
            </div>
          </article>
        );
      })}
    </section>
  );
}

function Closing() {
  return (
    <section aria-labelledby="closing-heading" className="closing reveal">
      <div className="closing-words">
        <h2 id="closing-heading" className="closing-line">
          Paste a link. See the map.
        </h2>
        <p className="closing-sentence">
          RepoScope checks GitHub, then opens the repository and analyzes it. No account needed for public code.
        </p>
      </div>
      <div className="closing-dialog" data-ui role="group" aria-labelledby="closing-dialog-title">
        <p id="closing-dialog-title" className="closing-dialog-title">
          Import a repository
        </p>
        <p className="closing-dialog-text">Any public GitHub link works, such as a repository&apos;s home page.</p>
        <ImportForm />
      </div>
    </section>
  );
}

const MARK_HEIGHTS = [100, 72, 86, 64, 94, 78, 60, 88, 70];

function Footer() {
  return (
    <footer className="landing-footer">
      <div className="footer-mark" aria-label="RepoScope" role="img">
        {[..."RepoScope"].map((letter, index) => (
          <span key={index} className="footer-block" style={{ height: `${MARK_HEIGHTS[index]}%` }}>
            <span aria-hidden>{letter}</span>
          </span>
        ))}
      </div>
      <div className="footer-links">
        <nav aria-label="Product" className="footer-column">
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/signup">Create account</Link>
          <Link href="/login">Sign in</Link>
        </nav>
        <nav aria-label="This page" className="footer-column">
          <a href="#how">How it works</a>
          <a href="#languages">Languages</a>
          <a href="#examples">Examples</a>
        </nav>
        <nav aria-label="Source" className="footer-column">
          <a href="https://github.com/medinaadrianpanlilio-design/RepoScope" rel="noreferrer noopener" target="_blank">
            Source on GitHub
          </a>
        </nav>
        <p className="footer-note">
          RepoScope reads code and never runs it. A local folder&apos;s source never leaves your computer.
        </p>
      </div>
      <div className="footer-last">
        <span>RepoScope</span>
        <a href="#analyze" className="node-button node-button-small">
          <span className="node-button-dot" aria-hidden />
          Analyze a repository
        </a>
      </div>
    </footer>
  );
}
