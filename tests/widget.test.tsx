import { React, saveAs } from 'jimu-core'
import { widgetRender, wrapWidget } from 'jimu-for-test'
import { fireEvent, waitFor } from '@testing-library/react'
import _Widget from '../src/runtime/widget'

jest.mock('jimu-core', () => ({ ...jest.requireActual('jimu-core'), saveAs: jest.fn() }))

// jsdom has no IndexedDB; use an in-memory store with the same contract.
jest.mock('../src/runtime/state-store', () => {
  const states = new Map<string, any>()
  return {
    createStateStore: () => ({
      init: () => Promise.resolve(),
      close: jest.fn(),
      loadSavedStates: () => Promise.resolve(Array.from(states.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
      putSavedStates: (list: any[]) => { list.forEach(s => states.set(s.id, s)); return Promise.resolve() },
      deleteSavedState: (id: string) => { states.delete(id); return Promise.resolve() },
      loadLastSession: () => Promise.resolve(null),
      putLastSession: () => Promise.resolve()
    })
  }
})

const config = {
  restoreOnReopen: false,
  restoreMode: 'prompt',
  includePage: true,
  includeViews: true,
  includeWindow: true,
  includeMapExtent: false,
  includeLayerVisibility: false,
  includeBasemap: false,
  includeDrawings: false,
  enableLocalSaves: true,
  maxLocalSaves: 2,
  enableFileExport: true,
  enableFileImport: true
}

const render = widgetRender()

describe('save-experience-state widget', () => {
  it('shows empty state, saves a named state and enforces the limit', async () => {
    const Widget = wrapWidget(_Widget, { config })
    const { getByText, getByLabelText, findByText, queryByText } = render(<Widget widgetId='widget_ses' />)
    expect(getByText(/No saved states yet/)).toBeTruthy()
    // "Save to file" is redundant with Save + download while named states are on.
    expect(queryByText('Save to file')).toBeNull()
    expect(getByText('Export all').closest('button').disabled).toBe(true)

    const saveButton = getByText('Save').closest('button')
    await waitFor(() => { expect(saveButton.disabled).toBe(false) })

    fireEvent.change(getByLabelText('State name'), { target: { value: 'First' } })
    fireEvent.click(saveButton)
    expect(await findByText('Saved "First".')).toBeTruthy()
    expect(getByText('1 of 2')).toBeTruthy()
    expect(getByText('Export all').closest('button').disabled).toBe(false)

    fireEvent.click(saveButton)
    await findByText('2 of 2')
    await waitFor(() => { expect(saveButton.disabled).toBe(false) })
    fireEvent.click(saveButton)
    expect(await findByText(/You can save up to 2 states/)).toBeTruthy()
  })

  it('offers "Save to file" only when named states are off', () => {
    const Widget = wrapWidget(_Widget, { config: { ...config, enableLocalSaves: false } })
    const { getByText, queryByText } = render(<Widget widgetId='widget_ses3' />)
    expect(getByText('Save to file')).toBeTruthy()
    expect(queryByText('Export all')).toBeNull()
  })

  it('refuses a multi-state file when named states are off, but restores a single-state file', async () => {
    const Widget = wrapWidget(_Widget, { config: { ...config, enableLocalSaves: false } })
    const { container, findByText, queryByText } = render(<Widget widgetId='widget_ses5' />)
    const fileInput = container.querySelector('input[type="file"]')
    const entry = (id: string, name: string) => ({ id, name, createdAt: '2026-09-28T12:00:00.000Z', state: {} })
    const chooseFile = (states: any[]) => {
      const json = JSON.stringify({ type: 'exb-experience-state', version: 1, states })
      fireEvent.change(fileInput, { target: { files: [{ text: () => Promise.resolve(json) }] } })
    }

    chooseFile([entry('state_a', 'A'), entry('state_b', 'B'), entry('state_c', 'C')])
    expect(await findByText('This file contains 3 states. This app can only load a file with one state.')).toBeTruthy()
    expect(queryByText(/Loaded \d+ state/)).toBeNull()

    chooseFile([entry('state_d', 'D')])
    expect(await findByText('Restored "D".')).toBeTruthy()
  })

  it('asks for a file name before exporting all states', async () => {
    const Widget = wrapWidget(_Widget, { config })
    const { getByText, getByLabelText, queryByLabelText, findByText } = render(<Widget widgetId='widget_ses4' />)
    const exportAll = (await findByText('Export all')).closest('button')
    await findByText('First')

    fireEvent.click(exportAll)
    expect(exportAll.getAttribute('aria-expanded')).toBe('true')
    const input = getByLabelText('File name') as HTMLInputElement
    expect(input.value).toMatch(/states \d{4}-\d{2}-\d{2}$/)

    // Escape closes without exporting.
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(queryByLabelText('File name')).toBeNull()
    expect(saveAs).not.toHaveBeenCalled()

    fireEvent.click(exportAll)
    fireEvent.change(getByLabelText('File name'), { target: { value: 'My trip.json' } })
    fireEvent.click(getByText('Export 2 states'))
    expect(saveAs).toHaveBeenCalledWith(expect.any(Blob), 'My trip.json')
    expect(queryByLabelText('File name')).toBeNull()
  })

  it('asks before replacing a saved state with the current state', async () => {
    const Widget = wrapWidget(_Widget, { config })
    const { getByLabelText, getByText, queryByText, findByText, findByLabelText } = render(<Widget widgetId='widget_ses2' />)
    const replaceButton = await findByLabelText('Replace First with the current state')

    fireEvent.click(replaceButton)
    expect(getByText('Replace "First" with the current state?')).toBeTruthy()
    fireEvent.click(getByText('No'))
    expect(queryByText('Replace "First" with the current state?')).toBeNull()
    expect(queryByText('Updated "First".')).toBeNull()

    fireEvent.click(getByLabelText('Replace First with the current state'))
    fireEvent.click(getByText('Yes'))
    expect(await findByText('Updated "First".')).toBeTruthy()
  })

  it('tags each state with whether it is in a saved file', async () => {
    const Widget = wrapWidget(_Widget, { config })
    const { getByText, getByLabelText, getAllByLabelText, getByRole, findByText, findAllByText, queryByText } = render(<Widget widgetId='widget_ses6' />)
    // "Export all" in an earlier test saved both states to a file.
    expect(await findAllByText('Saved to file')).toHaveLength(2)
    expect(queryByText(/in a saved file/)).toBeNull()

    // Renaming makes the file out of date.
    fireEvent.click(getByLabelText('Rename First'))
    const input = getByRole('textbox', { name: 'Rename First' })
    fireEvent.change(input, { target: { value: 'First renamed' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await findByText('Unsaved changes')).toBeTruthy()
    expect(getByText(/1 state isn't in a saved file/)).toBeTruthy()

    // Saving it to file again brings it back in line.
    fireEvent.click(getByLabelText('Save First renamed to file'))
    await waitFor(() => { expect(queryByText('Unsaved changes')).toBeNull() })
    expect(queryByText(/in a saved file/)).toBeNull()

    // A new state starts out not saved to file.
    const other = getAllByLabelText(/^Delete /).find(button => button.getAttribute('aria-label') !== 'Delete First renamed')
    fireEvent.click(other)
    fireEvent.click(getByText('Yes'))
    await findByText('1 of 2')
    fireEvent.change(getByLabelText('State name'), { target: { value: 'Second' } })
    fireEvent.click(getByText('Save').closest('button'))
    expect(await findByText('Not saved to file')).toBeTruthy()
    expect(getByText(/1 state isn't in a saved file/)).toBeTruthy()
  })

  it('hides the tags when saving to file is off', async () => {
    const Widget = wrapWidget(_Widget, { config: { ...config, enableFileExport: false } })
    const { findByText, queryByText } = render(<Widget widgetId='widget_ses7' />)
    await findByText('First renamed')
    expect(queryByText(/Not saved to file|Unsaved changes|Saved to file/)).toBeNull()
    expect(queryByText(/in a saved file/)).toBeNull()
  })
})
