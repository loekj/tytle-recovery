// SPDX-License-Identifier: GPL-3.0-only
//
// Builds the solc standard-JSON input from contracts/: the verified sources,
// keyed by their verified source names, and the verified settings. The source
// names and settings go into the metadata hash, which is part of the bytecode,
// so nothing here may rename, add or drop anything.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak256, toBytes } from 'viem';

export const CONTRACTS_DIR = fileURLToPath(new URL('../../contracts/', import.meta.url));
export const COMPILER_FILE = path.join(CONTRACTS_DIR, 'compiler.json');

export interface CompilerFile {
  _provenance: Record<string, unknown>;
  compilerVersion: string;
  language: string;
  /** "<source name>:<contract name>" */
  compilationTarget: string;
  settings: {
    viaIR: boolean;
    metadata: { bytecodeHash: string; useLiteralContent: boolean };
    libraries: Record<string, unknown>;
    optimizer: { runs: number; enabled: boolean };
    evmVersion: string;
    remappings: string[];
  };
  /** Every source of the verified input, with the keccak256 the verified metadata gives it. */
  sources: Record<string, { keccak256: string; license: string | null }>;
}

export interface StandardJsonInput {
  language: string;
  sources: Record<string, { content: string }>;
  settings: CompilerFile['settings'] & { outputSelection: Record<string, Record<string, string[]>> };
}

export async function readCompilerFile(): Promise<CompilerFile> {
  return JSON.parse(await readFile(COMPILER_FILE, 'utf8')) as CompilerFile;
}

/**
 * The standard-JSON input. Each source file must hash to the keccak256 that the
 * verified metadata names, so a changed file stops here, before the compiler.
 */
export async function readStandardJsonInput(): Promise<{ input: StandardJsonInput; compiler: CompilerFile }> {
  const compiler = await readCompilerFile();
  const sources: StandardJsonInput['sources'] = {};
  for (const [name, { keccak256: want }] of Object.entries(compiler.sources)) {
    const content = await readFile(path.join(CONTRACTS_DIR, name), 'utf8');
    const have = keccak256(toBytes(content));
    if (have !== want) throw new Error(`contracts/${name}: keccak256 ${have}, the verified source has ${want}`);
    sources[name] = { content };
  }
  const [targetSource, targetName] = splitTarget(compiler.compilationTarget);
  // outputSelection is not part of the metadata, so it cannot change the bytes.
  const outputSelection = {
    [targetSource]: {
      [targetName]: ['abi', 'metadata', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences'],
    },
  };
  return { input: { language: compiler.language, sources, settings: { ...compiler.settings, outputSelection } }, compiler };
}

export function splitTarget(target: string): [source: string, contract: string] {
  const at = target.lastIndexOf(':');
  if (at < 1) throw new Error(`bad compilation target ${target}`);
  return [target.slice(0, at), target.slice(at + 1)];
}
