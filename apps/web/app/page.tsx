import Image from "next/image";
import Link from "next/link";
import { cache, Suspense, type ReactNode } from "react";
import { ImportForm } from "@/components/import-form";
import { DemoGraph } from "@/components/landing/demo-graph";
import { loadShowcase, SHOWCASE, type Showcase } from "@/lib/examples/showcase";
import { readyExamples, type ReadyExample } from "@/lib/examples/queries";
import { languageColor } from "@/lib/ui/colors";
import "./landing.css";

/** Pictures of each example's real graph, taken from RepoScope itself. */
const EXAMPLE_PICTURES: Record<string, string> = {
  "vercel/ms": "/landing/example-ms.webp",
  "sindresorhus/ky": "/landing/example-ky.webp",
  "pmndrs/zustand": "/landing/example-zustand.webp",
  "colinhacks/zod": "/landing/example-zod.webp",
};

/** Read once per request: the examples, and the full analysis the page is built around. */
const pageData = cache(async (): Promise<{ examples: ReadyExample[]; showcase: Showcase | null }> => {
  const examples = await readyExamples().catch(() => []);
  const showcase = await loadShowcase(examples).catch(() => null);
  return { examples, showcase };
});

export default function Home() {
  return (
    <main id="main" tabIndex={-1} className="landing">
      <Hero />
      <Suspense fallback={<DemoPlaceholder />}>
        <Demo />
      </Suspense>
      <HowItWorks />
      <Suspense fallback={<Features showcase={null} />}>
        <WithShowcase render={(showcase) => <Features showcase={showcase} />} />
      </Suspense>
      <Suspense fallback={<Agents showcase={null} />}>
        <WithShowcase render={(showcase) => <Agents showcase={showcase} />} />
      </Suspense>
      <Suspense fallback={null}>
        <Examples />
      </Suspense>
      <Closing />
      <Footer />
    </main>
  );
}

async function WithShowcase({ render }: { render: (showcase: Showcase | null) => ReactNode }) {
  const { showcase } = await pageData();
  return render(showcase);
}

function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-heading">
      <div className="wrap hero-grid">
        <div>
          <p className="kicker">
            <span className="kicker-dot" aria-hidden />
            Static analysis for JavaScript and TypeScript
          </p>
          <h1 id="hero-heading">
            See how code <em>connects</em>
          </h1>
          <p className="lede">
            Paste a GitHub link. RepoScope reads every import, draws the dependency graph, and tells you and
            your coding agent what a change will reach. The facts come from the code; AI only explains them.
          </p>
        </div>

        <div className="import-card" id="analyze">
          <h2 className="import-title">GitHub repository</h2>
          <ImportForm example={`https://github.com/${SHOWCASE}`} />
          <p className="import-help">
            Public repositories need no account. <Link href="/dashboard">Connect GitHub</Link> for private
            ones.
          </p>
          <dl className="import-facts">
            <div>
              <dt>Imported code</dt>
              <dd>Never run</dd>
            </div>
            <div>
              <dt>Source code</dt>
              <dd>Not stored</dd>
            </div>
            <div>
              <dt>Languages</dt>
              <dd>TS · JS</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}

function DemoPlaceholder() {
  return <div className="wrap demo-space" aria-hidden />;
}

async function Demo() {
  const { showcase } = await pageData();
  if (!showcase) return null;
  const { totals, graph } = showcase;

  return (
    <section className="demo" aria-labelledby="demo-title">
      <div className="wrap wrap-wide">
        <div className="demo-frame">
          <div className="demo-bar">
            <h2 className="demo-title" id="demo-title">
              <Link href={`/repositories/${showcase.repositoryId}/architecture`}>{showcase.fullName}</Link>
              <span>
                {totals.sourceFiles} source files · {totals.dependencies} imports · {totals.cycles}{" "}
                {totals.cycles === 1 ? "cycle" : "cycles"}
              </span>
            </h2>
            <div className="legend">
              <span>
                <i className="swatch" style={{ color: "var(--importer)" }} aria-hidden />
                Imports the picked file
              </span>
              <span>
                <i className="swatch" style={{ color: "var(--imported)" }} aria-hidden />
                Imported by it
              </span>
            </div>
          </div>
          <DemoGraph graph={graph} initialPath={showcase.hub?.path ?? null} />
          <p className="demo-foot">
            <span>
              The real analysis of {showcase.fullName}
              {showcase.commitSha && <> at {showcase.commitSha.slice(0, 7)}</>}. Pick a file, or Tab to one
              and press Enter.
            </span>
            {graph.standalone > 0 && (
              <span>
                {graph.standalone} standalone {graph.standalone === 1 ? "file is" : "files are"} left out.
              </span>
            )}
          </p>
        </div>
      </div>
    </section>
  );
}

function SectionHead({ number, id, title, children }: { number: string; id: string; title: string; children: ReactNode }) {
  return (
    <div className="section-head">
      <div>
        <span className="section-number">{number}</span>
        <h2 id={id}>{title}</h2>
      </div>
      <p>{children}</p>
    </div>
  );
}

