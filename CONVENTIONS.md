# Conventions

Patterns and anti-patterns for the Quorum codebase. Updated as the project evolves.

---

## Project Structure

**When to use**: Always. Follow this directory layout for all new code.

```
src/
  components/
    ui/          # shadcn/ui primitives (auto-generated, do not hand-edit)
  lib/           # Shared utilities and core modules
    db/          # Data layer (Dexie schema, types, data access functions)
    models.ts    # Model definitions, display names, provider constants
    pricing.ts   # Token pricing table and cost calculation (pure functions)
    crossfeed.ts # Cross-feed message construction utilities (pure functions)
    export.ts    # Export serialization to JSON and Markdown (pure functions)
    download.ts  # Browser file download utility (Blob + object URL)
    store.ts     # Zustand store (ephemeral UI state)
    utils.ts     # Utility functions (cn(), helpers)
  hooks/         # Custom React hooks
    useProviderChat.ts    # Per-provider chat hook (wraps useChat)
    useKeyboardShortcuts.ts # Global keyboard shortcuts (Cmd/Ctrl+N, Cmd/Ctrl+K)
  test/          # Test setup and shared test utilities
    setup.ts     # Vitest setup: jest-dom matchers, ResizeObserver polyfill
    db-helpers.ts # Dexie test utilities: clearAllTables(), deleteDatabase()
functions/       # Cloudflare Pages Functions (API proxy)
  api/
    chat.ts      # POST /api/chat — provider proxy endpoint
e2e/             # Playwright E2E tests
docs/            # Project documentation
```

**Why**: Matches the shadcn/ui convention and keeps generated code separate from application code.

---

## Import Aliases

**When to use**: Always use the `@/` alias for imports within `src/`.

**Example**:
```tsx
// Good
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Bad
import { Button } from '../../components/ui/button'
import { cn } from '../lib/utils'
```

**Why**: Path aliases eliminate fragile relative imports and make refactoring safer. Configured in both `tsconfig.app.json` and `vite.config.ts`.

---

## Dark Mode as Default

**When to use**: Always. The app ships with dark mode active.

**Example**:
```html
<!-- index.html -->
<html lang="en" class="dark">
  <body class="dark bg-background text-foreground">
```

**Why**: The product spec calls for dark-mode-default. The `class="dark"` on `<html>` activates the dark theme tokens defined in `src/index.css`. The Tailwind v4 `@custom-variant dark` directive scopes dark styles to `.dark *`.

---

## Tailwind CSS v4 Theme Tokens

**When to use**: Always use semantic color tokens from the theme, never raw color values.

**Example**:
```tsx
// Good - uses semantic tokens
<div className="bg-background text-foreground border-border" />
<div className="bg-card text-card-foreground" />
<div className="text-muted-foreground" />

// Bad - hardcoded colors
<div className="bg-gray-900 text-white border-gray-700" />
```

**Why**: Semantic tokens ensure consistent theming and make future light-mode support trivial. All tokens are defined in `src/index.css` under `@theme inline` (Tailwind v4) and `:root` / `.dark` blocks (shadcn/ui CSS variables).

---

## shadcn/ui Components

**When to use**: For all standard UI primitives (buttons, inputs, dialogs, etc.).

**Example**:
```tsx
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
```

**Why**: shadcn/ui components are copy-pasted source code we own (not an npm dependency). They use Radix UI primitives under the hood for accessibility. Do not modify files in `src/components/ui/` unless intentionally customizing a component.

---

## Testing Conventions

**When to use**: All test files.

- Test files live next to the code they test: `Component.tsx` -> `Component.test.tsx`
- Use the `.test.ts` or `.test.tsx` extension (not `.spec`)
- Vitest globals are enabled (`describe`, `it`, `expect` available without imports)
- React Testing Library is configured with jsdom environment
- Setup file at `src/test/setup.ts` loads jest-dom matchers and registers global polyfills (e.g., `ResizeObserver`)
- Dexie test cleanup: use `clearAllTables()` in `beforeEach` and `deleteDatabase()` in `afterAll` from `@/test/db-helpers` — do not inline `db.*.clear()` calls

**Example**:
```tsx
import { render, screen } from '@testing-library/react'
import { MyComponent } from './MyComponent'

describe('MyComponent', () => {
  it('renders correctly', () => {
    render(<MyComponent />)
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })
})
```

**Why**: Co-located tests are easier to find and maintain. Vitest globals reduce boilerplate.

---

## ESLint + Prettier

**When to use**: Always. Run before committing.

- ESLint handles code quality rules (TypeScript, React hooks, React refresh)
- Prettier handles formatting (no semicolons, single quotes, trailing commas)
- `eslint-config-prettier` disables ESLint rules that conflict with Prettier
- `prettier-plugin-tailwindcss` auto-sorts Tailwind class names

**Commands**:
```bash
npm run lint          # Check for lint errors
npm run format        # Auto-format all files
npm run format:check  # Check formatting without writing
```

---

## shadcn/ui Smoke Tests

**When to use**: When testing shadcn/ui primitives in `src/components/ui/`.

Place a single smoke-test file at `src/components/ui-components.test.tsx` (outside `ui/` directory). Don't co-locate test files inside `src/components/ui/` since that directory is for generated code.

