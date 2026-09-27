import { getAppStore, jimuHistory, appActions, type IMState, type IMSectionNavInfo } from 'jimu-core'
import { MapViewManager, loadArcGISJSAPIModules, type JimuMapView, type JimuMapViewGroup } from 'jimu-arcgis'
import type { ExperienceState, MapWidgetState } from './state-file'
import { captureDrawings, applyDrawings } from './drawings'

export interface StateParts {
  includePage: boolean
  includeViews: boolean
  includeWindow: boolean
  includeMapExtent: boolean
  includeLayerVisibility: boolean
  includeBasemap: boolean
  includeDrawings: boolean
}

export interface ApplyOptions {
  /** Title of the layer that holds restored drawings until the Draw widget is loaded. */
  drawingsLayerTitle: string
}

const includesMapParts = (parts: StateParts): boolean =>
  parts.includeMapExtent || parts.includeLayerVisibility || parts.includeBasemap || parts.includeDrawings

export interface ApplyResult {
  /** Number of captured items (page, window, views, maps) that no longer exist in this experience. */
  missingCount: number
}

const MAP_WAIT_TIMEOUT = 10000
const LAYER_WAIT_TIMEOUT = 5000
const POLL_INTERVAL = 250

const wait = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms) })

function withTimeout<T> (promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([promise.catch(() => null), wait(ms).then(() => null)])
}

const isUsableView = (jmv: JimuMapView): boolean => !!jmv?.view && !jmv.isDestroyed() && !jmv.isCached()

/** Same logic the framework uses to persist section views: current view, else default, else first. */
function getCurrentViewIds (state: IMState): string[] {
  const { appConfig, appRuntimeInfo } = state
  const navInfos = appRuntimeInfo?.sectionNavInfos ?? {}
  return Object.entries(navInfos).reduce<string[]>((ids, [sectionId, navInfo]: [string, IMSectionNavInfo]) => {
    const section = appConfig.sections?.[sectionId]
    const viewId = navInfo?.currentViewId || section?.defaultView || section?.views?.[0]
    if (viewId) ids.push(viewId)
    return ids
  }, [])
}

async function captureMap (group: JimuMapViewGroup, parts: StateParts): Promise<MapWidgetState | null> {
  const jimuMapViews = group.getAllJimuMapViews().filter(jmv => !jmv.isDestroyed())
  const active = group.getActiveJimuMapView() ?? jimuMapViews.find(jmv => jmv.isActive)
  const mapState: MapWidgetState = {}

  if (parts.includeMapExtent && active?.view?.viewpoint) {
    mapState.activeDataSourceId = active.dataSourceId
    mapState.viewpoint = active.view.viewpoint.toJSON()
  }

  if (parts.includeLayerVisibility) {
    // Unlike the built-in state (which only stores layers whose visibility differs from the web map),
    // store every layer so a saved state reproduces the exact same map regardless of later web map edits.
    const layerVisibility: MapWidgetState['layerVisibility'] = {}
    jimuMapViews.forEach(jmv => {
      const layers: { [jimuLayerViewId: string]: boolean } = {}
      Object.values(jmv.jimuLayerViews ?? {}).forEach(jlv => {
        if (jlv?.layer && !jlv.fromRuntime) layers[jlv.id] = !!jlv.layer.visible
      })
      if (Object.keys(layers).length > 0) layerVisibility[jmv.id] = layers
    })
    if (Object.keys(layerVisibility).length > 0) mapState.layerVisibility = layerVisibility
  }

  if (parts.includeBasemap) {
    const basemaps: MapWidgetState['basemaps'] = {}
    jimuMapViews.forEach(jmv => {
      try {
        const basemapJson = jmv.view?.map?.basemap?.toJSON()
        if (basemapJson) basemaps[jmv.id] = basemapJson
      } catch (err) {
        console.warn('save-experience-state: failed to serialize basemap', err)
      }
    })
    if (Object.keys(basemaps).length > 0) mapState.basemaps = basemaps
  }

  if (parts.includeDrawings) {
    // Always stored (even when empty) so that restoring a state without drawings clears current drawings.
    mapState.drawings = {}
    for (const jmv of jimuMapViews) {
      mapState.drawings[jmv.id] = await captureDrawings(jmv)
    }
  }

  return Object.keys(mapState).length > 0 ? mapState : null
}

