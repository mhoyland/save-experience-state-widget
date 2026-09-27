import { loadArcGISJSAPIModules, type JimuMapView } from 'jimu-arcgis'

// The Draw widget (JimuDraw in jimu-ui/advanced/map) adds, per map view, a group layer containing:
//  - a GraphicsLayer with id `jimu-draw-layer-<jimuMapViewId>-<timestamp>` holding the drawings
//  - a client-side FeatureLayer with id `jimu-draw-measurements-layer-<jimuMapViewId>-<timestamp>` holding
//    measurement labels, linked to drawings through `attributes.jimuDrawId`.
// Its "Export drawings" file is an array of `Graphic.toJSON()` where each graphic carries its measurement
// label feature in `attributes.measurementInfos`. We capture and restore exactly that format, so drawings
// in a saved state are interchangeable with Draw's own export/"Append from file".
//
// Draw only creates its layers once the Draw widget is loaded. Until then, restored drawings are put in a
// fallback GraphicsLayer (listed in the map layers) and moved into Draw's layer as soon as it appears.

export interface DrawGraphicJson { [key: string]: any }

const DRAW_LAYER_PREFIX = 'jimu-draw-layer-'
const DRAW_MEASUREMENTS_PREFIX = 'jimu-draw-measurements-layer-'
const FALLBACK_LAYER_PREFIX = 'save-experience-state-drawings-'

interface DrawLayers {
  canvas: __esri.GraphicsLayer
  measurements: __esri.FeatureLayer | null
}

type GraphicCtor = typeof __esri.Graphic

let modulesPromise: Promise<[GraphicCtor, typeof __esri.GraphicsLayer]>
const loadModules = () => {
  modulesPromise = modulesPromise ?? loadArcGISJSAPIModules(['esri/Graphic', 'esri/layers/GraphicsLayer']) as Promise<[GraphicCtor, typeof __esri.GraphicsLayer]>
  return modulesPromise
}

const isUsable = (jmv: JimuMapView): boolean => !!jmv?.view?.map && !jmv.isDestroyed()

export function isDrawingLayerId (id: string): boolean {
  return !!id && (id.startsWith(DRAW_LAYER_PREFIX) || id.startsWith(FALLBACK_LAYER_PREFIX))
}

function findDrawLayers (jmv: JimuMapView): DrawLayers[] {
  if (!isUsable(jmv)) return []
  const allLayers = jmv.view.map.allLayers
  const prefix = `${DRAW_LAYER_PREFIX}${jmv.id}-`
  return allLayers
    .filter(layer => layer.type === 'graphics' && !!layer.id?.startsWith(prefix))
    .toArray()
    .map(canvas => {
      const suffix = canvas.id.slice(prefix.length)
      const measurements = allLayers.find(layer => layer.id === `${DRAW_MEASUREMENTS_PREFIX}${jmv.id}-${suffix}`) as __esri.FeatureLayer
      return { canvas: canvas as __esri.GraphicsLayer, measurements: measurements ?? null }
    })
}

function getFallbackLayer (jmv: JimuMapView): __esri.GraphicsLayer | null {
  if (!isUsable(jmv)) return null
  return (jmv.view.map.findLayerById(FALLBACK_LAYER_PREFIX + jmv.id) as __esri.GraphicsLayer) ?? null
}

function removeFallbackLayer (jmv: JimuMapView, layer: __esri.GraphicsLayer): void {
  layer.removeAll()
  jmv.view?.map?.remove(layer)
  layer.destroy()
}

async function queryMeasurementFeatures (layer: __esri.FeatureLayer, returnGeometry: boolean): Promise<__esri.Graphic[]> {
  try {
    await layer.load()
    const query = layer.createQuery()
    query.where = '1=1'
    query.outFields = ['*']
    query.returnGeometry = returnGeometry
    return (await layer.queryFeatures(query)).features
  } catch {
    return []
  }
}

