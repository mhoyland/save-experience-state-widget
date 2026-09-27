import { React, hooks } from 'jimu-core'
import type { AllWidgetSettingProps } from 'jimu-for-builder'
import { SettingSection, SettingRow } from 'jimu-ui/advanced/setting-components'
import { Checkbox, Label, NumericInput, Radio, Switch } from 'jimu-ui'
import type { Config, IMConfig, RestoreMode } from '../config'
import defaultMessages from './translations/default'

type BooleanKey = {
  [K in keyof Config]: Config[K] extends boolean ? K : never
}[keyof Config]

const PART_KEYS: Array<{ key: BooleanKey, label: string }> = [
  { key: 'includePage', label: 'sesIncludePage' },
  { key: 'includeViews', label: 'sesIncludeViews' },
  { key: 'includeWindow', label: 'sesIncludeWindow' },
  { key: 'includeMapExtent', label: 'sesIncludeMapExtent' },
  { key: 'includeLayerVisibility', label: 'sesIncludeLayerVisibility' },
  { key: 'includeBasemap', label: 'sesIncludeBasemap' },
  { key: 'includeDrawings', label: 'sesIncludeDrawings' }
]

const Setting = (props: AllWidgetSettingProps<IMConfig>) => {
  const { config, id } = props
  const translate = hooks.useTranslation(defaultMessages)

  const set = <K extends keyof Config>(key: K, value: Config[K]) => {
    props.onSettingChange({ id, config: config.set(key, value) })
  }

  const toggleRow = (key: BooleanKey, label: string, hint?: string) => (
    <React.Fragment>
      <SettingRow label={translate(label)} flow='no-wrap'>
        <Switch checked={!!config[key]} aria-label={translate(label)} onChange={(_evt, checked) => { set(key, checked) }} />
      </SettingRow>
      {hint && <SettingRow><div className='text-break' style={{ fontSize: '0.75rem', opacity: 0.8 }}>{translate(hint)}</div></SettingRow>}
    </React.Fragment>
  )

  const restoreMode: RestoreMode = config.restoreMode ?? 'prompt'
  // Parts added after the first release are missing from older saved configs; like the runtime, treat missing as on.
  const isPartOn = (key: BooleanKey): boolean => config[key] ?? true
  const noPartsSelected = PART_KEYS.every(({ key }) => !isPartOn(key))

  return (
    <div className='widget-setting-save-experience-state'>
      <SettingSection title={translate('sesExperienceState')}>
        {toggleRow('restoreOnReopen', 'sesRestoreOnReopen', 'sesRestoreOnReopenHint')}
        {config.restoreOnReopen && (
          <SettingRow flow='wrap' role='radiogroup' aria-label={translate('sesRestoreMode')} label={translate('sesRestoreMode')}>
            {(['prompt', 'auto'] as RestoreMode[]).map(mode => (
              <Label key={mode} className='d-flex align-items-center w-100'>
                <Radio className='mr-2' name={`${id}-restore-mode`} checked={restoreMode === mode} onChange={() => { set('restoreMode', mode) }} />
                {translate(mode === 'prompt' ? 'sesRestoreModePrompt' : 'sesRestoreModeAuto')}
              </Label>
            ))}
          </SettingRow>
        )}
      </SettingSection>

      <SettingSection title={translate('sesIncludedItems')}>
        {PART_KEYS.map(({ key, label }) => (
          <SettingRow key={key}>
            <Label className='d-flex align-items-center'>
              <Checkbox className='mr-2' checked={isPartOn(key)} onChange={(_evt, checked) => { set(key, checked) }} />
              {translate(label)}
            </Label>
          </SettingRow>
        ))}
        {isPartOn('includeDrawings') && (
          <SettingRow><div className='text-break' style={{ fontSize: '0.75rem', opacity: 0.8 }}>{translate('sesIncludeDrawingsHint')}</div></SettingRow>
        )}
        {noPartsSelected && (
          <SettingRow><div role='alert' style={{ fontSize: '0.75rem', color: 'var(--sys-color-warning-dark)' }}>{translate('sesNoPartsSelected')}</div></SettingRow>
        )}
      </SettingSection>

      <SettingSection title={translate('sesLocalStorage')}>
        {toggleRow('enableLocalSaves', 'sesEnableLocalSaves', 'sesEnableLocalSavesHint')}
        {config.enableLocalSaves && (
          <SettingRow label={translate('sesMaxLocalSaves')} flow='no-wrap'>
            <NumericInput
              size='sm'
              style={{ width: 80 }}
              min={1}
              max={200}
              step={1}
              precision={0}
              value={config.maxLocalSaves ?? 20}
              aria-label={translate('sesMaxLocalSaves')}
              onAcceptValue={value => { set('maxLocalSaves', Math.min(200, Math.max(1, Math.round(Number(value) || 20)))) }}
            />
          </SettingRow>
        )}
      </SettingSection>

      <SettingSection title={translate('sesFiles')}>
        {toggleRow('enableFileExport', 'sesEnableFileExport')}
        {toggleRow('enableFileImport', 'sesEnableFileImport')}
      </SettingSection>
    </div>
  )
}

export default Setting