**Why**: The `ui/` directory convention is "auto-generated, do not hand-edit." A single smoke-test suite one level up verifies that all primitives render without cluttering the generated directory.

---

## Dependency Categorization

**When to use**: When adding new npm packages.

- **`dependencies`**: Packages whose code/CSS is imported into `src/` files at runtime (React, Radix, clsx, tw-animate-css, etc.)
- **`devDependencies`**: Build-time, test-time, or lint-time only tools (Vite, Tailwind, Vitest, ESLint, Prettier, Playwright, shadcn CLI, etc.)

**Why**: Keeps the dependency manifest accurate even though Vite tree-shakes everything regardless.

---

## Data Layer (Dexie.js)

**When to use**: For all persistent data operations (conversations, messages, settings).

- Database schema is defined in `src/lib/db/schema.ts` as a singleton `db` instance
- TypeScript types for all tables live in `src/lib/db/types.ts`
- Data access functions are organized by table: `conversations.ts`, `messages.ts`, `settings.ts`
- Barrel export at `src/lib/db/index.ts` re-exports everything
- Import runtime values (functions, `db` instance) from the barrel `@/lib/db`
- Import types from `@/lib/db/types` directly (type-only imports)

**Example**:
```ts
// Runtime functions and db instance from barrel
import { createConversation, addMessage, getSettings, db } from '@/lib/db'

// Type-only imports from types module directly
import type { Conversation, Provider, Message } from '@/lib/db/types'
```

**Why**: Keeps the data layer modular and testable. The barrel export provides a clean public API while internal files can be refactored freely. Separating types from schema from access functions prevents circular dependencies.

### Data Access Function Conventions
- All functions are `async` (Dexie operations return Promises)
- Create functions accept `*Input` types and return the auto-generated `id`
- Timestamps (`createdAt`, `updatedAt`, `timestamp`) are set automatically by the access functions, not the caller
- `updateConversation` auto-bumps `updatedAt`
- `deleteConversation` cascades to messages using a Dexie transaction
- Settings is a singleton (always `id=1`); `getSettings()` auto-initializes on first run using `put` (upsert) to avoid race conditions
- `updateSettings()` shallow-merges nested objects (`apiKeys`, `selectedModels`) — callers can update a single provider key without overwriting others

---

## Zustand Store

**When to use**: For all ephemeral UI state (not persisted to IndexedDB).

- Store lives at `src/lib/store.ts`
- Split into `AppState` (data) and `AppActions` (setters) interfaces, composed as `AppStore = AppState & AppActions`
- Use selector-based access (one selector per field) to minimize re-renders
- Import from `@/lib/store`

**Example**:
```tsx
import { useAppStore } from '@/lib/store'

// Good — granular selectors, only re-renders when that field changes
const activeId = useAppStore((s) => s.activeConversationId)
const setActiveId = useAppStore((s) => s.setActiveConversationId)

// Bad — subscribes to entire store, re-renders on any change
const store = useAppStore()
```

**Testing**: Reset store in `beforeEach` to prevent state leakage between tests:
```ts
import { useAppStore } from '@/lib/store'

beforeEach(() => {
  useAppStore.setState({ activeConversationId: null, sidebarOpen: false })
})
```

**Why**: Zustand is lightweight (~1 KB), has no provider wrappers, and works outside React components. Granular selectors prevent cascading re-renders from streaming updates.

---

## Reactive Data with useLiveQuery

**When to use**: When a React component needs to reactively display data from Dexie (IndexedDB).

- Import `useLiveQuery` from `dexie-react-hooks`
- Always provide a dependency array as the second argument
- Handle the `undefined` return (loading state) before checking for empty data
- Prefer calling data access functions from `@/lib/db` inside the callback rather than raw Dexie queries
- When returning an empty array for a null/skipped query, cast it: `return [] as Message[]`

**Example**:
```tsx
import { useLiveQuery } from 'dexie-react-hooks'
import { getMessagesByThread } from '@/lib/db'
import type { Message } from '@/lib/db/types'

const messages = useLiveQuery(() => {
  if (activeConversationId === null) return [] as Message[]
  return getMessagesByThread(activeConversationId, provider)
}, [activeConversationId, provider])

// Handle loading vs empty
if (messages === undefined) return <Loading />
if (messages.length === 0) return <EmptyState />
```

**Why**: `useLiveQuery` automatically re-renders the component when the underlying Dexie data changes, even across browser tabs. Using data access functions inside the callback keeps query logic in the data layer while still enabling Dexie's reactive tracking.

---

## React.memo for Stream Isolation

**When to use**: Wrap model columns (and similar independently-updating components) in `React.memo`.

**Example**:
```tsx
import { memo } from 'react'

export const ModelColumn = memo(function ModelColumn({ provider, label }: Props) {
  // Component body
})
```

**Why**: When three AI models stream tokens simultaneously, each column receives high-frequency updates. `React.memo` prevents tokens arriving for one provider from re-rendering the other columns. Use a named function (not an arrow function) inside `memo()` for better debugging in React DevTools.

---

## Responsive Desktop/Mobile Pattern

**When to use**: When a component needs fundamentally different rendering on desktop vs mobile (not just layout changes).