function HowItWorks() {
  return (
    <section className="section" id="how" aria-labelledby="how-title">
      <div className="wrap">
        <SectionHead number="01 / How it works" id="how-title" title="From a link to a map">
          RepoScope reads a repository the way a compiler would, without ever running it, and keeps the map
          current as the code changes.
        </SectionHead>
        <ol className="steps">
          <li>
            <span className="step-number">01</span>
            <h3>Paste a link</h3>
            <p>
              Any public GitHub repository, or a private one through the GitHub App. Local folders sync with the
              CLI, and only results leave your computer.
            </p>
          </li>
          <li>
            <span className="step-number">02</span>
            <h3>It reads every import</h3>
            <p>Static, dynamic, re-exported and type-only imports, resolved through aliases and workspaces.</p>
          </li>
          <li>
            <span className="step-number">03</span>
            <h3>You explore, your agent asks</h3>
            <p>Browse the graph, in 2D or 3D, and the explorer, or let Claude Code ask through MCP before it edits.</p>
          </li>
        </ol>
      </div>
    </section>
  );
}

function Features({ showcase }: { showcase: Showcase | null }) {
  const languages = showcase?.languages ?? [];
  const most = Math.max(1, ...languages.map((language) => language.files));

  return (
    <section className="section" id="features" aria-labelledby="features-title">
      <div className="wrap">
        <SectionHead number="02 / Features" id="features-title" title="Every answer comes from the code">
          No guessed relationships and no invented numbers. When an import can&apos;t be resolved, RepoScope
          lists it instead of guessing.
        </SectionHead>

        <div className="bento">
          <article className="tile span-2 rows-2">
            <TileIcon>
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
              <path d="M10 6.5h4a3 3 0 0 1 3 3V14" />
            </TileIcon>
            <h3>A graph you can actually read</h3>
            <p>
              Layered, force-directed, by folder, or in 3D space you can turn and zoom. Big repositories group
              by folder, and switching keeps the file you picked.
            </p>
            <div className="layouts">
              {[
                { src: "/landing/layout-layered.webp", name: "Layered" },
                { src: "/landing/layout-force.webp", name: "Force" },
                { src: "/landing/layout-folder.webp", name: "By folder" },
              ].map((layout) => (
                <figure key={layout.name}>
                  <Image
                    src={layout.src}
                    alt={`pmndrs/zustand drawn ${layout.name.toLowerCase()}`}
                    width={1600}
                    height={1000}
                    sizes="(min-width: 1024px) 16vw, 33vw"
                  />
                  <figcaption>{layout.name}</figcaption>
                </figure>
              ))}
            </div>
          </article>

          <article className="tile span-2">
            <TileIcon>
              <circle cx="12" cy="12" r="3" />
              <circle cx="12" cy="12" r="8" />
              <path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
            </TileIcon>
            <h3>Change impact</h3>
            <p>Pick the files you plan to edit and see everything that depends on them, directly or through other files.</p>
            {showcase?.hub && (
              <p className="fact">
                {showcase.hub.path} → <b>{showcase.hub.direct}</b> direct, <b>{showcase.hub.total}</b> in total
              </p>
            )}
          </article>

          <article className="tile">
            <TileIcon>
              <path d="M3 7h6l2 2h10v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
            </TileIcon>
            <h3>Explorer</h3>
            <p>File tree, search and highlighted source, fetched when you open a file and never stored.</p>
          </article>

          <article className="tile">
            <TileIcon>
              <path d="M12 3l9 16H3z" />
              <path d="M12 10v4M12 17v.01" />
            </TileIcon>
            <h3>Insights</h3>
            {showcase?.insight ? (
              <div className="insight">
                <strong>{showcase.insight.title}</strong>
                {showcase.insight.description}
              </div>
            ) : (
              <p>Cycles, files used far more than usual, and imports that couldn&apos;t be resolved.</p>
            )}
          </article>

          <article className="tile span-2">
            <TileIcon>
              <path d="M4 7h16M4 12h10M4 17h7" />
            </TileIcon>
            <h3>What it reads</h3>
            {languages.length > 0 ? (
              <>
                <ul className="langs" aria-label={`${showcase!.fullName}'s source files by language`}>
                  {languages.map((language) => (
                    <li key={language.language}>
                      <span>{language.language}</span>
                      <span className="bar" aria-hidden>
                        <i
                          style={{
                            width: `${(language.files / most) * 100}%`,
                            background: languageColor(language.language),
                          }}
                        />
                      </span>
                      <span>{language.files}</span>
                    </li>
                  ))}
                </ul>
                <p className="fact">
                  {showcase!.fullName}&apos;s {showcase!.totals.sourceFiles} source files, by language
                </p>
              </>
            ) : (
              <p>TypeScript, TSX, JavaScript and JSX, including ES modules and CommonJS.</p>
            )}
          </article>

          <article className="tile">
            <TileIcon>
              <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
            </TileIcon>
            <h3>Local AI</h3>
            <p>Summaries and chat from a model on your own computer. Your code never passes through RepoScope.</p>
          </article>

          <article className="tile">
            <TileIcon>
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </TileIcon>
            <h3>Private repos</h3>
            <p>Through the GitHub App. A push to the default branch re-analyzes only what changed.</p>
          </article>
        </div>
      </div>
    </section>
  );
}

function TileIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="tile-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

const TOOLS = [
  { name: "get_overview", does: "The structure, at the start of a session" },
  { name: "get_file_context", does: "What a file imports, exports and is used by" },
  { name: "get_impact", does: "Everything a change could reach" },
  { name: "get_risks", does: "Warnings about a planned change" },
  { name: "get_conventions", does: "Your import rules and notes" },
];

function Agents({ showcase }: { showcase: Showcase | null }) {
  const answer = showcase?.impactAnswer;
  return (
    <section className="section" id="agents" aria-labelledby="agents-title">
      <div className="wrap agents-grid">
        <div>
          <span className="section-number">03 / For coding agents</span>
          <h2 id="agents-title">Your agent asks before it edits</h2>
          <p className="agents-lede">
            RepoScope is an MCP server. Claude Code gets a repository&apos;s structure in one call instead of
            opening file after file, and checks what a change reaches before making it.
          </p>
          <ul className="tools">
            {TOOLS.map((tool) => (
              <li key={tool.name}>
                <code>{tool.name}</code>
                <span>{tool.does}</span>
              </li>
            ))}
          </ul>
        </div>
        {showcase?.hub && answer && (
          <figure className="terminal">
            <figcaption>
              get_impact on {showcase.fullName}, first {answer.files.length} of {answer.total} files
            </figcaption>
            <pre>
              <span className="t-dim">{"// request\n"}</span>
              {"{ "}
              <span className="t-key">&quot;paths&quot;</span>
              {": ["}
              <span className="t-str">&quot;{showcase.hub.path}&quot;</span>
              {"] }\n\n"}
              <span className="t-dim">{"// answer\n"}</span>
              {"{\n  "}
              <span className="t-key">&quot;total&quot;</span>: <span className="t-num">{answer.total}</span>
              {",\n  "}
              <span className="t-key">&quot;maxDepth&quot;</span>: <span className="t-num">{answer.maxDepth}</span>
              {",\n  "}
              <span className="t-key">&quot;files&quot;</span>
              {": [\n"}
              {answer.files.map((item, index) => (
                <span key={item.path}>
                  {"    { "}
                  <span className="t-key">&quot;path&quot;</span>: <span className="t-str">&quot;{item.path}&quot;</span>,{" "}
                  <span className="t-key">&quot;depth&quot;</span>: <span className="t-num">{item.depth}</span>
                  {" }"}
                  {index < answer.files.length - 1 ? ",\n" : "\n"}
                </span>
              ))}
              {"  ]\n}"}
            </pre>
          </figure>
        )}
      </div>
    </section>
  );
}

async function Examples() {
  const { examples } = await pageData();
  if (examples.length === 0) return null;

  return (
    <section className="section" id="examples" aria-labelledby="examples-title">
      <div className="wrap">
        <SectionHead number="04 / Examples" id="examples-title" title="Open one that's already analyzed">
          Real repositories, kept up to date. Open any of them without an account.
        </SectionHead>
        <ul className="examples">
          {examples.map((example) => {
            const picture = EXAMPLE_PICTURES[example.fullName];
            return (
              <li key={example.repositoryId}>
                <Link className="example" href={`/repositories/${example.repositoryId}/architecture`}>
                  {picture && (
                    <Image
                      src={picture}
                      alt={`RepoScope's graph of ${example.fullName}`}
                      width={1600}
                      height={1000}
                      sizes="(min-width: 768px) 50vw, 100vw"
                    />
                  )}
                  <span className="example-body">
                    <strong>{example.fullName}</strong>
                    <span>
                      {example.sourceFiles.toLocaleString("en-US")} files ·{" "}
                      {example.dependencies.toLocaleString("en-US")} imports
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function Closing() {
  return (
    <section className="cta" aria-labelledby="cta-title">
      <div className="wrap">
        <div className="cta-box">
          <div>
            <h2 id="cta-title">Map your repository</h2>
            <p>Paste a link and watch the graph build. Nothing to install.</p>
          </div>
          <a className="cta-button" href="#analyze">
            Import a repository
          </a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="landing-footer">
      <div className="wrap footer-row">
        <p>RepoScope reads code and never runs it. A local folder&apos;s source never leaves your computer.</p>
        <nav aria-label="Footer">
          <a href="https://github.com/medinaadrianpanlilio-design/RepoScope" rel="noreferrer noopener" target="_blank">
            Source on GitHub
          </a>
          <Link href="/signup">Create account</Link>
          <Link href="/login">Sign in</Link>
        </nav>
      </div>
    </footer>
  );
}
