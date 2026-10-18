vi.mock('@/lib/council/transport', () => ({
  loadCatalog: vi.fn().mockResolvedValue([]),
}))
/**
 * Component tests for SettingsDialog.
 *
 * Uses fake-indexeddb for Dexie's useLiveQuery. Tests the dialog trigger,
 * the unified OpenRouter API key input with show/hide toggle, model selectors,
 * and the first-run pulse animation on the gear icon.
 */

import 'fake-indexeddb/auto'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsDialog } from '@/components/SettingsDialog'
import { useAppStore } from '@/lib/store'
import { db, updateSettings } from '@/lib/db'
import { clearAllTables, deleteDatabase } from '@/test/db-helpers'

// Radix Select calls scrollIntoView on items, which jsdom doesn't implement
Element.prototype.scrollIntoView = vi.fn()

beforeEach(async () => {
  useAppStore.setState({
    activeConversationId: null,
    sidebarOpen: false,
    selectedModels: {
      claude: 'claude-sonnet-4-6',
      chatgpt: 'gpt-5.2',
      gemini: 'gemini-2.5-flash',
    },
    streamingStatus: { claude: false, chatgpt: false, gemini: false },
  })
  await clearAllTables()
})

afterAll(async () => {
  await deleteDatabase()
})

describe('SettingsDialog', () => {
  describe('trigger button', () => {
    it('renders a settings button with gear icon', () => {
      render(<SettingsDialog />)
      expect(
        screen.getByRole('button', { name: 'Settings' }),
      ).toBeInTheDocument()
    })

    it('pulses when no OpenRouter API key is configured', async () => {
      render(<SettingsDialog />)

      // Wait for useLiveQuery to resolve (settings get auto-initialized with empty keys)
      await waitFor(() => {
        const button = screen.getByRole('button', { name: 'Settings' })
        expect(button.className).toContain('animate-pulse')
      })
    })

    it('does not pulse when OpenRouter API key is configured', async () => {
      await updateSettings({ apiKeys: { openrouter: 'sk-or-test-key' } })

      render(<SettingsDialog />)

      await waitFor(() => {
        const button = screen.getByRole('button', { name: 'Settings' })
        expect(button.className).not.toContain('animate-pulse')
      })
    })
  })

  describe('dialog content', () => {
    async function openDialog() {
      const user = userEvent.setup()
      render(<SettingsDialog />)
      await user.click(screen.getByRole('button', { name: 'Settings' }))

      // Wait for dialog to open (Radix renders in a portal)
      await waitFor(() => {
        expect(screen.getByText('Settings')).toBeInTheDocument()
      })
      return user
    }

    it('shows dialog title and description when opened', async () => {
      await openDialog()

      expect(screen.getByText('Settings')).toBeInTheDocument()
      expect(
        screen.getByText(/One API key for all providers/),
      ).toBeInTheDocument()
    })

    it('shows a link to openrouter.ai/keys', async () => {
      await openDialog()

      const link = screen.getByRole('link', { name: 'openrouter.ai/keys' })
      expect(link).toHaveAttribute('href', 'https://openrouter.ai/keys')
      expect(link).toHaveAttribute('target', '_blank')
    })

    it('shows a single OpenRouter API key input', async () => {
      await openDialog()

      expect(screen.getByText('OpenRouter API Key')).toBeInTheDocument()
      const input = screen.getByLabelText('OpenRouter API Key')
      expect(input).toBeInTheDocument()
      expect(input).toHaveAttribute('type', 'password')
    })

    it('shows all three provider names in the Models section', async () => {
      await openDialog()

      expect(screen.getByText('Claude')).toBeInTheDocument()
      expect(screen.getByText('ChatGPT')).toBeInTheDocument()
      expect(screen.getByText('Gemini')).toBeInTheDocument()
    })

    it('shows Models section header', async () => {
      await openDialog()

      expect(
        screen.getByText('Compare / Cross-feed models'),
      ).toBeInTheDocument()
    })

    it('API key input defaults to password type (masked)', async () => {
      await openDialog()

      const input = screen.getByLabelText('OpenRouter API Key')
      expect(input).toHaveAttribute('type', 'password')
    })

    it('shows placeholder text for the OpenRouter API key input', async () => {
      await openDialog()

      const input = screen.getByPlaceholderText('sk-or-...')
      expect(input).toBeInTheDocument()
    })
  })

  describe('API key show/hide toggle', () => {
    it('toggles API key visibility from password to text', async () => {
      const user = userEvent.setup()
      render(<SettingsDialog />)
      await user.click(screen.getByRole('button', { name: 'Settings' }))

      await waitFor(() => {
        expect(screen.getByText('Settings')).toBeInTheDocument()
      })

      const input = screen.getByLabelText('OpenRouter API Key')
      expect(input).toHaveAttribute('type', 'password')

      // Click "Show API key" button
      const showButton = screen.getByRole('button', {
        name: 'Show API key',
      })
      await user.click(showButton)

      // Input should now be text type
      expect(input).toHaveAttribute('type', 'text')
    })

    it('toggles API key visibility from text back to password', async () => {
      const user = userEvent.setup()
      render(<SettingsDialog />)
      await user.click(screen.getByRole('button', { name: 'Settings' }))

      await waitFor(() => {
        expect(screen.getByText('Settings')).toBeInTheDocument()
      })

      // Show the key
      const showButton = screen.getByRole('button', {
        name: 'Show API key',
      })
      await user.click(showButton)

      // Now hide it again
      const hideButton = screen.getByRole('button', { name: 'Hide API key' })
      await user.click(hideButton)

      const input = screen.getByLabelText('OpenRouter API Key')
      expect(input).toHaveAttribute('type', 'password')
    })
  })

  describe('API key persistence', () => {
    it('saves OpenRouter API key to Dexie when changed', async () => {
      const user = userEvent.setup()
      render(<SettingsDialog />)
      await user.click(screen.getByRole('button', { name: 'Settings' }))

      await waitFor(() => {
        expect(screen.getByText('Settings')).toBeInTheDocument()
      })

      const input = screen.getByLabelText('OpenRouter API Key')

      // Use fireEvent.change to set the value directly (avoids userEvent
      // interpreting hyphens as keyboard shortcut modifiers)
      fireEvent.change(input, {
        target: { value: 'sk-or-test-123' },
      })

      // Verify it persisted to Dexie
      await waitFor(async () => {
        const settings = await db.settings.get(1)
        expect(settings?.apiKeys.openrouter).toBe('sk-or-test-123')
      })
    })
  })

  describe('model selection', () => {
    it('updates Zustand store when model is changed', async () => {
      // Initialize settings so useLiveQuery has data
      await updateSettings({
        selectedModels: { claude: 'claude-sonnet-4-6' },
      })

      const user = userEvent.setup()
      render(<SettingsDialog />)
      await user.click(screen.getByRole('button', { name: 'Settings' }))

      await waitFor(() => {
        expect(screen.getByText('Settings')).toBeInTheDocument()
      })

      // Find the Claude model select trigger by its id
      const claudeModelTrigger = document.getElementById(
        'claude-model',
      ) as HTMLElement
      expect(claudeModelTrigger).toBeTruthy()

      // Use fireEvent because Radix Select has pointer-events issues in jsdom
      fireEvent.click(claudeModelTrigger)

      // Wait for dropdown to appear and select a different model
      await waitFor(() => {
        expect(screen.getByText('Opus 4.6 (Max Thinking)')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Opus 4.6 (Max Thinking)'))

      // Verify Zustand store was updated
      await waitFor(() => {
        const { selectedModels } = useAppStore.getState()
        expect(selectedModels.claude).toBe('claude-opus-4-6')
      })
    })

    it('persists model change to Dexie', async () => {
      await updateSettings({
        selectedModels: { claude: 'claude-sonnet-4-6' },
      })

      const user = userEvent.setup()
      render(<SettingsDialog />)
      await user.click(screen.getByRole('button', { name: 'Settings' }))

      await waitFor(() => {
        expect(screen.getByText('Settings')).toBeInTheDocument()
      })

      const claudeModelTrigger = document.getElementById(
        'claude-model',
      ) as HTMLElement
      expect(claudeModelTrigger).toBeTruthy()

      fireEvent.click(claudeModelTrigger)

      await waitFor(() => {
        expect(screen.getByText('Opus 4.6 (Max Thinking)')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Opus 4.6 (Max Thinking)'))

      // Verify Dexie was updated
      await waitFor(async () => {
        const settings = await db.settings.get(1)
        expect(settings?.selectedModels.claude).toBe('claude-opus-4-6')
      })
    })
  })

  describe('first-run detection', () => {
    it('shows pulse when OpenRouter API key is empty', async () => {
      // Initialize settings with empty openrouter key (simulating first run)
      await updateSettings({
        apiKeys: { openrouter: '' },
      })

      render(<SettingsDialog />)

      await waitFor(() => {
        const button = screen.getByRole('button', { name: 'Settings' })
        expect(button.className).toContain('animate-pulse')
      })
    })

    it('stops pulsing when OpenRouter key is set', async () => {
      // Start with no keys
      render(<SettingsDialog />)

      await waitFor(() => {
        const button = screen.getByRole('button', { name: 'Settings' })
        expect(button.className).toContain('animate-pulse')
      })

      // Add a key
      await updateSettings({ apiKeys: { openrouter: 'sk-or-test-key' } })

      // useLiveQuery should re-render and remove the pulse
      await waitFor(() => {
        const button = screen.getByRole('button', { name: 'Settings' })
        expect(button.className).not.toContain('animate-pulse')
      })
    })
  })
})

it('persists a pasted key even when settings immediately unmounts', async () => {
  const view = render(<SettingsDialog />)
  await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
  fireEvent.change(screen.getByLabelText('OpenRouter API Key'), {
    target: { value: 'sk-or-immediate-save-test' },
  })
  view.unmount()
  await waitFor(async () => {
    expect((await db.settings.get(1))?.apiKeys.openrouter).toBe(
      'sk-or-immediate-save-test',
    )
  })
})
