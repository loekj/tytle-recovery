// SPDX-License-Identifier: GPL-3.0-only
//
// The exit copy: the 90-day recovery module, deployed through Safe's singleton
// factory with a fixed, public salt. Everything here is a pure function of this
// repository, so anybody can compute the same address.

import { concat, getAddress, getCreate2Address, keccak256, toBytes, type Address, type Hex } from 'viem';
import { RECOVERY_PERIOD_90_DAYS, SAFE_SINGLETON_FACTORY } from './addresses.ts';
import { initCode, runtimeCode, type ModuleBuild } from './build.ts';

/** The salt is keccak256 of this text. */
export const EXIT_MODULE_SALT_TEXT = 'tytle-recovery/exit-module/v1';
export const EXIT_MODULE_SALT: Hex = keccak256(toBytes(EXIT_MODULE_SALT_TEXT));

/**
 * keccak256 of the factory's 69-byte runtime code (recorded from Gnosis in
 * fixtures/gnosis/). A node that shows other code at the factory's address is
 * not Gnosis, or not telling the truth; the deploy stops.
 */
export const FACTORY_CODE_KECCAK256: Hex = '0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989';

export interface ExitModuleDeployment {
  factory: Address;
  salt: Hex;
  saltText: string;
  recoveryPeriodSeconds: bigint;
  initCode: Hex;
  initCodeHash: Hex;
  /** The call data for the factory: salt ++ init code. */
  factoryCallData: Hex;
  address: Address;
  /** The code the address holds once deployed. */
  runtimeCode: Hex;
}

export function exitModuleDeployment(build: ModuleBuild): ExitModuleDeployment {
  const code = initCode(build, RECOVERY_PERIOD_90_DAYS);
  const factory = getAddress(SAFE_SINGLETON_FACTORY);
  return {
    factory,
    salt: EXIT_MODULE_SALT,
    saltText: EXIT_MODULE_SALT_TEXT,
    recoveryPeriodSeconds: RECOVERY_PERIOD_90_DAYS,
    initCode: code,
    initCodeHash: keccak256(code),
    factoryCallData: concat([EXIT_MODULE_SALT, code]),
    address: getCreate2Address({ from: factory, salt: EXIT_MODULE_SALT, bytecode: code }),
    runtimeCode: runtimeCode(build, RECOVERY_PERIOD_90_DAYS),
  };
}
