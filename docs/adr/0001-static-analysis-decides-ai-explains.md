# Static analysis decides, AI explains

Every fact RepoScope shows comes from static analysis. AI output is limited to explanations, is
always labeled, and never adds relationships to the graph.

The AI is a model on the viewer's own PC, called from their browser, because a local model can't run
on Vercel and private code should not go to a third-party AI service. The app must work fully
without it. Hosted models and tunnels were rejected: the first sends code to third parties and can't
serve a free fine-tune, the second exposes a personal GPU to strangers.
