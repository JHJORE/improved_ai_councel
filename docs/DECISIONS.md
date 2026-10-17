# Architectural Decisions

Significant decisions made during implementation. Referenced by CLAUDE.md's Compound Engineering Protocol.

---

## 001: Vite 7 instead of Vite 6

**Date:** 2026-02-28
**Phase:** 1

**Context:** CLAUDE.md and BUILD-STRATEGY.md originally specified Vite 6. Running `npm create vite@latest` installed Vite 7.3.1 (current stable).

**Decision:** Use Vite 7 as-is. No breaking changes affect this project.

**Consequence:** Updated all documentation references from "Vite 6" to "Vite 7".

---

## 002: Exclude test files from tsconfig.app.json

**Date:** 2026-02-28
**Phase:** 1

**Context:** Test files use Vitest globals (`describe`, `it`, `expect`) which aren't recognized by the app TypeScript config. Including test files in the build causes type errors.

**Decision:** Add `"exclude": ["src/**/*.test.ts", "src/**/*.test.tsx", "src/test"]` to `tsconfig.app.json`. Test files get their types from Vitest's own configuration.

**Consequence:** `tsc -b` (used in `npm run build`) only checks application code. Vitest handles type-checking test files separately.

---

## 003: UI Message Stream format for proxy responses

**Date:** 2026-02-28
**Phase:** 4

**Context:** The AI SDK offers multiple stream response formats: `toTextStreamResponse()` (plain text stream), `toDataStreamResponse()` (data protocol stream), and `toUIMessageStreamResponse()` (UI message stream). The proxy needs to return a format that the client-side `useChat` hook can consume.

**Decision:** Use `toUIMessageStreamResponse()` which outputs the UI message stream protocol compatible with AI SDK v6's `useChat` hook.

**Consequence:** The client uses `DefaultChatTransport` from the `ai` package with `prepareSendMessagesRequest` for request customization, paired with `useChat({ transport })`. This is the default transport in AI SDK v6 and parses the UI message stream format natively. Token usage metadata is included in the stream. Mid-stream errors are surfaced via the `onError` callback.

---

## 004: Provider type duplicated between SPA and functions

**Date:** 2026-02-28
**Phase:** 4

**Context:** The `Provider` type (`'claude' | 'chatgpt' | 'gemini'`) is needed in both `src/lib/db/types.ts` (SPA) and `functions/api/chat.ts` (proxy). The functions directory has its own TypeScript project and cannot import from `src/`.

**Decision:** Duplicate the type definition in both locations. Do not create a shared types package.

**Consequence:** If the provider list changes, both files must be updated. This is acceptable given the type is a simple union of 3 literals that changes rarely. A shared package can be extracted later if needed.

---

## 005: Cross-feed as pure functions + SendOptions extension

**Date:** 2026-03-01
**Phase:** 8

