'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { Notice } from '@/components/ui/Notice';
import { postJson, requestJson } from '@/lib/api-client';
import { useI18n } from '@/i18n/client';
import type { McpTokenSummary } from '@/lib/mcp';
import styles from './McpTokensSection.module.css';

export interface McpTokensSectionProps {
  enabled: boolean;
  initialTokens: McpTokenSummary[];
}

/**
 * Personal MCP credentials (Profile → AI access).
 *
 * The raw token is shown exactly once, immediately after creation, and is never
 * fetchable again. Revoking is a two-step inline confirmation: it immediately
 * breaks any AI client using that token.
 */
export function McpTokensSection({ enabled, initialTokens }: McpTokensSectionProps) {
  const { t, formatDateTime } = useI18n();
  const baseId = useId();
  const [tokens, setTokens] = useState<McpTokenSummary[]>(
    initialTokens.filter((token) => token.revokedAt === null),
  );
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ token: string; label: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [labelError, setLabelError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);

  const handleCreate = async () => {
    if (creating) return;
    const trimmed = label.trim();
    if (!trimmed) {
      setLabelError(t('profile.mcpLabelRequired'));
      return;
    }
    if (trimmed.length > 60) {
      setLabelError(t('profile.mcpLabelTooLong'));
      return;
    }
    setCreating(true);
    setError(null);
    setLabelError(null);
    try {
      const result = await postJson<{ token: string; summary: McpTokenSummary }>(
        '/api/me/mcp-tokens',
        { label: trimmed },
      );
      if (!result.ok) {
        setLabelError(result.fields?.label ?? null);
        setError(result.message);
        return;
      }
      setTokens((current) => [result.data.summary, ...current]);
      setCreated({ token: result.data.token, label: result.data.summary.label });
      setCopied(false);
      setLabel('');
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (revoking) return;
    setRevoking(true);
    setError(null);
    try {
      const result = await requestJson<{ revoked: boolean }>(`/api/me/mcp-tokens/${id}`, {
        method: 'DELETE',
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setTokens((current) => current.filter((token) => token.id !== id));
      setConfirmId(null);
    } finally {
      setRevoking(false);
    }
  };

  const inputId = `${baseId}-label`;

  return (
    <Card as="section" className={styles.card}>
      <CardHeader title={t('profile.mcpTitle')} description={t('profile.mcpDescription')} />

      {!enabled ? (
        <Notice tone="info">{t('profile.mcpDisabled')}</Notice>
      ) : (
        <>
          {created ? (
            <Notice tone="success" title={t('profile.mcpCreatedTitle')}>
              <p>{t('profile.mcpCreatedBody')}</p>
              <div className={styles.tokenRow}>
                <code className={styles.token}>{created.token}</code>
                <Button
                  variant="quiet"
                  size="sm"
                  icon={<Icon name={copied ? 'check' : 'content_copy'} size={18} />}
                  onClick={() => void handleCopy()}
                >
                  {copied ? t('profile.mcpCopied') : t('profile.mcpCopy')}
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCreated(null)}
                className={styles.dismiss}
              >
                {t('profile.mcpDone')}
              </Button>
            </Notice>
          ) : null}

          <div className={styles.form}>
            <Field
              label={t('profile.mcpNameLabel')}
              htmlFor={inputId}
              hint={t('profile.mcpNameHint')}
              error={labelError ?? undefined}
            >
              <Input
                id={inputId}
                name="mcpTokenLabel"
                value={label}
                maxLength={60}
                placeholder={t('profile.mcpNamePlaceholder')}
                onChange={(event) => {
                  setLabel(event.target.value);
                  setLabelError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void handleCreate();
                  }
                }}
              />
            </Field>
            <Button
              onClick={() => void handleCreate()}
              loading={creating}
              icon={<Icon name="add" size={18} />}
            >
              {t('profile.mcpCreate')}
            </Button>
          </div>

          {error ? <Notice tone="error">{error}</Notice> : null}

          <h3 className={styles.listHeading}>{t('profile.mcpExisting')}</h3>
          {tokens.length === 0 ? (
            <p className={styles.empty}>{t('profile.mcpNone')}</p>
          ) : (
            <ul className={styles.list}>
              {tokens.map((token) => (
                <li key={token.id} className={styles.item}>
                  <div className={styles.itemText}>
                    <p className={styles.itemLabel}>{token.label}</p>
                    <p className={styles.itemMeta}>
                      {t('profile.mcpCreatedAt', { date: formatDateTime(token.createdAt) })}
                      {' · '}
                      {token.lastUsedAt
                        ? t('profile.mcpLastUsed', { date: formatDateTime(token.lastUsedAt) })
                        : t('profile.mcpNeverUsed')}
                    </p>
                  </div>
                  {confirmId === token.id ? (
                    <div className={styles.confirm}>
                      <p className={styles.confirmText}>{t('profile.mcpConfirmRevoke')}</p>
                      <Button
                        variant="danger"
                        size="sm"
                        loading={revoking}
                        onClick={() => void handleRevoke(token.id)}
                      >
                        {t('profile.mcpConfirm')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmId(null)}
                        disabled={revoking}
                      >
                        {t('profile.mcpCancel')}
                      </Button>
                    </div>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => setConfirmId(token.id)}>
                      {t('profile.mcpRevoke')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}
