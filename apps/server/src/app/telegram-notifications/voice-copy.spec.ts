import {
  signalHeadline,
  translateExitReason,
  tpHoldHeadline,
  voiceDisplayName,
} from './voice-copy';
import { parseTelegramVoiceArg } from './voice-preference';

describe('parseTelegramVoiceArg', () => {
  it('maps aliases to canonical voices', () => {
    expect(parseTelegramVoiceArg('english')).toBe('trader');
    expect(parseTelegramVoiceArg('hindi')).toBe('simple');
    expect(parseTelegramVoiceArg('topori')).toBe('tapori');
    expect(parseTelegramVoiceArg('marathi-english')).toBe('marathi');
  });
});

describe('signalHeadline', () => {
  it('uses tapori copy for PE entry', () => {
    expect(
      signalHeadline({
        voice: 'tapori',
        action: 'PE-BUY',
        flipped: false,
      }),
    ).toContain('PUT pakad');
  });

  it('uses marathi copy for CE entry', () => {
    expect(
      signalHeadline({
        voice: 'marathi',
        action: 'CE-BUY',
        flipped: false,
      }),
    ).toContain('CALL ghe');
  });

  it('uses hindi simple copy for no-trade', () => {
    expect(
      signalHeadline({
        voice: 'simple',
        action: 'NO-TRADE',
        flipped: false,
      }),
    ).toContain('Trade mat lo');
  });
});

describe('translateExitReason', () => {
  it('localizes stop breach for tapori', () => {
    expect(
      translateExitReason('Index stop breached (spot 25,120)', 'tapori'),
    ).toContain('index SL toot gaya');
  });

  it('keeps trader text unchanged', () => {
    const reason = 'Opposite CE-BUY confirmed — exit PE-BUY';
    expect(translateExitReason(reason, 'trader')).toBe(reason);
  });
});

describe('tpHoldHeadline', () => {
  it('localizes edge-fade hold wording in simple voice', () => {
    expect(
      signalHeadline({
        voice: 'simple',
        action: 'CE-BUY',
        flipped: false,
        alertTone: 'caution',
        kinds: ['EDGE_FADE'],
      }),
    ).toContain('stop na lage tab tak hold');
  });
  it('localizes 1:2.5 trail advice in marathi voice', () => {
    const line = tpHoldHeadline({
      voice: 'marathi',
      original:
        '1:2.5 locked — trail toward 1:4; floor protects at 1:2.5 on reversal.',
      holdAdvice: 'trail',
      alertKind: 'HOLD_REVIEW',
      highestHitRr: '1:2.5',
    });
    expect(line).toContain('1:2.5');
    expect(line).toContain('1:4');
  });
});

describe('voiceDisplayName', () => {
  it('labels marathi voice clearly', () => {
    expect(voiceDisplayName('marathi')).toBe('Marathi-English');
  });
});