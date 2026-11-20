import { describe, expect, it } from 'vitest';
import { computeNextRun } from '@/server/backup/schedule';
import { formatBackupName, parseBackupName } from '@/server/backup/service';

/**
 * Rolling backup schedule/name unit tests (issue #13). Dates are built with the
 * local-time constructor so the assertions hold in any server timezone.
 */
describe('computeNextRun', () => {
  it('schedules later the same day when the start time is still ahead', () => {
    const next = computeNextRun(new Date(2026, 0, 15, 1, 30, 0), '02:00');
    expect(next).toEqual(new Date(2026, 0, 15, 2, 0, 0, 0));
  });

  it('schedules tomorrow when the start time has passed', () => {
    const next = computeNextRun(new Date(2026, 0, 15, 3, 0, 0), '02:00');
    expect(next).toEqual(new Date(2026, 0, 16, 2, 0, 0, 0));
  });

  it('schedules tomorrow when the clock is exactly on the start time', () => {
    const next = computeNextRun(new Date(2026, 0, 15, 2, 0, 0, 0), '02:00');
    expect(next).toEqual(new Date(2026, 0, 16, 2, 0, 0, 0));
  });

  it('rolls over month and year boundaries', () => {
    const next = computeNextRun(new Date(2026, 11, 31, 23, 30, 0), '00:30');
    expect(next).toEqual(new Date(2027, 0, 1, 0, 30, 0, 0));
  });

  it('falls back to 02:00 for an invalid stored time', () => {
    const next = computeNextRun(new Date(2026, 5, 1, 1, 0, 0), 'not-a-time');
    expect(next).toEqual(new Date(2026, 5, 1, 2, 0, 0, 0));
  });
});

describe('backup folder names', () => {
  it('formats sortable local timestamps', () => {
    expect(formatBackupName(new Date(2026, 10, 20, 15, 55, 9))).toBe('kapo-20261120-155509');
  });

  it('parses a formatted name back to the same local time', () => {
    const date = new Date(2026, 0, 2, 2, 0, 3);
    const parsed = parseBackupName(formatBackupName(date));
    expect(parsed).not.toBeNull();
    expect(parsed?.getTime()).toBe(date.getTime());
  });

  it('rejects unrelated folder names', () => {
    expect(parseBackupName('uploads')).toBeNull();
    expect(parseBackupName('kapo-2026-01-02')).toBeNull();
  });
});
