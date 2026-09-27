import { React, css } from 'jimu-core'
import { Button, Label, TextInput } from 'jimu-ui'

export interface ExportAllPromptProps {
  id: string
  defaultFileName: string
  count: number
  translate: (id: string, values?: { [key: string]: any }) => string
  onExport: (fileName: string) => void
  onCancel: () => void
}

const style = css`
  display: flex;
  flex-direction: column;
  gap: var(--sys-spacing-2);
  padding: var(--sys-spacing-3);
  margin-bottom: var(--sys-spacing-2);
  border: 1px solid var(--sys-color-divider-primary);
  border-radius: var(--sys-shape-shape1);
  background: var(--sys-color-surface-paper);
  .ses-prompt-label {
    margin: 0;
    font-size: 0.8125rem;
    font-weight: var(--sys-typography-font-weight-medium);
  }
  .ses-prompt-suffix {
    color: var(--sys-color-surface-paper-hint);
  }
  .ses-prompt-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--sys-spacing-2);
  }
`

/** Inline "File name" box shown under the Saved states header when "Export all" is clicked. */
export const ExportAllPrompt = (props: ExportAllPromptProps) => {
  const { id, count, translate } = props
  const [fileName, setFileName] = React.useState(props.defaultFileName)
  const inputId = `${id}-file-name`

  const submit = () => {
    // The ".json" suffix is shown after the field; drop it if the user typed it too.
    props.onExport(fileName.trim().replace(/\.json$/i, '') || props.defaultFileName)
  }

  return (
    <div
      css={style}
      role='group'
      aria-label={translate('sesExportAllTitle')}
      onKeyDown={evt => { if (evt.key === 'Escape') props.onCancel() }}
    >
      <Label className='ses-prompt-label' for={inputId}>{translate('sesFileName')}</Label>
      <TextInput
        id={inputId}
        size='sm'
        autoFocus
        value={fileName}
        suffix={<span className='ses-prompt-suffix'>.json</span>}
        onFocus={evt => { evt.target.select() }}
        onChange={evt => { setFileName(evt.target.value) }}
        onKeyDown={evt => { if (evt.key === 'Enter') submit() }}
      />
      <div className='ses-prompt-actions'>
        <Button type='tertiary' size='sm' onClick={props.onCancel}>{translate('sesCancel')}</Button>
        <Button type='primary' size='sm' onClick={submit}>{translate('sesExportCount', { count })}</Button>
      </div>
    </div>
  )
}
