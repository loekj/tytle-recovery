// SPDX-License-Identifier: GPL-3.0-only
//
// The recorded Gnosis chain data (fixtures/gnosis/contracts.json). Loading a
// fixture checks each code against its recorded keccak256, so an edited fixture
// fails here and not somewhere less clear.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { keccak256, type Hex } from 'viem';

export interface RecordedContract {
  what: string;
  address: string;
  codeKeccak256: Hex;
  codeBytes: number;
  code: Hex;
  creation?: {
    transactionHash: Hex;
    blockNumber: number;
    from: string;
    /** null for a direct creation; the factory's address for a CREATE2 through a factory. */
    to: string | null;
    input: Hex;
    inputKeccak256: Hex;
  };
}

export interface GnosisFixture {
  _provenance: { what: string; recordedAt: string; chainId: number; blockNumber: number; nodes: string[] };
  contracts: Record<string, RecordedContract>;
  /** Addresses that held no code at the block named: the exit copy's address in the block before its deploy. */
  emptyAddresses: { exitModule?: { address: string; blockNumber: number } };
}

const FILE = fileURLToPath(new URL('../../fixtures/gnosis/contracts.json', import.meta.url));

export function loadGnosisFixture(): GnosisFixture {
  const fixture = JSON.parse(readFileSync(FILE, 'utf8')) as GnosisFixture;
  for (const [name, c] of Object.entries(fixture.contracts)) {
    if (keccak256(c.code) !== c.codeKeccak256) throw new Error(`fixture ${name}: code does not hash to its recorded keccak256`);
    if (c.creation && keccak256(c.creation.input) !== c.creation.inputKeccak256) {
      throw new Error(`fixture ${name}: creation input does not hash to its recorded keccak256`);
    }
  }
  return fixture;
}

export function recorded(name: string): RecordedContract {
  const c = loadGnosisFixture().contracts[name];
  if (!c) throw new Error(`no recorded contract ${name}; run node scripts/record-fixtures.ts`);
  return c;
}
