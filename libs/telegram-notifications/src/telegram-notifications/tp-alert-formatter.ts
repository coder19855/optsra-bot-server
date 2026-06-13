import {
  PositionTpEvaluation,
  TpAlertKind,
} from '../types/telegram-notifications';
import { DEFAULT_TELEGRAM_VOICE, TelegramVoice } from '../types/telegram-voice';
import { joinTelegramLines, joinTelegramSections } from './message-layout';
import {
  tpCoachTitle,
  tpEngineLine,
  tpHoldHeadline,
  tpKindHeadline,
  translateTpHoldReason,
} from './voice-copy';
import {
  formatScenarioBanner,
  scenarioForHoldAdvice,
  scenarioForPnl,
  scenarioForTpKinds,
  wrapScenarioCallout,
} from './telegram-palette';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatRrSummary(evaluation: PositionTpEvaluation): string {
  const parts = [
    `${evaluation.currentR.toFixed(2)}R`,
    `spot ${evaluation.spot.toLocaleString('en-IN')}`,
    `entry ${evaluation.tradeSetup.entry.toLocaleString('en-IN')}`,
    `SL ${evaluation.tradeSetup.stopLoss.toLocaleString('en-IN')}`,
  ];

  if (evaluation.highestHitTp) {
    parts.push(`banked ${evaluation.highestHitTp.rr}`);
  }

  if (evaluation.nextTp) {
    const dist =
      evaluation.distanceToNextPoints != null
        ? `${evaluation.distanceToNextPoints.toFixed(0)}pts`
        : '';
    parts.push(`next ${evaluation.nextTp.rr} ${dist}`.trim());
  }

  return parts.join(' · ');
}

export function formatTelegramTpAlertMessage(params: {
  evaluation: PositionTpEvaluation;
  kinds: TpAlertKind[];
  voice?: TelegramVoice;
}): string {
  const { evaluation, kinds, voice = DEFAULT_TELEGRAM_VOICE } = params;
  const { position } = evaluation;
  const pnlSign = position.unrealizedPnl >= 0 ? '+' : '';
  const tpScenario = scenarioForTpKinds(kinds);
  const holdScenario = scenarioForHoldAdvice(evaluation.holdAdvice);
  const pnlScenario = scenarioForPnl(position.unrealizedPnl);

  const reasons = evaluation.holdReasons
    .slice(0, 2)
    .map((line) => escapeHtml(translateTpHoldReason(line, voice)))
    .join('\n');

  const localizedHold = tpHoldHeadline({
    voice,
    original: evaluation.holdHeadline,
    holdAdvice: evaluation.holdAdvice,
    alertKind: evaluation.alertKind,
    highestHitRr: evaluation.highestHitTp?.rr ?? null,
    nextTpRr: evaluation.nextTp?.rr ?? null,
  });

  const header = joinTelegramLines(
    formatScenarioBanner(tpScenario, tpKindHeadline(kinds, voice)),
    `<b>${escapeHtml(position.optionLabel)}</b> · ${escapeHtml(position.indexLabel)} · ${evaluation.tradingStyle}`,
  );

  const positionBlock = joinTelegramLines(
    `${pnlScenario === 'success' ? '✅' : pnlScenario === 'danger' ? '🚨' : '⚠️'} P&L ${pnlSign}₹${Math.abs(position.unrealizedPnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })} · ${position.netQty} qty @ ₹${position.buyAvg.toFixed(1)}`,
    tpEngineLine({
      voice,
      signalAction: evaluation.signalAction,
      conviction: evaluation.conviction,
      bias: evaluation.bias,
    }),
  );

  const rrBlock = formatRrSummary(evaluation);

  const coachBlock = wrapScenarioCallout(holdScenario, tpCoachTitle(voice), [
    escapeHtml(localizedHold),
    reasons || null,
  ].filter((line): line is string => line != null));

  // Management Brain enrichment — this is what makes alerts feel like a real co-pilot when holding
  let finalSections = [header, positionBlock, rrBlock, coachBlock];
  const mgmt = evaluation.managementAdvice;
  if (mgmt) {
    if (mgmt.positionHealth) {
      const h = mgmt.positionHealth;
      const trendEmoji = h.trend === 'improving' ? '↑' : h.trend === 'deteriorating' ? '↓' : '';
      finalSections.push(`Position Health: **${h.score}/100 ${h.label}** ${trendEmoji}`);
    }
    if (mgmt.recommendedActions?.length) {
      const actionsText = mgmt.recommendedActions
        .map((a: any) => `• ${a.detail}`)
        .join('\n');
      finalSections.push(`🧠 Management:\n${escapeHtml(actionsText)}`);
    }
    if (mgmt.riskAdjustment?.notes?.length) {
      finalSections.push(`Risk note: ${mgmt.riskAdjustment.notes[0]}`);
    }
  }

  return joinTelegramSections(...finalSections);
}