# Handover — Improved AI Council

Repository: https://github.com/JHJORE/improved_ai_councel

## What changed

Quorum's Compare conversations and manual Cross-feed remain available. Council adds concurrent independent answers, randomized anonymous critique, 0–3 independent revision rounds, validated anonymous scoring with mean ordinal rankings, and one configurable chairman synthesis. It includes streaming, pause/stop/resume, targeted retries, explicit two-model continuation, local run history, JSON export, intermediate inspection, usage/cost reporting and a live model catalog.

The existing local proxy now runs inside Vite, so `npm run dev` is sufficient. Cloudflare is optional for production deployment. The source retains Quorum history and both MIT attributions.

## Run

Requires Node.js 22+:

```bash
git clone https://github.com/JHJORE/improved_ai_councel.git
cd improved_ai_councel
npm install
npm run dev
```

For the copy already installed during this session:

```bash
cd /Users/joergenjore/Documents/Codex/2026-10-17/use-the-ef-mcp-x20-2/outputs/improved_ai_councel
npm run dev
```

Use the URL printed by Vite, normally http://127.0.0.1:5173. A development server was left running there at handover.

1. Gear icon → **OpenRouter API Key**: enter your funded OpenRouter key.
2. **Mode → Council**: enter your question.
3. Expand **Council settings** to choose Claude, GPT and Gemini model IDs, the **Chairman model**, and **Revision rounds**. Exact IDs and live suggestions are supported. Save settings or start a run to persist them.
4. Click **Start Council**. Default: 13 calls, one revision round.

No real API key was committed or used in testing. Mock credentials appear only in browser tests.

## Architecture / changed files

Added:

- `src/lib/council/types.ts`, `config.ts`: run, step, request and centralized model configuration.
- `prompts.ts`, `anonymize.ts`, `ranking.ts`: bounded contexts, randomized mappings, identity redaction, label translation, validated parsing and rank aggregation.
- `orchestrator.ts`: injected, framework-independent state machine and failure/retry controls.
- `transport.ts`: OpenRouter catalog, structured output schema and cancellable SSE streaming.
- `persistence.ts`: local Dexie run/config access.
- `council.test.ts`, `transport.test.ts`: mocked orchestration, ranking, anonymity, restore, streaming and error tests.
- `src/components/CouncilPanel.tsx`: controls, streaming columns, final answer and expandable evidence/usage.
- `src/components/SafeMarkdown.tsx` and its test: Markdown without automatic remote image loads.
- `local-api.ts`: Vite adapter for the existing Pages Function.
- `e2e/council.spec.ts`: desktop flow, refresh/inspection, failed-peer retry and mobile checks.
- `.github/workflows/ci.yml`: complete automated verification.
- `SETUP-REPORT.md`: this handover.

Modified:

- `src/App.tsx`: Compare / Cross-feed / Council selector.
- `src/lib/db/schema.ts`: additive Dexie v2 Council tables.
- `src/lib/models.ts` and model/pricing tests: corrected current Claude OpenRouter IDs while preserving internal aliases.
- `src/components/MessageBubble.tsx`, `src/hooks/useProviderChat.ts`, `functions/api/chat.ts`: safe Markdown, reduced error logging and propagated cancellation.
- `vite.config.ts`, `package.json`: single-command local server and combined typecheck script.
- `README.md`, `CONVENTIONS.md`, `docs/DECISIONS.md`, `LICENSE`: setup, algorithm, conventions and preserved attribution.

## Validation

Before changes: all 428 upstream tests and production build passed; lint had one existing Fast Refresh warning.

After changes: 463 unit/component/integration tests pass. Lint passes with that same existing warning. Application and Pages Function typechecks pass. Production build passes. Three mocked Playwright flows passed on GitHub Actions, including the full pipeline, refresh persistence, targeted retry and mobile width. GitHub Actions verifies every push; see the repository's Actions tab for the latest commit.

Local Playwright Chromium launch was blocked by the macOS execution sandbox, so browser automation was executed successfully on GitHub's Linux runner. The local UI and key-entry guidance were also inspected in the Codex browser. The local Compare proxy returned its expected HTTP 400 validation response without a paid model request.

## Known limitations

- Paid live-provider calls have not been exercised. Your funded key and chosen models' availability are required.
- Anonymity is best effort; style can identify an author, and identity redaction can affect questions about AI providers. Inspect raw prompts in those cases.
- Interrupted calls may have unknown billable usage. Reported retry usage is retained; OpenRouter billing is authoritative.
- Large context safeguards use characters, not exact token counting. No browsing, evidence retrieval, Chairman Council or automatic fact verification is implemented.
- History is browser/origin-local. Export runs before clearing site data. Council history is separate from ordinary Quorum exports.
- Existing upstream dependency advisories remain: install reported 48 across all dependencies, including development tools; production-only audit reported four low-severity advisories. Broad dependency upgrades were not mixed into this feature.
- Existing build warnings include bundle size and outdated browser compatibility data. Lint retains one upstream Fast Refresh warning.

## Next three improvements (not implemented)

1. Evidence retrieval with citations for externally verifiable claims.
2. Preflight spending estimates and a user-defined maximum run budget.
3. A dedicated disagreement summary linked to the relevant candidate passages.
