// SPDX-License-Identifier: GPL-3.0-only
//
// Compiles the recovery module with solc 0.8.20 (solc-js from npm, pinned in
// package-lock.json) from the verified standard-JSON input, and gives the bytes
// of a copy for any recovery period.

import { createRequire } from 'node:module';
import { encodeAbiParameters, type Abi, type Hex } from 'viem';
import { readStandardJsonInput, splitTarget } from './solcInput.ts';

interface Solc {
  version(): string;
  compile(input: string): string;
}

interface SolcOutput {
  errors?: Array<{ severity: 'error' | 'warning' | 'info'; formattedMessage: string }>;
  contracts?: Record<
    string,
    Record<
      string,
      {
        abi: Abi;
        metadata: string;
        evm: {
          bytecode: { object: string };
          deployedBytecode: { object: string; immutableReferences: Record<string, Array<{ start: number; length: number }>> };
        };
      }
    >
  >;
}

export interface ModuleBuild {
  solcVersion: string;
  abi: Abi;
  metadata: string;
  /** Creation code without the constructor argument. */
  creationCode: Hex;
  /** Runtime code with every immutable left as solc leaves it (zero bytes). */
  runtimeCodeTemplate: Hex;
  /** Byte ranges of the one immutable, `recoveryPeriod`. */
  periodImmutable: Array<{ start: number; length: number }>;
}

let cached: Promise<ModuleBuild> | undefined;

/** One compile per process: viaIR at 1,000,000 runs is slow in solc-js. */
export function buildModule(): Promise<ModuleBuild> {
  cached ??= compile();
  return cached;
}

async function compile(): Promise<ModuleBuild> {
  const { input, compiler } = await readStandardJsonInput();
  const solc = createRequire(import.meta.url)('solc') as Solc;
  // solc-js reports "<version>.Emscripten.clang"; the part before it must be the verified compiler exactly.
  const solcVersion = solc.version();
  if (!solcVersion.startsWith(`${compiler.compilerVersion}.`)) {
    throw new Error(`solc is ${solcVersion}; the verified build used ${compiler.compilerVersion}`);
  }
  const output = JSON.parse(solc.compile(JSON.stringify(input))) as SolcOutput;
  const errors = (output.errors ?? []).filter((e) => e.severity === 'error');
  if (errors.length > 0) throw new Error(`solc errors:\n${errors.map((e) => e.formattedMessage).join('\n')}`);

  const [source, name] = splitTarget(compiler.compilationTarget);
  const contract = output.contracts?.[source]?.[name];
  if (!contract) throw new Error(`solc gave no ${compiler.compilationTarget}`);

  const immutables = Object.values(contract.evm.deployedBytecode.immutableReferences);
  // The module has exactly one immutable (`uint256 internal immutable recoveryPeriod`). Anything else is a different build.
  if (immutables.length !== 1 || !immutables[0]) throw new Error(`expected 1 immutable, solc gave ${immutables.length}`);
  return {
    solcVersion,
    abi: contract.abi,
    metadata: contract.metadata,
    creationCode: `0x${contract.evm.bytecode.object}`,
    runtimeCodeTemplate: `0x${contract.evm.deployedBytecode.object}`,
    periodImmutable: immutables[0],
  };
}

export function encodePeriod(periodSeconds: bigint): Hex {
  return encodeAbiParameters([{ type: 'uint256' }], [periodSeconds]);
}

/** The init code of a copy: creation code + abi.encode(uint256 period). This is what a deploy sends. */
export function initCode(build: ModuleBuild, periodSeconds: bigint): Hex {
  return `${build.creationCode}${encodePeriod(periodSeconds).slice(2)}`;
}

/**
 * The runtime code a copy has once deployed, by filling the immutable the way
 * the constructor does. The bytecode check compares it with real code: the
 * deployed 14-day copy (fixture) and, on the local chain, our 90-day deploy.
 */
export function runtimeCode(build: ModuleBuild, periodSeconds: bigint): Hex {
  const code = Buffer.from(build.runtimeCodeTemplate.slice(2), 'hex');
  const value = Buffer.from(encodePeriod(periodSeconds).slice(2), 'hex');
  for (const { start, length } of build.periodImmutable) {
    if (length !== 32) throw new Error(`immutable of ${length} bytes, expected 32`);
    if (!code.subarray(start, start + length).equals(Buffer.alloc(32))) throw new Error(`immutable at ${start} is not blank`);
    value.copy(code, start);
  }
  return `0x${code.toString('hex')}`;
}
