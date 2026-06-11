import { parseVetoCommandArgs } from './veto-command';

describe('veto-command', () => {
  it('parses veto strict/relaxed/off/status', () => {
    expect(parseVetoCommandArgs('/veto')).toEqual({ action: 'status' });
    expect(parseVetoCommandArgs('/veto off')).toEqual({ action: 'off' });
    expect(parseVetoCommandArgs('/veto on')).toEqual({ action: 'strict' });
    expect(parseVetoCommandArgs('/veto strict')).toEqual({ action: 'strict' });
    expect(parseVetoCommandArgs('/veto relaxed')).toEqual({ action: 'relaxed' });
    expect(parseVetoCommandArgs('/veto disable')).toEqual({ action: 'off' });
  });
});