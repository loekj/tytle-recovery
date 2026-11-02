// SPDX-License-Identifier: GPL-3.0-only
//
// Writes abi/SocialRecoveryModule.json from the build. Both copies (14 and 90
// days) have this one ABI: they differ only in an immutable. A test keeps the
// committed file equal to the build.
//
//   node scripts/build-abi.ts

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildModule } from './lib/build.ts';

export const ABI_FILE = fileURLToPath(new URL('../abi/SocialRecoveryModule.json', import.meta.url));

export function abiJson(abi: unknown): string {
  return JSON.stringify(abi, null, 2) + '\n';
}

if (import.meta.main) {
  const build = await buildModule();
  await writeFile(ABI_FILE, abiJson(build.abi));
  console.log(`wrote abi/SocialRecoveryModule.json (${build.abi.length} entries)`);
}
