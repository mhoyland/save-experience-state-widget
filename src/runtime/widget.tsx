import { React, ReactRedux, hooks, css, saveAs, AppMode, type AllWidgetProps, type IMState } from 'jimu-core'
import { Alert, Button, Paper, TextInput, defaultMessages as jimuUIDefaultMessages } from 'jimu-ui'
import { MapViewManager, loadArcGISJSAPIModules } from 'jimu-arcgis'
import { SaveOutlined } from 'jimu-icons/outlined/application/save'
import { ExportOutlined } from 'jimu-icons/outlined/editor/export'
import { ImportOutlined } from 'jimu-icons/outlined/editor/import'
import type { IMConfig } from '../config'
import { captureState, applyState, type StateParts } from './state-manager'
import { createStateFile, createStateId, parseStateFile, toFileName, type ExperienceState, type SavedExperienceState } from './state-file'
import { createStateStore, type StateStore } from './state-store'
import { adoptFallbackDrawings, getDrawingsSignature } from './drawings'
import { StateListItem } from './state-list-item'
import { ExportAllPrompt } from './export-all-prompt'
import defaultMessages from './translations/default'

interface Status {
  type: 'success' | 'error' | 'warning' | 'info'
  text: string
}

const RECORD_DEBOUNCE = 1000

const style = css`
  display: flex;
  flex-direction: column;
  gap: var(--sys-spacing-3);
  padding: var(--sys-spacing-3);
  overflow: auto;
  .ses-section-title {
    margin: 0 0 var(--sys-spacing-2);
    font-size: var(--sys-typography-title3-font-size, 0.875rem);
    font-weight: var(--sys-typography-font-weight-medium);
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .ses-list-header {
    display: flex;
    align-items: center;
    gap: var(--sys-spacing-2);
    margin-bottom: var(--sys-spacing-2);
  }
  .ses-list-header .ses-section-title {
    margin: 0;
  }
  .ses-count {
    flex-grow: 1;
    font-weight: var(--sys-typography-font-weight-regular);
    color: var(--sys-color-surface-paper-hint);
    font-size: 0.75rem;
  }
  .ses-export-all[aria-expanded='true'] {
    background: var(--sys-color-action-hover);
  }
  .ses-divider {
    height: 1px;
    border: 0;
    margin: var(--sys-spacing-1) calc(-1 * var(--sys-spacing-3));
    background: var(--sys-color-divider-secondary);
  }
  .ses-row {
    display: flex;
    gap: var(--sys-spacing-2);
    align-items: center;
  }
  .ses-row > .jimu-input {
    flex: 1;
    min-width: 0;
  }
  .ses-file-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sys-spacing-2);
    margin-top: var(--sys-spacing-3);
  }
  .ses-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--sys-spacing-1);
  }
  .ses-empty {
    color: var(--sys-color-surface-paper-hint);
    font-size: 0.8125rem;
  }
  .ses-banner-actions {
    display: flex;
    gap: var(--sys-spacing-2);
    margin-top: var(--sys-spacing-2);
  }
`