- Render both variants simultaneously, use Tailwind responsive classes (`hidden md:block` / `md:hidden`) for visibility
- For interactive overlays (Sheet, Dialog), pass an `onAfterAction` callback only to the mobile variant so it can auto-close; the desktop variant stays open on interaction

**Example** (ConversationSidebar pattern):
```tsx
// Desktop: inline panel, stays open on interaction
{sidebarOpen && (
  <aside className="hidden w-64 border-r md:block">
    <SidebarContent onNewConversation={onNew} />
  </aside>
)}

// Mobile: Sheet overlay, closes on interaction
<Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
  <SheetContent className="md:hidden">
    <SidebarContent onNewConversation={onNew} onAfterAction={closeSheet} />
  </SheetContent>
</Sheet>
```

**Why**: CSS-based visibility is simpler and more reliable than JS media query hooks. The `onAfterAction` pattern cleanly separates desktop (sidebar stays open) from mobile (overlay closes) behavior without conditional logic inside the shared content component.

---

## Testing with Radix Overlays (Sheet, Dialog)

**When to use**: When testing components that include Radix-based overlays (Sheet, Dialog).

- In jsdom, CSS media queries don't apply, so both desktop and mobile variants render simultaneously
- The Sheet's `aria-modal` overlay blocks `getByRole` queries for elements behind it
- **Fix for component isolation**: Set `sidebarOpen: false` in Zustand `beforeEach` when testing components that don't need the sidebar
- **Fix for sidebar tests**: Use `within(container.querySelector('aside')!)` to scope queries to the desktop variant; use `fireEvent.click` instead of `userEvent.click` to bypass pointer-event checks
- **Fix for hidden elements**: The desktop aside has `class="hidden md:block"` which makes it `display: none` in jsdom. Use `{ hidden: true }` option with `getByRole` to find elements inside it
- `ResizeObserver` is globally polyfilled in `src/test/setup.ts` — do not add per-file stubs. The polyfill is required for Radix ScrollArea.

**Why**: These workarounds are necessary because jsdom lacks CSS layout engine features (media queries, computed visibility). Document them here to prevent future developers from debugging the same issues.

---

## Anti-pattern: Editing shadcn/ui Files Casually

**Don't do this**: Make ad-hoc edits to files in `src/components/ui/` without understanding the implications.

**Why it fails**: These files are generated by `npx shadcn add <component>`. Casual edits can break accessibility patterns from Radix UI, conflict with future component additions, or produce inconsistent styling. Prettier will also reformat them from the shadcn default style to our project style, which is fine.

**Do this instead**: If you need custom behavior, create a wrapper component in `src/components/` that imports and extends the shadcn primitive. Only edit `src/components/ui/` files when you have a clear reason and understand the Radix primitives underneath.

---

## Anti-pattern: Raw CSS or Inline Styles

**Don't do this**:
```tsx
<div style={{ backgroundColor: '#1a1a1a', color: 'white' }}>
```

**Why it fails**: Bypasses the Tailwind design system and theme tokens. Inconsistent with the rest of the codebase.

**Do this instead**:
```tsx
<div className="bg-background text-foreground">
```

---

## Cloudflare Pages Functions (API Proxy)

**When to use**: For all server-side proxy code that forwards requests to AI providers.

- Pages Functions live in `functions/` at the project root
- File path maps to route: `functions/api/chat.ts` -> `POST /api/chat`
- Export `onRequestPost` for POST handlers, `onRequestOptions` for CORS preflight
- The `PagesFunction` type from `@cloudflare/workers-types` is available globally (no import needed)
- Functions have their own `functions/tsconfig.json` separate from the app's TS config
- Use `createOpenRouter()` with `{ apiKey }` for BYOK pattern (all providers route through OpenRouter)
- Use `streamText().toUIMessageStreamResponse()` to produce streams compatible with `useChat`
- Pass `providerOptions` to `streamText()` for provider-specific thinking/reasoning config (see `PROVIDER_OPTIONS` map)
- Pass `sendReasoning: true` to `toUIMessageStreamResponse()` to stream reasoning content to the client
- Always add CORS headers to all responses (including error responses)

**Example**:
```ts
import { streamText } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'

export const onRequestPost: PagesFunction = async (context) => {
  const { provider, model, messages, apiKey } = await context.request.json()
  const openrouter = createOpenRouter({ apiKey })
  const result = streamText({
    model: openrouter(model),
    messages,
    providerOptions: PROVIDER_OPTIONS[provider],
  })
  return corsResponse(result.toUIMessageStreamResponse({ sendReasoning: true }))
}
```

**Why**: A unified proxy eliminates CORS issues across all three providers and keeps one code path for streaming, error handling, and testing.

---

## Provider Options for Thinking/Reasoning (`PROVIDER_OPTIONS`)

**When to use**: When configuring provider-specific thinking or reasoning capabilities in the proxy.

- `PROVIDER_OPTIONS` is a static `const` map in `functions/api/chat.ts` keyed by `Provider`
- Each entry contains the `providerOptions` shape expected by the AI SDK for that provider
- Passed to `streamText()` via `providerOptions: PROVIDER_OPTIONS[provider]`
- Thinking is always on — all providers use their highest-quality reasoning mode by default

