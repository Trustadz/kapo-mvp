'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { Button, Dialog, Field, Input, Notice } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { MoveDestination, ProjectCard } from '@/components/projects/types';
import { changeInboxParentRequest, fetchMoveInfo } from '@/components/projects/api';
import styles from './inbox.module.css';

export interface ChangeParentDialogProps {
  open: boolean;
  projectId: string;
  projectTitle: string;
  onClose: () => void;
  /** Called with the updated card; the capture stays in the Inbox. */
  onChanged: (project: ProjectCard) => void;
}

/**
 * Inbox Change parent (issue #15).
 *
 * Reuses the Move API's destination list (readable, editable, non-descendant,
 * current parent excluded) and filters it client-side by project title. Unlike
 * the Move dialog there is no status mapping: the capture moves to the
 * destination's Start status and keeps its Inbox flag.
 */
export function ChangeParentDialog({
  open,
  projectId,
  projectTitle,
  onClose,
  onChanged,
}: ChangeParentDialogProps) {
  const inputId = useId();
  const [destinations, setDestinations] = useState<MoveDestination[]>([]);
  const [destinationId, setDestinationId] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDestinations([]);
    setDestinationId('');
    setQuery('');
    void fetchMoveInfo(projectId).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setDestinations(
        result.data.destinations.filter(
          (destination) => destination.id !== result.data.project.currentParentId,
        ),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!normalizedQuery) return destinations;
    return destinations.filter(
      (destination) =>
        destination.title.toLowerCase().includes(normalizedQuery) ||
        destination.path.toLowerCase().includes(normalizedQuery),
    );
  }, [destinations, normalizedQuery]);

  const selected = destinations.find((destination) => destination.id === destinationId) ?? null;
  const selectedStart =
    selected?.statuses.find((status) => status.isStart) ?? selected?.statuses[0] ?? null;
  const canSubmit = Boolean(selected) && !loading && !saving;

  const submit = async () => {
    if (!selected || saving) return;
    setSaving(true);
    setError(null);
    const result = await changeInboxParentRequest(projectId, selected.id);
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onChanged(result.data.project);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Change parent"
      description={`${projectTitle} stays in the Inbox and starts at the new parent's Start status.`}
      dismissible={!saving}
      footer={
        <div className={styles.dialogFooter}>
          <Button type="button" onClick={() => void submit()} disabled={!canSubmit} loading={saving}>
            Change parent
          </Button>
          <Button type="button" variant="quiet" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
        </div>
      }
    >
      <div className={styles.dialogForm}>
        {loading ? <Notice tone="info">Loading projects…</Notice> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        {!loading && !error && destinations.length === 0 ? (
          <Notice tone="info">There is no other project you can move this capture under.</Notice>
        ) : null}
        {!loading && !error && destinations.length > 0 ? (
          <>
            <Field
              label="Find a parent"
              htmlFor={inputId}
              hint="Search by project title. The list only includes projects you can edit."
            >
              <Input
                id={inputId}
                type="search"
                value={query}
                autoFocus
                autoComplete="off"
                placeholder="Type a project title"
                onChange={(event) => setQuery(event.target.value)}
              />
            </Field>
            {filtered.length > 0 ? (
              <ul className={styles.parentOptions} aria-label="Parent destinations">
                {filtered.map((destination) => (
                  <li key={destination.id}>
                    <button
                      type="button"
                      className={cn(
                        styles.parentOption,
                        destination.id === destinationId && styles.parentOptionSelected,
                      )}
                      aria-pressed={destination.id === destinationId}
                      onClick={() => setDestinationId(destination.id)}
                    >
                      <span className={styles.parentOptionTitle}>{destination.title}</span>
                      <span className={styles.parentOptionPath}>{destination.path}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.dialogHint}>No project titles match “{query.trim()}”.</p>
            )}
            {selected && selectedStart ? (
              <p className={styles.dialogHint}>
                {selected.title} starts captures at “{selectedStart.name}”.
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
