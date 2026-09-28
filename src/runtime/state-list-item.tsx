import { React, css } from 'jimu-core'
import { Button, TextInput } from 'jimu-ui'
import { ArrowUndoOutlined } from 'jimu-icons/outlined/directional/arrow-undo'
import { SaveOutlined } from 'jimu-icons/outlined/application/save'
import { EditOutlined } from 'jimu-icons/outlined/editor/edit'
import { DownloadOutlined } from 'jimu-icons/outlined/editor/download'
import { TrashOutlined } from 'jimu-icons/outlined/editor/trash'
import type { SavedExperienceState } from './state-file'
import type { StateFileStatus } from './state-fingerprint'

export interface StateListItemProps {
  item: SavedExperienceState
  disabled: boolean
  allowDownload: boolean
  /** Whether the state is in a saved file; `null` hides the tag (when saving to file is off). */
  fileStatus: StateFileStatus | null
  translate: (id: string, values?: { [key: string]: any }) => string
  onRestore: () => void
  onUpdate: () => void
  onRename: (name: string) => void
  onDownload: () => void
  onDelete: () => void
}

const style = css`
  display: flex;
  align-items: center;
  gap: var(--sys-spacing-1);
  padding: var(--sys-spacing-1) var(--sys-spacing-2);
  border: 1px solid var(--sys-color-divider-secondary);
  border-radius: var(--sys-shape-shape1);
  .ses-item-main {
    flex: 1;
    min-width: 0;
  }
  .ses-item-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.8125rem;
  }
  .ses-confirm-text {
    font-size: 0.8125rem;
    overflow-wrap: anywhere;
  }
  .ses-item-date {
    color: var(--sys-color-surface-paper-hint);
    font-size: 0.75rem;
  }
  .ses-item-file-status {
    font-size: 0.75rem;
    color: var(--sys-color-surface-paper-hint);
  }
  .ses-item-file-status.is-unsaved {
    font-weight: var(--sys-typography-font-weight-medium);
    color: var(--sys-color-warning-dark, #8a6100);
  }
  .ses-item-actions {
    display: flex;
    flex-shrink: 0;
  }
`

export const StateListItem = (props: StateListItemProps) => {
  const { item, disabled, allowDownload, fileStatus, translate } = props
  const [editing, setEditing] = React.useState(false)
  const [draftName, setDraftName] = React.useState(item.name)
  // Destructive actions (replace, delete) ask for confirmation inline, in place of the item's buttons.
  const [confirming, setConfirming] = React.useState<'replace' | 'delete'>(null)

  const commitRename = () => {
    const name = draftName.trim()
    if (name && name !== item.name) props.onRename(name)
    setEditing(false)
  }

  const date = new Date(item.updatedAt ?? item.createdAt)
  const dateText = isNaN(date.getTime()) ? '' : date.toLocaleString()
  const values = { name: item.name }

  const iconButton = (label: string, icon: React.ReactNode, onClick: () => void) => (
    <Button icon type='tertiary' size='sm' title={label} aria-label={label} disabled={disabled} onClick={onClick}>
      {icon}
    </Button>
  )

  if (confirming) {
    const question = translate(confirming === 'delete' ? 'sesConfirmDelete' : 'sesConfirmReplace', values)
    const onConfirm = confirming === 'delete' ? props.onDelete : props.onUpdate
    return (
      <li css={style} role='group' aria-label={question} onKeyDown={evt => { if (evt.key === 'Escape') setConfirming(null) }}>
        <div className='ses-item-main ses-confirm-text'>{question}</div>
        <div className='ses-item-actions'>
          <Button type={confirming === 'delete' ? 'danger' : 'primary'} size='sm' autoFocus onClick={() => { setConfirming(null); onConfirm() }}>{translate('sesYes')}</Button>
          <Button type='tertiary' size='sm' onClick={() => { setConfirming(null) }}>{translate('sesNo')}</Button>
        </div>
      </li>
    )
  }

  return (
    <li css={style}>
      <div className='ses-item-main'>
        {editing
          ? (
            <TextInput
              size='sm'
              autoFocus
              value={draftName}
              aria-label={translate('sesRenameItem', values)}
              onChange={evt => { setDraftName(evt.target.value) }}
              onBlur={commitRename}
              onKeyDown={evt => {
                if (evt.key === 'Enter') commitRename()
                if (evt.key === 'Escape') { setDraftName(item.name); setEditing(false) }
              }}
            />
            )
          : <div className='ses-item-name' title={item.name}>{item.name}</div>}
        {dateText && <div className='ses-item-date'>{dateText}</div>}
        {fileStatus && (
          <div className={`ses-item-file-status${fileStatus === 'saved' ? '' : ' is-unsaved'}`}>
            {translate(fileStatus === 'notSaved' ? 'sesFileStatusNotSaved' : fileStatus === 'changed' ? 'sesFileStatusChanged' : 'sesFileStatusSaved')}
          </div>
        )}
      </div>
      <div className='ses-item-actions'>
        {iconButton(translate('sesRestoreItem', values), <ArrowUndoOutlined />, props.onRestore)}
        {iconButton(translate('sesUpdateItem', values), <SaveOutlined />, () => { setConfirming('replace') })}
        {iconButton(translate('sesRenameItem', values), <EditOutlined />, () => { setDraftName(item.name); setEditing(true) })}
        {allowDownload && iconButton(translate('sesDownloadItem', values), <DownloadOutlined />, props.onDownload)}
        {iconButton(translate('sesDeleteItem', values), <TrashOutlined />, () => { setConfirming('delete') })}
      </div>
    </li>
  )
}