/** Capture the current experience state. */
export async function captureState (parts: StateParts): Promise<ExperienceState> {
  const appState = getAppStore().getState()
  const runtimeInfo = appState.appRuntimeInfo
  const result: ExperienceState = {}

  if (parts.includePage && runtimeInfo?.currentPageId) result.pageId = runtimeInfo.currentPageId
  if (parts.includeWindow) result.dialogId = runtimeInfo?.currentDialogId || null
  if (parts.includeViews) result.viewIds = getCurrentViewIds(appState)

  if (includesMapParts(parts)) {
    const mapViewManager = MapViewManager.getInstance()
    const mapWidgetIds = new Set(mapViewManager.getAllJimuMapViews().map(jmv => jmv.mapWidgetId).filter(Boolean))
    const maps: ExperienceState['maps'] = {}
    for (const mapWidgetId of mapWidgetIds) {
      const group = mapViewManager.getJimuMapViewGroup(mapWidgetId)
      const mapState = group && await captureMap(group, parts)
      if (mapState) maps[mapWidgetId] = mapState
    }
    if (Object.keys(maps).length > 0) result.maps = maps
  }

  return result
}

/** Wait until the map widget has created a visible, loaded active map view (it may mount after a page change). */
async function waitForMapGroup (mapWidgetId: string): Promise<JimuMapViewGroup | null> {
  const start = Date.now()
  while (Date.now() - start < MAP_WAIT_TIMEOUT) {
    const group = MapViewManager.getInstance().getJimuMapViewGroup(mapWidgetId)
    const active = group?.getActiveJimuMapView()
    if (active && isUsableView(active)) {
      await withTimeout(active.whenJimuMapViewLoaded(), MAP_WAIT_TIMEOUT)
      return group
    }
    await wait(POLL_INTERVAL)
  }
  return null
}

async function applyMap (mapWidgetId: string, mapState: MapWidgetState, parts: StateParts, options: ApplyOptions): Promise<boolean> {
  const group = await waitForMapGroup(mapWidgetId)
  if (!group) return false

  let active = group.getActiveJimuMapView()
  const wantedDsId = parts.includeMapExtent ? mapState.activeDataSourceId : null
  if (wantedDsId && active?.dataSourceId !== wantedDsId &&
      group.getAllJimuMapViews().some(jmv => jmv.dataSourceId === wantedDsId)) {
    try {
      await group.switchMap(true)
      active = (await waitForMapGroup(mapWidgetId))?.getActiveJimuMapView() ?? active
    } catch (err) {
      console.warn('save-experience-state: failed to switch map', err)
    }
  }

  if (parts.includeBasemap && mapState.basemaps) {
    const [Basemap] = await loadArcGISJSAPIModules(['esri/Basemap']) as [typeof __esri.Basemap]
    group.getAllJimuMapViews().forEach(jmv => {
      const basemapJson = mapState.basemaps[jmv.id]
      const map = jmv.view?.map
      if (!basemapJson || !map || jmv.isDestroyed()) return
      try {
        if (JSON.stringify(map.basemap?.toJSON()) !== JSON.stringify(basemapJson)) map.basemap = Basemap.fromJSON(basemapJson)
      } catch (err) {
        console.warn('save-experience-state: failed to restore basemap', err)
      }
    })
  }

  if (parts.includeDrawings && mapState.drawings) {
    for (const jmv of group.getAllJimuMapViews()) {
      if (jmv.isDestroyed()) continue
      try {
        await applyDrawings(jmv, mapState.drawings[jmv.id] ?? [], options.drawingsLayerTitle)
      } catch (err) {
        console.warn('save-experience-state: failed to restore drawings', err)
      }
    }
  }

  if (parts.includeLayerVisibility && mapState.layerVisibility) {
    for (const jmv of group.getAllJimuMapViews()) {
      const layers = mapState.layerVisibility[jmv.id]
      if (!layers || jmv.isDestroyed()) continue
      await withTimeout(jmv.whenAllJimuLayerViewLoaded(), LAYER_WAIT_TIMEOUT)
      Object.entries(layers).forEach(([jimuLayerViewId, visible]) => {
        const jlv = jmv.jimuLayerViews?.[jimuLayerViewId]
        if (jlv?.layer && !jlv.fromRuntime && jlv.layer.visible !== visible) jlv.layer.visible = visible
      })
    }
  }

  if (parts.includeMapExtent && mapState.viewpoint && active && isUsableView(active)) {
    try {
      const [Viewpoint] = await loadArcGISJSAPIModules(['esri/Viewpoint']) as [typeof __esri.Viewpoint]
      await active.view.goTo(Viewpoint.fromJSON(mapState.viewpoint))
    } catch (err) {
      // goTo rejects when interrupted by user navigation; that is not an error worth surfacing.
      if (err?.name !== 'AbortError') console.warn('save-experience-state: failed to restore viewpoint', err)
    }
  }
  return true
}

