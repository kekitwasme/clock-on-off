const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

class TestElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.className = '';
    this.style = {};
    this.children = [];
    this._innerHTML = '';
    this.classList = {
      add: (...classes) => {
        const existing = this.className ? this.className.split(/\s+/) : [];
        classes.forEach((className) => {
          if (!existing.includes(className)) existing.push(className);
        });
        this.className = existing.join(' ');
      },
      toggle: () => {}
    };
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML + this.children.map((child) => child.outerHTML).join('');
  }

  get outerHTML() {
    return `<${this.tagName} class="${this.className}">${this.innerHTML}</${this.tagName}>`;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  addEventListener() {}

  querySelector(selector) {
    if (selector === '.staff-timesheet-body') {
      return {
        appendChild: (child) => {
          this._innerHTML += child.outerHTML;
          return child;
        }
      };
    }

    return {
      style: {},
      addEventListener: () => {},
      appendChild: () => {}
    };
  }
}

function loadTimesheetModule() {
  const container = new TestElement('div');
  const source = fs.readFileSync(path.join(__dirname, '..', 'admin-timesheet.js'), 'utf8');
  const context = {
    console,
    Date,
    document: {
      createElement: (tagName) => new TestElement(tagName),
      getElementById: (id) => (id === 'timesheets-list' ? container : null)
    },
    window: {
      ClockDB: {
        calculateDuration: (clockIn, clockOut) => new Date(clockOut).getTime() - new Date(clockIn).getTime(),
        formatTime: (isoString) => new Date(isoString).toLocaleTimeString('en-AU', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'UTC'
        }),
        formatDate: (isoString) => new Date(isoString).toLocaleDateString('en-AU', {
          day: 'numeric',
          month: 'short',
          timeZone: 'UTC'
        })
      }
    }
  };

  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'admin-timesheet.js' });

  return { container, api: context.window.ClockAdminTimesheet };
}

test('renders decimal hour totals to two decimal places', () => {
  const { container, api } = loadTimesheetModule();

  api.getData().push(
    {
      id: 'shift-1',
      staff_id: 'staff-1',
      staff: { id: 'staff-1', name: 'Bidha' },
      clock_in: '2026-06-22T17:00:00.000Z',
      clock_out: '2026-06-22T20:45:00.000Z',
      clock_in_adjusted: true,
      clock_out_adjusted: false
    },
    {
      id: 'shift-2',
      staff_id: 'staff-1',
      staff: { id: 'staff-1', name: 'Bidha' },
      clock_in: '2026-06-24T17:00:00.000Z',
      clock_out: '2026-06-24T21:15:00.000Z',
      clock_in_adjusted: true,
      clock_out_adjusted: true
    }
  );

  api.render();

  assert.match(container.innerHTML, /8\.00 hrs/);
  assert.match(container.innerHTML, /Mon(?:&ndash;|–)Fri: 8\.00h/);
  assert.match(container.innerHTML, /3\.75 h/);
  assert.match(container.innerHTML, /4\.25 h/);
  assert.match(container.innerHTML, /staff-timesheet-card staff-timesheet-card-collapsed/);
  assert.match(container.innerHTML, /data-action="export-staff"/);
});
