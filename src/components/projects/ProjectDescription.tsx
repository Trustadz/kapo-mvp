'use client';

import { useState } from 'react';
import {
  getDescriptionProviderClient,
  getPlainTextDescriptionClient,
} from '@/components/addons/description/registry';
import { Button, Card, Notice } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import type { ProjectDescriptionData } from '@/lib/description';
import { saveProjectDescription } from './api';
import styles from './ProjectDescription.module.css';

export interface ProjectDescriptionProps {
  projectId: string;
  description: ProjectDescriptionData;
  canEdit: boolean;
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
  onSaved: () => void;
}

/**
 * Core description region. The active provider supplies the editor/renderer;
 * core owns permissions, the record and the plaintext fallback.
 */
export function ProjectDescription({
  projectId,
  description,
  canEdit,
  notify,
  onSaved,
}: ProjectDescriptionProps) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(description.record?.body ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const client = description.provider
    ? getDescriptionProviderClient(description.provider.identifier)
    : getPlainTextDescriptionClient();
  const unsupported =
    description.record !== null && description.provider !== null && description.unsupportedFormat;
  const editable =
    canEdit && (description.provider === null || (client !== null && !unsupported));
  const showFallback =
    description.record !== null &&
    description.provider !== null &&
    (client === null || unsupported);

  const startEditing = () => {
    setDraft(description.record?.body ?? '');
    setError(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    if (saving) return;
    setEditing(false);
    setError(null);
  };

  const save = async () => {
    if (!client || saving) return;
    setSaving(true);
    setError(null);
    const result = await saveProjectDescription(projectId, client.serialize(draft));
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    notify(t('description.saved'));
    setEditing(false);
    onSaved();
  };

  return (
    <Card className={styles.card} as="section" aria-labelledby="description-heading">
      <div className={styles.header}>
        <h2 id="description-heading" className={styles.title}>
          {t('description.heading')}
        </h2>
        {!editing && editable ? (
          <Button
            size="sm"
            variant="quiet"
            onClick={startEditing}
            disabled={saving}
          >
            {description.record ? t('description.edit') : t('description.add')}
          </Button>
        ) : null}
      </div>

      {editing && client ? (
        <div className={styles.editor}>
          <client.Editor
            label={t('description.heading')}
            value={draft}
            onChange={setDraft}
            disabled={saving}
            autoFocus
          />
          {error ? <Notice tone="error">{error}</Notice> : null}
          <div className={styles.footer}>
            <Button onClick={() => void save()} loading={saving} disabled={saving}>
              {t('description.save')}
            </Button>
            <Button variant="quiet" onClick={cancelEditing} disabled={saving}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : description.record ? (
        <div className={styles.body}>
          {description.provider && client && !unsupported ? (
            <client.Renderer value={description.record.body} />
          ) : (
            <p className={styles.fallback}>{description.record.plaintext}</p>
          )}
          {showFallback ? <Notice tone="warning">{t('description.unsupportedFormat')}</Notice> : null}
        </div>
      ) : (
        <div className={styles.body}>
          <p className={styles.empty}>{t('description.empty')}</p>
        </div>
      )}
    </Card>
  );
}
