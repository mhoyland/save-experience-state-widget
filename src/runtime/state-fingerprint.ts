import type { SavedExperienceState } from './state-file'

// Tells whether a saved state has changes that aren't in a saved file, like Print Studio's template tags.
// When a state is saved to file (or loaded from one), the fingerprint of its name and content is stored with
// it (`fileFingerprint`); comparing that with the current fingerprint gives the tag the list shows. Renaming
// or replacing a state therefore makes it "changed" by itself. It knows a download was started, not that
// the file was kept.

export type StateFileStatus = 'notSaved' | 'changed' | 'saved'

// A short hash of what a file of this state holds. `id`, dates and `fileFingerprint` are left out: loading a
// file gives the state a new id, and the dates don't change what restoring it does. Object keys are sorted
// first, so the same content always gives the same fingerprint.
export function stateFingerprint (item: SavedExperienceState): string {
  const text = stableStringify({ name: item.name, state: item.state })
  // FNV-1a, 32-bit: plenty for spotting a change in one state (this is not a security check).
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0') + text.length.toString(16)
}

export function stateFileStatus (item: SavedExperienceState): StateFileStatus {
  if (!item.fileFingerprint) return 'notSaved'
  return item.fileFingerprint === stateFingerprint(item) ? 'saved' : 'changed'
}

/** The state as it is now, marked as matching a saved file. */
export function markSavedToFile (item: SavedExperienceState): SavedExperienceState {
  return { ...item, fileFingerprint: stateFingerprint(item) }
}

function stableStringify (value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.keys(value as object).sort()
      .filter(key => (value as { [key: string]: unknown })[key] !== undefined)
      .map(key => `${JSON.stringify(key)}:${stableStringify((value as { [key: string]: unknown })[key])}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
