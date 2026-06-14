import { AIAnalysisResponse } from '../types/ai-agent';
import { BenchmarkTradeRow } from './types';

export function buildEngineVerdict(row: {
  action: string;
  conviction: number;
  hitLevel: string;
  exitStatus: string;
  pnlR: number;
  optionSource: string;
}): string {
  const parts: string[] = [];
  parts.push(`${row.action} @ ${row.conviction}% conviction`);

  if (row.exitStatus === 'STOP_LOSS') {
    parts.push('Stop loss hit — structure failed to follow through.');
  } else if (row.hitLevel === '1:2.5') {
    parts.push('Locked 1:2.5 on reversal after extension — disciplined trail exit.');
  } else if (row.hitLevel === '1:1.5') {
    parts.push('Locked 1:1.5 on reversal — partial move captured.');
  } else if (row.hitLevel === '1:4') {
    parts.push('Extended past 1:4 — held until flip, floor, or session end.');
  } else if (row.hitLevel === '1:3') {
    parts.push('Full 1:3 target reached — strong trend follow-through.');
  } else if (row.hitLevel === '1:2') {
    parts.push('Locked 1:2 on reversal after extension — disciplined trail exit.');
  } else if (row.hitLevel === '1:1') {
    parts.push('Locked 1:1 on reversal — partial move captured.');
  } else if (row.hitLevel === 'TRAIL_FLOOR') {
    parts.push(
      `Dynamic trail floor at ${row.pnlR}R — ratchet protected extension from peak.`,
    );
  } else if (row.hitLevel === 'SIGNAL_FLIP') {
    parts.push(
      'Exited on strong engine flip while in profit — protected open gains.',
    );
  } else if (row.exitStatus === 'SESSION_END') {
    parts.push('Held to session close without SL/TP — time stop.');
  }

  if (row.pnlR >= 1.5) parts.push('Spot move exceeded 1.5R.');
  else if (row.pnlR <= -0.9) parts.push('Full risk unit lost on spot.');

  if (row.optionSource === 'neutral_fallback') {
    parts.push('Option flow neutral (no snapshot) — PA-weighted read.');
  }

  return parts.join(' ');
}

export function buildAiVerdictSummary(
  ai: AIAnalysisResponse | undefined,
  row: BenchmarkTradeRow,
): string | undefined {
  if (!ai) return undefined;
  const win = row.pnlR > 0;
  const aligned =
    (ai.verdict === 'AGREE' && win) || (ai.verdict === 'DISAGREE' && !win);
  const prefix = aligned ? 'AI aligned with outcome' : 'AI misread outcome';
  return `${prefix}: ${ai.verdict} — ${ai.betaNote}`;
}