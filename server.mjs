import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const secret = process.env.UPLOAD_SECRET ?? '';
if (!/^[a-fA-F0-9]{64}$/.test(secret)) {
  throw new Error('UPLOAD_SECRET muss aus 64 Hex-Zeichen bestehen.');
}

const apiAuthorization = Buffer.from('Bearer ' + secret);
const page = readFileSync(new URL('./index.html', import.meta.url));
const script = readFileSync(new URL('./upload.js', import.meta.url));
const maxBytes = 2 * 1024 * 1024;
const sessionDuration = 5 * 60 * 1000;
const sessions = new Map();

function authorized(header) {
  const provided = Buffer.from(header ?? '');
  return provided.length === apiAuthorization.length && timingSafeEqual(provided, apiAuthorization);
}

function pruneSessions() {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now >= session.expiresAt) sessions.delete(token);
  }
}

function reply(res, status, body = '', type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  });
  res.end(body);
}

async function handle(req, res) {
  const { method, url } = req;
  if (method === 'GET' && url === '/health') return reply(res, 200, 'OK');
  if (method === 'GET' && url === '/') return reply(res, 200, page, 'text/html; charset=utf-8');
  if (method === 'GET' && url === '/upload.js') {
    return reply(res, 200, script, 'text/javascript; charset=utf-8');
  }

  pruneSessions();
  const lookup = /^\/api\/sessions\/([a-f0-9]{48})$/.exec(url);
  if ((method === 'POST' && url === '/api/sessions') || (method === 'GET' && lookup)) {
    if (!authorized(req.headers.authorization)) return reply(res, 401);
    if (lookup) {
      const session = sessions.get(lookup[1]);
      if (!session) return reply(res, 404);
      if (!session.image) return reply(res, 204);
      return reply(res, 200, session.image, 'application/octet-stream');
    }
    if (sessions.size >= 64) return reply(res, 503);
    const token = randomBytes(24).toString('hex');
    sessions.set(token, { expiresAt: Date.now() + sessionDuration, uploading: false, image: null });
    return reply(res, 201, token);
  }

  if (method === 'POST' && url === '/upload') {
    const token = /^Bearer ([a-f0-9]{48})$/.exec(req.headers.authorization ?? '')?.[1];
    const session = sessions.get(token);
    if (!session) return reply(res, 404);
    if (session.image || session.uploading) return reply(res, 409);
    if (Number(req.headers['content-length']) > maxBytes) return reply(res, 413);

    session.uploading = true;
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > maxBytes) {
          res.setHeader('Connection', 'close');
          return reply(res, 413);
        }
        chunks.push(chunk);
      }
      if (Date.now() >= session.expiresAt) return reply(res, 404);
      const image = Buffer.concat(chunks, size);
      const png = image.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
      const jpeg = image.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'));
      if (!png && !jpeg) return reply(res, 415);
      session.image = image;
      return reply(res, 201);
    } finally {
      session.uploading = false;
    }
  }

  return reply(res, 404);
}

setInterval(pruneSessions, 30_000).unref();
const server = createServer({
  requestTimeout: 20_000,
  headersTimeout: 10_000,
  connectionsCheckingInterval: 1000,
}, (req, res) => {
  handle(req, res).catch(() => {
    if (!res.destroyed && !res.headersSent) reply(res, 500);
  });
});
server.listen(Number(process.env.PORT ?? 8080), process.env.HOST ?? '0.0.0.0', () => {
  console.log('ImageUploader hört auf Port ' + server.address().port);
});
