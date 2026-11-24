'use client';

import { useState } from 'react';
import { getCommentProviderClient } from '@/components/addons/comments/registry';
import { Avatar, Button, Card, Notice } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import type { ProjectCommentView, ProjectCommentsData } from '@/lib/comments';
import { formatPersonName } from '@/lib/format';
import { addProjectComment } from './api';
import styles from './ProjectDiscussion.module.css';

export interface CommentsPanelProps {
  projectId: string;
  comments: ProjectCommentsData;
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

/**
 * Core comments region. The active comments provider supplies the composer and
 * renderer; core owns authors, permissions, ordering and the plaintext fallback.
 */
export function CommentsPanel({ projectId, comments, notify }: CommentsPanelProps) {
  const { t, formatDateTime } = useI18n();
  const [items, setItems] = useState<ProjectCommentView[]>(comments.comments);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const client = comments.provider
    ? getCommentProviderClient(comments.provider.identifier)
    : null;
  const canComment = comments.canComment && client !== null;

  const submit = async () => {
    if (!client || !canComment || saving || draft.trim() === '') return;
    setSaving(true);
    setError(null);
    const result = await addProjectComment(projectId, client.serialize(draft));
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setItems((current) => [...current, result.data.comment]);
    setDraft('');
    notify(t('comments.posted'));
  };

  return (
    <Card className={styles.commentsCard} as="section" aria-labelledby="comments-heading">
      <h2 id="comments-heading" className={styles.cardTitle}>
        {t('comments.heading')}
      </h2>

      {items.length === 0 ? (
        <p className={styles.empty}>{t('comments.empty')}</p>
      ) : (
        <ul className={styles.commentsList} aria-label={t('comments.heading')}>
          {items.map((comment) => {
            const provider = comments.provider;
            const renderClient =
              provider && provider.reads.includes(comment.format) ? client : null;
            const author = comment.author;
            const authorName = author
              ? formatPersonName(author.username)
              : t('comments.formerMember');
            return (
              <li key={comment.id} className={styles.comment}>
                <Avatar
                  name={authorName}
                  src={author?.avatar ?? undefined}
                  size={32}
                  decorative
                />
                <div className={styles.commentBody}>
                  <div className={styles.commentMeta}>
                    <span className={styles.commentAuthor}>{authorName}</span>
                    <span>{formatDateTime(comment.createdAt)}</span>
                  </div>
                  {renderClient ? (
                    <div className={styles.commentText}>
                      <renderClient.Renderer value={comment.body} />
                    </div>
                  ) : (
                    <p className={styles.commentPlain}>{comment.plaintext}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {canComment && client ? (
        <form
          className={styles.composer}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          noValidate
        >
          <client.Editor
            value={draft}
            onChange={setDraft}
            disabled={saving}
            placeholder={t('comments.placeholder')}
            ariaLabel={t('comments.addLabel')}
          />
          <p className={styles.hint}>{t('comments.hint')}</p>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <div className={styles.composerActions}>
            <Button type="submit" loading={saving} disabled={saving || draft.trim() === ''}>
              {t('comments.post')}
            </Button>
          </div>
        </form>
      ) : (
        <p className={styles.readOnly}>
          {comments.provider ? t('comments.readOnly') : t('comments.unavailable')}
        </p>
      )}
    </Card>
  );
}
