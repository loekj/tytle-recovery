// SPDX-License-Identifier: GPL-3.0-only
//
// The IPFS publish step. The page's IPFS address, computed here, against the
// root block that Pinata made for the real page. And against a local stand-in
// for Pinata, its block endpoint and the IPFS routing (no network, no token):
// what the upload sends, how it treats a refusal or a busy service, and how it
// reads the page back.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import {
  FILE_CID,
  PIECE_BYTES,
  PinRefused,
  base32,
  cidBytes,
  cidText,
  confirmBlocks,
  fileBlocks,
  fileRootBlock,
  findProviders,
  pinPage,
  readPage,
  type PageFile,
} from '../scripts/lib/ipfs.ts';

const JWT = 'test-token-never-printed';
const sha256 = (b: Uint8Array) => new Uint8Array(createHash('sha256').update(b).digest());
const fromHex = (h: string) => new Uint8Array(Buffer.from(h, 'hex'));

type Seen = { auth?: string; network: unknown; name: unknown; file?: { name: string; type: string; bytes: Buffer } };
type Out = { status: number; body: Buffer | string };
type Reply = Out | (() => Out);

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of req) parts.push(c as Buffer);
  return Buffer.concat(parts);
}

describe("the page's IPFS address", () => {
  test('base32 is RFC 4648, lower case, no padding', () => {
    const vectors: [string, string][] = [['', ''], ['f', 'my'], ['fo', 'mzxq'], ['foo', 'mzxw6'], ['foob', 'mzxw6yq'], ['fooba', 'mzxw6ytb'], ['foobar', 'mzxw6ytboi']];
    for (const [text, encoded] of vectors) assert.equal(base32(new TextEncoder().encode(text)), encoded, text);
  });

  test('the root block Pinata made for the real page is the one made here, and its CID is the page address', () => {
    const fixture = JSON.parse(readFileSync(new URL('../fixtures/ipfs/pinata-root-block.json', import.meta.url), 'utf8')) as {
      cid: string;
      pieces: { sha256: string; size: number }[];
      rootBlock: string;
    };
    const root = fileRootBlock(fixture.pieces.map((p) => ({ digest: fromHex(p.sha256), size: p.size })));
    assert.equal(Buffer.from(root).toString('hex'), fixture.rootBlock);
    assert.equal(cidText(cidBytes(0x70, sha256(root))), fixture.cid);
    assert.ok(FILE_CID.test(fixture.cid));
  });

  test('a file of one piece is one raw block: its CID is the sha256 of its bytes', () => {
    const bytes = new TextEncoder().encode('<!doctype html><title>x</title>');
    const blocks = fileBlocks(bytes);
    assert.equal(blocks.length, 1);
    assert.deepEqual(blocks[0]!.bytes, bytes);
    assert.equal(blocks[0]!.cid, `b${base32(Uint8Array.of(0x01, 0x55, 0x12, 0x20, ...sha256(bytes)))}`);
    assert.ok(blocks[0]!.cid.startsWith('bafkrei') && FILE_CID.test(blocks[0]!.cid));
  });

  test('a file of three pieces: pieces of 256 KiB, a root that lists them, and the pieces give the file back', () => {
    const bytes = new Uint8Array(2 * PIECE_BYTES + 75_712).map((_, i) => i % 251);
    const [root, ...pieces] = fileBlocks(bytes);
    assert.deepEqual(pieces.map((p) => p.bytes.length), [PIECE_BYTES, PIECE_BYTES, 75_712]);
    assert.deepEqual(Buffer.concat(pieces.map((p) => p.bytes)), Buffer.from(bytes));
    assert.deepEqual(root!.bytes, fileRootBlock(pieces.map((p) => ({ digest: sha256(p.bytes), size: p.bytes.length }))));
    assert.ok(root!.cid.startsWith('bafybei') && FILE_CID.test(root!.cid));
  });
});

