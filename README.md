# Improved AI Council — built on Quorum

A local daily interface for Claude, GPT and Gemini, with automatic deliberation alongside Quorum's original compare and manual cross-feed conversations. Based on [blockpilgrim/quorum](https://github.com/blockpilgrim/quorum), with the peer-review approach inspired by [Karpathy's LLM Council](https://github.com/karpathy/llm-council). Original Quorum source and MIT attribution are preserved.

## Run locally

Use Node.js 22 or newer:

```bash
git clone https://github.com/JHJORE/improved_ai_councel.git
cd improved_ai_councel
npm install
npm run dev
```

Open the local URL printed by Vite (normally http://127.0.0.1:5173). No Cloudflare account or separate proxy process is needed locally. The Vite plugin executes Quorum's existing chat handler for Compare/Cross-feed. Council streams directly from OpenRouter; no remote application server is involved.

Click the **gear icon → OpenRouter API Key** and enter your key. The key is saved in this browser's IndexedDB. Chat opens by default. Type a question and press **Enter** (or **Send**) to get the final answer automatically. Use Shift+Enter for a new line. Follow-up messages include your previous questions and answers; **New conversation** starts fresh. Compare and Cross-feed retain Quorum's existing conversation storage, model controls, exports, and manual Cross-feed button.

## AWS Bedrock

Open **Settings → Chat provider → AWS Bedrock**, paste a Bedrock bearer API key, and select your AWS region. Then close Settings and chat normally. You do not need an OpenRouter key for Bedrock Council chats. Keys save immediately in this browser's local IndexedDB and are sent only to the local proxy and AWS; they are excluded from run exports.

The defaults use US inference profiles for Claude Sonnet 4.6, Amazon Nova 2 Lite, and Llama 3.3 70B, with Claude as chairman. Your account must have access to these models in the selected region. Model fields accept Bedrock IDs or inference profile ARNs; change them to match your account, especially outside US regions. This uses a Bedrock **bearer API key**, not an IAM access-key ID/secret pair. See [AWS key documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys-use.html).

Bedrock streams through `/api/bedrock` using ConverseStream. `npm run dev` starts the required local proxy automatically. A static-only host or `npm run preview` does not provide this proxy. Token counts are shown; dollar costs are marked unknown because Bedrock does not return per-request billing. Runs retain their backend and region when resumed. The optional legacy Compare and Cross-feed modes still use OpenRouter.

## Council Mode

```text
Prompt
   │
   ├── Claude
   ├── GPT
   └── Gemini
        │
        ▼
 Anonymous cross-critique
        │
        ▼
 Independent revision
        │
        ▼
 Anonymous evaluation
        │
        ▼
     Chairman
        │
        ▼
   Final answer
```

1. Independent answers stream concurrently with no peer responses or conversation history included.
2. A shuffled anonymous candidate set goes to each critic. Critiques identify insights, errors, omissions, unsupported claims and disagreements, without synthesizing yet.
3. Each member sees its original/current answer and anonymous peer material. It revises independently, preserving better-supported disagreement rather than blindly agreeing.
4. A fresh permutation is evaluated by all remaining members. Structured JSON is requested for catalog models advertising support. Scores and complete rankings are validated; a conservative prose fallback requires explicit scores and a complete final ranking. Invalid evaluations pause for a targeted retry. Mean ordinal rank determines aggregate order, with lower better; ties remain visibly tied (alphabetical order is display-only).
5. The configurable chairman receives revised candidates, evaluations, rankings and earlier disagreement evidence. Earlier critique labels are translated to the evaluation mapping. The synthesis prompt prioritizes correctness, supported minority views and acknowledged uncertainty.

**Council settings** inside the gear menu controls all three model IDs, the chairman, and revision rounds. Inputs offer live OpenRouter catalog suggestions and accept exact IDs. Changes save automatically. New runs snapshot configuration; resuming a run uses its original configuration. The chairman may be one of the members or any fourth catalog model. Initial defaults are centralized in `src/lib/council/config.ts` and were checked against OpenRouter's model catalog on 2026-10-17:

- Claude: `anthropic/claude-opus-4.6`
- GPT: `openai/gpt-5.4`
- Gemini: `google/gemini-3.1-pro-preview`
- Chairman: `anthropic/claude-opus-4.6`

Revision rounds are 0–3, default 1. Zero skips critique/revision and evaluates initial answers. Planned call counts are 7, 13, 19 and 25 respectively, before retries. Rounds never repeat indefinitely.

**Pause after stage** completes the current batch and stops before the next. **Stop now** aborts active requests and retains completed peers. **Resume / retry failed** reruns only unfinished requests. Individual retry buttons retry one failure. When at least two requests succeed, **Continue with successful models** explicitly skips failed peers; fewer than two cannot proceed. Evaluation can use two successful judges for all remaining candidates. Synthesis always requires a successful chairman.

Completed runs reopen from **Chat history**, including after refresh. Intermediate stage results, anonymous mappings, raw/parsed evaluations, exact prompts and request attempts are inspectable. **Export run** downloads JSON without your API key. An interrupted page restores completed requests and lets you retry unfinished ones. Council history is separate from ordinary Quorum conversations and their exports.

### Costs and context

The usage panel shows tokens and USD costs by model and stage, including reported retry usage, plus total active execution time. OpenRouter-reported cost is preferred; otherwise catalog token prices provide an estimate. Missing usage is marked unknown, never treated as free. Aborted requests can still incur charges, and unknown usage cannot be reconstructed locally; OpenRouter billing is authoritative. Active time excludes paused intervals and updates at execution boundaries.

Each stage sends only its relevant context. Individual sections over 60,000 characters are visibly truncated in the prompt; combined prompts over 300,000 characters are rejected before making an API call. These are character safeguards, not model-specific token guarantees. A 16,384-token output ceiling and five-minute request timeout prevent unbounded calls. Truncated/error streams never count as successful answers.

### Privacy and limitations

Keys stay in browser settings and request headers (or the local Compare proxy request). They are never stored in Council runs, exported, or logged. `.env`, `.env.local` and other environment files are ignored. OpenRouter Council content goes to OpenRouter and its model providers; Bedrock Council content goes through the local proxy to AWS. Model-provided images are displayed as text placeholders to prevent unsolicited third-party image requests. Local browser data is not encrypted and clearing site data removes it; export important runs. Use the same localhost URL/port to retain access to browser storage.

Anonymous labels hide configured provider identities, and common self-identification is redacted in peer prompts. Writing style and content can still reveal authorship; anonymity is best effort. Identity redaction also affects provider names in questions about AI companies; inspect raw prompts for such questions. Prompt-injection resistance is advisory, not a security guarantee. Model rankings are opinions, not external fact verification. This release has no browsing/retrieval tools or Chairman Council.

No paid live-provider calls are part of the tests. Real use requires a funded key with access to the chosen models. Catalog availability does not guarantee account/provider availability.

## Architecture and tests

`src/lib/council/` holds `types`, `config`, `prompts`, `anonymize`, `ranking`, `orchestrator`, `transport` and `persistence`. The framework-independent orchestrator accepts an injected streaming model caller and persistence callback, making paid API calls unnecessary in tests. `CouncilPanel.tsx` renders chat, progress and results; `CouncilSettings.tsx` provides optional configuration in Settings. Dexie schema version 2 adds Council tables without replacing existing conversations. `local-api.ts` adapts the existing Pages Function for single-command local development. The chairman is isolated as a synthesis step for future extension.

```bash
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

GitHub Actions runs lint, both TypeScript projects, the complete unit suite, production build and mocked Playwright flows. Browser tests cover all stages, inspectable intermediates, refresh persistence, targeted retry, and mobile layout. No API key or GitHub secrets are needed. `npm run preview` serves only the static build; use `npm run dev` for the complete local Compare/Cross-feed proxy, or the original Cloudflare deployment for production hosting.

Possible next improvements (not implemented): evidence retrieval with citations; budget caps with preflight cost estimates; a dedicated disagreement summary linked to source responses.

---

## Original Quorum documentation

# Quorum

A tri-model AI workspace that sends your prompt to Claude, ChatGPT, and Gemini simultaneously and streams all three responses in real time.

## What It Does

Quorum eliminates the tab-switching workflow of comparing AI models. Type a message once, and it fans out to three providers concurrently — each maintaining its own independent conversation history. Three columns stream tokens side-by-side, so you can watch how Claude, ChatGPT, and Gemini approach the same question differently.

The interesting part is **cross-feed**: a single button press takes each model's latest response and shares it with the other two, triggering a second round of concurrent responses. The models effectively review each other's work. You can repeat this for as many rounds as you want — useful for iterative reasoning, code review, or getting models to challenge each other's assumptions.

Everything runs client-side with a bring-your-own-key model. A single OpenRouter API key gives access to all three providers. Keys stay in your browser's IndexedDB. A thin Cloudflare Worker proxy exists solely because OpenAI and Gemini don't support browser CORS — it forwards requests to OpenRouter and streams responses, storing nothing.

## Tech Stack

- **Frontend:** React 19 + TypeScript, built with Vite 7
- **Styling:** Tailwind CSS v4 + shadcn/ui components
- **AI Streaming:** Vercel AI SDK — three independent `useChat` instances, one per provider, with adaptive thinking/reasoning enabled for all models
- **Providers:** All models routed through OpenRouter via `@openrouter/ai-sdk-provider` — Claude (Sonnet/Opus 4.6), GPT-5.2/5.3 Codex, Gemini 3.1 Pro
- **Persistence:** Dexie.js v4 (IndexedDB) — conversations, messages, and API keys stored locally with reactive queries via `useLiveQuery`
- **State:** Zustand v5 for ephemeral UI state (streaming status, active conversation, model selections)
- **Proxy:** Cloudflare Pages Functions — stateless CORS proxy using AI SDK's `streamText`
- **PWA:** Installable with offline app shell caching via `vite-plugin-pwa`
- **Testing:** Vitest + React Testing Library (406 tests), Playwright configured for E2E

## Architecture

```
Browser (SPA)
├── Shared InputBar ──→ sends to all 3 useChat instances concurrently
├── Claude Column ────→ independent message history + streaming
├── ChatGPT Column ──→ independent message history + streaming
├── Gemini Column ───→ independent message history + streaming
├── Zustand ─────────→ streaming status, UI state, model selections
└── Dexie/IndexedDB ─→ conversations, messages, settings, API keys
         │
         │ HTTPS (SSE streaming)
         ▼
Cloudflare Worker (stateless proxy)
├── Validates request body
├── Creates provider-specific AI SDK model with user's API key
├── Calls streamText() with provider-specific reasoning config
└── Streams response back with CORS headers
         │
         ▼
OpenRouter API (all providers)
```

**Key design decisions:**

- **Stream isolation:** Each model column is `React.memo`-wrapped with its own `useChat` instance. Tokens arriving for one provider don't re-render the others.
- **Persistence on completion:** Messages write to IndexedDB when a stream finishes, not during. Avoids hundreds of writes/second across three concurrent streams.
- **Cross-feed is client-orchestrated:** The SPA reads latest responses, constructs context messages, and sends three concurrent requests. The proxy stays stateless.
- **Imperative refs for send orchestration:** Parent dispatches to columns via `forwardRef` + `useImperativeHandle`. Streaming status syncs back via Zustand store.
- **Token usage from API metadata:** Actual token counts extracted from provider responses via AI SDK's `messageMetadata` callback. No client-side tokenizer. Cost estimates calculated from a per-model pricing table.

## Getting Started

```bash
# Install dependencies
npm install

# Start the dev server (includes Vite proxy for /api/chat)
npm run dev

# Run tests
npm run test

# Production build
npm run build
```

You'll need an OpenRouter API key — enter it in the settings dialog (gear icon). One key gives access to all three providers. Keys are stored in your browser's IndexedDB and sent to the proxy with each request.

For the proxy in production, deploy to Cloudflare Pages — `wrangler.toml` is preconfigured. The free tier (100K requests/day) is more than sufficient.

## Live Demo

**[quorum-25w.pages.dev](https://quorum-25w.pages.dev/)** *(URL will change after Cloudflare Pages migration)*

Bring your own OpenRouter API key — enter it in the settings dialog (gear icon).

## Status

Feature-complete MVP. Deployed on Cloudflare Pages. 406 tests passing. Built over a focused sprint as a daily-driver tool for comparing AI model outputs.
