// SPDX-License-Identifier: GPL-3.0-only
//
// The ABI entries the page calls, picked by name from the verified ABIs in
// abi/ (Sourcify, or our own build for the exit copy). Nothing here is written
// by hand: a missing or doubled entry stops the page at load.

import type { Abi, AbiEvent, AbiFunction } from 'viem';
import eureAbi from '../../abi/EURe.json' with { type: 'json' };
import safeAbi from '../../abi/SafeL2.json' with { type: 'json' };
import moduleAbi from '../../abi/SocialRecoveryModule.json' with { type: 'json' };

function pick(from: unknown, names: readonly string[]): Abi {
  const entries = from as (AbiFunction | AbiEvent | { type: string; name?: string })[];
  return names.map((name) => {
    const found = entries.filter((e) => (e.type === 'function' || e.type === 'event') && e.name === name);
    if (found.length !== 1) throw new Error(`ABI: expected one entry named ${name}, found ${found.length}`);
    return found[0] as AbiFunction | AbiEvent;
  });
}

export const MODULE_ABI = pick(moduleAbi, [
  'isGuardian',
  'threshold',
  'nonce',
  'getRecoveryRequest',
  'confirmRecovery',
  'finalizeRecovery',
  'GuardianAdded',
  'RecoveryExecuted',
  'RecoveryCanceled',
  'RecoveryFinalized',
]);

export const SAFE_ABI = pick(safeAbi, [
  'VERSION',
  'nonce',
  'getOwners',
  'getThreshold',
  'isModuleEnabled',
  'getStorageAt',
  'getTransactionHash',
  'execTransaction',
  'execTransactionFromModule',
  'swapOwner',
  'ExecutionSuccess',
  'ExecutionFailure',
]);

export const EURE_ABI = pick(eureAbi, ['balanceOf', 'transfer', 'Transfer']);

/** Safe 1.4.1's guard slot (GuardManager.sol, GUARD_STORAGE_SLOT, in the verified source). */
export const SAFE_GUARD_STORAGE_SLOT = 0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8n;
