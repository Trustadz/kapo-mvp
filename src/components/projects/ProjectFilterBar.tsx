'use client';

import { Combobox, Icon, Input } from '@/components/ui';
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
      <Combobox
        className={styles.filterReporter}
        label={t('filters.byReporterAria')}
        searchLabel={t('filters.searchReporter')}
        listLabel={t('filters.reporters')}
        placeholder={t('filters.allReporters')}
        emptyLabel={t('filters.noReporters')}
        align="start"
        value={filters.reporterId ?? ''}
        onChange={(value) => onChange({ ...filters, reporterId: value || null })}
        options={[
          { value: '', label: t('filters.allReporters') },
          ...reporters.map((reporter) => ({
            value: reporter.id,
            label: formatPersonName(reporter.username),
            avatar: reporter.avatar,
          })),
        ]}
      />
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
