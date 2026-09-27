import { indexedDBUtils } from 'jimu-core'
import { isExperienceState, isSavedExperienceState, type ExperienceState, type SavedExperienceState } from './state-file'

// States live in IndexedDB (like the built-in experience state, Draw and Add Data) because drawings can easily
// exceed the ~5 MB localStorage quota. `IndexedDBCache` puts the app id in the database name, so every
// experience has its own states, shared by all instances of this widget in that experience.
const WIDGET_NAME = 'save-experience-state'
const LAST_SESSION_KEY = 'last-session'

// Keys used by the first version of this widget, which stored everything in localStorage.
const LEGACY_SAVED_KEY_PREFIX = 'save-experience-state:saved:'
const LEGACY_SESSION_KEY_PREFIX = 'save-experience-state:last-session:'

export interface LastSession {
  savedAt: string
  state: ExperienceState
}

export interface StateStore {
  init: () => Promise<void>
  close: () => void
  loadSavedStates: () => Promise<SavedExperienceState[]>
  putSavedStates: (states: SavedExperienceState[]) => Promise<void>
  deleteSavedState: (id: string) => Promise<void>
  loadLastSession: () => Promise<LastSession | null>
  putLastSession: (state: ExperienceState) => Promise<void>
}

function takeLegacyItem (key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    window.localStorage.removeItem(key)
    return JSON.parse(raw)
  } catch {
    return null
  }
}

const byNewest = (a: SavedExperienceState, b: SavedExperienceState) => b.createdAt.localeCompare(a.createdAt)

export function createStateStore (appId: string): StateStore {
  const saved = new indexedDBUtils.IndexedDBCache('saved-states', WIDGET_NAME, 'states')
  const session = new indexedDBUtils.IndexedDBCache('last-session', WIDGET_NAME, 'session')

  const migrateFromLocalStorage = async () => {
    const legacyStates = takeLegacyItem(LEGACY_SAVED_KEY_PREFIX + appId)
    if (Array.isArray(legacyStates)) {
      const valid = legacyStates.filter(isSavedExperienceState)
      if (valid.length > 0) await saved.putAll(valid.map(s => ({ key: s.id, value: s })))
    }
    const legacySession = takeLegacyItem(LEGACY_SESSION_KEY_PREFIX + appId)
    if (legacySession) await session.put(LAST_SESSION_KEY, legacySession)
  }

  return {
    init: async () => {
      await Promise.all([saved.init(), session.init()])
      await migrateFromLocalStorage()
    },
    close: () => {
      saved.close()
      session.close()
    },
    loadSavedStates: async () => ((await saved.getAll()) as unknown[]).filter(isSavedExperienceState).sort(byNewest),
    putSavedStates: states => saved.putAll(states.map(s => ({ key: s.id, value: s }))),
    deleteSavedState: id => saved.delete(id),
    loadLastSession: async () => {
      const value = await session.get(LAST_SESSION_KEY) as LastSession
      return value && typeof value.savedAt === 'string' && isExperienceState(value.state) ? value : null
    },
    putLastSession: state => session.put(LAST_SESSION_KEY, { savedAt: new Date().toISOString(), state })
  }
}
