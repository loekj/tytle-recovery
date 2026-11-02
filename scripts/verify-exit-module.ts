// SPDX-License-Identifier: GPL-3.0-only
//
// Puts the exit copy's source code on Sourcify, which compiles it again and
// compares the result with the code on Gnosis, byte for byte (its creation code
// and its code now). Blockscout, the Gnosis explorer, then shows the source as
// verified too; this script reads its answer.
// Sends no transaction and needs no key. Anybody can run it again.
//
//   node scripts/verify-exit-module.ts --tx <the deploy transaction's hash>

import { parseArgs } from 'node:util';
import { EXIT_MODULE, EXPLORER } from '../page/src/config.ts';
import { readStandardJsonInput } from './lib/solcInput.ts';

const SOURCIFY = 'https://sourcify.dev/server';
const BLOCKSCOUT = EXPLORER;

const { values: args } = parseArgs({ options: { tx: { type: 'string' } } });
if (!args.tx || !/^0x[0-9a-fA-F]{64}$/u.test(args.tx)) throw new Error('--tx must be the deploy transaction hash (0x + 64 hex digits)');

type Match = { match: string | null; creationMatch: string | null; runtimeMatch: string | null };

async function sourcifyState(): Promise<Match> {
  const res = await fetch(`${SOURCIFY}/v2/contract/100/${EXIT_MODULE}`, { signal: AbortSignal.timeout(30_000) });
  return (await res.json()) as Match;
}

let state = await sourcifyState();
if (state.match === null) {
  const { input, compiler } = await readStandardJsonInput();
  const res = await fetch(`${SOURCIFY}/v2/verify/100/${EXIT_MODULE}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      stdJsonInput: input,
      compilerVersion: compiler.compilerVersion,
      contractIdentifier: compiler.compilationTarget,
      creationTransactionHash: args.tx,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = (await res.json()) as { verificationId?: string };
  if (!body.verificationId) throw new Error(`Sourcify refused the request (HTTP ${res.status}): ${JSON.stringify(body).slice(0, 500)}`);
  console.log(`Sourcify job ${body.verificationId}`);
  const until = Date.now() + 10 * 60_000;
  for (;;) {
    await new Promise((r) => setTimeout(r, 5_000));
    const job = (await (await fetch(`${SOURCIFY}/v2/verify/${body.verificationId}`, { signal: AbortSignal.timeout(30_000) })).json()) as {
      isJobCompleted?: boolean;
      error?: unknown;
    };
    if (job.isJobCompleted) {
      if (job.error) throw new Error(`Sourcify could not verify: ${JSON.stringify(job.error).slice(0, 800)}`);
      break;
    }
    if (Date.now() > until) throw new Error('Sourcify did not finish in 10 minutes; run this again');
  }
  state = await sourcifyState();
}
console.log(`Sourcify: match ${state.match}, creation code ${state.creationMatch}, code now ${state.runtimeMatch}`);
console.log(`  ${SOURCIFY.replace('/server', '')}/#/lookup/${EXIT_MODULE}`);
if (state.creationMatch !== 'exact_match' || state.runtimeMatch !== 'exact_match') {
  throw new Error('not an exact match of both the creation code and the code now');
}

const bs = (await (await fetch(`${BLOCKSCOUT}/api/v2/smart-contracts/${EXIT_MODULE}`, { signal: AbortSignal.timeout(30_000) })).json()) as {
  is_verified?: boolean;
  is_verified_via_sourcify?: boolean;
  is_fully_verified?: boolean;
  name?: string;
};
console.log(`Blockscout: verified ${bs.is_verified ?? false}${bs.is_verified_via_sourcify ? ' (from Sourcify)' : ''}, name ${bs.name ?? '-'}`);
console.log(`  ${BLOCKSCOUT}/address/${EXIT_MODULE}?tab=contract`);
