import { createStateFile, isExperienceState, parseStateFile, toFileName, type SavedExperienceState } from '../src/runtime/state-file'

const sample: SavedExperienceState = {
  id: 'state_1',
  name: 'Downtown',
  createdAt: '2026-01-01T00:00:00.000Z',
  state: {
    pageId: 'page_1',
    dialogId: null,
    viewIds: ['view_2'],
    maps: {
      widget_1: {
        activeDataSourceId: 'dataSource_1',
        viewpoint: { rotation: 0, scale: 5000, targetGeometry: { x: 1, y: 2, spatialReference: { wkid: 3857 } } },
        layerVisibility: { 'widget_1-dataSource_1': { 'widget_1-dataSource_1-layer_a': false } },
        basemaps: { 'widget_1-dataSource_1': { title: 'Topographic', baseMapLayers: [] } },
        drawings: { 'widget_1-dataSource_1': [{ geometry: { x: 1, y: 2 }, attributes: { jimuDrawId: 'd1' } }] }
      }
    }
  }
}

describe('save-experience-state file format', () => {
  it('round-trips a state through export and import with a fresh id', () => {
    const text = JSON.stringify(createStateFile([sample], 'app_1'))
    const result = parseStateFile(text)
    expect(result.ok).toBe(true)
    if ('reason' in result) return
    expect(result.appId).toBe('app_1')
    expect(result.states).toHaveLength(1)
    expect(result.states[0].state).toEqual(sample.state)
    expect(result.states[0].name).toBe('Downtown')
    expect(result.states[0].id).not.toBe(sample.id)
  })

  it('rejects invalid files', () => {
    expect(parseStateFile('{not json')).toEqual({ ok: false, reason: 'invalidJson' })
    expect(parseStateFile(JSON.stringify({ hello: 'world' }))).toEqual({ ok: false, reason: 'invalidFormat' })
    expect(parseStateFile(JSON.stringify({ ...createStateFile([sample]), version: 99 }))).toEqual({ ok: false, reason: 'unsupportedVersion' })
    expect(parseStateFile(JSON.stringify(createStateFile([])))).toEqual({ ok: false, reason: 'empty' })
    const badLayer = { ...sample, state: { maps: { widget_1: { layerVisibility: { a: { b: 'yes' } } } } } }
    expect(parseStateFile(JSON.stringify(createStateFile([badLayer as any])))).toEqual({ ok: false, reason: 'invalidFormat' })
  })

  it('validates experience state shape', () => {
    expect(isExperienceState({})).toBe(true)
    expect(isExperienceState({ dialogId: null })).toBe(true)
    expect(isExperienceState({ viewIds: [1] })).toBe(false)
    expect(isExperienceState(null)).toBe(false)
    expect(isExperienceState({ maps: { w: { drawings: { v: {} } } } })).toBe(false)
    expect(isExperienceState({ maps: { w: { drawings: { v: [] } } } })).toBe(true)
    expect(isExperienceState({ maps: { w: { basemaps: { v: 'x' } } } })).toBe(false)
  })

  it('creates safe file names', () => {
    expect(toFileName('a/b:c*?')).toBe('a_b_c_.json')
    expect(toFileName('   ')).toBe('experience-state.json')
  })
})
