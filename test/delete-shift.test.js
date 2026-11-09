const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture({ confirm = true, admin = true, remove = async () => {} } = {}) {
  const listeners = {};
  const notices = [];
  const calls = [];
  let hidden = false;
  const buttons = [{ disabled: false }, { disabled: false }];
  const elements = {
    'shift-delete-btn': { addEventListener: (_, callback) => { listeners.delete = callback; } },
    'edit-shift-id': { value: 'shift-1' },
    'shift-modal': { classList: { add: () => { hidden = true; } } }
  };
  const window = {
    confirm: () => confirm,
    ClockAuth: { isAdmin: () => admin },
    ClockDB: { deleteShift: async id => { calls.push(id); await remove(); } },
    ClockApp: { showToast: (message, type) => notices.push({ message, type }) }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'admin-timesheet.js'), 'utf8'), {
    window, console,
    document: { getElementById: id => elements[id] || null, querySelector: () => null, querySelectorAll: () => buttons }
  });
  window.ClockAdminTimesheet.initShiftEditModal();
  return { remove: listeners.delete, calls, notices, buttons, hidden: () => hidden };
}

test('shift deletion requires confirmation and admin access', async () => {
  for (const options of [{ confirm: false }, { admin: false }]) {
    const f = fixture(options);
    await f.remove();
    assert.equal(f.calls.length, 0);
    assert.equal(f.hidden(), false);
  }
});

test('shift deletion prevents double submission and closes after success', async () => {
  let finish;
  const f = fixture({ remove: () => new Promise(resolve => { finish = resolve; }) });
  const pending = f.remove();
  assert.ok(f.buttons.every(button => button.disabled));
  await f.remove();
  assert.deepEqual(f.calls, ['shift-1']);
  finish();
  await pending;
  assert.equal(f.hidden(), true);
  assert.ok(f.buttons.every(button => !button.disabled));
});

test('failed deletion leaves the modal open and permits retry', async () => {
  const f = fixture({ remove: async () => { throw new Error('Connection failed'); } });
  await f.remove();
  assert.equal(f.hidden(), false);
  assert.equal(f.notices[0].message, 'Connection failed');
  assert.ok(f.buttons.every(button => !button.disabled));
});

test('database adapter calls the audited deletion RPC and surfaces failures', async () => {
  let error = null;
  const calls = [];
  const window = { supabase: { createClient: () => ({ rpc: async (name, params) => {
    calls.push([name, params.p_shift_id]);
    return { data: { success: true }, error };
  } }) } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8'), { window });
  window.ClockDB.init('token');
  await window.ClockDB.deleteShift('shift-1');
  assert.deepEqual(calls, [['admin_delete_shift', 'shift-1']]);
  error = { message: 'Admin role required.' };
  await assert.rejects(window.ClockDB.deleteShift('shift-1'), /Admin role required/);
});
