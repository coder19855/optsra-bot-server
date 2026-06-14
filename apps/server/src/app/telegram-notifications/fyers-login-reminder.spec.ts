import {
  getFyersLoginAlreadyActiveContent,
  getFyersLoginReminderContent,
  resolveFyersLoginUrl,
} from './fyers-login-reminder';

describe('fyers login reminder', () => {
  const prevPublic = process.env.PUBLIC_APP_URL;

  beforeAll(() => {
    process.env.PUBLIC_APP_URL = 'https://bot.example.com';
  });

  afterAll(() => {
    process.env.PUBLIC_APP_URL = prevPublic;
  });

  it('builds force relogin URL when requested', () => {
    expect(resolveFyersLoginUrl(true)).toBe(
      'https://bot.example.com/api/login?forceRedirect=true&forceRelogin=true',
    );
  });

  it('already-active copy does not claim token expired', () => {
    const { text } = getFyersLoginAlreadyActiveContent();
    expect(text).toContain('active');
    expect(text).not.toContain('expired');
  });

  it('reminder copy still prompts login when session missing', () => {
    const { text } = getFyersLoginReminderContent();
    expect(text).toContain('Time to log into Fyers');
  });
});