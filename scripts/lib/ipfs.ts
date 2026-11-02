// SPDX-License-Identifier: GPL-3.0-only
//
// The exit page on IPFS: upload its one file, index.html, through Pinata's
// upload endpoint, and prove that IPFS holds exactly that file. The page holds
// everything it needs, its licences too, so one file is the whole copy.
//
// The proof has two parts. First, this script computes the file's IPFS address
// (its CID) from the built bytes itself, the same way Pinata does, and Pinata's
// answer must be that address: an IPFS address is a hash of the content. Then it
// reads each block of the file back from the endpoint that Pinata announces to
// the IPFS network, and compares it byte for byte. Pinata's public gateway
// (gateway.pinata.cloud) is not used: it refuses to serve HTML files ("ERR_ID
// 00023", checked 2 November 2026).
//
// Only Node's own modules are used here (and Node's own fetch): the pinning
// token never reaches a package from npm.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** Pinata's upload endpoint (API v3). Its key needs only the permission Files: Write. */
export const PINATA_UPLOAD = 'https://uploads.pinata.cloud/v3/files';

/**
 * The HTTP endpoint that Pinata announces to the IPFS network for its files (a "trustless gateway": it serves
 * raw blocks, which the reader checks against their CIDs). Read from the network's routing on 2 November 2026.
 */
export const PINATA_BLOCKS = 'https://gateway-v3.pinata.cloud';

/** The public IPFS routing service. inbrowser.link, the in-browser IPFS gateway, asks it where a file is. */
export const IPFS_ROUTING = 'https://delegated-ipfs.dev';

/** A CIDv1, base32, sha2-256: raw (bafk, a file of one block) or dag-pb (bafy, a file of several blocks). */
export const FILE_CID = /^baf[ky][a-z2-7]{55}$/u;

const sha256 = (b: Uint8Array) => new Uint8Array(createHash('sha256').update(b).digest());
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

// ---- The IPFS address of a file ----
//
// The layout of Kubo's and Pinata's default for one file: pieces of 256 KiB, each a raw block (codec 0x55); for
// more than one piece, one dag-pb block (codec 0x70) that lists them as a UnixFS file. CIDv1, sha2-256. A test
// checks it against the root block that Pinata made for this page.

/** The size of one piece. */
export const PIECE_BYTES = 262_144;
/** The most pieces one dag-pb block lists (Kubo's balanced layout). A larger file needs a tree; the page never does. */
const MAX_LINKS = 174;

const RAW = 0x55;
const DAG_PB = 0x70;

function varint(n: number): Uint8Array {
  const out: number[] = [];
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return Uint8Array.from(out);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

/** A protobuf field of wire type 2 (bytes). */
const bytesField = (tag: number, b: Uint8Array) => concat(Uint8Array.of(tag), varint(b.length), b);
/** A protobuf field of wire type 0 (varint). */
const numberField = (tag: number, n: number) => concat(Uint8Array.of(tag), varint(n));

/** The binary CIDv1 of a block. */
export function cidBytes(codec: number, digest: Uint8Array): Uint8Array {
  return concat(Uint8Array.of(0x01), varint(codec), Uint8Array.of(0x12, 0x20), digest);
}

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** RFC 4648 base32, lower case, no padding. */
export function base32(b: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of b) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** A CID as text: "b" (the multibase prefix of base32), then the binary CID in base32. */
export const cidText = (cid: Uint8Array) => `b${base32(cid)}`;

/**
 * The dag-pb block that lists a file's pieces: PBNode { Links (field 2): PBLink { Hash (1), Name (2) = "",
 * Tsize (3) }..., Data (field 1): UnixFS { Type (1) = File (2), filesize (3), blocksizes (4)... } }.
 */
export function fileRootBlock(pieces: readonly { digest: Uint8Array; size: number }[]): Uint8Array {
  const links = pieces.map((p) =>
    bytesField(0x12, concat(bytesField(0x0a, cidBytes(RAW, p.digest)), bytesField(0x12, new Uint8Array()), numberField(0x18, p.size))),
  );
  const filesize = pieces.reduce((s, p) => s + p.size, 0);
  const unixfs = concat(numberField(0x08, 2), numberField(0x18, filesize), ...pieces.map((p) => numberField(0x20, p.size)));
  return concat(...links, bytesField(0x0a, unixfs));
}

export type Block = { cid: string; bytes: Uint8Array };

/** The file's blocks, root first, and so its CID: the root's CID. */
export function fileBlocks(bytes: Uint8Array): Block[] {
  const pieces: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += PIECE_BYTES) pieces.push(bytes.subarray(i, i + PIECE_BYTES));
  const leaves = pieces.map((p) => ({ digest: sha256(p), size: p.length, bytes: p }));
  if (leaves.length === 1) return [{ cid: cidText(cidBytes(RAW, leaves[0]!.digest)), bytes: leaves[0]!.bytes }];
  if (leaves.length > MAX_LINKS) throw new Error(`a file of ${leaves.length} pieces needs a tree of blocks; this script makes one level`);
  const root = fileRootBlock(leaves);
  return [{ cid: cidText(cidBytes(DAG_PB, sha256(root))), bytes: root }, ...leaves.map((l) => ({ cid: cidText(cidBytes(RAW, l.digest)), bytes: l.bytes }))];
}