async function addToDrawLayers (target: DrawLayers, graphics: __esri.Graphic[], Graphic: GraphicCtor): Promise<void> {
  target.canvas.addMany(graphics)
  const measurementInfos = graphics.map(g => g.attributes?.measurementInfos).filter(Boolean)
  if (!target.measurements || measurementInfos.length === 0) return
  try {
    await target.measurements.load()
    await target.measurements.applyEdits({ addFeatures: measurementInfos.map(json => Graphic.fromJSON(json)) })
  } catch (err) {
    console.warn('save-experience-state: failed to restore measurement labels', err)
  }
}

/** Capture drawings of one map view in the Draw widget's export format. */
export async function captureDrawings (jmv: JimuMapView): Promise<DrawGraphicJson[]> {
  const result: DrawGraphicJson[] = []
  for (const { canvas, measurements } of findDrawLayers(jmv)) {
    const graphics: DrawGraphicJson[] = canvas.graphics.toArray().map(g => g.toJSON())
    if (measurements && graphics.length > 0) {
      const features = (await queryMeasurementFeatures(measurements, true)).map(f => f.toJSON())
      graphics.forEach(g => {
        const jimuDrawId = g.attributes?.jimuDrawId
        const measurement = jimuDrawId && features.find(f => f.attributes?.jimuDrawId === jimuDrawId)
        if (measurement) g.attributes.measurementInfos = measurement
      })
    }
    result.push(...graphics)
  }
  // Restored drawings not yet adopted by a Draw widget (they already carry their measurementInfos).
  const fallback = getFallbackLayer(jmv)
  if (fallback) result.push(...fallback.graphics.toArray().map(g => g.toJSON()))
  return result
}

/** Replace the drawings of one map view with `graphicsJson`. */
export async function applyDrawings (jmv: JimuMapView, graphicsJson: DrawGraphicJson[], fallbackTitle: string): Promise<void> {
  if (!isUsable(jmv)) return
  const [Graphic, GraphicsLayer] = await loadModules()
  const graphics = graphicsJson.map(json => Graphic.fromJSON(json))
  const drawLayers = findDrawLayers(jmv)

  for (const { canvas, measurements } of drawLayers) {
    canvas.removeAll()
    if (measurements) {
      const existing = await queryMeasurementFeatures(measurements, false)
      if (existing.length > 0) await measurements.applyEdits({ deleteFeatures: existing }).catch(() => null)
    }
  }
  let fallback = getFallbackLayer(jmv)

  if (drawLayers.length > 0) {
    if (fallback) removeFallbackLayer(jmv, fallback)
    await addToDrawLayers(drawLayers[0], graphics, Graphic)
    return
  }

  if (graphics.length === 0) {
    if (fallback) removeFallbackLayer(jmv, fallback)
    return
  }
  if (!fallback) {
    fallback = new GraphicsLayer({ id: FALLBACK_LAYER_PREFIX + jmv.id, title: fallbackTitle, listMode: 'show' })
    jmv.view.map.add(fallback)
  } else {
    fallback.removeAll()
  }
  fallback.addMany(graphics)
}

/** Move drawings from the fallback layer into the Draw widget's layer once it exists, so they become editable. */
export async function adoptFallbackDrawings (jmv: JimuMapView): Promise<void> {
  const fallback = getFallbackLayer(jmv)
  if (!fallback) return
  const drawLayers = findDrawLayers(jmv)
  if (drawLayers.length === 0) return
  const graphics = fallback.graphics.toArray()
  removeFallbackLayer(jmv, fallback) // synchronously, so concurrent calls do not adopt twice
  if (graphics.length === 0) return
  const [Graphic] = await loadModules()
  await addToDrawLayers(drawLayers[0], graphics, Graphic)
}

/**
 * Value that changes whenever drawings change (added, removed, reshaped or restyled). Meant to be used as a
 * `reactiveUtils.watch` getter.
 */
export function getDrawingsSignature (jmv: JimuMapView): unknown[] {
  if (!isUsable(jmv)) return []
  return jmv.view.map.allLayers
    .filter(layer => isDrawingLayerId(layer.id) && layer.type === 'graphics')
    .toArray()
    .flatMap(layer => (layer as __esri.GraphicsLayer).graphics.toArray().map(g => [g.geometry, g.symbol]))
}
