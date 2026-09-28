import { markSavedToFile, stateFileStatus, stateFingerprint } from '../src/runtime/state-fingerprint'
import { createStateFile, parseStateFile, type SavedExperienceState } from '../src/runtime/state-file'

const item: SavedExperienceState = {
  id: 'state_1',
  name: 'Downtown',
  createdAt: '2026-01-01T00:00:00.000Z',
  state: { pageId: 'page_1', maps: { widget_1: { viewpoint: { scale: 5000, rotation: 0 } } } }
}

describe('save-experience-state file status', () => {
  it('is "not saved" until saved to file, then "saved"', () => {
    expect(stateFileStatus(item)).toBe('notSaved')
    expect(stateFileStatus(markSavedToFile(item))).toBe('saved')
  })

  it('becomes "changed" when the name or content changes, but not the id or dates', () => {
    const saved = markSavedToFile(item)
    expect(stateFileStatus({ ...saved, name: 'Uptown' })).toBe('changed')
    expect(stateFileStatus({ ...saved, state: { ...saved.state, pageId: 'page_2' } })).toBe('changed')
    expect(stateFileStatus({ ...saved, id: 'state_2', updatedAt: '2026-02-01T00:00:00.000Z' })).toBe('saved')
  })

  it('ignores key order', () => {
    const reordered = { ...item, state: { maps: { widget_1: { viewpoint: { rotation: 0, scale: 5000 } } }, pageId: 'page_1' } }
    expect(stateFingerprint(reordered)).toBe(stateFingerprint(item))
  })

  it('keeps fingerprints out of files, and marks loaded states as saved', () => {
    const file = createStateFile([markSavedToFile(item)])
    expect(file.states[0]).not.toHaveProperty('fileFingerprint')
    const result = parseStateFile(JSON.stringify(file))
    if ('reason' in result) throw new Error(result.reason)
    expect(stateFileStatus(result.states[0])).toBe('saved')
  })
})
