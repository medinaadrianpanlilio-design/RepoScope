# The browser calls local AI directly

AI requests go from the viewer's browser straight to a model on their own PC, never through Vercel.
Private code therefore only reaches the viewer's machine, and running the site costs nothing extra.

Tested from the deployed HTTPS site in November 2026 with `llama-server` on the same PC. Streaming
chat completions worked in Chrome 156, Edge 157 and Firefox 157 once local network access was allowed.
Safari wasn't available to test, and is treated as unsupported.

- **Permission:** Chrome and Edge refuse the request until the site has local network access, which
  they ask a person for. Requests also pass `targetAddressSpace: "loopback"`. The first request to
  this machine triggers the prompt, so RepoScope only makes it after someone clicks Connect.
- **Allow-list:** `llama-server` allows every origin by default, which would let any website use the
  model. The setup command always sets `--cors-origins`. With it set, another site was refused even
  with local network access granted.
- **One origin only:** despite its help text, `--cors-origins a,b` sends both values in a single
  header, which browsers reject. The setup command gives exactly one origin.
- **Endpoint:** the code refuses to send anything to an address that isn't this machine.

## Prompt injection

Repository code is untrusted, so it could contain instructions aimed at the model. Seven hostile files
were tested four times each, in summaries and chat, using Qwen3.5-4B.

With the file in the system message, chat obeyed 12 of 28 attacks. With the file in a user message
and a reminder beside each question, all 56 attempts across summaries and chat held. A small model
can't be guaranteed safe against every attack, so AI output stays labeled, and is only ever shown as
text. It never changes analysis facts and can't take actions.
