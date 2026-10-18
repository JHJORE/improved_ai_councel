/**
 * Data model types for the Quorum IndexedDB schema.
 *
 * These types define the shape of records stored in Dexie tables.
 * Fields ending with `?` are optional on creation (auto-set or nullable).
 */

// ---------------------------------------------------------------------------
// Enums / Union Types
// ---------------------------------------------------------------------------

/** AI provider identifiers. */
export type Provider = 'claude' | 'chatgpt' | 'gemini'

/** Message roles in a conversation thread. */
export type MessageRole = 'user' | 'assistant'

/** Application color theme. */
export type Theme = 'dark' | 'light'

// ---------------------------------------------------------------------------
// Model Config
// ---------------------------------------------------------------------------

/**
 * Per-provider model selection for a conversation.
 * Maps each provider to the model variant ID used in that conversation.
 */
export interface ModelConfig {
  claude: string
  chatgpt: string
  gemini: string
}

// ---------------------------------------------------------------------------
// Token Count
// ---------------------------------------------------------------------------

/** Input/output token counts returned by the AI provider. */
export interface TokenCount {
  input: number
  output: number
}

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

/** A conversation record as stored in IndexedDB. */
export interface Conversation {
  /** Auto-incremented primary key. */
  id?: number
  /** Display title (auto-generated or user-set). */
  title: string
  /** ISO timestamp of creation. */
  createdAt: string
  /** ISO timestamp of last update. */
  updatedAt: string
  /** Per-provider model selection for this conversation. */
  modelConfig: ModelConfig
}

/** Fields accepted when creating a new conversation. */
export interface CreateConversationInput {
  title?: string
  modelConfig: ModelConfig
}

/** Fields that can be updated on an existing conversation. */
export interface UpdateConversationInput {
  title?: string
  modelConfig?: ModelConfig
}

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

/** A message record as stored in IndexedDB. */
export interface Message {
  /** Auto-incremented primary key. */
  id?: number
  /** Foreign key to the parent conversation. */
  conversationId: number
  /** Which AI provider this message belongs to. */
  provider: Provider
  /** Whether this is a user or assistant message. */
  role: MessageRole
  /** Full text content of the message. */
  content: string
  /** ISO timestamp. */
  timestamp: string
  /** Token counts from the API response (null for user messages). */
  tokenCount: TokenCount | null
  /** Whether this message is part of a cross-feed round. */
  isCrossFeed: boolean
  /** Cross-feed round number (null if not a cross-feed message). */
  crossFeedRound: number | null
}

/** Fields accepted when adding a new message. */
export interface AddMessageInput {
  conversationId: number
  provider: Provider
  role: MessageRole
  content: string
  tokenCount?: TokenCount | null
  isCrossFeed?: boolean
  crossFeedRound?: number | null
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Per-provider API key storage. */
export interface ApiKeys {
  bedrock?: string
  claude: string
  chatgpt: string
  gemini: string
  /** OpenRouter API key — used as default for all providers. */
  openrouter: string
}

/** Per-provider selected model IDs. */
export interface SelectedModels {
  claude: string
  chatgpt: string
  gemini: string
}

/** Application settings record (singleton — always id=1). */
export interface Settings {
  /** Always 1 (singleton record). */
  id?: number
  /** API keys per provider. */
  apiKeys: ApiKeys
  /** Selected model IDs per provider. */
  selectedModels: SelectedModels
  /** Color theme. */
  theme: Theme
}

/** Fields that can be updated on settings. All optional for partial updates. */
export interface UpdateSettingsInput {
  apiKeys?: Partial<ApiKeys>
  selectedModels?: Partial<SelectedModels>
  theme?: Theme
}
