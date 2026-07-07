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
      add: () => {},
      remove: () => {},
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

  querySelector() {
    return {
      style: {},
      addEventListener: () => {},
      appendChild: () => {}
    };
  }
}

function loadTimesheetModule() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'admin-timesheet.js'), 'utf8');
  const context = {
    console,
    Date,
    document: {
      createElement: (tagName) => new TestElement(tagName),
      getElementById: () => null,
      querySelectorAll: () => []
    },
    window: {
      ClockDB: {
        calculateDuration: (clockIn, clockOut) => new Date(clockOut).getTime() - new Date(clockIn).getTime(),
        csvEscape: (value) => {
          const stringValue = value === null || value === undefined ? '' : String(value);
          return /[",\r\n]/.test(stringValue) ? `"${stringValue.replace(/"/g, '""')}"` : stringValue;
        }
      }
    }
  };

  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'admin-timesheet.js' });

  return context.window.ClockAdminTimesheet;
}

test('builds payroll export CSV matching the supplied sample format', () => {
  const api = loadTimesheetModule();

  api.getData().push(
    {
      id: 'shift-1',
      employee_id: '547',
      department_id: '141',
      clock_in: '2022-01-12T09:00:00.000+08:00',
      clock_out: '2022-01-12T17:00:00.000+08:00'
    },
    {
      id: 'shift-2',
      staff: { employee_id: '511', department_id: '140' },
      clock_in: '2022-01-02T12:00:00.000+08:00',
      clock_out: '2022-01-02T18:00:00.000+08:00',
      break_minutes: 20
    }
  );

  assert.equal(
    api.buildExportCSV(),
    [
      'Employee_Id,Department_Id,Type,Leave_Id,Start_Time,End_Time,Break,Date',
      '547,141,T,,9:00,17:00,,12/01/2022',
      '511,140,T,,12:00,18:00,20,2/01/2022'
    ].join('\r\n')
  );
});

test('uses employee and department ids from the staff object', () => {
  const api = loadTimesheetModule();

  api.getData().push({
    id: 'shift-1',
    staff: {
      employee_id: '547',
      department_id: '141'
    },
    clock_in: '2022-01-12T09:00:00.000+08:00',
    clock_out: '2022-01-12T17:00:00.000+08:00'
  });

  const lines = api.buildExportCSV().split('\r\n');
  assert.equal(lines[1], '547,141,T,,9:00,17:00,,12/01/2022');
});

test('exports one row per staff member per day for split shifts', () => {
  const api = loadTimesheetModule();

  api.getData().push(
    {
      id: 'shift-1',
      staff_id: 'staff-1',
      staff: { employee_id: '547', department_id: '141' },
      clock_in: '2022-01-12T09:00:00.000+08:00',
      clock_out: '2022-01-12T12:00:00.000+08:00'
    },
    {
      id: 'shift-2',
      staff_id: 'staff-1',
      staff: { employee_id: '547', department_id: '141' },
      clock_in: '2022-01-12T13:00:00.000+08:00',
      clock_out: '2022-01-12T17:00:00.000+08:00'
    }
  );

  assert.equal(
    api.buildExportCSV(),
    [
      'Employee_Id,Department_Id,Type,Leave_Id,Start_Time,End_Time,Break,Date',
      '547,141,T,,9:00,17:00,60,12/01/2022'
    ].join('\r\n')
  );
});

test('can build an export for one staff card only', () => {
  const api = loadTimesheetModule();

  const bidhaShift = {
    id: 'shift-1',
    staff_id: 'staff-1',
    staff: { employee_id: '547', department_id: '141' },
    clock_in: '2022-01-12T09:00:00.000+08:00',
    clock_out: '2022-01-12T17:00:00.000+08:00'
  };

  api.getData().push(
    bidhaShift,
    {
      id: 'shift-2',
      staff_id: 'staff-2',
      staff: { employee_id: '511', department_id: '140' },
      clock_in: '2022-01-12T09:00:00.000+08:00',
      clock_out: '2022-01-12T15:00:00.000+08:00'
    }
  );

  assert.equal(
    api.buildExportCSV([bidhaShift]),
    [
      'Employee_Id,Department_Id,Type,Leave_Id,Start_Time,End_Time,Break,Date',
      '547,141,T,,9:00,17:00,,12/01/2022'
    ].join('\r\n')
  );
});
