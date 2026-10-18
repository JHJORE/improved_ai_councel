/**
 * Tests for the App shell.
 *
 * Mocks useProviderChat to avoid AI SDK dependencies.
 * Tests layout rendering and Phase 6 tri-model dispatch behavior:
 * 1. handleSend dispatches to all three provider columns
 * 2. One provider failing does not prevent others from receiving messages
 */

import 'fake-indexeddb/auto'

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '@/App'
import { useAppStore } from '@/lib/store'
import { db, updateSettings } from '@/lib/db'
import type { Provider } from '@/lib/db/types'
import { clearAllTables, deleteDatabase } from '@/test/db-helpers'

// Per-provider mock send functions so we can verify each provider received the message
const mockSendClaude = vi.fn().mockResolvedValue(true)
const mockSendChatgpt = vi.fn().mockResolvedValue(true)
const mockSendGemini = vi.fn().mockResolvedValue(true)

const mockSendByProvider: Record<Provider, ReturnType<typeof vi.fn>> = {
  claude: mockSendClaude,
  chatgpt: mockSendChatgpt,
  gemini: mockSendGemini,
}

// Mock useProviderChat with per-provider send functions
vi.mock('@/hooks/useProviderChat', () => ({
  useProviderChat: ({ provider }: { provider: Provider }) => ({
    messages: [],
    status: 'ready',
    error: undefined,
    send: mockSendByProvider[provider],
    stop: vi.fn(),
    clearError: vi.fn(),
    isLoading: false,
  }),
  getMessageText: () => '',
}))

beforeEach(async () => {
  useAppStore.setState({
    activeConversationId: null,
    sidebarOpen: false,
    streamingStatus: { claude: false, chatgpt: false, gemini: false },
  })
  await clearAllTables()
  vi.clearAllMocks()

  // Restore default resolved values after clearAllMocks
  mockSendClaude.mockResolvedValue(true)
  mockSendChatgpt.mockResolvedValue(true)
  mockSendGemini.mockResolvedValue(true)
})

afterAll(async () => {
  await deleteDatabase()
})

vi.mock('@/lib/council/transport', () => ({
  loadCatalog: vi.fn().mockResolvedValue([]),
  createModelCall: vi.fn(),
}))

describe('App', () => {
  it('renders the main layout elements', async () => {
    render(<App />)
    await userEvent.selectOptions(screen.getByLabelText('Mode'), 'compare')
    expect(screen.getByText('Quorum')).toBeInTheDocument()
    expect(screen.getByLabelText('Claude conversation')).toBeInTheDocument()
    expect(screen.getByLabelText('ChatGPT conversation')).toBeInTheDocument()
    expect(screen.getByLabelText('Gemini conversation')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Send message' }),
    ).toBeInTheDocument()
  })
})

describe('Tri-model dispatch (Phase 6)', () => {
  /**
   * Helper: configure an API key so InputBar is enabled, render App,
   * type a message, and submit it.
   */
  async function sendMessage(text: string) {
    await updateSettings({ apiKeys: { openrouter: 'sk-test' } })
    const user = userEvent.setup()
    render(<App />)
    await userEvent.selectOptions(screen.getByLabelText('Mode'), 'compare')

    // Wait for InputBar to become enabled (useLiveQuery needs to resolve)
    const input = await waitFor(() => {
      const el = screen.getByPlaceholderText('Ask all three models...')
      expect(el).not.toBeDisabled()
      return el
    })

    await user.type(input, text)
    await user.click(screen.getByRole('button', { name: 'Send message' }))
  }

  it('dispatches the message to all three providers', async () => {
    await sendMessage('Hello from all three')

    // Wait for all three provider send functions to be called.
    // handleSend is async (creates conversation, then calls Promise.allSettled).
    await waitFor(() => {
      expect(mockSendClaude).toHaveBeenCalledWith('Hello from all three')
      expect(mockSendChatgpt).toHaveBeenCalledWith('Hello from all three')
      expect(mockSendGemini).toHaveBeenCalledWith('Hello from all three')
    })

    // Each provider should have been called exactly once
    expect(mockSendClaude).toHaveBeenCalledTimes(1)
    expect(mockSendChatgpt).toHaveBeenCalledTimes(1)
    expect(mockSendGemini).toHaveBeenCalledTimes(1)
  })

  it('auto-creates a conversation on first message', async () => {
    expect(useAppStore.getState().activeConversationId).toBeNull()

    await sendMessage('First message')

    await waitFor(() => {
      expect(mockSendClaude).toHaveBeenCalled()
    })

    // A conversation should now exist in Dexie and be active in the store
    const conversations = await db.conversations.toArray()
    expect(conversations).toHaveLength(1)
    expect(conversations[0].title).toBe('First message')

    expect(useAppStore.getState().activeConversationId).toBe(
      conversations[0].id,
    )
  })

  it('one provider error does not prevent others from receiving the message', async () => {
    // Make ChatGPT's send reject with an error
    mockSendChatgpt.mockRejectedValue(new Error('ChatGPT API key invalid'))

    await sendMessage('Testing error isolation')

    // Claude and Gemini should still have been called successfully
    await waitFor(() => {
      expect(mockSendClaude).toHaveBeenCalledWith('Testing error isolation')
      expect(mockSendGemini).toHaveBeenCalledWith('Testing error isolation')
    })

    // ChatGPT was also called (it just failed)
    expect(mockSendChatgpt).toHaveBeenCalledWith('Testing error isolation')

    // All three were called exactly once -- the rejection did not prevent dispatching
    expect(mockSendClaude).toHaveBeenCalledTimes(1)
    expect(mockSendChatgpt).toHaveBeenCalledTimes(1)
    expect(mockSendGemini).toHaveBeenCalledTimes(1)
  })

  it('multiple provider errors do not prevent the remaining provider from receiving the message', async () => {
    // Make both Claude and Gemini reject
    mockSendClaude.mockRejectedValue(new Error('Claude rate limited'))
    mockSendGemini.mockRejectedValue(new Error('Gemini quota exceeded'))

    await sendMessage('Two failures')

    await waitFor(() => {
      expect(mockSendChatgpt).toHaveBeenCalledWith('Two failures')
    })

    // All three were called -- Promise.allSettled waits for all, does not short-circuit
    expect(mockSendClaude).toHaveBeenCalledTimes(1)
    expect(mockSendChatgpt).toHaveBeenCalledTimes(1)
    expect(mockSendGemini).toHaveBeenCalledTimes(1)
  })
})