const Widget = (props: AllWidgetProps<IMConfig>) => {
  const { config, id: widgetId } = props
  const translate = hooks.useTranslation(defaultMessages, jimuUIDefaultMessages)

  const appId = ReactRedux.useSelector((state: IMState) => state.appId) || 'default'
  const appTitle = ReactRedux.useSelector((state: IMState) => state.appConfig?.attributes?.title)
  const appMode = ReactRedux.useSelector((state: IMState) => state.appRuntimeInfo?.appMode)
  const currentPageId = ReactRedux.useSelector((state: IMState) => state.appRuntimeInfo?.currentPageId)
  const currentDialogId = ReactRedux.useSelector((state: IMState) => state.appRuntimeInfo?.currentDialogId)
  const sectionNavInfos = ReactRedux.useSelector((state: IMState) => state.appRuntimeInfo?.sectionNavInfos)
  const jimuMapViewsInfo = ReactRedux.useSelector((state: IMState) => state.jimuMapViewsInfo)

  const isDesignMode = appMode === AppMode.Design
  // Same condition the built-in feature uses: never record or restore sessions inside the builder.
  const isInBuilder = !!(window.jimuConfig?.isInBuilder || window.jimuConfig?.isBuilder)
  const recordSession = !!config.restoreOnReopen && !isInBuilder
  const maxLocalSaves = Math.max(1, config.maxLocalSaves ?? 20)

  const parts: StateParts = React.useMemo(() => ({
    includePage: config.includePage ?? true,
    includeViews: config.includeViews ?? true,
    includeWindow: config.includeWindow ?? true,
    includeMapExtent: config.includeMapExtent ?? true,
    includeLayerVisibility: config.includeLayerVisibility ?? true,
    includeBasemap: config.includeBasemap ?? true,
    includeDrawings: config.includeDrawings ?? true
  }), [config.includePage, config.includeViews, config.includeWindow, config.includeMapExtent, config.includeLayerVisibility, config.includeBasemap, config.includeDrawings])
  const drawingsLayerTitle = translate('sesDrawingsLayerTitle')
  const applyOptions = React.useMemo(() => ({ drawingsLayerTitle }), [drawingsLayerTitle])

  const [store, setStore] = React.useState<StateStore>(null)
  const [savedStates, setSavedStates] = React.useState<SavedExperienceState[]>([])
  const [newName, setNewName] = React.useState('')
  const [status, setStatus] = React.useState<Status>(null)
  const [busy, setBusy] = React.useState(false)
  const [pendingSession, setPendingSession] = React.useState<ExperienceState>(null)
  const [exportPromptOpen, setExportPromptOpen] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  // Stable identity: `translate` changes on every render and must not re-create the store below.
  const showStorageError = hooks.useEventCallback((err: unknown) => {
    console.error('save-experience-state: storage error', err)
    setStatus({ type: 'error', text: translate('sesStorageFailed') })
  })

  React.useEffect(() => {
    const nextStore = createStateStore(appId)
    let closed = false
    nextStore.init()
      .then(async () => {
        if (closed) return
        setSavedStates(await nextStore.loadSavedStates())
        setStore(nextStore)
      })
      .catch(showStorageError)
    return () => {
      closed = true
      setStore(null)
      nextStore.close()
    }
  }, [appId, showStorageError])

  const refreshSavedStates = React.useCallback(async () => {
    if (store) setSavedStates(await store.loadSavedStates())
  }, [store])

  const restore = React.useCallback(async (state: ExperienceState, successText: string) => {
    setBusy(true)
    try {
      const { missingCount } = await applyState(state, parts, applyOptions)
      setStatus(missingCount > 0
        ? { type: 'warning', text: translate('sesRestoredPartial', { count: missingCount }) }
        : { type: 'success', text: successText })
    } catch (err) {
      console.error('save-experience-state: restore failed', err)
      setStatus({ type: 'error', text: translate('sesRestoreFailed') })
    } finally {
      setBusy(false)
    }
  }, [parts, applyOptions, translate])

  // ---- Last session (built-in "restore state upon reopening" equivalent) ----

  // On startup, pick up the previous session before recording starts overwriting it.
  const sessionCheckedRef = React.useRef(false)
  const [sessionChecked, setSessionChecked] = React.useState(false)
  React.useEffect(() => {
    if (!store || sessionCheckedRef.current) return
    sessionCheckedRef.current = true
    if (!recordSession) {
      setSessionChecked(true)
      return
    }
    store.loadLastSession()
      .then(last => {
        if (!last) return
        if (config.restoreMode === 'auto') {
          void restore(last.state, translate('sesRestoredSession'))
        } else {
          setPendingSession(last.state)
        }
      })
      .catch(err => { console.error('save-experience-state: failed to read last session', err) })
      .finally(() => { setSessionChecked(true) })
    // Only once per store (i.e. per app).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])

  const canRecord = recordSession && !!store && sessionChecked
  const recordingRef = React.useRef<Promise<void>>(null)
  const record = hooks.useEventCallback(() => {
    if (!canRecord || recordingRef.current) return
    recordingRef.current = captureState(parts)
      .then(state => store.putLastSession(state))
      .catch(err => { console.warn('save-experience-state: failed to record session', err) })
      .finally(() => { recordingRef.current = null })
  })
  const debouncedRecord = React.useMemo(() => {
    let timer: number
    const fn = () => {
      clearTimeout(timer)
      timer = window.setTimeout(record, RECORD_DEBOUNCE)
    }
    fn.cancel = () => { clearTimeout(timer) }
    return fn
  }, [record])

  // Record on page / window / view changes.
  React.useEffect(() => {
    if (canRecord) debouncedRecord()
  }, [canRecord, currentPageId, currentDialogId, sectionNavInfos, debouncedRecord])

  // Best effort when the page is hidden or closed. IndexedDB writes are asynchronous, so the debounced
  // recording on every change is what actually keeps the last session up to date.
  React.useEffect(() => {
    if (!canRecord) return
    const onHide = () => { if (document.visibilityState === 'hidden') record() }
    window.addEventListener('pagehide', record)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      debouncedRecord.cancel()
      window.removeEventListener('pagehide', record)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [canRecord, record, debouncedRecord])

  // Per map view: move restored drawings into the Draw widget's layer when it appears, and record the
  // session when the map stops moving or its layers, basemap or drawings change.
  React.useEffect(() => {
    const jimuMapViews = MapViewManager.getInstance().getAllJimuMapViews().filter(jmv => jmv.view && !jmv.isDestroyed())
    if (isDesignMode || jimuMapViews.length === 0) return
    let handles: __esri.WatchHandle[] = []
    let cancelled = false
    void loadArcGISJSAPIModules(['esri/core/reactiveUtils']).then(([reactiveUtils]: [typeof __esri.reactiveUtils]) => {
      if (cancelled) return
      handles = jimuMapViews.filter(jmv => !jmv.isDestroyed()).flatMap(jmv => {
          const view = jmv.view
          const adopt = () => { void adoptFallbackDrawings(jmv).catch(err => { console.warn('save-experience-state: failed to move drawings', err) }) }
          const watches = [reactiveUtils.watch(() => view.map?.allLayers?.length, adopt, { initial: true })]
          if (canRecord) {
            watches.push(
              reactiveUtils.watch(() => view.stationary, stationary => { if (stationary) debouncedRecord() }),
              reactiveUtils.watch(() => view.map?.allLayers?.map(layer => layer.visible).toArray().join(','), debouncedRecord),
              reactiveUtils.watch(() => view.map?.basemap, debouncedRecord),
              reactiveUtils.watch(() => getDrawingsSignature(jmv), debouncedRecord)
            )
          }
          return watches
        })
    })
    return () => {
      cancelled = true
      handles.forEach(handle => { handle.remove() })
    }
  }, [isDesignMode, canRecord, jimuMapViewsInfo, debouncedRecord])

  // ---- Saved states (IndexedDB) ----

  const onSave = async () => {
    if (!store) return
    if (savedStates.length >= maxLocalSaves) {
      setStatus({ type: 'error', text: translate('sesLimitReached', { max: maxLocalSaves }) })
      return
    }
    const name = newName.trim() || new Date().toLocaleString()
    setBusy(true)
    try {
      const entry: SavedExperienceState = { id: createStateId(), name, createdAt: new Date().toISOString(), state: await captureState(parts) }
      await store.putSavedStates([entry])
      await refreshSavedStates()
      setNewName('')
      setStatus({ type: 'success', text: translate('sesSaved', { name }) })
    } catch (err) {
      showStorageError(err)
    } finally {
      setBusy(false)
    }
  }

  const onUpdate = async (item: SavedExperienceState) => {
    setBusy(true)
    try {
      await store.putSavedStates([{ ...item, state: await captureState(parts), updatedAt: new Date().toISOString() }])
      await refreshSavedStates()
      setStatus({ type: 'success', text: translate('sesUpdated', { name: item.name }) })
    } catch (err) {
      showStorageError(err)
    } finally {
      setBusy(false)
    }
  }

  const onRename = (item: SavedExperienceState, name: string) => {
    store.putSavedStates([{ ...item, name }]).then(refreshSavedStates).catch(showStorageError)
  }

  const onDelete = (item: SavedExperienceState) => {
    store.deleteSavedState(item.id)
      .then(refreshSavedStates)
      .then(() => { setStatus({ type: 'info', text: translate('sesDeleted', { name: item.name }) }) })
      .catch(showStorageError)
  }

  // ---- Files ----

  const download = (states: SavedExperienceState[], fileName: string) => {
    const blob = new Blob([JSON.stringify(createStateFile(states, appId), null, 2)], { type: 'application/json' })
    saveAs(blob, fileName)
  }

  // e.g. "Hawaii trip states 2026-09-27"
  const getDefaultExportName = () => {
    const now = new Date()
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    return appTitle?.trim()
      ? translate('sesExportDefaultName', { title: appTitle.trim(), date })
      : translate('sesExportDefaultNameNoTitle', { date })
  }

  // Close the prompt when there is nothing left to export (e.g. the last state was deleted).
  React.useEffect(() => {
    if (savedStates.length === 0) setExportPromptOpen(false)
  }, [savedStates.length])

  const onSaveCurrentToFile = async () => {
    const name = newName.trim() || new Date().toLocaleString()
    setBusy(true)
    try {
      download([{ id: createStateId(), name, createdAt: new Date().toISOString(), state: await captureState(parts) }], toFileName(name))
    } finally {
      setBusy(false)
    }
  }

  const onFileChosen = async (evt: React.ChangeEvent<HTMLInputElement>) => {
    const file = evt.target.files?.[0]
    evt.target.value = '' // allow picking the same file again
    if (!file) return
    let text: string
    try {
      text = await file.text()
    } catch {
      setStatus({ type: 'error', text: translate('sesReadFailed') })
      return
    }
    const result = parseStateFile(text)
    if ('reason' in result) {
      const errorKey = { invalidJson: 'sesInvalidJson', invalidFormat: 'sesInvalidFormat', unsupportedVersion: 'sesUnsupportedVersion', empty: 'sesEmptyFile' }[result.reason]
      setStatus({ type: 'error', text: translate(errorKey) })
      return
    }

    if (config.enableLocalSaves && store) {
      const room = maxLocalSaves - savedStates.length
      if (room < result.states.length) {
        setStatus({ type: 'error', text: translate('sesLimitReached', { max: maxLocalSaves }) })
        return
      }
      try {
        await store.putSavedStates(result.states)
        await refreshSavedStates()
      } catch (err) {
        showStorageError(err)
        return
      }
    }

    // A single state is applied right away; a multi-state bundle is only added to the list.
    if (result.states.length === 1) {
      const [item] = result.states
      await restore(item.state, translate('sesRestored', { name: item.name }))
    } else {
      setStatus({ type: 'success', text: translate('sesImported', { count: result.states.length }) })
    }
    if (result.appId && result.appId !== appId) {
      setStatus({ type: 'warning', text: translate('sesImportedOtherApp') })
    }
  }

  // ---- Render ----

  const disabled = isDesignMode || busy
  const storageDisabled = disabled || !store
  const showSaveToFile = !!config.enableFileExport && !config.enableLocalSaves
  const showSaveSection = !!(config.enableLocalSaves || config.enableFileExport || config.enableFileImport)
  const nothingEnabled = !showSaveSection && !config.restoreOnReopen

  return (
    <Paper variant='flat' shape='none' className='jimu-widget widget-save-experience-state' css={style} aria-busy={busy} role='region' aria-label={props.label}>
      {isDesignMode && <Alert type='info' withIcon fullWidth text={translate('sesDesignModeHint')} />}
      {nothingEnabled && <Alert type='warning' withIcon fullWidth text={translate('sesNothingEnabled')} />}

      {pendingSession && !isDesignMode && (
        <Alert type='info' withIcon fullWidth open title={translate('sesLastSessionTitle')} closable onClose={() => { setPendingSession(null) }}>
          <div>{translate('sesLastSessionText')}</div>
          <div className='ses-banner-actions'>
            <Button type='primary' size='sm' disabled={busy} onClick={() => {
              const state = pendingSession
              setPendingSession(null)
              void restore(state, translate('sesRestoredSession'))
            }}>{translate('sesLastSessionAccept')}</Button>
            <Button size='sm' onClick={() => { setPendingSession(null) }}>{translate('sesLastSessionIgnore')}</Button>
          </div>
        </Alert>
      )}

      {status && (
        <Alert type={status.type} withIcon fullWidth open closable text={status.text} aria-live='polite' onClose={() => { setStatus(null) }} />
      )}

      {showSaveSection && (
        <section aria-labelledby={`${widgetId}-save-title`}>
          <h3 className='ses-section-title' id={`${widgetId}-save-title`}>{translate('sesSaveCurrent')}</h3>
          {(config.enableLocalSaves || config.enableFileExport) && (
            <div className='ses-row'>
              <TextInput
                size='sm'
                value={newName}
                placeholder={translate('sesStateName')}
                aria-label={translate('sesStateName')}
                disabled={disabled}
                onChange={evt => { setNewName(evt.target.value) }}
                onKeyDown={evt => { if (evt.key === 'Enter' && config.enableLocalSaves && !storageDisabled) void onSave() }}
              />
              {config.enableLocalSaves && (
                <Button type='primary' size='sm' disabled={storageDisabled} onClick={onSave}>
                  <SaveOutlined className='mr-1' />{translate('sesSave')}
                </Button>
              )}
            </div>
          )}
          {(config.enableFileImport || showSaveToFile) && (
            <div className='ses-file-row'>
              {config.enableFileImport && (
                <React.Fragment>
                  <Button size='sm' disabled={disabled} onClick={() => { fileInputRef.current?.click() }}>
                    <ImportOutlined className='mr-1' />{translate('sesLoadFromFile')}
                  </Button>
                  <input ref={fileInputRef} type='file' accept='.json,application/json' hidden tabIndex={-1} aria-hidden onChange={onFileChosen} />
                </React.Fragment>
              )}
              {/* With named states on, users save and then download (per row or "Export all"), so this is only
                  offered when files are the only way to keep a state. */}
              {showSaveToFile && (
                <Button size='sm' disabled={disabled} onClick={onSaveCurrentToFile}>
                  <ExportOutlined className='mr-1' />{translate('sesSaveToFile')}
                </Button>
              )}
            </div>
          )}
        </section>
      )}

      {showSaveSection && config.enableLocalSaves && <hr className='ses-divider' />}

      {config.enableLocalSaves && (
        <section aria-labelledby={`${widgetId}-list-title`}>
          <div className='ses-list-header'>
            <h3 className='ses-section-title' id={`${widgetId}-list-title`}>{translate('sesSavedStates')}</h3>
            <span className='ses-count'>{translate('sesCount', { count: savedStates.length, max: maxLocalSaves })}</span>
            {config.enableFileExport && (
              <Button
                className='ses-export-all'
                type='tertiary'
                size='sm'
                aria-expanded={exportPromptOpen}
                aria-controls={exportPromptOpen ? `${widgetId}-export-prompt` : undefined}
                disabled={disabled || savedStates.length === 0}
                onClick={() => { setExportPromptOpen(open => !open) }}
              >
                <ExportOutlined className='mr-1' />{translate('sesExportAll')}
              </Button>
            )}
          </div>
          {exportPromptOpen && (
            <div id={`${widgetId}-export-prompt`}>
              <ExportAllPrompt
                id={widgetId}
                defaultFileName={getDefaultExportName()}
                count={savedStates.length}
                translate={translate}
                onCancel={() => { setExportPromptOpen(false) }}
                onExport={fileName => {
                  download(savedStates, toFileName(fileName))
                  setExportPromptOpen(false)
                }}
              />
            </div>
          )}
          {savedStates.length === 0
            ? <div className='ses-empty'>{translate('sesNoSavedStates')}</div>
            : (
              <ul className='ses-list'>
                {savedStates.map(item => (
                  <StateListItem
                    key={item.id}
                    item={item}
                    disabled={disabled}
                    allowDownload={!!config.enableFileExport}
                    translate={translate}
                    onRestore={() => restore(item.state, translate('sesRestored', { name: item.name }))}
                    onUpdate={() => { void onUpdate(item) }}
                    onRename={name => { onRename(item, name) }}
                    onDownload={() => { download([item], toFileName(item.name)) }}
                    onDelete={() => { onDelete(item) }}
                  />
                ))}
              </ul>
              )}
        </section>
      )}
    </Paper>
  )
}

export default Widget
