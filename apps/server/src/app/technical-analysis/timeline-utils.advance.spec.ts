import { advanceCandleEndIndex } from './timeline-utils';

describe('advanceCandleEndIndex', () => {
  const candles = [
    [100, 1, 1, 1, 1, 1],
    [200, 1, 1, 1, 1, 1],
    [300, 1, 1, 1, 1, 1],
    [400, 1, 1, 1, 1, 1],
  ] as Array<[number, number, number, number, number, number]>;

  it('walks forward without revisiting earlier candles', () => {
    let end = -1;
    end = advanceCandleEndIndex(candles, end, 100);
    expect(end).toBe(0);
    end = advanceCandleEndIndex(candles, end, 250);
    expect(end).toBe(1);
    end = advanceCandleEndIndex(candles, end, 400);
    expect(end).toBe(3);
  });
});