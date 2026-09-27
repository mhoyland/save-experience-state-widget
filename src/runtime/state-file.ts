// Types, validation and (de)serialization for experience states. Kept free of jimu-arcgis / store access
// so it can be unit tested in isolation.

export const STATE_FILE_TYPE = 'exb-experience-state'
export const STATE_FILE_VERSION = 1

export interface MapWidgetState {
  /** Data source id of the active map when the map widget holds two maps. */
  activeDataSourceId?: string
  /** `Viewpoint.toJSON()` of the active map view. */
  viewpoint?: { [key: string]: any }
  /** `{ [jimuMapViewId]: { [jimuLayerViewId]: visible } }` — same shape the built-in state uses. */
  layerVisibility?: { [jimuMapViewId: string]: { [jimuLayerViewId: string]: boolean } }
  /** `{ [jimuMapViewId]: Basemap.toJSON() }` */
  basemaps?: { [jimuMapViewId: string]: { [key: string]: any } }
  /**
   * `{ [jimuMapViewId]: graphics }` where graphics use the same format as the Draw widget's
   * "Export drawings" file (`Graphic.toJSON()` with `attributes.jimuDrawId` / `attributes.measurementInfos`).
   * An empty array means "no drawings" and clears existing drawings on restore.
   */
  drawings?: { [jimuMapViewId: string]: Array<{ [key: string]: any }> }
}

/**
 * A snapshot of the experience. Mirrors what the built-in "Experience state" persists
 * (page, window, section views, map viewpoint and layer visibility per map widget).
 */
export interface ExperienceState {
  pageId?: string
  /** `null` means "no window open". `undefined` means the window was not captured. */
  dialogId?: string | null
  viewIds?: string[]
  maps?: { [mapWidgetId: string]: MapWidgetState }
}

export interface SavedExperienceState {
  id: string
  name: string
  createdAt: string
  updatedAt?: string
  state: ExperienceState
}

export interface ExperienceStateFile {
  type: typeof STATE_FILE_TYPE
  version: number
  appId?: string
  exportedAt: string
  states: SavedExperienceState[]
}

const isPlainObject = (v: unknown): v is { [key: string]: any } =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isOptionalString = (v: unknown): boolean => v === undefined || typeof v === 'string'

function isMapWidgetState (v: unknown): v is MapWidgetState {
  if (!isPlainObject(v)) return false
  if (!isOptionalString(v.activeDataSourceId)) return false
  if (v.viewpoint !== undefined && !isPlainObject(v.viewpoint)) return false
  if (v.basemaps !== undefined && !(isPlainObject(v.basemaps) && Object.values(v.basemaps).every(isPlainObject))) return false
  if (v.drawings !== undefined) {
    if (!isPlainObject(v.drawings)) return false
    if (!Object.values(v.drawings).every(graphics => Array.isArray(graphics) && graphics.every(isPlainObject))) return false
  }
  if (v.layerVisibility !== undefined) {
    if (!isPlainObject(v.layerVisibility)) return false
    for (const layers of Object.values(v.layerVisibility)) {
      if (!isPlainObject(layers)) return false
      if (!Object.values(layers).every(visible => typeof visible === 'boolean')) return false
    }
  }
  return true
}

export function isExperienceState (v: unknown): v is ExperienceState {
  if (!isPlainObject(v)) return false
  if (!isOptionalString(v.pageId)) return false
  if (v.dialogId !== undefined && v.dialogId !== null && typeof v.dialogId !== 'string') return false
  if (v.viewIds !== undefined && !(Array.isArray(v.viewIds) && v.viewIds.every(id => typeof id === 'string'))) return false
  if (v.maps !== undefined && !(isPlainObject(v.maps) && Object.values(v.maps).every(isMapWidgetState))) return false
  return true
}

export function isSavedExperienceState (v: unknown): v is SavedExperienceState {
  return isPlainObject(v) &&
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.createdAt === 'string' &&
    isOptionalString(v.updatedAt) &&
    isExperienceState(v.state)
}

export function createStateId (): string {
  return `state_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function createStateFile (states: SavedExperienceState[], appId?: string): ExperienceStateFile {
  return {
    type: STATE_FILE_TYPE,
    version: STATE_FILE_VERSION,
    appId,
    exportedAt: new Date().toISOString(),
    states
  }
}

export type ParseStateFileResult =
  | { ok: true, states: SavedExperienceState[], appId?: string }
  | { ok: false, reason: 'invalidJson' | 'invalidFormat' | 'unsupportedVersion' | 'empty' }

/**
 * Parse the text of a .json state file. Imported states get fresh ids so they never collide with
 * states already in local storage.
 */
export function parseStateFile (text: string): ParseStateFileResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'invalidJson' }
  }
  if (!isPlainObject(parsed) || parsed.type !== STATE_FILE_TYPE || !Array.isArray(parsed.states)) {
    return { ok: false, reason: 'invalidFormat' }
  }
  if (typeof parsed.version !== 'number' || parsed.version > STATE_FILE_VERSION) {
    return { ok: false, reason: 'unsupportedVersion' }
  }
  if (!parsed.states.every(isSavedExperienceState)) {
    return { ok: false, reason: 'invalidFormat' }
  }
  if (parsed.states.length === 0) {
    return { ok: false, reason: 'empty' }
  }
  const states = (parsed.states as SavedExperienceState[]).map(s => ({ ...s, id: createStateId() }))
  return { ok: true, states, appId: typeof parsed.appId === 'string' ? parsed.appId : undefined }
}

/** Turn a state name into a safe file name. */
export function toFileName (name: string): string {
  const base = name.trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').slice(0, 100)
  return `${base || 'experience-state'}.json`
}
