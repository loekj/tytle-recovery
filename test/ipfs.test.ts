// SPDX-License-Identifier: GPL-3.0-only
//
// The IPFS publish step, against a local stand-in for Pinata and for the
// gateways (no network, no token): what it sends, how it treats a refusal or
// a busy service, and how it reads the page back.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { FILE_CID, PinRefused, confirmOnGateways, pinPage, readPage, type Gateway, type PageFile } from '../scripts/lib/ipfs.ts';

const CID = `bafy${'b'.repeat(55)}`;
const JWT = 'test-token-never-printed';

type Seen = { auth?: string; network: unknown; name: unknown; file?: { name: string; type: string; bytes: Buffer } };
type Out = { status: number; body: Buffer | string };
type Reply = Out | (() => Out);

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of req) parts.push(c as Buffer);
  return Buffer.concat(parts);
}

describe('publishing the page on IPFS', () => {
  let server: Server;
  let base: string;
  let uploadReplies: Reply[] = [];
  let seen: Seen[] = [];
  let gatewayReply: Record<string, Reply> = {};
  let page: PageFile;
  const wait = async () => undefined;

  before(async () => {
    server = createServer(async (req, res) => {
      const url = new URL(req.url!, 'http://x');
      if (url.pathname === '/upload') {
        const body = await readBody(req);
        const form = await new Response(new Uint8Array(body), { headers: { 'content-type': req.headers['content-type']! } }).formData();
        const f = form.get('file') as File | null;
        seen.push({
          auth: req.headers.authorization,
          network: form.get('network'),
          name: form.get('name'),
          file: f ? { name: f.name, type: f.type, bytes: Buffer.from(await f.arrayBuffer()) } : undefined,
        });
        const r = uploadReplies.shift() ?? { status: 200, body: JSON.stringify({ data: { id: 'x', cid: CID, number_of_files: 1 } }) };
        const out = typeof r === 'function' ? r() : r;
        res.writeHead(out.status).end(out.body);
        return;
      }
      const [, gateway, cid] = url.pathname.split('/');
      const r = gatewayReply[gateway!];
      const out = !r || cid !== CID ? { status: 404, body: 'no' } : typeof r === 'function' ? r() : r;
      res.writeHead(out.status).end(out.body);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    const dir = mkdtempSync(join(tmpdir(), 'page-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>x</title>');
    page = readPage(join(dir, 'index.html'));
  });
  after(() => new Promise<void>((r) => server.close(() => r())));
  beforeEach(() => {
    uploadReplies = [];
    seen = [];
    gatewayReply = {};
  });

  const gateway = (name: string, required: boolean, patienceMs = 60_000): Gateway => ({ name, required, patienceMs, url: (cid) => `${base}/${name}/${cid}` });
  const serving = (bytes: Uint8Array): Out => ({ status: 200, body: Buffer.from(bytes) });
  const clock = () => {
    let t = 0;
    return { now: () => t, wait: async (ms: number) => void (t += ms) };
  };
  const upload = () => pinPage(page, { jwt: JWT, name: 'exit-page abc', url: `${base}/upload`, wait });

  test('the page is read with its sha256; a file that is not the built page is refused', () => {
    assert.equal(page.sha256, createHash('sha256').update('<!doctype html><title>x</title>').digest('hex'));
    const dir = mkdtempSync(join(tmpdir(), 'page-'));
    writeFileSync(join(dir, 'licenses.txt'), 'MIT');
    assert.throws(() => readPage(join(dir, 'licenses.txt')), /not the built page/u);
  });

  test('one upload of the one file: public IPFS, as index.html, text/html, the token as a Bearer header', async () => {
    assert.equal(await upload(), CID);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.auth, `Bearer ${JWT}`);
    assert.equal(seen[0]!.network, 'public');
    assert.equal(seen[0]!.name, 'exit-page abc');
    assert.equal(seen[0]!.file?.name, 'index.html');
    assert.equal(seen[0]!.file?.type, 'text/html');
    assert.deepEqual(new Uint8Array(seen[0]!.file!.bytes), page.bytes);
  });

  test('a refused token stops at once, names the secret and the permission, and never shows the token', async () => {
    uploadReplies = [{ status: 403, body: JSON.stringify({ error: 'no scope' }) }];
    await assert.rejects(upload(), (e: unknown) => {
      assert.ok(e instanceof PinRefused);
      assert.match(e.message, /PINATA_JWT/u);
      assert.match(e.message, /Files: Write/u);
      assert.ok(!e.message.includes(JWT));
      return true;
    });
    assert.equal(seen.length, 1, 'no second try with a refused token');
  });

  test('a busy service is tried again; it gives up after the last try', async () => {
    uploadReplies = [{ status: 503, body: '' }, { status: 429, body: '' }];
    assert.equal(await upload(), CID);
    assert.equal(seen.length, 3);
    seen = [];
    uploadReplies = [{ status: 502, body: '' }, { status: 502, body: '' }, { status: 502, body: '' }];
    await assert.rejects(upload(), /HTTP 502/u);
    assert.equal(seen.length, 3);
  });

  test('only a CIDv1 (raw or dag-pb) is taken', async () => {
    assert.ok(FILE_CID.test(CID) && FILE_CID.test(`bafk${'b'.repeat(55)}`));
    for (const bad of ['QmVLwvmGehsrNEvhcCnnsw5RQNseohgEkFNN1848zNzdng', `bafz${'b'.repeat(55)}`, `bafy${'b'.repeat(54)}`, 42, undefined]) {
      uploadReplies = [{ status: 200, body: JSON.stringify({ data: { cid: bad } }) }];
      await assert.rejects(upload(), /no CIDv1/u);
    }
  });

  test('read back: the required gateway serves the exact bytes after a short wait; an optional one that fails is only reported', async () => {
    let misses = 2;
    gatewayReply.pinata = () => (misses-- > 0 ? { status: 504, body: 'later' } : serving(page.bytes));
    gatewayReply.other = { status: 429, body: 'slow down' };
    const results = await confirmOnGateways(CID, page, { gateways: [gateway('pinata', true), gateway('other', false)], ...clock() });
    assert.deepEqual(results.map((r) => [r.name, r.ok]), [['pinata', true], ['other', false]]);
    assert.equal(results[1]!.note, 'HTTP 429');
  });

  test('other bytes under the CID fail the publish at once, with no waiting', async () => {
    gatewayReply.pinata = serving(new Uint8Array(Buffer.from('<!doctype html>changed')));
    const c = clock();
    await assert.rejects(confirmOnGateways(CID, page, { gateways: [gateway('pinata', true)], ...c }), /served other bytes/u);
    assert.equal(c.now(), 0);
  });

  test('a required gateway that never serves the page: the error says the upload is made and a new run is safe', async () => {
    gatewayReply.pinata = { status: 404, body: 'no' };
    await assert.rejects(confirmOnGateways(CID, page, { gateways: [gateway('pinata', true)], ...clock() }), (e: unknown) => {
      assert.match((e as Error).message, new RegExp(`uploaded as ${CID}`, 'u'));
      assert.match((e as Error).message, /Run the job again/u);
      return true;
    });
  });
});
