'use client';

import { Icon, Input, Select } from '@/components/ui';
import { formatPersonName } from '@/lib/format';
import { useI18n } from '@/i18n/client';
import {
  hasActiveProjectFilters,
  type ProjectFilterState,
  type ReporterFilterOption,
} from './projectFilters';
import styles from './ProjectPage.module.css';

export interface ProjectFilterBarProps {
  filters: ProjectFilterState;
  reporters: readonly ReporterFilterOption[];
  onChange: (next: ProjectFilterState) => void;
  /** Matching projects after filtering. */
  matchingCount: number;
  /** Projects in the unfiltered collection for the active view. */
  totalCount: number;
}

/**
 * Compact filter bar for a project's child collection (issue #55): live title
 * search plus a reporter select. It sits above the collection toolbar so the
 * view selector and Add action stay available, and wraps/stacks on mobile.
 */
export function ProjectFilterBar({
  filters,
  reporters,
  onChange,
  matchingCount,
  totalCount,
}: ProjectFilterBarProps) {
  const { t, plural } = useI18n();
  const active = hasActiveProjectFilters(filters);

  return (
    <div className={styles.filterBar} role="group" aria-label={t('filters.group')}>
      <div className={styles.filterSearch}>
        <Icon name="search" size={20} className={styles.filterSearchIcon} />
        <Input
          className={styles.filterSearchInput}
          type="search"
          value={filters.title}
          placeholder={t('filters.byTitle')}
          aria-label={t('filters.byTitleAria')}
          onChange={(event) => onChange({ ...filters, title: event.target.value })}
        />
      </div>
      <Select
        className={styles.filterReporter}
        aria-label={t('filters.byReporterAria')}
        value={filters.reporterId ?? ''}
        onChange={(event) =>
          onChange({ ...filters, reporterId: event.target.value || null })
        }
      >
        <option value="">{t('filters.allReporters')}</option>
        {reporters.map((reporter) => (
          <option key={reporter.id} value={reporter.id}>
            {formatPersonName(reporter.username)}
          </option>
        ))}
      </Select>
      {active ? (
        <span className={styles.filterCount} role="status" aria-live="polite" aria-atomic="true">
          {plural('plurals.filterCount', totalCount, {
            matching: matchingCount,
            total: totalCount,
          })}
        </span>
      ) : null}
    </div>
  );
}