// ---- The page ----

export type PageFile = { bytes: Uint8Array<ArrayBuffer>; sha256: string; cid: string; blocks: Block[] };

/** The built page, with its sha256 and its IPFS address (computed here). */
export function readPage(path: string): PageFile {
  const bytes = new Uint8Array(readFileSync(path));
  if (!Buffer.from(bytes.subarray(0, 15)).toString('latin1').toLowerCase().startsWith('<!doctype html>')) {
    throw new Error(`${path} is not the built page: build it first`);
  }
  const blocks = fileBlocks(bytes);
  return { bytes, sha256: hex(sha256(bytes)), cid: blocks[0]!.cid, blocks };
}

// ---- The upload ----

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

/**
 * Uploads the page to public IPFS. Pinata's CID must be the one computed here from the same bytes: anything else
 * means Pinata holds other bytes. The same bytes always give the same CID, so a new upload is safe.
 */
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
    if (cid !== page.cid) throw new Error(`Pinata's address ${cid} is not the page's address ${page.cid}: Pinata holds other bytes`);
    return cid;
  }
  throw last;
}

// ---- The read-back ----

export type Patience = {
  patienceMs?: number;
  retryMs?: number;
  timeoutMs?: number;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
};

/** The endpoint refused to serve (it will not change its mind): no waiting. */
const REFUSALS = new Set([401, 403, 451]);

/**
 * Reads each block of the page back from a trustless gateway, as raw bytes, and compares it with the block made
 * here. Throws at once on other bytes or a refusal; waits a while for a block that is not there yet.
 */
export async function confirmBlocks(page: PageFile, opts: Patience & { base?: string } = {}): Promise<string> {
  const { base = PINATA_BLOCKS, patienceMs = 5 * 60_000, retryMs = 15_000, timeoutMs = 60_000, now = Date.now, wait = sleep } = opts;
  const until = now() + patienceMs;
  const host = new URL(base).host;
  for (const [i, block] of page.blocks.entries()) {
    for (;;) {
      let note: string;
      try {
        const res = await fetch(`${base}/ipfs/${block.cid}`, { headers: { accept: 'application/vnd.ipld.raw' }, signal: AbortSignal.timeout(timeoutMs) });
        if (res.status === 200) {
          const got = new Uint8Array(await res.arrayBuffer());
          if (same(got, block.bytes)) break;
          throw new Error(`uploaded as ${page.cid}, but ${host} served other bytes for block ${i + 1} (${block.cid})`);
        }
        await res.body?.cancel();
        if (REFUSALS.has(res.status)) throw new Error(`uploaded as ${page.cid}, but ${host} refused to serve block ${i + 1} (HTTP ${res.status})`);
        note = `HTTP ${res.status}`;
      } catch (e) {
        if ((e as Error).message.startsWith('uploaded as')) throw e;
        note = (e as Error).message;
      }
      if (now() + retryMs > until) {
        throw new Error(
          `uploaded as ${page.cid}, but ${host} did not serve block ${i + 1} (${note}). ` +
            'Run the job again: the same bytes give the same address.',
        );
      }
      await wait(retryMs);
    }
  }
  return `${page.blocks.length} of ${page.blocks.length} blocks, byte for byte`;
}

/**
 * Asks the public IPFS routing who provides the page. Only reported, never required: it shows whether a browser
 * that opens the page by its address (inbrowser.link) can find it.
 */
export async function findProviders(cid: string, opts: Patience & { base?: string } = {}): Promise<{ ok: boolean; note: string }> {
  const { base = IPFS_ROUTING, patienceMs = 3 * 60_000, retryMs = 15_000, timeoutMs = 30_000, now = Date.now, wait = sleep } = opts;
  const until = now() + patienceMs;
  for (;;) {
    let note: string;
    try {
      const res = await fetch(`${base}/routing/v1/providers/${cid}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 200) {
        const providers = ((await res.json()) as { Providers?: unknown[] | null }).Providers ?? [];
        if (providers.length > 0) return { ok: true, note: `${providers.length} provider(s) listed` };
        note = 'no provider listed yet';
      } else {
        await res.body?.cancel();
        note = `HTTP ${res.status}`;
      }
    } catch (e) {
      note = (e as Error).message;
    }
    if (now() + retryMs > until) return { ok: false, note };
    await wait(retryMs);
  }
}

/** The job summary: the address, how to open it, and the checks. */
export function summary(page: PageFile, blocks: string, routing: { ok: boolean; note: string }): string {
  return [
    '## The exit page on IPFS',
    '',
    `CID: \`${page.cid}\``,
    '',
    `- In a browser: https://inbrowser.link/ipfs/${page.cid}`,
    `- With an IPFS app or node: \`ipfs://${page.cid}\``,
    `- sha256 of index.html: \`${page.sha256}\``,
    '',
    '| Check | Result |',
    '| --- | --- |',
    "| The CID computed from the built page = Pinata's CID | yes |",
    `| Read back from ${new URL(PINATA_BLOCKS).host} | ${blocks} |`,
    `| Listed by the IPFS routing (${new URL(IPFS_ROUTING).host}) | ${routing.ok ? 'yes' : 'no'}: ${routing.note} |`,
    '',
  ].join('\n');
}
