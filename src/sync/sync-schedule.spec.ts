import { nextSyncAfterFailure, nextSyncAfterSuccess } from './sync-schedule.js';

const NOW = new Date('2026-11-23T12:00:00Z');

describe('sync schedule', () => {
  it('schedules the next run one interval after a success', () => {
    expect(nextSyncAfterSuccess(NOW, 15)).toEqual(new Date('2026-11-23T12:15:00Z'));
  });

  it('doubles the delay with every consecutive failure', () => {
    expect(nextSyncAfterFailure(NOW, 15, 0, 360)).toEqual(new Date('2026-11-23T12:15:00Z'));
    expect(nextSyncAfterFailure(NOW, 15, 1, 360)).toEqual(new Date('2026-11-23T12:30:00Z'));
    expect(nextSyncAfterFailure(NOW, 15, 3, 360)).toEqual(new Date('2026-11-23T14:00:00Z'));
  });

  it('caps the delay', () => {
    expect(nextSyncAfterFailure(NOW, 15, 10, 360)).toEqual(new Date('2026-11-23T18:00:00Z'));
  });
});
