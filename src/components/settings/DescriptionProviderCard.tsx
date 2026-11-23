'use client';

import { useState } from 'react';
import { Button, Field, Notice, Select } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { requestJson } from '@/lib/api-client';
import type { DescriptionCapabilitySettings } from '@/lib/description';
import styles from './ApplicationSettingsForm.module.css';

export interface DescriptionProviderCardProps {
  capability: DescriptionCapabilitySettings;
}

/**
 * Application-settings control for the exclusive description capability.
 * The card owns its own save so it can sit inside the Add-ons tab without
 * being coupled to the property add-on mode form.
 */
export function DescriptionProviderCard({ capability }: DescriptionProviderCardProps) {
  const { t } = useI18n();
  const [selected, setSelected] = useState(capability.activeProvider ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (capability.providers.length === 0) return null;

  const current = selected === '' ? null : selected;
  const provider = capability.providers.find((candidate) => candidate.identifier === selected) ?? null;
  const dirty = current !== capability.activeProvider;
  const unsupported = capability.formatsInUse.filter(
    (usage) => provider === null || !provider.reads.includes(usage.format),
  );
  const unsupportedCount = unsupported.reduce((total, usage) => total + usage.count, 0);
  const formats = capability.formatsInUse
    .map((usage) => `${usage.format} (${usage.count})`)
    .join(', ');

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    const result = await requestJson<{
      capabilities: { description: DescriptionCapabilitySettings };
    }>('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ capabilities: { description: current } }),
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSaved(true);
    if (typeof window !== 'undefined') window.location.reload();
  };

  return (
    <section className={styles.addonCard} aria-labelledby="description-provider-heading">
      <div className={styles.addonHeader}>
        <h3 id="description-provider-heading" className={styles.addonName}>
          {t('description.providerHeading')}
        </h3>
        <p className={styles.addonDescription}>{t('description.providerHint')}</p>
      </div>

      <Field
        label={t('description.providerLabel')}
        htmlFor="description-provider"
        labelWidth={190}
        hint={
          capability.formatsInUse.length > 0
            ? t('description.formatsInUse', { formats })
            : t('description.noDescriptions')
        }
      >
        <Select
          id="description-provider"
          value={selected}
          disabled={saving}
          onChange={(event) => {
            setSelected(event.target.value);
            setSaved(false);
            setError(null);
          }}
        >
          <option value="">{t('description.providerNone')}</option>
          {capability.providers.map((candidate) => (
            <option key={candidate.identifier} value={candidate.identifier}>
              {candidate.name}
            </option>
          ))}
        </Select>
      </Field>

      {provider ? (
        <p className={styles.capabilityMeta}>
          {provider.reads.length > 0
            ? `${provider.identifier} · ${provider.reads.join(', ')}`
            : provider.identifier}
        </p>
      ) : null}

      {provider && unsupportedCount > 0 ? (
        <Notice tone="warning">
          {t('description.providerWarning', { count: unsupportedCount })}
        </Notice>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {saved ? <p className={styles.capabilityMeta}>{t('description.providerSaved')}</p> : null}

      <div className={styles.capabilityActions}>
        <Button onClick={() => void save()} loading={saving} disabled={saving || !dirty}>
          {t('common.saveChanges')}
        </Button>
      </div>
    </section>
  );
}
