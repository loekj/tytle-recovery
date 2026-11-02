// SPDX-License-Identifier: GPL-3.0-only
//
// The CREATE2 deploy on a local chain, with the factory's recorded Gnosis code:
// - the address the script prints is the address the deploy lands at;
// - the constructor really runs: our 14-day init code lands at the deployed
//   module's address with its exact code, and our 90-day init code gives code
//   that differs from it only in the recovery period.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { concat, getAddress, getCreate2Address, keccak256, type Hex } from 'viem';
import { RECOVERY_PERIOD_14_DAYS, SAFE_SINGLETON_FACTORY } from '../scripts/lib/addresses.ts';
import { buildModule, initCode, type ModuleBuild } from '../scripts/lib/build.ts';
import { readDeployState, sendDeploy } from '../scripts/lib/deploy.ts';
import { EXIT_MODULE_SALT, EXIT_MODULE_SALT_TEXT, exitModuleDeployment } from '../scripts/lib/exitModule.ts';
import { recorded } from './support/fixtures.ts';
import { startLocalChain, type LocalChain } from './support/localChain.ts';

/**
 * The exit copy's address. Others print it (the code sheet) and name it (a
 * policy) before the deploy, so a change of factory, salt or init code that
 * moves it must fail here first.
 */
const EXIT_MODULE_ADDRESS = '0x3EBf48D76BA83afee8bC4606F3Cff65dBb0BaECf';

describe('the exit copy deploy', () => {
  let chain: LocalChain;
  let build: ModuleBuild;

  before(async () => {
    build = await buildModule();
    chain = await startLocalChain();
    await chain.place('safeSingletonFactory');
  });
  after(() => chain?.close());

  test('the salt is keccak256 of its documented text', () => {
    assert.equal(EXIT_MODULE_SALT_TEXT, 'tytle-recovery/exit-module/v1');
    assert.equal(EXIT_MODULE_SALT, keccak256(new TextEncoder().encode(EXIT_MODULE_SALT_TEXT)));
  });

  test('the predicted address is the pinned one', () => {
    const d = exitModuleDeployment(build);
    assert.equal(d.factory, getAddress(SAFE_SINGLETON_FACTORY));
    assert.equal(d.address, getCreate2Address({ from: d.factory, salt: d.salt, bytecode: d.initCode }));
    assert.equal(d.address, EXIT_MODULE_ADDRESS);
  });

  test('our 14-day init code, through the factory with the salt it used, gives the deployed module exactly', async () => {
    const deployed = recorded('recoveryModule14Days');
    const [from] = chain.accounts;
    assert.ok(from);
    const salt: Hex = `0x${'0'.repeat(64)}`;
    const hash = await chain.walletFor(from).sendTransaction({
      to: SAFE_SINGLETON_FACTORY,
      data: concat([salt, initCode(build, RECOVERY_PERIOD_14_DAYS)]),
      gas: 4_000_000n,
    });
    assert.equal((await chain.client.waitForTransactionReceipt({ hash })).status, 'success');
    assert.equal(await chain.client.getCode({ address: getAddress(deployed.address) }), deployed.code);
  });

  test('sendDeploy lands the exit copy at the predicted address, and its code differs from the 14-day copy only in the period', async () => {
    const d = exitModuleDeployment(build);
    assert.deepEqual(await readDeployState(chain.client, d), { kind: 'not-deployed' });
    const [, from] = chain.accounts;
    assert.ok(from);
    const result = await sendDeploy(chain.client, chain.walletFor(from), d);
    assert.equal(result.from, from);
    assert.deepEqual(await readDeployState(chain.client, d), { kind: 'deployed' });

    const exitCode = await chain.client.getCode({ address: d.address });
    const code14 = await chain.client.getCode({ address: getAddress(recorded('recoveryModule14Days').address) });
    assert.ok(exitCode && code14);
    const a = Buffer.from(code14.slice(2), 'hex');
    const b = Buffer.from(exitCode.slice(2), 'hex');
    assert.equal(a.length, b.length);
    const differing = [...a.keys()].filter((i) => a[i] !== b[i]);
    const [range] = build.periodImmutable;
    assert.ok(range);
    assert.ok(differing.length > 0 && differing.every((i) => i >= range.start && i < range.start + range.length));
  });

  test('the deploy on Gnosis (recorded): our salt and init code, through the factory, and our code byte for byte', () => {
    const d = exitModuleDeployment(build);
    const onGnosis = recorded('exitModule90Days');
    assert.equal(getAddress(onGnosis.address), d.address);
    assert.ok(onGnosis.creation);
    assert.equal(onGnosis.creation.to, d.factory);
    assert.equal(onGnosis.creation.input, concat([d.salt, d.initCode]));
    assert.equal(onGnosis.code, d.runtimeCode);
  });

  test('a second deploy is refused: the address already holds the exit copy', async () => {
    const [, , from] = chain.accounts;
    assert.ok(from);
    await assert.rejects(sendDeploy(chain.client, chain.walletFor(from), exitModuleDeployment(build)), /already holds the exit copy/);
  });
});
