const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(file, window, extra = {}) {
  const context = { window, console, Date, Number, Promise,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    document: { getElementById: () => null, querySelectorAll: () => [] },
    localStorage: { setItem() {}, removeItem() {} }, setTimeout() {}, ...extra };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  return window;
}

function dbContext(rpc) {
  const events = [];
  const window = { dispatchEvent: event => events.push(event.type),
    supabase: { createClient: (_, __, options) => ({ rpc: (name, args) => rpc(name, args, options.global.headers) }) } };
  load('db.js', window);
  window.ClockDB.init('old-token');
  return { api: window.ClockDB, events };
}

test('clock mutations signal session expiration, including inactive staff', async () => {
  for (const action of ['clockOn', 'clockOff']) {
    const { api, events } = dbContext(async () => ({ error: { code: '28000', message: 'Staff member not found or inactive.' } }));
    await assert.rejects(api[action]('example'), /session has expired/);
    assert.deepEqual(events, ['session:expired']);
  }
});

test('ordinary clock failures do not expire sessions', async () => {
  const { api, events } = dbContext(async () => ({ error: { message: 'Connection failed' } }));
  await assert.rejects(api.clockOn('example'), /Connection failed/);
  assert.equal(events.length, 0);
});

test('a late clock authentication error cannot expire a newer session', async () => {
  let finish;
  const { api, events } = dbContext(() => new Promise(resolve => { finish = resolve; }));
  const pending = api.clockOn('example');
  api.init('new-token');
  finish({ error: { code: '28000', message: 'No valid session' } });
  await assert.rejects(pending, /session has expired/);
  assert.equal(events.length, 0);
});

test('late logout response cannot clear a new login token', async () => {
  let finish;
  const { api } = dbContext(() => new Promise(resolve => { finish = resolve; }));
  const pending = api.logoutStaff();
  assert.equal(api.getSessionToken(), null);
  api.init('new-token');
  finish({ data: true });
  await pending;
  assert.equal(api.getSessionToken(), 'new-token');
});

function authContext(getCurrentStaff) {
  const events = [];
  const window = { dispatchEvent: event => events.push(event.type), scrollTo() {},
    ClockDB: { init() {}, getCurrentStaff, logoutStaff: async () => {} } };
  load('auth.js', window);
  return { api: window.ClockAuth, events };
}

const staff = { id: 'staff-1', name: 'Staff', role: 'staff', active: true, token: 'token' };

test('expired sessions are cleared before a clock action can proceed', async () => {
  const { api, events } = authContext(async () => null);
  await api.createSession(staff);
  assert.equal(await api.validateSession(), false);
  assert.equal(api.getSession(), null);
  assert.ok(events.includes('session:logout'));
});

test('temporary connection failure preserves the session and blocks the action', async () => {
  const { api } = authContext(async () => { throw new Error('offline'); });
  await api.createSession(staff);
  await assert.rejects(api.validateSession(), /Check your connection/);
  assert.equal(api.getSession().id, staff.id);
});

test('validation is shared and an old response cannot log out a new login', async () => {
  let finish;
  const { api } = authContext(() => new Promise(resolve => { finish = resolve; }));
  await api.createSession(staff);
  const first = api.validateSession();
  assert.equal(api.validateSession(), first);
  await api.createSession({ ...staff, id: 'staff-2' });
  finish(null);
  assert.equal(await first, false);
  assert.equal(api.getSession().id, 'staff-2');
});

test('local expiry does not depend on a successful network request', async () => {
  const { api } = authContext(async () => { throw new Error('Must not call'); });
  await api.createSession(staff);
  api.getSession().loginTime = new Date(Date.now() - 9 * 3600000).toISOString();
  assert.equal(await api.validateSession(), false);
  assert.equal(api.getSession(), null);
});