**Current configuration** (all use `openrouter` SDK key since all providers route through OpenRouter):
| Provider | SDK Key | Config |
|----------|---------|--------|
| Claude | `openrouter` | `thinking: { type: 'adaptive' }` |
| ChatGPT | `openrouter` | `reasoningEffort: 'high'` |
| Gemini | `openrouter` | `reasoning: { effort: 'high' }` |

**Note**: This config is per-provider, not per-model. All models for a given provider share the same thinking config. If a future budget model does not support thinking, this structure will need to become model-aware.

**Why**: Centralizes provider-specific AI SDK configuration in one place. Adding a new provider or changing reasoning depth is a single-map edit. The `as const satisfies` type validates structure at compile time.

---

## Proxy Error Handling

**When to use**: When handling errors in the API proxy.

- Map provider errors to a consistent JSON shape: `{ error: { code, message, provider? } }`
- Use HTTP status codes: 401 (auth), 429 (rate limit), 504 (timeout), 502 (provider outage), 400 (validation), 500 (unknown)
- Provide user-friendly error messages that don't leak raw provider details
- Use the AI SDK's `onError` callback in `toUIMessageStreamResponse()` for mid-stream errors

**Why**: The SPA can display consistent error UI regardless of which provider failed. The error shape is the same for pre-stream (HTTP response) and mid-stream (stream event) errors.

---

## Testing Cloudflare Pages Functions

**When to use**: When writing tests for code in `functions/`.

- Test files co-locate with source: `functions/api/chat.ts` → `functions/api/chat.test.ts`
- `functions/tsconfig.json` excludes `**/*.test.ts` (test files rely on Vitest for types)
- `vitest.config.ts` includes `functions/**/*.test.ts` alongside `src/` tests
- Mock AI SDK modules with `vi.mock()` factories declared before imports
- Create helper functions to build mock `EventContext` objects for `PagesFunction` handlers
- Test through exported handlers (`onRequestPost`, `onRequestOptions`), not internal functions

**Example** (mock pattern for AI SDK):
```ts
const mockStreamText = vi.fn()
vi.mock('ai', () => ({ streamText: mockStreamText }))

const mockCreateOpenRouter = vi.fn()
vi.mock('@openrouter/ai-sdk-provider', () => ({ createOpenRouter: mockCreateOpenRouter }))
```

**Why**: Functions have their own TypeScript project and cannot share types with Vitest globals. Mocking at the module boundary keeps tests fast and avoids real API calls.

---

## useProviderChat Hook Pattern

**When to use**: For all provider chat instances in model columns.

- One `useProviderChat` instance per provider column, wrapping `@ai-sdk/react`'s `useChat`
- `DefaultChatTransport` created once via `useMemo(() => ..., [])`, reads dynamic values (provider, model, API key) through refs at request time
- `prepareSendMessagesRequest` callback reads API key from Dexie settings, converts `UIMessage` parts to `{role, content}` for the proxy
- Persistence sync: user messages saved to Dexie on `send()`, assistant messages on `onFinish`
- Token usage extraction: reads `UIMessage.metadata.usage` in `onFinish`, persists to Dexie, updates `tokenCountMap` state
- Message seeding: loads from Dexie when `conversationId` changes, clears on null; also populates `crossFeedIds` and `tokenCountMap` from Dexie records
- Streaming status synced to Zustand store via `useEffect` for cross-component reactivity

**Example**:
```tsx
const { messages, send, isLoading, error, stop, clearError, crossFeedIds, tokenCountMap } = useProviderChat({
  provider: 'claude',
  conversationId: activeConversationId,
  model: 'claude-sonnet-4-6',
})

// Regular send
await send('Hello')

// Cross-feed send with metadata
await send(crossFeedText, { isCrossFeed: true, crossFeedRound: 1 })
```

**Why**: Encapsulates all streaming, persistence, and state sync concerns in a single hook. Each column is fully self-contained — the parent only needs to call `send()`. Cross-feed metadata (`SendOptions`) is threaded through to Dexie persistence via `pendingCrossFeedRef` so `onFinish` can tag the assistant response.

---

## Imperative Ref Pattern for Cross-Component Messaging

**When to use**: When a parent needs to trigger actions on child components (e.g., sending messages to multiple columns concurrently).

- Child exposes a handle type via `forwardRef` + `useImperativeHandle`
- Parent stores a `useRef<HandleType>` and calls methods in event handlers (never during render)
- Streaming/loading status shared via Zustand store, not by reading refs during render

**Example**:
```tsx
// Child component
export interface ModelColumnHandle {
  send: (text: string, options?: SendOptions) => Promise<boolean>
}

export const ModelColumn = memo(
  forwardRef(function ModelColumn(props, ref: ForwardedRef<ModelColumnHandle>) {
    useImperativeHandle(ref, () => ({ send }), [send])
    // ...
  }),
)

// Parent
const claudeRef = useRef<ModelColumnHandle>(null)
const handleSend = async (text: string) => {
  await claudeRef.current?.send(text)
}
```

**Why**: Avoids prop-drilling callback chains and keeps the parent's send orchestration imperative while each column manages its own streaming state.

---

## Streaming Status via Zustand Store

