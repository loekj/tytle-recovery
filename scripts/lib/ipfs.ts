// SPDX-License-Identifier: GPL-3.0-only
//
// The exit page on IPFS: upload its one file, index.html, through Pinata's
// upload endpoint, then read it back by its content address (CID) and compare
// it, byte for byte, with the file that was built. The page holds everything
// it needs, its licences too, so one file is the whole copy.
//
// Only Node's own modules are used here (and Node's own fetch): the pinning
// token never reaches a package from npm.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** Pinata's upload endpoint (API v3). Its key needs only the permission Files: Write. */
export const PINATA_UPLOAD = 'https://uploads.pinata.cloud/v3/files';

/** A CIDv1, base32, sha2-256: raw (bafk, a file of one block) or dag-pb (bafy, a file of several blocks). */
export const FILE_CID = /^baf[ky][a-z2-7]{55}$/u;

export type PageFile = { bytes: Uint8Array<ArrayBuffer>; sha256: string };

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The built page, with its sha256. */
export function readPage(path: string): PageFile {
  const bytes = new Uint8Array(readFileSync(path));
  if (!Buffer.from(bytes.subarray(0, 15)).toString('latin1').toLowerCase().startsWith('<!doctype html>')) {
    throw new Error(`${path} is not the built page: build it first`);
  }
  return { bytes, sha256: sha256(bytes) };
}

/** Pinata said no to the token: a wrong token, or a key without Files: Write. */
export class PinRefused extends Error {}

export type PinOptions = {
  jwt: string;
  /** A name for the upload in the Pinata account. It is not part of the content or its address. */
  name: string;
  url?: string;
  attempts?: number;
  timeoutMs?: number;
  wait?: (ms: number) => Promise<void>;
};

/** Uploads the page to public IPFS and returns its CID. The same bytes always give the same CID. */
export async function pinPage(page: PageFile, opts: PinOptions): Promise<string> {
  const { jwt, name, url = PINATA_UPLOAD, attempts = 3, timeoutMs = 120_000, wait = sleep } = opts;
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await wait(5_000 * 2 ** (i - 1));
    const form = new FormData();
    form.append('network', 'public');
    form.append('name', name);
    form.append('file', new Blob([page.bytes], { type: 'text/html' }), 'index.html');
    let res: Response;
    try {
      res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${jwt}` }, body: form, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      last = new Error(`could not reach Pinata: ${(e as Error).message}`);
      continue;
    }
    const body = await res.text();
    if (res.status === 401 || res.status === 403) {
      throw new PinRefused(`Pinata refused the token (HTTP ${res.status}). Check the secret PINATA_JWT, and that its key has Files: Write.`);
    }
    if (res.status === 429 || res.status >= 500) {
      last = new Error(`Pinata answered HTTP ${res.status}`);
      continue;
    }
    if (!res.ok) throw new Error(`Pinata answered HTTP ${res.status}: ${body.slice(0, 300)}`);
    const cid = (JSON.parse(body) as { data?: { cid?: unknown } }).data?.cid;
    if (typeof cid !== 'string' || !FILE_CID.test(cid)) throw new Error(`Pinata gave no CIDv1: ${String(cid).slice(0, 100)}`);
    return cid;
  }
  throw last;
}

export type Gateway = {
  name: string;
  url: (cid: string) => string;
  /** The publish fails when a required gateway does not serve the exact bytes in time. */
  required: boolean;
  patienceMs: number;
};

/**
 * Where the job reads the page back. Pinata's own gateway must serve it. A
 * second, unrelated gateway is asked too, and its answer is reported, never
 * required: public gateways now limit or refuse such reads (ipfs.io and
 * dweb.link stopped serving on 21 September 2026).
 */
export const GATEWAYS: readonly Gateway[] = [
  { name: 'gateway.pinata.cloud', url: (cid) => `https://gateway.pinata.cloud/ipfs/${cid}`, required: true, patienceMs: 10 * 60_000 },
  { name: '4everland.io', url: (cid) => `https://${cid}.ipfs.4everland.io/`, required: false, patienceMs: 3 * 60_000 },
];

export type GatewayResult = { name: string; required: boolean; ok: boolean; note: string };

export type ConfirmOptions = {
  gateways?: readonly Gateway[];
  retryMs?: number;
  timeoutMs?: number;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
};

async function readBack(g: Gateway, cid: string, page: PageFile, o: Required<ConfirmOptions>): Promise<GatewayResult> {
  const until = o.now() + g.patienceMs;
  for (;;) {
    let note: string;
    try {
      const res = await fetch(g.url(cid), { signal: AbortSignal.timeout(o.timeoutMs) });
      if (res.status === 200) {
        const got = sha256(new Uint8Array(await res.arrayBuffer()));
        if (got === page.sha256) return { name: g.name, required: g.required, ok: true, note: 'byte for byte the same' };
        // Other bytes under this CID: never a wait-and-see case.
        return { name: g.name, required: g.required, ok: false, note: `served other bytes (sha256 ${got})` };
      }
      await res.body?.cancel();
      note = `HTTP ${res.status}`;
    } catch (e) {
      note = (e as Error).message;
    }
    if (o.now() + o.retryMs > until) return { name: g.name, required: g.required, ok: false, note };
    await o.wait(o.retryMs);
  }
}

/** Reads the page back from each gateway. Throws when a required gateway did not serve the exact bytes. */
export async function confirmOnGateways(cid: string, page: PageFile, opts: ConfirmOptions = {}): Promise<GatewayResult[]> {
  const o: Required<ConfirmOptions> = { gateways: GATEWAYS, retryMs: 15_000, timeoutMs: 60_000, now: Date.now, wait: sleep, ...opts };
  const results = await Promise.all(o.gateways.map((g) => readBack(g, cid, page, o)));
  const failed = results.filter((r) => r.required && !r.ok);
  if (failed.length > 0) {
    throw new Error(
      `uploaded as ${cid}, but ${failed.map((r) => `${r.name} (${r.note})`).join('; ')}. ` +
        'Run the job again: the same bytes give the same address.',
    );
  }
  return results;
}

/** The job summary: the address, how to open it, and the page's sha256. */
export function summary(cid: string, page: PageFile, results: readonly GatewayResult[]): string {
  return [
    '## The exit page on IPFS',
    '',
    `CID: \`${cid}\``,
    '',
    `- With an IPFS app or node: \`ipfs://${cid}\``,
    `- At Pinata, read back: https://gateway.pinata.cloud/ipfs/${cid}`,
    `- sha256 of index.html: \`${page.sha256}\``,
    '',
    '| Gateway | Read back |',
    '| --- | --- |',
    ...results.map((r) => `| ${r.name}${r.required ? ' (required)' : ''} | ${r.ok ? 'yes' : 'no'}: ${r.note} |`),
    '',
  ].join('\n');
}
