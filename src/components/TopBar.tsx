/**
 * Top bar with app title, settings, export, new conversation button, and sidebar toggle.
 *
 * Touch targets use min-h/min-w of 44px on mobile for iOS/Android accessibility.
 * Keyboard shortcut hints shown as tooltips via title attributes.
 */

import { MenuIcon, PlusIcon, SearchIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ExportMenu } from '@/components/ExportMenu'
import { SettingsDialog } from '@/components/SettingsDialog'
import { UsageSummary } from '@/components/UsageSummary'
import { useAppStore } from '@/lib/store'

interface TopBarProps {
  onNewConversation: () => void
  onSearchOpen?: () => void
  compareTools?: boolean
  busy?: boolean
}

export function TopBar({
  onNewConversation,
  onSearchOpen,
  compareTools = true,
  busy = false,
}: TopBarProps) {
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)

  return (
    <header
      className="border-border bg-background flex h-12 shrink-0 items-center gap-1 border-b px-2 sm:gap-2 sm:px-4"
      role="banner"
    >
      {compareTools && (
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          aria-label="Toggle sidebar"
          className="h-10 w-10 sm:h-8 sm:w-8"
        >
          <MenuIcon className="h-4 w-4" />
        </Button>
      )}

      <h1 className="text-foreground text-lg font-semibold tracking-tight">
        Quorum
      </h1>

      <div className="flex-1" />

      {compareTools && onSearchOpen && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onSearchOpen}
          aria-label="Search conversations"
          title={`Search conversations (${/(Mac|iPhone|iPad)/.test(navigator.userAgent) ? '⌘' : 'Ctrl+'}K)`}
          className="h-10 w-10 sm:h-8 sm:w-8"
        >
          <SearchIcon className="h-4 w-4" />
        </Button>
      )}

      {compareTools && <ExportMenu />}

      {compareTools && <UsageSummary />}

      <SettingsDialog />

      <Button
        variant="ghost"
        size="icon"
        disabled={busy}
        onClick={onNewConversation}
        aria-label="New conversation"
        title={`New conversation (${/(Mac|iPhone|iPad)/.test(navigator.userAgent) ? '⌘' : 'Ctrl+'}N)`}
        className="h-10 w-10 sm:h-8 sm:w-8"
      >
        <PlusIcon className="h-4 w-4" />
      </Button>
    </header>
  )
}