function closeSplashDialog (appState: IMState): void {
  const splash = Object.values(appState.appConfig.dialogs ?? {}).find(dialog => dialog.isSplash)
  const dialogInfos = appState.appRuntimeInfo?.dialogInfos
  if (!splash || !dialogInfos || dialogInfos[splash.id]?.isClosed) return
  getAppStore().dispatch(appActions.dialogInfosChanged(dialogInfos.setIn([splash.id, 'isClosed'], true).asMutable({ deep: true })))
}

/**
 * Apply a saved state to the running experience. Only parts enabled in `parts` are applied; items
 * that no longer exist (deleted pages, views, windows or maps) are skipped and counted.
 */
export async function applyState (state: ExperienceState, parts: StateParts, options: ApplyOptions): Promise<ApplyResult> {
  let missingCount = 0
  const getState = () => getAppStore().getState()
  const { appConfig } = getState()

  if (parts.includePage && state.pageId) {
    if (!appConfig.pages?.[state.pageId]) {
      missingCount++
    } else if (getState().appRuntimeInfo?.currentPageId !== state.pageId) {
      jimuHistory.changePage(state.pageId)
    }
  }

  if (parts.includeViews && state.viewIds) {
    state.viewIds.forEach(viewId => {
      const view = appConfig.views?.[viewId]
      if (!view) {
        missingCount++
        return
      }
      if (getState().appRuntimeInfo?.sectionNavInfos?.[view.parent]?.currentViewId !== viewId) {
        jimuHistory.changeView(view.parent, viewId)
      }
    })
  }

  if (parts.includeWindow && state.dialogId !== undefined) {
    // Like the built-in restore, dismiss the splash window so the restored state is visible.
    closeSplashDialog(getState())
    const currentDialogId = getState().appRuntimeInfo?.currentDialogId
    if (state.dialogId && !appConfig.dialogs?.[state.dialogId]) {
      missingCount++
    } else if (state.dialogId && state.dialogId !== currentDialogId) {
      jimuHistory.changeDialog(state.dialogId)
    } else if (!state.dialogId && currentDialogId) {
      jimuHistory.changeDialog(null)
    }
  }

  if (includesMapParts(parts) && state.maps) {
    const results = await Promise.all(Object.entries(state.maps).map(([mapWidgetId, mapState]) =>
      appConfig.widgets?.[mapWidgetId] ? applyMap(mapWidgetId, mapState, parts, options) : Promise.resolve(false)
    ))
    missingCount += results.filter(ok => !ok).length
  }

  return { missingCount }
}
