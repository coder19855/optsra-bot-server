export type { EnginePollRead as BenchmarkAnchorRead } from '../technical-analysis/flip-exit-policy';
export {
  buildFlipExitSignals,
  findFirstConfirmedFlipExit,
  isStrongOppositeSignal,
} from '../technical-analysis/flip-exit-policy';