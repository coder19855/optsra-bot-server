import { parseFlowCommandArgs } from './flow-command';

describe('flow-command', () => {
  it('parses flow pa, option, blend, and on', () => {
    expect(parseFlowCommandArgs('/flow')).toEqual({ action: 'status' });
    expect(parseFlowCommandArgs('/flow pa')).toEqual({ action: 'pa-only' });
    expect(parseFlowCommandArgs('/flow option')).toEqual({
      action: 'option-only',
    });
    expect(parseFlowCommandArgs('/flow options')).toEqual({
      action: 'option-only',
    });
    expect(parseFlowCommandArgs('/flow blend')).toEqual({ action: 'blend' });
    expect(parseFlowCommandArgs('/flow on')).toEqual({ action: 'blend' });
  });
});