**When to use**: When hook-local state (like `useChat`'s `status`) needs to be read by sibling or parent components during render.

- Each `useProviderChat` syncs its loading state to `useAppStore.streamingStatus[provider]` via `useEffect`
- Other components read `streamingStatus` from the store with granular selectors
- Never read imperative handle refs during render (violates React 19 rules)

**Example**:
```tsx
// Inside useProviderChat
useEffect(() => {
  const isActive = status === 'submitted' || status === 'streaming'
  setStreamingStatus(provider, isActive)
}, [status, provider, setStreamingStatus])

// In InputBar or App
const isAnyStreaming = useAppStore(
  (s) => s.streamingStatus.claude || s.streamingStatus.chatgpt || s.streamingStatus.gemini,
)
```

**Testing**: Reset `streamingStatus` in `beforeEach`:
```ts
useAppStore.setState({
  activeConversationId: null,
  sidebarOpen: false,
  streamingStatus: { claude: false, chatgpt: false, gemini: false },
})
```

**Why**: Zustand selectors are safe to read during render and minimize re-renders via equality checks.

---

## Anti-pattern: Reading Imperative Refs During Render

**Don't do this**:
```tsx
// In a parent component's render body
const isLoading = claudeRef.current?.isLoading // React 19 ESLint error
```

**Why it fails**: React 19's `react-hooks/refs` rule prohibits reading `ref.current` during render because refs are not tracked by React's reactivity system. The value may be stale or cause inconsistent renders.

**Do this instead**: Sync derived state to a Zustand store via `useEffect` in the child, and read it from the store in the parent/sibling (see "Streaming Status via Zustand Store" pattern above).

---

## Model & Provider Constants (`src/lib/models.ts`)

**When to use**: When referencing model IDs, display names, or provider-level display constants.

- `PROVIDERS`: Frozen array of all provider keys, derived from `MODEL_OPTIONS`. Use this instead of hardcoding `['claude', 'chatgpt', 'gemini']`.
- `MODEL_OPTIONS`: Per-provider lists of available models (id + label), ordered by preference (default first)
- `DEFAULT_MODELS`: Per-provider default model IDs, derived from `MODEL_OPTIONS[provider][0].id`. Used by Zustand store and Dexie settings to avoid duplicating model IDs.
- `MODEL_DISPLAY_NAMES`: Flat map from model ID to display name
- `getModelDisplayName(modelId)`: Lookup with fallback to raw ID for unknown models
- `PROVIDER_LABELS`: Human-readable provider names (`claude` → `'Claude'`)
- `PROVIDER_COLORS`: Tailwind accent color classes per provider (`claude` → `'bg-chart-1'`)

**Example**:
```ts
import { getModelDisplayName, PROVIDER_COLORS, PROVIDER_LABELS } from '@/lib/models'

// In a component
<span>{getModelDisplayName('claude-sonnet-4-6')}</span> // → "Sonnet 4.6"
<div className={cn('h-2 w-2 rounded-full', PROVIDER_COLORS[provider])} />
```

**Why**: Centralizes all model/provider display metadata in one module. When providers release new models, update only `src/lib/models.ts`. Both `SettingsDialog` and `ModelColumn` import from here.

---

## Settings Dual-Write Pattern (Dexie + Zustand)

**When to use**: When a user changes a setting that needs both persistence (survives reload) and immediate runtime effect.

- Write to Dexie via `updateSettings()` for persistence
- Update Zustand setter for immediate runtime effect
- API keys only need Dexie (read at request time via `getSettings()` in the transport callback)
- Model selections need both (Zustand `selectedModels` drives `useProviderChat`)
- On app mount, `App.tsx` syncs persisted settings from Dexie → Zustand

**Example**:
```ts
// In SettingsDialog — model change needs dual-write
const handleModelChange = async (modelId: string) => {
  await updateSettings({ selectedModels: { [provider]: modelId } })
  setSelectedModel(provider, modelId) // Zustand for immediate effect
}

// OpenRouter API key change only needs Dexie (read at request time)
const handleApiKeyChange = (value: string) => {
  updateSettings({ apiKeys: { openrouter: value } })
}
```

**Why**: Dexie is the source of truth for persistence. Zustand is the source of truth for runtime. The dual-write keeps them in sync without adding a reactive subscription from Zustand to Dexie.

---

## Debounced Input Saving

**When to use**: When a text input persists each change to Dexie (or any async store).

- Maintain local `useState` for the input value (instant visual feedback)
- Sync from parent prop via `useEffect` when external data changes
- Debounce the Dexie write with `setTimeout` (~300ms)
- Clean up the timer on unmount

**Example**:
```tsx
const [localValue, setLocalValue] = useState(propValue)
const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

useEffect(() => { setLocalValue(propValue) }, [propValue])

const handleChange = (value: string) => {
  setLocalValue(value)
  if (debounceRef.current) clearTimeout(debounceRef.current)
  debounceRef.current = setTimeout(() => {
    updateSettings({ apiKeys: { [provider]: value } })
  }, 300)
}

useEffect(() => () => {
  if (debounceRef.current) clearTimeout(debounceRef.current)
}, [])
```

**Why**: Without debouncing, each keystroke fires a full Dexie read-write transaction. For a 50-character API key, that is 50 sequential IndexedDB transactions. Debouncing batches rapid changes into a single write.

---

## Cross-Feed: Pure Functions for Message Construction

**When to use**: When building features that construct messages or transform data before sending to providers.

- Keep message construction logic in pure utility functions (`src/lib/crossfeed.ts`)
- Separate orchestration (React hooks, callbacks) from data transformation
- Pure functions are trivially testable — no mocking needed

**Example**:
```ts
import { buildCrossFeedMessages, findLastAssistant, getNextCrossFeedRound } from '@/lib/crossfeed'

// Pure functions — no side effects, easy to test
const messages = buildCrossFeedMessages({ claude: '...', chatgpt: '...', gemini: '...' })
const lastAssistant = findLastAssistant(messageArray)
const round = getNextCrossFeedRound(claudeMsgs, chatgptMsgs, geminiMsgs)
```

**Why**: Pure functions are the most testable unit of code. The 24 cross-feed unit tests run in ~2ms total. Keeping message construction separate from React orchestration means the logic can be reused if cross-feed evolves (e.g., selective provider cross-feed, custom prompts).

---

## SendOptions Metadata Threading via Ref

**When to use**: When request-specific metadata needs to travel from `send()` to `onFinish()` through the AI SDK's streaming lifecycle.

- Store metadata in a ref (`pendingCrossFeedRef`) before sending
- Read the ref in `onFinish` to tag the persisted assistant message
- Clear the ref after persistence completes

**Example**:
```ts
// In send()
pendingCrossFeedRef.current = options ?? {}
await sendMessage({ text })

// In onFinish
const crossFeedOpts = pendingCrossFeedRef.current
await addMessage({ ...msgData, isCrossFeed: crossFeedOpts.isCrossFeed })
pendingCrossFeedRef.current = {}
```

**Why**: The AI SDK's `useChat` does not provide a way to attach arbitrary metadata to a request that flows through to `onFinish`. A ref bridges this gap without modifying the transport or message format. Each hook instance has its own ref, so concurrent cross-feed sends across providers are safe.

---

## useLiveQuery for Boolean Availability Checks

**When to use**: When a UI element needs to reactively enable/disable based on Dexie data state.

- Return a boolean from `useLiveQuery`, not full data objects
- Provide a default value (third argument) for the loading state
- Use count queries or existence checks for efficiency

**Example**:
```tsx
const hasCrossFeedContent = useLiveQuery(
  async () => {
    if (activeConversationId === null) return false
    const counts = await Promise.all(
      providers.map((p) => db.messages.where(...).filter(...).count()),
    )
    return counts.every((c) => c > 0)
  },
  [activeConversationId],
  false, // default while loading
)
```

**Why**: `useLiveQuery` re-runs on any Dexie table change. Returning a boolean minimizes re-render impact — the component only updates when the boolean flips, not on every message write.

---

## Zustand `getState()` in Event Handlers to Avoid Stale Closures

**When to use**: When an event handler fires after a delay (e.g., confirmation dialog) and needs the latest Zustand value, not the value from when the callback was created.

**Example**:
```tsx
// Bad — stale closure if activeConversationId changes while dialog is open
const handleDelete = useCallback(async (id: number) => {
  await deleteConversation(id)
  if (activeConversationId === id) {  // May be stale!
    setActiveConversationId(null)
  }
}, [activeConversationId, setActiveConversationId])

// Good — reads fresh value at execution time
const handleDelete = useCallback(async (id: number) => {
  await deleteConversation(id)
  if (useAppStore.getState().activeConversationId === id) {
    setActiveConversationId(null)
  }
}, [setActiveConversationId])
```

**Why**: `useCallback` closures capture values at creation time. When a confirmation dialog stays open while the user interacts elsewhere, the closed-over value can become stale. `useAppStore.getState()` reads the latest value synchronously at call time. This is safe in event handlers (not during render).

---

## Inline Edit Pattern for Sidebar Items

**When to use**: When a list item needs in-place rename/edit capability.

- Trigger: hover-reveal pencil button enters edit mode
- Confirm: Enter key or input blur
- Cancel: Escape key or X button
- Use `onMouseDown` + `preventDefault` on confirm/cancel buttons to prevent blur firing before click

**Example**:
```tsx
// Cancel button prevents blur from firing confirmRename before cancel runs
<Button
  onMouseDown={(e) => e.preventDefault()}  // Prevents onBlur from firing first
  onClick={cancelRename}
  aria-label="Cancel rename"
>
  <XIcon />
</Button>
```

**Why**: When focus leaves an input, `onBlur` fires before `onClick` on a sibling button. Without `preventDefault` on `mouseDown`, clicking cancel would trigger the blur handler (which confirms) before the cancel handler runs. This pattern ensures the user's intent (cancel) takes priority.

---

## Token Usage Extraction Pipeline (Proxy → Client)

**When to use**: When structured metadata needs to flow from the Cloudflare proxy to the client alongside a streamed response.

- Proxy: Use `messageMetadata` callback in `toUIMessageStreamResponse()` to extract data from stream events (e.g., `finish` event for token usage)
- Proxy: Pass `sendReasoning: true` to `toUIMessageStreamResponse()` to include thinking/reasoning content in the stream alongside regular text
- Client: Read `UIMessage.metadata` in `useProviderChat`'s `onFinish` callback
- Persist to Dexie and update local state (e.g., `tokenCountMap`)

**Example**:
```ts
// Proxy (functions/api/chat.ts)
result.toUIMessageStreamResponse({
  messageMetadata: ({ part }) => {
    if (part.type === 'finish') {
      return { usage: { inputTokens: part.totalUsage.inputTokens ?? 0, outputTokens: part.totalUsage.outputTokens ?? 0 } }
    }
    return undefined
  },
})

// Client (useProviderChat.ts onFinish)
const metadata = message.metadata as { usage?: { inputTokens?: number; outputTokens?: number } } | undefined
const tokenCount = metadata?.usage ? { input: metadata.usage.inputTokens ?? 0, output: metadata.usage.outputTokens ?? 0 } : null
```

**Why**: The AI SDK's `messageMetadata` callback is the standard way to send structured data alongside a stream. This avoids custom stream parsing or separate API calls. The pattern is reusable for any metadata (e.g., model version, safety flags).

---

## Popover-Gated Queries

**When to use**: When a Popover (or similar overlay) displays data from expensive queries that should not run continuously.

- Control the Popover with `[open, setOpen] = useState(false)` and `<Popover open={open} onOpenChange={setOpen}>`
- Render the query-executing content only when open: `{open && <PopoverContent />}`
- The inner component mounts/unmounts with the popover, so `useLiveQuery` subscriptions are active only while visible

**Example**:
```tsx
function UsageSummary() {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button>Usage</Button></PopoverTrigger>
      <PopoverContent>
        {open && <UsagePopoverContent />}
      </PopoverContent>
    </Popover>
  )
}

function UsagePopoverContent() {
  // useLiveQuery only runs while popover is open
  const data = useLiveQuery(() => db.messages.toArray(), [])
  // ...
}
```

**Why**: `useLiveQuery` re-subscribes to Dexie table changes. Without gating, every message write triggers query re-evaluation even when the popover is closed. Conditional rendering ensures queries only run when the user actually views the data.

---

## Lazy-Loaded Feature Modules via Dynamic Import

**When to use**: When a feature module (export, analytics, etc.) is only needed on explicit user action and should not bloat the main bundle.

- Use dynamic `import()` at the point of invocation (e.g., inside an event handler)
- Vite automatically code-splits dynamic imports into separate chunks
- Load multiple modules in parallel with `Promise.all([import(...), import(...)])`

**Example**:
```ts
async function performExport() {
  const [exportModule, downloadModule] = await Promise.all([
    import('@/lib/export'),
    import('@/lib/download'),
  ])
  const content = exportModule.exportConversationToJson(data)
  downloadModule.downloadJson(content, filename)
}
```

**Why**: Keeps the main bundle small (performance strategy target: < 200 KB gzipped). Export logic (~3 KB combined) is only loaded when the user actually clicks an export action. Vite handles chunk naming and cache-busting automatically.

---

## Pure Functions for Data Transformation

**When to use**: For any feature that transforms data (export, cross-feed, pricing, etc.) without side effects.

- Keep transformation logic in `src/lib/*.ts` as pure functions
- Separate I/O (Dexie reads, DOM manipulation) from data transformation
- The calling component or handler orchestrates I/O and passes data to pure functions
- Pure functions accept typed inputs and return typed outputs -- no global state or side effects

**Example** (from export):
```ts
// Pure function -- no side effects, trivially testable
export function exportConversationToJson(data: ExportableConversation): string {
  return JSON.stringify(toConversationJson(data), null, 2)
}

// Orchestration in the component reads from Dexie, calls pure function, triggers download
const conversation = await getConversation(id)
const messages = await getMessagesByConversation(id)
const content = exportConversationToJson({ conversation, messages })
downloadJson(content, filename)
```

**Why**: Consistent with the established patterns from `crossfeed.ts` and `pricing.ts`. Pure functions are the most testable unit -- no mocking needed. I/O orchestration stays in the component where it is visible and debuggable.

---

## Responsive Touch Target Sizing

**When to use**: For all interactive elements (buttons, links, tappable areas) that need to work on mobile.

- Use `h-10 w-10 sm:h-8 sm:w-8` for icon buttons (40px on mobile, 32px on desktop)
- Use `min-h-[44px] sm:min-h-0` for list items and sidebar entries
- Apply consistently across TopBar, sidebar, and overlay trigger buttons

**Example**:
```tsx
<Button
  variant="ghost"
  size="icon"
  className="h-10 w-10 sm:h-8 sm:w-8"
  aria-label="Toggle sidebar"
>
  <MenuIcon className="h-4 w-4" />
</Button>
```

**Why**: Apple and WCAG guidelines recommend minimum 44px touch targets on mobile. The responsive class pattern keeps desktop buttons compact while ensuring comfortable mobile tapping. Using `sm:` breakpoint (640px) as the cutoff matches the project's mobile/desktop boundary.

---

## Global Keyboard Shortcuts via `useKeyboardShortcuts` Hook

**When to use**: When adding app-wide keyboard shortcuts that should work regardless of which component has focus.

- All shortcuts live in `src/hooks/useKeyboardShortcuts.ts`
- Register handlers via `useEffect` on `document` `keydown`
- Use `e.metaKey || e.ctrlKey` to detect Cmd (macOS) / Ctrl (Windows/Linux)
- Call `e.preventDefault()` to prevent browser default behavior
- New shortcuts should be added to this hook, not scattered across components

**Example**:
```ts
useKeyboardShortcuts({
  onNewConversation: handleNewConversation,
  onSearchOpen: () => setSearchOpen(true),
})
```

**Why**: Centralizing keyboard shortcuts in one hook prevents conflicts between components, makes discoverability easy (one file to check), and ensures cleanup is handled via the `useEffect` return.

---

## CSS Animations with Reduced Motion Support

**When to use**: When adding any CSS animation or transition.

- Always pair animations with a `@media (prefers-reduced-motion: reduce)` override
- Place the override immediately after the animation definition in `src/index.css`

**Example**:
```css
.conversation-fade-in {
  animation: conversationFadeIn 200ms ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .conversation-fade-in {
    animation: none;
  }
}
```

**Why**: Users with vestibular disorders or motion sensitivity configure their OS to reduce motion. Respecting this preference is both an accessibility requirement (WCAG 2.3.3) and good UX practice.

---

## Safe-Area Inset Padding for iOS PWA

**When to use**: For elements pinned to the bottom of the viewport (input bars, toolbars) that could be obscured by the iOS home indicator in standalone PWA mode.

**Example**:
```tsx
<footer className="pb-[max(0.75rem,env(safe-area-inset-bottom))]">
```

**Why**: When installed as a PWA with `display: standalone`, the app runs without the Safari chrome. On iPhones with a home indicator bar, bottom-pinned elements can be obscured. `env(safe-area-inset-bottom)` provides the safe padding. Using `max()` ensures a minimum padding even on devices without the inset.

---

## Flex Overflow Containment

**When to use**: When a flex child contains scrollable content (e.g., `ScrollArea`) and must not grow beyond its parent's bounds.

**Example**:
```tsx
// Every flex child in the chain from viewport to scroll container needs min-h-0
<div className="flex h-dvh flex-col">
  <header className="shrink-0" />
  <div className="flex min-h-0 flex-1 flex-col">
    <ScrollArea className="min-h-0 flex-1">
      {/* scrollable content */}
    </ScrollArea>
  </div>
</div>
```

**Why**: Flex children default to `min-height: auto`, which prevents them from shrinking below their content height. This causes scrollable containers to expand to fit all content instead of activating overflow scrolling. Adding `min-h-0` (`min-height: 0`) overrides this default. Every flex child in the chain from the viewport root to the scroll container needs `min-h-0` — a single missing link breaks the entire scroll containment. Add `overflow-hidden` on the direct parent of the scroll area as a second layer of defense.

---

## OpenRouter Unified Routing

**When to use**: For all AI provider API calls. All providers (Claude, ChatGPT, Gemini) route through OpenRouter by default.

- The proxy uses `createOpenRouter()` exclusively — no direct provider adapters imported
- Model IDs are mapped from internal format (e.g., `claude-sonnet-4-6`) to OpenRouter format (e.g., `anthropic/claude-sonnet-4-6`) on the client side before sending to the proxy
- `OPENROUTER_MODEL_MAP` in `src/lib/models.ts` holds the mapping; `toOpenRouterModelId()` resolves with passthrough fallback
- The client reads `settings.apiKeys.openrouter` (not per-provider keys)
- Per-provider `apiKeys` fields exist in the Dexie schema but are not used at runtime (reserved for future direct API feature)

**Example**:
```ts
import { toOpenRouterModelId } from '@/lib/models'

// Client-side: map model ID before sending to proxy
const openRouterModelId = toOpenRouterModelId(selectedModels[provider])
// → 'claude-sonnet-4-6' becomes 'anthropic/claude-sonnet-4-6'
// → 'google/gemini-3.1-pro-preview' stays unchanged (already OpenRouter format)
```

**Why**: One API key gives full access to all three providers. Simplifies onboarding and reduces settings complexity. The mapping layer means stored data (Dexie model selections) uses stable internal IDs — changing the routing layer doesn't require data migration.

---

## Anti-pattern: Missing `min-h-0` in Flex Scroll Chain

**Don't do this**:
```tsx
<div className="flex flex-1 flex-col">
  <ScrollArea className="flex-1">
    {/* Content grows unboundedly — no scrolling */}
  </ScrollArea>
</div>
```

**Why it fails**: Without `min-h-0`, the flex child's minimum height is determined by its content. The ScrollArea expands to fit all messages instead of activating its internal scroll viewport. Content overflows the intended boundaries.

**Do this instead**:
```tsx
<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
  <ScrollArea className="min-h-0 flex-1">
    {/* Content scrolls within constrained bounds */}
  </ScrollArea>
</div>
```


## Council stage boundaries and persistence

Keep Council prompts, permutations, ranking validation and transitions in `src/lib/council/`, not React components. Each stage runs peers concurrently, checkpoints successful requests, and waits for explicit user action on failures. Retry only incomplete requests. Never persist an API key in a run or log a raw provider error. Preserve every reported attempt's usage and text. Translate critique labels through their saved mapping before synthesis uses a new anonymous permutation. Tests inject the model caller and use fake IndexedDB.
