// SPDX-License-Identifier: GPL-3.0-only
//
// The bytecode match: our build reproduces the deployed 14-day module
// byte for byte, and the 90-day copy differs only in its recovery period.
// Offline: the chain data comes from fixtures/gnosis/.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, describe, test } from 'node:test';
import { getAddress, getCreate2Address, slice } from 'viem';
import { RECOVERY_PERIOD_14_DAYS, RECOVERY_PERIOD_90_DAYS, SAFE_SINGLETON_FACTORY } from '../scripts/lib/addresses.ts';
import { buildModule, encodePeriod, initCode, runtimeCode, type ModuleBuild } from '../scripts/lib/build.ts';
import { ABI_FILE, abiJson } from '../scripts/build-abi.ts';
import { recorded } from './support/fixtures.ts';

describe('the recovery module build', () => {
  let build: ModuleBuild;
  const deployed = recorded('recoveryModule14Days');

  before(async () => {
    build = await buildModule();
  });

  test('is solc 0.8.20+commit.a1b79de6', () => {
    assert.match(build.solcVersion, /^0\.8\.20\+commit\.a1b79de6\./);
  });

  test('the 14-day init code is the deploy transaction of the deployed module, after its salt', () => {
    const creation = deployed.creation;
    assert.ok(creation?.to, 'the fixture records a factory creation');
    assert.equal(getAddress(creation.to), SAFE_SINGLETON_FACTORY);
    assert.equal(slice(creation.input, 32), initCode(build, RECOVERY_PERIOD_14_DAYS));
    assert.equal(
      getCreate2Address({ from: SAFE_SINGLETON_FACTORY, salt: slice(creation.input, 0, 32), bytecode: initCode(build, RECOVERY_PERIOD_14_DAYS) }),
      getAddress(deployed.address),
    );
  });

  test('the 14-day runtime code is eth_getCode of the deployed module', () => {
    assert.equal(runtimeCode(build, RECOVERY_PERIOD_14_DAYS), deployed.code);
  });

  test('the 90-day runtime differs from the 14-day one only inside the recoveryPeriod immutable', () => {
    const a = Buffer.from(runtimeCode(build, RECOVERY_PERIOD_14_DAYS).slice(2), 'hex');
    const b = Buffer.from(runtimeCode(build, RECOVERY_PERIOD_90_DAYS).slice(2), 'hex');
    assert.equal(a.length, b.length);
    const [range] = build.periodImmutable;
    assert.ok(range && build.periodImmutable.length === 1);
    // Outside the immutable: equal. Inside: exactly abi.encode(7776000).
    assert.ok(a.subarray(0, range.start).equals(b.subarray(0, range.start)));
    assert.ok(a.subarray(range.start + range.length).equals(b.subarray(range.start + range.length)));
    assert.equal(`0x${b.subarray(range.start, range.start + range.length).toString('hex')}`, encodePeriod(RECOVERY_PERIOD_90_DAYS));
    assert.equal(encodePeriod(RECOVERY_PERIOD_90_DAYS), `0x${'0'.repeat(58)}76a700`);
  });

  test('abi/SocialRecoveryModule.json is the build ABI', async () => {
    assert.equal(await readFile(ABI_FILE, 'utf8'), abiJson(build.abi));
  });
});
