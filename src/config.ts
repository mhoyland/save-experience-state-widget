import type { ImmutableObject } from 'jimu-core'

/**
 * How the last session is restored when the experience is reopened.
 * - `prompt`: show a banner in the widget asking the user to restore (same as the built-in behavior).
 * - `auto`: restore without asking.
 */
export type RestoreMode = 'prompt' | 'auto'

export interface Config {
  /** Equivalent of the built-in "Allow to restore state upon reopening the experience" option. */
  restoreOnReopen: boolean
  restoreMode: RestoreMode

  /** Which parts of the experience are captured and restored. */
  includePage: boolean
  includeViews: boolean
  includeWindow: boolean
  includeMapExtent: boolean
  includeLayerVisibility: boolean
  includeBasemap: boolean
  /** Drawings made with the Draw widget, in the Draw widget's export format. */
  includeDrawings: boolean

  /** Named states kept in the browser (IndexedDB). */
  enableLocalSaves: boolean
  maxLocalSaves: number

  /** Save the current state to a .json file / load a state from a .json file. */
  enableFileExport: boolean
  enableFileImport: boolean
}

export type IMConfig = ImmutableObject<Config>
