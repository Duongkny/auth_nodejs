import http from 'node:http';
import { SignJWT, jwtVerify } from 'jose';
import { docsHtml, openapi } from './docs.js';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scrypt = promisify(scryptCallback);
const hashToken = value => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });

export function createApp({ databasePath = process.env.DATABASE_PATH || resolve(dirname(fileURLToPath(import.meta.url)), '../data/auth.sqlite'), secureCookie = process.env.NODE_ENV === 'production', jwtSecret = process.env.JWT_SECRET }  = {}) {
  if (!jwtSecret || Buffer.byteLength(jwtSecret) < 32) throw new Error('Set JWT_SECRET to a random secret of at least 32 bytes');
  const signingKey = new TextEncoder().encode(jwtSecret);
  const accessToken = userId => new SignJWT({ type: 'access' }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setSubject(String(userId)).setIssuer('node-auth').setAudience('node-auth-api').setIssuedAt().setExpirationTime('15m').sign(signingKey);
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS refresh_tokens (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);`);
  const limits = new Map();
  const dummySalt = randomBytes(16).toString('hex');
  const cookie = (value, age) => `refresh_token=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secureCookie ? '; Secure' : ''}`;
  const server = http.createServer(async (req, res) => {
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
      res.end(JSON.stringify(body));
    };
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/') {
        res.writeHead(302, { Location: '/docs' });
        return res.end();
      }
      if (req.method === 'GET' && (path === '/docs' || path === '/docs/')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        return res.end(docsHtml);
      }
      if (req.method === 'GET' && path === '/openapi.json') return send(200, openapi);
      if (req.method === 'GET' && path === '/health') return send(200, { status: 'ok' });
      if (req.method === 'POST') {
        if (req.headers['sec-fetch-site'] === 'cross-site') throw fail(403, 'Cross-site request rejected');
        if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw fail(415, 'Use application/json');
      }
      const token = /(?:^|;\s*)refresh_token=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
      if (req.method === 'GET' && path === '/auth/me') {
        const bearer = /^Bearer ([^ ]+)$/i.exec(req.headers.authorization || '')?.[1];
        let payload;
        try {
          ({ payload } = await jwtVerify(bearer || '', signingKey, { algorithms: ['HS256'], issuer: 'node-auth', audience: 'node-auth-api', requiredClaims: ['sub', 'iat', 'exp'], typ: 'JWT' }));
          if (payload.type !== 'access' || !/^[1-9][0-9]*$/.test(payload.sub)) throw new Error();
        } catch { throw fail(401, 'Invalid or expired access token'); }
        const user = db.prepare('SELECT id, email, created_at FROM users WHERE id=?').get(Number(payload.sub));
        if (!user) throw fail(401, 'Authentication required');
        return send(200, { user });
      }
      if (req.method === 'POST' && path === '/auth/refresh') {
        const existing = token && db.prepare('SELECT * FROM refresh_tokens WHERE token_hash=? AND expires_at>?').get(hashToken(token), Date.now());
        if (!existing) throw fail(401, 'Invalid or expired refresh token');
        const jwt = await accessToken(existing.user_id);
        const next = randomBytes(32).toString('hex');
        db.exec('BEGIN IMMEDIATE');
        try {
          const deleted = db.prepare('DELETE FROM refresh_tokens WHERE token_hash=?').run(hashToken(token));
          if (deleted.changes !== 1) throw fail(401, 'Refresh token already used');
          db.prepare('INSERT INTO refresh_tokens VALUES (?,?,?)').run(hashToken(next), existing.user_id, existing.expires_at);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return send(200, { accessToken: jwt, tokenType: 'Bearer', expiresIn: 900 }, { 'Set-Cookie': cookie(next, Math.max(0, Math.floor((existing.expires_at - Date.now()) / 1000))) });
      }
      if (req.method === 'POST' && path === '/auth/logout') {
        if (token) db.prepare('DELETE FROM refresh_tokens WHERE token_hash=?').run(hashToken(token));
        return send(200, { message: 'Logged out' }, { 'Set-Cookie': cookie('', 0) });
      }
      if (req.method !== 'POST' || !['/auth/register', '/auth/login'].includes(path)) throw fail(404, 'Not found');
      const now = Date.now();
      for (const [key, entry] of limits) if (entry.until <= now) limits.delete(key);
      const ip = req.socket.remoteAddress;
      const entry = limits.get(ip) || { count: 0, until: now + 60_000 };
      limits.set(ip, entry);
      if (++entry.count > 10) throw fail(429, 'Too many attempts; try again in one minute');
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 16_384) throw fail(413, 'Request too large');
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw fail(400, 'Invalid JSON'); }
      const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
      const password = body?.password;
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== 'string' || password.length < 12 || password.length > 128) throw fail(400, 'Provide a valid email and a password of 12–128 characters');
      if (path === '/auth/register') {
        const salt = randomBytes(16).toString('hex');
        const key = await scrypt(password, salt, 64);
        try {
          db.prepare('INSERT INTO users (email,password) VALUES (?,?)').run(email, `${salt}:${key.toString('hex')}`);
        } catch (error) {
          if (!String(error.message).includes('UNIQUE constraint failed')) throw error;
        }
        return send(202, { message: 'Registration processed. You can try signing in.' });
      }
      const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
      const [salt, stored] = user ? user.password.split(':') : [dummySalt, '00'.repeat(64)];
      const key = await scrypt(password, salt, 64);
      if (!timingSafeEqual(key, Buffer.from(stored, 'hex')) || !user) throw fail(401, 'Invalid email or password');
      db.prepare('DELETE FROM refresh_tokens WHERE expires_at<=?').run(now);
      if (token) db.prepare('DELETE FROM refresh_tokens WHERE token_hash=?').run(hashToken(token));
      const session = randomBytes(32).toString('hex');
      const age = 7 * 24 * 3600;
      db.prepare('INSERT INTO refresh_tokens VALUES (?,?,?)').run(hashToken(session), user.id, now + age * 1000);
      return send(200, { accessToken: await accessToken(user.id), tokenType: 'Bearer', expiresIn: 900, user: { id: user.id, email: user.email } }, { 'Set-Cookie': cookie(session, age) });
    } catch (error) {
      if (!error.status) console.error(error);
      send(error.status || 500, { error: error.status ? error.message : 'Internal server error' });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.on('close', () => db.close());
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  const server = createApp();
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Stop the previous server or change PORT.` : error.message);
    process.exit(1);
  });
  server.listen(port, host, () => console.log(`Auth API listening on ${host}:${port}; Swagger: /docs`));
  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
