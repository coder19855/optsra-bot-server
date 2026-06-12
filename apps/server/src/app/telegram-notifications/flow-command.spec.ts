import { parseFlowCommandArgs } from './flow-command';

describe('flow-command', () => {
  it('parses flow blend/pa/status', () => {
    expect(parseFlowCommandArgs('/flow')).toEqual({ action: 'status' });
    expect(parseFlowCommandArgs('/flow pa')).toEqual({ action: 'pa-only' });
    expect(parseFlowCommandArgs('/flow off')).toEqual({ action: 'pa-only' });
    expect(parseFlowCommandArgs('/flow blend')).toEqual({ action: 'blend' });
    expect(parseFlowCommandArgs('/flow on')).toEqual({ action: 'blend' });
  });
});