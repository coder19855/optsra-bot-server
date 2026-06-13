import {
  formatAlertStatusMessage,
  parseAlertCommandArgs,
} from './alert-command';

describe('parseAlertCommandArgs', () => {
  it('defaults to status', () => {
    expect(parseAlertCommandArgs('/alert')).toEqual({ action: 'status' });
    expect(parseAlertCommandArgs('/alert status')).toEqual({ action: 'status' });
  });

  it('parses full and compact aliases', () => {
    expect(parseAlertCommandArgs('/alert full')).toEqual({ action: 'full' });
    expect(parseAlertCommandArgs('/alert verbose')).toEqual({ action: 'full' });
    expect(parseAlertCommandArgs('/alert compact')).toEqual({ action: 'compact' });
    expect(parseAlertCommandArgs('/alert short')).toEqual({ action: 'compact' });
  });
});

describe('formatAlertStatusMessage', () => {
  it('describes compact mode', () => {
    const message = formatAlertStatusMessage('compact');
    expect(message).toContain('Compact');
    expect(message).toContain('/alert full');
  });
});