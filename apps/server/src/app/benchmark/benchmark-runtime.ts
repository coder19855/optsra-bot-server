/** Active benchmark replays — used to pause heavy background polls. */
let activeReplays = 0;

export function beginBenchmarkReplay(): void {
  activeReplays += 1;
}

export function endBenchmarkReplay(): void {
  activeReplays = Math.max(0, activeReplays - 1);
}

export function isBenchmarkReplayActive(): boolean {
  return activeReplays > 0;
}