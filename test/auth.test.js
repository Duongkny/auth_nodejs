import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { createApp } from '../src/server.js';

test('JWT login, verification, refresh rotation and logout', async () => {
  const secret = 'test-only-random-secret-with-more-than-32-bytes';
  const app = createApp({ databasePath: ':memory:', jwtSecret: secret });
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.address().port}`;
  const post = (path, body = {}, cookie = '') => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body) });
  const me = token => fetch(base + '/auth/me', { headers: { Authorization: `Bearer ${token}` } });
  const account = { email: 'jwt@example.com', password: 'strong-test-password' };
  try {
    assert.equal((await post('/auth/register', account)).status, 202);
    assert.equal((await post('/auth/login', { ...account, password: 'wrong-password-here' })).status, 401);
    const login = await post('/auth/login', account);
    assert.equal(login.status, 200);
    const { accessToken } = await login.json();
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal(accessToken.split('.').length, 3);
    assert.equal((await me(accessToken)).status, 200);
    assert.equal((await me(accessToken + 'tamper')).status, 401);
    assert.equal((await me('')).status, 401);
    for (const overrides of [{ exp: 1 }, { aud: 'wrong' }, { iss: 'wrong' }, { type: 'refresh' }]) {
      const invalid = await new SignJWT({ sub: '1', iss: 'node-auth', aud: 'node-auth-api', iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+60, type: 'access', ...overrides }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).sign(new TextEncoder().encode(secret));
      assert.equal((await me(invalid)).status, 401);
    }
    const refreshed = await post('/auth/refresh', {}, cookie);
    assert.equal(refreshed.status, 200);
    assert.equal((await me((await refreshed.json()).accessToken)).status, 200);
    const nextCookie = refreshed.headers.get('set-cookie').split(';')[0];
    assert.notEqual(nextCookie, cookie);
    assert.equal((await post('/auth/refresh', {}, cookie)).status, 401);
    assert.equal((await post('/auth/logout', {}, nextCookie)).status, 200);
    assert.equal((await post('/auth/refresh', {}, nextCookie)).status, 401);
    assert.equal((await me(accessToken)).status, 200);
    const spec = await (await fetch(base + '/openapi.json')).json();
    assert.equal(spec.components.securitySchemes.bearerAuth.scheme, 'bearer');
    assert.ok(spec.paths['/auth/refresh']);
    assert.equal((await fetch(base + '/docs')).status, 200);
  } finally { await new Promise(r => app.close(r)); }
});

test('missing JWT secret fails at startup', () => {
  assert.throws(() => createApp({ databasePath: ':memory:', jwtSecret: '' }), /JWT_SECRET/);
});
