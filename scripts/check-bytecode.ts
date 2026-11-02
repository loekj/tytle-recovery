// SPDX-License-Identifier: GPL-3.0-only
//
// The bytecode match, as a report a person can read: our build of the 14-day copy equals the
// deployed one byte for byte, and the 90-day copy differs only in its wait.
//
//   node scripts/check-bytecode.ts
//
// Offline: it compares with the chain data recorded in fixtures/gnosis/. To
// compare with the live chain instead, run scripts/record-fixtures.ts first.

import { getAddress, getCreate2Address, keccak256, slice, type Hex } from 'viem';
import { RECOVERY_PERIOD_14_DAYS, RECOVERY_PERIOD_90_DAYS } from './lib/addresses.ts';
import { buildModule, initCode, runtimeCode } from './lib/build.ts';
import { recorded } from '../test/support/fixtures.ts';

const started = Date.now();
const build = await buildModule();
console.log(`compiled with solc ${build.solcVersion} in ${((Date.now() - started) / 1000).toFixed(0)} s`);

const deployed = recorded('recoveryModule14Days');
const creation = deployed.creation;
if (!creation?.to) throw new Error('the fixture has no factory creation for the 14-day module');

let failures = 0;
function report(ok: boolean, what: string): void {
  console.log(`${ok ? 'MATCH ' : 'DIFFER'}  ${what}`);
  if (!ok) failures++;
}

// 1. Creation: the deploy transaction's input is salt ++ init code; the init code is our creation code + 14 days.
const salt = slice(creation.input, 0, 32);
const ourInit14 = initCode(build, RECOVERY_PERIOD_14_DAYS);
report(slice(creation.input, 32) === ourInit14, `init code (creation code + 0x127500) = the deploy transaction's input after its salt (${(ourInit14.length - 2) / 2} bytes)`);
report(
  getCreate2Address({ from: getAddress(creation.to), salt, bytecode: ourInit14 }) === getAddress(deployed.address),
  `CREATE2(factory ${creation.to}, salt ${salt}, our init code) = ${deployed.address}`,
);

// 2. Runtime: our runtime with 14 days in the immutable = eth_getCode of the deployed module.
const ourRuntime14 = runtimeCode(build, RECOVERY_PERIOD_14_DAYS);
report(ourRuntime14 === deployed.code, `runtime code = eth_getCode(${deployed.address}) (${deployed.codeBytes} bytes, keccak256 ${keccak256(ourRuntime14)})`);

// 3. The 90-day copy: which bytes differ from the 14-day copy.
const ourRuntime90 = runtimeCode(build, RECOVERY_PERIOD_90_DAYS);
const a = Buffer.from(ourRuntime14.slice(2), 'hex');
const b = Buffer.from(ourRuntime90.slice(2), 'hex');
const differing: number[] = [];
for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differing.push(i);
const ranges = build.periodImmutable.map(({ start, length }) => `${start}..${start + length - 1}`).join(', ');
console.log(`\n90-day runtime vs 14-day runtime: same length ${a.length === b.length}, ${differing.length} byte(s) differ:`);
for (const i of differing) console.log(`  byte ${i}: 0x${a[i]?.toString(16).padStart(2, '0')} -> 0x${b[i]?.toString(16).padStart(2, '0')}`);
const inImmutable = differing.every((i) => build.periodImmutable.some(({ start, length }) => i >= start && i < start + length));
report(a.length === b.length && differing.length > 0 && inImmutable, `every differing byte lies in the recoveryPeriod immutable (bytes ${ranges})`);

const init90 = initCode(build, RECOVERY_PERIOD_90_DAYS);
const init90diff = init90.length === ourInit14.length && init90.slice(0, -64) === ourInit14.slice(0, -64);
report(init90diff, 'the 90-day init code differs from the 14-day one only in its last 32 bytes (the constructor argument)');
console.log(`\n90-day init code: ${(init90.length - 2) / 2} bytes, keccak256 ${keccak256(init90 as Hex)}`);

console.log(failures === 0 ? '\nAll checks match.' : `\n${failures} check(s) differ. Stop: the build does not reproduce the deployed module.`);
process.exit(failures === 0 ? 0 : 1);
