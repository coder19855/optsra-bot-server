import {
  loadVetoPreference,
  parseVetoModeQuery,
  saveVetoPreference,
} from './veto-preference';
import { parseVetoOffQuery } from '../types/veto-mode';

describe('veto-preference', () => {
  it('parses veto mode query flags', () => {
    expect(parseVetoModeQuery('strict')).toBe('strict');
    expect(parseVetoModeQuery('relaxed')).toBe('relaxed');
    expect(parseVetoModeQuery('off')).toBe('off');
    expect(parseVetoModeQuery(undefined, 'true')).toBe('off');
    expect(parseVetoModeQuery(undefined, undefined)).toBe('strict');
  });

  it('parses legacy vetoOff query flags', () => {
    expect(parseVetoOffQuery('true')).toBe(true);
    expect(parseVetoOffQuery('1')).toBe(true);
    expect(parseVetoOffQuery('false')).toBe(false);
    expect(parseVetoOffQuery(undefined)).toBe(false);
  });

  it('round-trips veto preference in memory when mongo is absent', async () => {
    const fastify = { mongo: undefined } as never;
    const saved = await saveVetoPreference(fastify, { vetoMode: 'strict' }, 'relaxed');
    expect(saved.vetoMode).toBe('relaxed');
    const loaded = await loadVetoPreference(fastify, { vetoMode: 'strict' });
    expect(loaded.vetoMode).toBe('strict');
  });
});