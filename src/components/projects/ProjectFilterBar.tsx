'use client';

import { Icon, Input, Select } from '@/components/ui';
import { formatPersonName } from '@/lib/format';
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
  const active = hasActiveProjectFilters(filters);

  return (
    <div className={styles.filterBar} role="group" aria-label="Filter child projects">
      <div className={styles.filterSearch}>
        <Icon name="search" size={20} className={styles.filterSearchIcon} />
        <Input
          className={styles.filterSearchInput}
          type="search"
          value={filters.title}
          placeholder="Filter by title"
          aria-label="Filter projects by title"
          onChange={(event) => onChange({ ...filters, title: event.target.value })}
        />
      </div>
      <Select
        className={styles.filterReporter}
        aria-label="Filter projects by reporter"
        value={filters.reporterId ?? ''}
        onChange={(event) =>
          onChange({ ...filters, reporterId: event.target.value || null })
        }
      >
        <option value="">All reporters</option>
        {reporters.map((reporter) => (
          <option key={reporter.id} value={reporter.id}>
            {formatPersonName(reporter.username)}
          </option>
        ))}
      </Select>
      {active ? (
        <span className={styles.filterCount} role="status" aria-live="polite" aria-atomic="true">
          {matchingCount} of {totalCount} project{totalCount === 1 ? '' : 's'}
        </span>
      ) : null}
    </div>
  );
}