**Context:** Cross-feed needs to construct per-provider messages (each containing the other two models' responses), send them concurrently, and persist them with `isCrossFeed`/`crossFeedRound` metadata. Several approaches were considered: (a) a separate `sendCrossFeed()` method on the hook, (b) a `CrossFeedManager` class, (c) pure utility functions + optional `SendOptions` on the existing `send()`.

**Decision:** Use pure utility functions in `src/lib/crossfeed.ts` for message construction, and extend the existing `send(text, options?)` signature with an optional `SendOptions` parameter for metadata. Orchestration lives in `App.tsx`'s `handleCrossFeed` callback. Cross-feed visual state tracked via a `Set<string>` of UIMessage IDs in `useProviderChat`.

**Consequence:** Cross-feed message construction is trivially testable (24 pure function tests). The `send()` API remains backward-compatible. The `Set<string>` tracking grows within a session but resets on conversation switch and rebuilds from Dexie on load. No new hooks or classes needed — cross-feed is an orchestration concern in the parent, not a per-column concern.

---

## 006: API-only token counting (no client-side tiktoken)

**Date:** 2026-03-01
**Phase:** 10

**Context:** BUILD-STRATEGY.md Decision #4 planned a "hybrid approach" combining API response token counts with client-side `js-tiktoken` for pre-send estimation. Phase 10 implemented token usage capture from API responses via the `messageMetadata` callback in the proxy's `toUIMessageStreamResponse`.

**Decision:** Use API response token counts exclusively. Do not install `js-tiktoken`. Token counts are extracted from the `finish` stream event and sent to the client as `UIMessage.metadata.usage`.

**Consequence:** No pre-send token estimation (user cannot see "this message will cost approximately X" before sending). Token counts are only available after the response completes. This keeps the bundle smaller (~2KB saved from tiktoken encoding data) and avoids complexity from provider-specific tokenizer differences. Pre-send estimation can be added later if needed.

---

## 007: Cost estimates use currently-selected model

**Date:** 2026-03-01
**Phase:** 10

**Context:** The `UsageSummary` component calculates costs using `selectedModels[provider]` from the Zustand store. If a user switches models mid-conversation (e.g., from Opus to Haiku), all historical costs are recalculated at the new model's price. The `Message` type does not store which model generated it.

**Decision:** Accept this limitation for the MVP. Document it in the UI with "Costs estimated using currently selected models." The correct long-term fix is to add a `model: string` field to the `Message` schema and use it for cost lookups, but this requires a Dexie schema migration and touches many persistence paths.

**Consequence:** Cost estimates may be inaccurate when users switch models within a conversation. This is a known limitation documented in the UI and in this decision log. Adding `model` to `Message` is deferred to a future phase.

---

## 008: Always-on thinking/reasoning via providerOptions

**Date:** 2026-03-01
**Phase:** Post-Phase 12 (model update)

**Context:** All three providers now support thinking/reasoning modes: Claude has adaptive thinking, OpenAI has reasoning effort levels, and Gemini has thinkingConfig with thinkingLevel. The question was whether to (a) make thinking a user-configurable setting, (b) enable it by default with opt-out, or (c) always enable it.

**Decision:** Always enable thinking/reasoning for all providers at high levels. Configuration is a static `PROVIDER_OPTIONS` map in the proxy, not user-configurable. Claude uses `adaptive` thinking (model decides when/how deeply), OpenAI uses `reasoningEffort: 'high'`, and Gemini uses `openrouter.reasoning: { effort: 'high' }` (OpenRouter maps this to Google's `thinkingLevel`). Reasoning content is streamed to the client via `sendReasoning: true`.

**Consequence:** All responses include thinking/reasoning, which improves response quality but increases token usage and cost. There is no UI toggle to disable thinking. The `PROVIDER_OPTIONS` map is per-provider, not per-model — all models for a given provider share the same thinking config. If a future budget model does not support thinking, this structure will need to become model-aware. Adding user-configurable reasoning effort levels is a future enhancement.

---

## 009: Route Gemini through OpenRouter

**Date:** 2026-03-01
**Phase:** Post-Phase 12

**Context:** The `@ai-sdk/google` provider called Google's Generative AI API directly, which blocks browser CORS and required maintaining a separate provider adapter. OpenRouter provides a unified API gateway with an official Vercel AI SDK provider (`@openrouter/ai-sdk-provider`) that supports Gemini models and maps `reasoning.effort` to Google's `thinkingLevel` parameter.

**Decision:** Replace `@ai-sdk/google` with `@openrouter/ai-sdk-provider`. Route all Gemini requests through OpenRouter using model ID `google/gemini-3.1-pro-preview`. Use `openrouter.reasoning: { effort: 'high' }` for thinking config. Users provide an OpenRouter API key instead of a Google API key for the Gemini column.

**Consequence:** Gemini reduced from two models (2.5 Flash + 2.5 Pro) to one (3.1 Pro). Users need an OpenRouter account/key instead of a Google AI key. The settings placeholder for Gemini says "OpenRouter" to make this clear. OpenRouter pricing may differ slightly from Google direct. Existing users with Google API keys stored in IndexedDB will need to replace them with OpenRouter keys.

---

## 010: Route ALL providers through OpenRouter (single API key)

**Date:** 2026-03-01
**Phase:** Post-Phase 12

**Context:** After Decision 009 routed Gemini through OpenRouter, the app required three separate API keys (Anthropic direct, OpenAI direct, OpenRouter for Gemini). This was high friction for users. OpenRouter supports all three providers through a single API key with a unified gateway. A future feature will allow per-provider direct API access, but the default should be simple.

**Decision:** Route all three providers (Claude, ChatGPT, Gemini) through OpenRouter by default. Remove `createAnthropic()` and `createOpenAI()` imports from the proxy — only `createOpenRouter()` is used. The client maps internal model IDs (e.g., `claude-sonnet-4-6`) to OpenRouter format (e.g., `anthropic/claude-sonnet-4-6`) via `toOpenRouterModelId()` in `src/lib/models.ts`. The Settings UI shows a single "OpenRouter API Key" field. Per-provider API key fields are retained in the Dexie schema for the future direct API feature but are not displayed or used at runtime.

**Consequence:** Users need only one API key for full access to all three providers. The `@ai-sdk/anthropic` and `@ai-sdk/openai` packages remain in `package.json` for the future per-provider routing feature but are not imported. `PROVIDER_OPTIONS` entries all use the `openrouter` SDK key. OpenRouter's provider passthrough for thinking/reasoning options is best-effort — if issues arise, the `PROVIDER_OPTIONS` may need adjustment. Existing users with per-provider keys stored in Dexie will need to enter an OpenRouter key in the updated settings UI.


## Council mode (2026-10-17)

Added a framework-independent staged orchestrator alongside Quorum's existing conversations. Dexie v2 adds Council run/config tables. Council uses browser OpenRouter SSE directly, avoiding another backend protocol and limiting content transmission to OpenRouter. Compare retains its SDK proxy; a Vite adapter runs that existing handler locally with one command. Stage-specific contexts, validated rankings and explicit degradation preserve independent reasoning. Earlier critique mappings are translated before chairman synthesis. Model catalog checks and pricing are loaded from OpenRouter; defaults remain centralized. Anonymous labels and redaction are best effort, and all intermediate artifacts remain inspectable.
