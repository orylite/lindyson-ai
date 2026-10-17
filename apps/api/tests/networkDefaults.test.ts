import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS,
  configureOutboundNetworkDefaults,
} from '../src/config/networkDefaults.js';

describe('configureOutboundNetworkDefaults', () => {
  const original = net.getDefaultAutoSelectFamilyAttemptTimeout();
  afterEach(() => net.setDefaultAutoSelectFamilyAttemptTimeout(original));

  it('放宽双栈自动选择的单次尝试超时，同时保留自动选择', () => {
    configureOutboundNetworkDefaults();
    expect(net.getDefaultAutoSelectFamilyAttemptTimeout()).toBe(AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS);
    expect(AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS).toBeGreaterThan(250);
  });
});