describe('publishing the page on IPFS', () => {
  let server: Server;
  let base: string;
  let uploadReplies: Reply[] = [];
  let seen: Seen[] = [];
  let blockReply: (cid: string) => Out;
  let routingReplies: Reply[] = [];
  let page: PageFile;
  const wait = async () => undefined;

  before(async () => {
    server = createServer(async (req, res) => {
      const url = new URL(req.url!, 'http://x');
      let out: Out;
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
        const r = uploadReplies.shift() ?? { status: 200, body: JSON.stringify({ data: { id: 'x', cid: page.cid, number_of_files: 1 } }) };
        out = typeof r === 'function' ? r() : r;
      } else if (url.pathname.startsWith('/ipfs/')) {
        assert.equal(req.headers.accept, 'application/vnd.ipld.raw');
        out = blockReply(url.pathname.slice('/ipfs/'.length));
      } else if (url.pathname.startsWith('/routing/v1/providers/')) {
        const r = routingReplies.shift() ?? { status: 200, body: JSON.stringify({ Providers: null }) };
        out = typeof r === 'function' ? r() : r;
      } else out = { status: 404, body: 'no' };
      res.writeHead(out.status).end(out.body);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    // A page of three blocks: a root and two pieces.
    const dir = mkdtempSync(join(tmpdir(), 'page-'));
    writeFileSync(join(dir, 'index.html'), `<!doctype html><title>x</title><!--${'x'.repeat(PIECE_BYTES + 1000)}-->`);
    page = readPage(join(dir, 'index.html'));
  });
  after(() => new Promise<void>((r) => server.close(() => r())));
  beforeEach(() => {
    uploadReplies = [];
    seen = [];
    routingReplies = [];
    blockReply = serveBlocks(() => page);
  });

  const blockOf = (p: PageFile, cid: string) => p.blocks.find((b) => b.cid === cid);
  const serveBlocks = (p: () => PageFile) => (cid: string): Out => {
    const b = blockOf(p(), cid);
    return b ? { status: 200, body: Buffer.from(b.bytes) } : { status: 404, body: 'no' };
  };
  const clock = () => {
    let t = 0;
    return { now: () => t, wait: async (ms: number) => void (t += ms) };
  };
  const upload = () => pinPage(page, { jwt: JWT, name: 'exit-page abc', url: `${base}/upload`, wait });

  test('the page is read with its sha256 and its address; a file that is not the built page is refused', () => {
    assert.equal(page.sha256, Buffer.from(sha256(page.bytes)).toString('hex'));
    assert.equal(page.blocks.length, 3);
    assert.equal(page.cid, page.blocks[0]!.cid);
    const dir = mkdtempSync(join(tmpdir(), 'page-'));
    writeFileSync(join(dir, 'licenses.txt'), 'MIT');
    assert.throws(() => readPage(join(dir, 'licenses.txt')), /not the built page/u);
  });

  test('one upload of the one file: public IPFS, as index.html, text/html, the token as a Bearer header', async () => {
    assert.equal(await upload(), page.cid);
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
    assert.equal(await upload(), page.cid);
    assert.equal(seen.length, 3);
    seen = [];
    uploadReplies = [{ status: 502, body: '' }, { status: 502, body: '' }, { status: 502, body: '' }];
    await assert.rejects(upload(), /HTTP 502/u);
    assert.equal(seen.length, 3);
  });

  test("only the page's own address is taken: not an old CID, and not another file's CIDv1", async () => {
    for (const bad of ['QmVLwvmGehsrNEvhcCnnsw5RQNseohgEkFNN1848zNzdng', `bafz${'b'.repeat(55)}`, `bafy${'b'.repeat(54)}`, 42, undefined]) {
      uploadReplies = [{ status: 200, body: JSON.stringify({ data: { cid: bad } }) }];
      await assert.rejects(upload(), /no CIDv1/u);
    }
    uploadReplies = [{ status: 200, body: JSON.stringify({ data: { cid: `bafy${'b'.repeat(55)}` } }) }];
    await assert.rejects(upload(), /Pinata holds other bytes/u);
  });

  test('read back: every block, byte for byte, also when the endpoint needs a little time', async () => {
    let misses = 2;
    const serve = serveBlocks(() => page);
    blockReply = (cid) => (misses-- > 0 ? { status: 504, body: 'later' } : serve(cid));
    assert.equal(await confirmBlocks(page, { base, ...clock() }), '3 of 3 blocks, byte for byte');
  });

  test('other bytes for a block fail the publish at once, with no waiting', async () => {
    const serve = serveBlocks(() => page);
    blockReply = (cid) => (cid === page.blocks[2]!.cid ? { status: 200, body: 'changed' } : serve(cid));
    const c = clock();
    await assert.rejects(confirmBlocks(page, { base, ...c }), /served other bytes for block 3/u);
    assert.equal(c.now(), 0);
  });

  test('an endpoint that refuses to serve fails the publish at once, with no waiting', async () => {
    blockReply = () => ({ status: 403, body: 'HTML content cannot be served' });
    const c = clock();
    await assert.rejects(confirmBlocks(page, { base, ...c }), /refused to serve block 1 \(HTTP 403\)/u);
    assert.equal(c.now(), 0);
  });

  test('an endpoint that never serves a block: the error says the upload is made and a new run is safe', async () => {
    blockReply = () => ({ status: 404, body: 'no' });
    await assert.rejects(confirmBlocks(page, { base, ...clock() }), (e: unknown) => {
      assert.match((e as Error).message, new RegExp(`uploaded as ${page.cid}`, 'u'));
      assert.match((e as Error).message, /Run the job again/u);
      return true;
    });
  });

  test('the IPFS routing: a listed provider is reported; none is reported too, and never fails the publish', async () => {
    routingReplies = [{ status: 200, body: JSON.stringify({ Providers: [] }) }, { status: 200, body: JSON.stringify({ Providers: [{ ID: 'x' }] }) }];
    assert.deepEqual(await findProviders(page.cid, { base, ...clock() }), { ok: true, note: '1 provider(s) listed' });
    routingReplies = [];
    const none = await findProviders(page.cid, { base, ...clock() });
    assert.equal(none.ok, false);
  });
});
