import {
  beginBenchmarkReplay,
  endBenchmarkReplay,
  isBenchmarkReplayActive,
} from './benchmark-runtime';

describe('benchmark runtime', () => {
  afterEach(() => {
    while (isBenchmarkReplayActive()) {
      endBenchmarkReplay();
    }
  });

  it('tracks nested replay scopes', () => {
    expect(isBenchmarkReplayActive()).toBe(false);
    beginBenchmarkReplay();
    expect(isBenchmarkReplayActive()).toBe(true);
    beginBenchmarkReplay();
    endBenchmarkReplay();
    expect(isBenchmarkReplayActive()).toBe(true);
    endBenchmarkReplay();
    expect(isBenchmarkReplayActive()).toBe(false);
  });
});