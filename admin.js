/**
 * admin.js - Admin Panel Module (Hardened)
 *
 * Handles staff management, timesheet viewing with filters,
 * CSV export, and manual time adjustment with mandatory
 * audit logging.  Every admin-mutating action is verified
 * both client-side (UX guard) and server-side (RLS + RPC).
 */

(function() {
  'use strict';

  // ===== State =====
  var currentStaffList = [];
  var currentTimesheets = [];
  var adminInitialized = false;
  var isLoadingStaff = false;
  var isLoadingTimesheets = false;
  var isLoadingAudit = false;

  // ===== Admin Panel Access =====

  /**
   * Initialise admin panel button (shown only for admin users).
   */
  function initAdminButton() {
    var adminBtn = document.getElementById('admin-panel-btn');
    if (!adminBtn) return;

    adminBtn.addEventListener('click', function() {
      if (!window.ClockAuth || !window.ClockAuth.isAdmin()) {
        if (window.ClockApp) {
          window.ClockApp.showToast('Access denied. Admin role required.', 'error');
        }
        return;
      }
      window.ClockAuth.showScreen('admin');
      loadAdminStaff();
    });
  }

  /**
   * Initialise admin panel back button.
   */
  function initAdminBack() {
    var btn = document.getElementById('admin-back-btn');
    if (!btn) return;

    btn.addEventListener('click', function() {
      window.ClockAuth.showScreen('app');
    });
  }

  // ===== Admin Tabs =====

  /**
   * Initialise admin tab switching.
   */
  function initAdminTabs() {
    document.querySelectorAll('.admin-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        var tabName = tab.dataset.tab;

        // Visual active state
        document.querySelectorAll('.admin-tab').forEach(function(t) {
          t.classList.remove('active');
          t.className = 'admin-tab flex-1 py-2 px-3 bg-gray-200 text-gray-800 rounded text-sm whitespace-nowrap';
        });
        tab.classList.add('active');
        tab.className = 'admin-tab active flex-1 py-2 px-3 bg-gray-800 text-white rounded text-sm whitespace-nowrap';

        // Content visibility
        document.querySelectorAll('.admin-tab-content').forEach(function(content) {
          content.classList.add('hidden');
        });
        var contentEl = document.getElementById('admin-' + tabName + '-tab');
        if (contentEl) contentEl.classList.remove('hidden');

        // Load tab data
        if (tabName === 'staff') loadAdminStaff();
        else if (tabName === 'timesheets') loadAdminTimesheets();
        else if (tabName === 'audit') loadAdminAudit();
      });
    });
  }

  // ===== Staff Management =====

  /**
   * Load and display all staff members.
   * Guarded to prevent concurrent execution causing duplicates.
   */
  async function loadAdminStaff() {
    if (isLoadingStaff) return;
    isLoadingStaff = true;

    var staffList = document.getElementById('staff-list');
    if (!staffList) { isLoadingStaff = false; return; }
    staffList.innerHTML = '';

    try {
      currentStaffList = await window.ClockDB.getAllStaff();

      if (!currentStaffList || currentStaffList.length === 0) {
        staffList.innerHTML = '<p class="text-center text-gray-500 py-4">No staff members found.</p>';
        isLoadingStaff = false;
        return;
      }

      currentStaffList.forEach(function(staff) {
        staffList.appendChild(createStaffCard(staff));
      });
    } catch (error) {
      console.error('Failed to load staff:', error);
      if (window.ClockApp) {
        window.ClockApp.showToast(error.message || 'Failed to load staff list.', 'error');
      }
    } finally {
      isLoadingStaff = false;
    }
  }

  /**
   * Build a staff card DOM element.
   * @param {object} staff
   * @returns {HTMLElement}
   */
  function createStaffCard(staff) {
    var card = document.createElement('div');
    card.className = 'staff-card' + (staff.active ? '' : ' inactive');

    var roleBadge = staff.role === 'admin'
      ? '<span class="text-xs bg-gray-800 text-white px-2 py-1 rounded">Admin</span>'
      : '<span class="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">Staff</span>';

    var statusBadge = staff.active
      ? '<span class="text-xs text-green-600">● Active</span>'
      : '<span class="text-xs text-gray-500">● Inactive</span>';

    var lockBadge = staff.locked_until ? '<span class="text-xs text-red-600 font-semibold">🔒 Locked until ' + escapeHtml(staff.locked_until.slice(0, 16).replace('T', ' ')) + '</span>' : '';

    card.innerHTML = '<div class="staff-info">' +
        '<div class="flex items-center gap-2 mb-1">' +
          '<span class="font-semibold text-gray-800">' + escapeHtml(staff.name) + '</span>' +
          roleBadge +
        '</div>' +
        '<div class="text-sm text-gray-500">' + statusBadge + (lockBadge ? ' • ' + lockBadge : '') + '</div>' +
      '</div>' +
      '<div class="staff-actions">' +
        '<button class="btn-edit" data-action="edit" data-staff-id="' + staff.id + '">✏️</button>' +
        (staff.active
          ? '<button class="btn-delete" data-action="deactivate" data-staff-id="' + staff.id + '">🚫</button>'
          : ''
        ) +
        (staff.locked_until
          ? '<button class="btn-unlock" data-action="unlock" data-staff-id="' + staff.id + '">🔓</button>'
          : ''
        ) +
      '</div>';

    card.querySelectorAll('button').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var action = btn.dataset.action;
        var staffId = btn.dataset.staffId;
        var staffRecord = currentStaffList.find(function(s) { return s.id === staffId; });

        if (action === 'edit') {
          openStaffModal(staffRecord);
        } else if (action === 'deactivate') {
          confirmDeactivate(staffRecord);
        } else if (action === 'unlock') {
          confirmUnlock(staffRecord);
        }
      });
    });

    return card;
  }

  /**
   * Open staff modal for add or edit.
   * @param {object|null} staff
   */
  function openStaffModal(staff) {
    staff = staff || null;
    var modal = document.getElementById('staff-modal');
    var title = document.getElementById('staff-modal-title');
    var form = document.getElementById('staff-form');
    if (!modal || !title || !form) return;

    form.reset();

    if (staff) {
      title.textContent = 'Edit Staff';
      document.getElementById('staff-id').value = staff.id;
      document.getElementById('staff-name-input').value = staff.name;
      document.getElementById('staff-pin-input').value = '';
      document.getElementById('staff-pin-input').placeholder = 'Leave blank to keep current';
      document.getElementById('staff-role-input').value = staff.role;
      document.getElementById('staff-active-input').checked = staff.active;
    } else {
      title.textContent = 'Add Staff';
      document.getElementById('staff-id').value = '';
      document.getElementById('staff-pin-input').value = '';
      document.getElementById('staff-pin-input').placeholder = '4-6 digits';
      document.getElementById('staff-role-input').value = 'staff';
      document.getElementById('staff-active-input').checked = true;
    }

    modal.classList.remove('hidden');
  }

  /**
   * Confirm and execute deactivation.
   * @param {object} staff
   */
  function confirmDeactivate(staff) {
    if (!staff) return;
    var msg = 'Deactivate ' + escapeHtml(staff.name) + '?\n\nTheir shift history will be preserved, but they will no longer be able to log in.';
    if (window.confirm(msg)) {
      deactivateStaffMember(staff.id);
    }
  }

  /**
   * Confirm and execute unlock.
   * @param {object} staff
   */
  function confirmUnlock(staff) {
    if (!staff) return;
    var msg = 'Unlock ' + escapeHtml(staff.name) + '\'s account?\n\nThis resets failed login attempts and removes the lockout.';
    if (window.confirm(msg)) {
      unlockStaffMember(staff.id);
    }
  }

  /**
   * Unlock a staff member via RPC.
   * @param {string} staffId
   */
  async function unlockStaffMember(staffId) {
    try {
      await window.ClockDB.unlockStaff(staffId);
      if (window.ClockApp) {
        window.ClockApp.showToast('Staff member unlocked.', 'success');
      }
      loadAdminStaff();
    } catch (error) {
      console.error('Failed to unlock staff:', error);
      if (window.ClockApp) {
        window.ClockApp.showToast(error.message || 'Failed to unlock staff.', 'error');
      }
    }
  }

  /**
   * Deactivate a staff member via RPC.
   * @param {string} staffId
   */
  async function deactivateStaffMember(staffId) {
    try {
      await window.ClockDB.deactivateStaff(staffId);
      if (window.ClockApp) {
        window.ClockApp.showToast('Staff member deactivated.', 'success');
      }
      loadAdminStaff();
    } catch (error) {
      console.error('Failed to deactivate staff:', error);
      if (window.ClockApp) {
        window.ClockApp.showToast(error.message || 'Failed to deactivate staff.', 'error');
      }
    }
  }

  /**
   * Initialise staff modal event handlers.
   */
  function initStaffModal() {
    var addBtn = document.getElementById('add-staff-btn');
    var cancelBtn = document.getElementById('staff-modal-cancel');
    var form = document.getElementById('staff-form');
    var overlay = document.querySelector('#staff-modal .modal-overlay');

    if (addBtn) {
      addBtn.addEventListener('click', function() { openStaffModal(null); });
    }
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function() {
        var modal = document.getElementById('staff-modal');
        if (modal) modal.classList.add('hidden');
      });
    }
    if (overlay) {
      overlay.addEventListener('click', function() {
        var modal = document.getElementById('staff-modal');
        if (modal) modal.classList.add('hidden');
      });
    }
    if (form) {
      form.addEventListener('submit', async function(e) {
        e.preventDefault();
        await submitStaffForm();
      });
    }
  }

  /**
   * Submit the staff form (create or update).
   */
  var isSubmittingStaff = false;

  async function submitStaffForm() {
    if (isSubmittingStaff) return;
    isSubmittingStaff = true;

    var staffId = document.getElementById('staff-id').value;
    var name = document.getElementById('staff-name-input').value.trim();
    var pin = document.getElementById('staff-pin-input').value.trim();
    var role = document.getElementById('staff-role-input').value;
    var active = document.getElementById('staff-active-input').checked;

    if (!name) {
      isSubmittingStaff = false;
      if (window.ClockApp) window.ClockApp.showToast('Name is required.', 'error');
      return;
    }

    // PIN required for new staff; optional for updates
    if (!staffId) {
      if (!pin || pin.length < 4 || pin.length > 6 || !/^\d+$/.test(pin)) {
        if (window.ClockApp) window.ClockApp.showToast('PIN must be 4-6 digits.', 'error');
        return;
      }
    }

    try {
      var staffData = { name: name, role: role, active: active };
      if (pin) staffData.pin = pin;

      if (staffId) {
        await window.ClockDB.updateStaff(staffId, staffData);
        if (window.ClockApp) window.ClockApp.showToast('Staff updated.', 'success');
      } else {
        await window.ClockDB.createStaff(staffData);
        if (window.ClockApp) window.ClockApp.showToast('Staff member added.', 'success');
      }

      var modal = document.getElementById('staff-modal');
      if (modal) modal.classList.add('hidden');
      loadAdminStaff();
    } catch (error) {
      console.error('Failed to save staff:', error);
      if (window.ClockApp) {
        window.ClockApp.showToast(error.message || 'Failed to save staff.', 'error');
      }
    } finally {
      isSubmittingStaff = false;
    }
  }

  // ===== Timesheets View =====

  /**
   * Load and display all timesheets with filters.
   * Guarded to prevent concurrent execution.
   */
  async function loadAdminTimesheets() {
    if (isLoadingTimesheets) return;
    isLoadingTimesheets = true;

    var timesheetsList = document.getElementById('timesheets-list');
    var staffFilter = document.getElementById('timesheet-staff-filter');
    if (!timesheetsList) { isLoadingTimesheets = false; return; }

    timesheetsList.innerHTML = '<div class="loading-spinner"></div><p class="text-center text-gray-600 mt-2">Loading...</p>';

    try {
      var filters = {};
      if (staffFilter && staffFilter.value) filters.staffId = staffFilter.value;

      currentTimesheets = await window.ClockDB.getAllShifts(filters);

      if (!currentTimesheets || currentTimesheets.length === 0) {
        timesheetsList.innerHTML = '<p class="text-center text-gray-500 py-4">No shifts found.</p>';
        isLoadingTimesheets = false;
        return;
      }

      renderTimesheets(currentTimesheets);
    } catch (error) {
      console.error('Failed to load timesheets:', error);
      timesheetsList.innerHTML = '<p class="text-center text-red-500 py-4">Failed to load timesheets.</p>';
      if (window.ClockApp) {
        window.ClockApp.showToast(error.message || 'Failed to load timesheets.', 'error');
      }
    } finally {
      isLoadingTimesheets = false;
    }
  }

  /**
   * Render the timesheet cards into the list container.
   * @param {Array} shifts
   */
  function renderTimesheets(shifts) {
    var timesheetsList = document.getElementById('timesheets-list');
    if (!timesheetsList) return;
    timesheetsList.innerHTML = '';

    shifts.forEach(function(shift) {
      timesheetsList.appendChild(createTimesheetCard(shift));
    });
  }

  /**
   * Build a timesheet card DOM element.
   * @param {object} shift
   * @returns {HTMLElement}
   */
  function createTimesheetCard(shift) {
    var card = document.createElement('div');
    card.className = 'timesheet-row';

    var isActive = !shift.clock_out;
    var dateStr = window.ClockDB.formatDate(shift.clock_in);
    var clockInStr = window.ClockDB.formatTime(shift.clock_in);
    var clockOutStr = shift.clock_out ? window.ClockDB.formatTime(shift.clock_out) : 'Active';
    var duration = shift.clock_out
      ? window.ClockDB.formatDuration(window.ClockDB.calculateDuration(shift.clock_in, shift.clock_out))
      : 'In progress';

    var staffName = escapeHtml(shift.staff && shift.staff.name ? shift.staff.name : 'Unknown');

    var adjustedBadges = [];
    if (shift.clock_in_adjusted) adjustedBadges.push('<span class="shift-adjusted-badge">in adjusted</span>');
    if (shift.clock_out_adjusted) adjustedBadges.push('<span class="shift-adjusted-badge">out adjusted</span>');

    card.innerHTML = '<div class="timesheet-row-header">' +
        '<span class="font-semibold text-gray-800">' + staffName + '</span>' +
        '<span class="text-sm ' + (isActive ? 'text-green-600' : 'text-gray-500') + '">' + dateStr + '</span>' +
      '</div>' +
      '<div class="timesheet-row-times">' +
        '<span><span class="text-green-600">' + clockInStr + '</span> → <span class="' + (isActive ? 'text-orange-600' : 'text-red-600') + '">' + clockOutStr + '</span></span>' +
        '<span class="shift-duration">' + duration + '</span>' +
      '</div>' +
      adjustedBadges.join('') +
      '<div class="mt-3 flex justify-end gap-2">' +
        '<button class="btn-edit text-sm px-3 py-2" data-action="edit-shift" data-shift-id="' + shift.id + '">✏️ Edit</button>' +
      '</div>';

    var editBtn = card.querySelector('[data-action="edit-shift"]');
    if (editBtn) {
      editBtn.addEventListener('click', function() {
        openShiftModal(shift);
      });
    }

    return card;
  }

  /**
   * Initialise timesheet filter and export controls.
   */
  function initTimesheetsControls() {
    var staffFilter = document.getElementById('timesheet-staff-filter');
    var exportBtn = document.getElementById('export-csv-btn');

    // Populate staff dropdown once
    (async function() {
      try {
        var staff = await window.ClockDB.getAllStaff();
        if (!staffFilter) return;
        // Preserve the first "All Staff" option
        var allOption = staffFilter.querySelector('option[value=""]');
        staffFilter.innerHTML = '';
        if (allOption) staffFilter.appendChild(allOption);

        staff.forEach(function(s) {
          var option = document.createElement('option');
          option.value = s.id;
          option.textContent = s.name;
          staffFilter.appendChild(option);
        });
      } catch (error) {
        console.error('Failed to populate staff filter:', error);
      }
    })();

    if (staffFilter) {
      staffFilter.addEventListener('change', loadAdminTimesheets);
    }
    if (exportBtn) {
      exportBtn.addEventListener('click', exportTimesheetsCSV);
    }
  }

  /**
   * Export the currently loaded timesheets to CSV and trigger download.
   */
  function exportTimesheetsCSV() {
    if (!currentTimesheets || currentTimesheets.length === 0) {
      if (window.ClockApp) window.ClockApp.showToast('No timesheets to export.', 'error');
      return;
    }

    var headers = [
      'staff_name', 'date', 'clock_in', 'clock_out',
      'duration_minutes', 'clock_in_adjusted', 'clock_out_adjusted', 'notes'
    ];

    var rows = currentTimesheets.map(function(shift) {
      var duration = shift.clock_out
        ? Math.round(window.ClockDB.calculateDuration(shift.clock_in, shift.clock_out) / 60000)
        : '';

      return [
        shift.staff && shift.staff.name ? shift.staff.name : 'Unknown',
        window.ClockDB.formatDate(shift.clock_in),
        window.ClockDB.formatDateTime(shift.clock_in),
        shift.clock_out ? window.ClockDB.formatDateTime(shift.clock_out) : '',
        duration,
        shift.clock_in_adjusted ? 'Yes' : 'No',
        shift.clock_out_adjusted ? 'Yes' : 'No',
        (shift.notes || '').replace(/"/g, '""')
      ].map(window.ClockDB.csvEscape).join(',');
    });

    var csvContent = [headers.join(','), rows.join('\r\n')].join('\r\n');
    var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'timesheets_' + new Date().toISOString().split('T')[0] + '.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    if (window.ClockApp) {
      window.ClockApp.showToast('Exported ' + currentTimesheets.length + ' shifts.', 'success');
    }
  }

  // ===== Shift Edit Modal =====

  /**
   * Open the shift edit modal.
   * @param {object} shift
   */
  function openShiftModal(shift) {
    var modal = document.getElementById('shift-modal');
    if (!modal) return;

    document.getElementById('edit-shift-id').value = shift.id;
    document.getElementById('edit-shift-staff-id').value = shift.staff_id || (shift.staff && shift.staff.id) || '';

    var clockInLocal = new Date(shift.clock_in).toISOString().slice(0, 16);
    var clockOutLocal = shift.clock_out ? new Date(shift.clock_out).toISOString().slice(0, 16) : '';

    document.getElementById('edit-clock-in').value = clockInLocal;
    document.getElementById('edit-clock-out').value = clockOutLocal;
    document.getElementById('edit-shift-notes').value = shift.notes || '';

    // Reason field is already present in the HTML (index.html:367-369)
    var reasonInput = document.getElementById('edit-shift-reason');
    if (reasonInput) reasonInput.value = '';

    modal.classList.remove('hidden');
  }

  /**
   * Initialise shift modal event handlers.
   */
  function initShiftModal() {
    var cancelBtn = document.getElementById('shift-modal-cancel');
    var form = document.getElementById('shift-form');
    var overlay = document.querySelector('#shift-modal .modal-overlay');

    if (cancelBtn) {
      cancelBtn.addEventListener('click', function() {
        var modal = document.getElementById('shift-modal');
        if (modal) modal.classList.add('hidden');
      });
    }
    if (overlay) {
      overlay.addEventListener('click', function() {
        var modal = document.getElementById('shift-modal');
        if (modal) modal.classList.add('hidden');
      });
    }
    if (form) {
      form.addEventListener('submit', async function(e) {
        e.preventDefault();
        await submitShiftForm();
      });
    }
  }

  /**
   * Submit the shift edit form.  Fetches the specific shift,
   * then calls the admin_update_shift RPC which auto-writes
   * an audit_log entry.
   */
  async function submitShiftForm() {
    var shiftId = document.getElementById('edit-shift-id').value;
    var clockInVal = document.getElementById('edit-clock-in').value;
    var clockOutVal = document.getElementById('edit-clock-out').value;
    var notes = document.getElementById('edit-shift-notes').value.trim();
    var reasonInput = document.getElementById('edit-shift-reason');
    var reason = reasonInput ? reasonInput.value.trim() : '';

    if (!clockInVal) {
      if (window.ClockApp) window.ClockApp.showToast('Clock-in time is required.', 'error');
      return;
    }

    if (clockOutVal && new Date(clockOutVal) <= new Date(clockInVal)) {
      if (window.ClockApp) window.ClockApp.showToast('Clock-out must be after clock-in.', 'error');
      return;
    }

    if (!reason) {
      if (window.ClockApp) window.ClockApp.showToast('Reason for adjustment is required.', 'error');
      return;
    }

    try {
      // Fetch the specific shift to verify it exists and get old values
      var currentShift = await window.ClockDB.getShiftById(shiftId);
      if (!currentShift) {
        if (window.ClockApp) window.ClockApp.showToast('Shift not found. It may have been deleted.', 'error');
        return;
      }

      var updates = {
        clockIn: new Date(clockInVal).toISOString(),
        clockOut: clockOutVal ? new Date(clockOutVal).toISOString() : null,
        notes: notes || null,
        reason: reason || 'Manual adjustment by admin'
      };

      await window.ClockDB.updateShift(shiftId, updates);

      if (window.ClockApp) {
        window.ClockApp.showToast('Shift updated. Change logged in audit trail.', 'success');
      }
      var modal = document.getElementById('shift-modal');
      if (modal) modal.classList.add('hidden');
      loadAdminTimesheets();
    } catch (error) {
      console.error('Failed to update shift:', error);
      if (window.ClockApp) {
        window.ClockApp.showToast(error.message || 'Failed to update shift.', 'error');
      }
    }
  }

  // ===== Audit Log View =====

  /**
   * Load and display audit log entries.
   * Guarded to prevent concurrent execution.
   */
  async function loadAdminAudit() {
    if (isLoadingAudit) return;
    isLoadingAudit = true;

    var auditList = document.getElementById('audit-list');
    if (!auditList) { isLoadingAudit = false; return; }
    auditList.innerHTML = '<div class="loading-spinner"></div><p class="text-center text-gray-600 mt-2">Loading...</p>';

    try {
      var entries = await window.ClockDB.getAuditLog(50);

      if (!entries || entries.length === 0) {
        auditList.innerHTML = '<p class="text-center text-gray-500 py-4">No audit entries found.</p>';
        isLoadingAudit = false;
        return;
      }

      auditList.innerHTML = '';
      entries.forEach(function(entry) {
        auditList.appendChild(createAuditCard(entry));
      });
    } catch (error) {
      console.error('Failed to load audit log:', error);
      auditList.innerHTML = '<p class="text-center text-red-500 py-4">Failed to load audit log.</p>';
      if (window.ClockApp) {
        window.ClockApp.showToast(error.message || 'Failed to load audit log.', 'error');
      }
    } finally {
      isLoadingAudit = false;
    }
  }

  /**
   * Build an audit log card DOM element.
   * @param {object} entry
   * @returns {HTMLElement}
   */
  function createAuditCard(entry) {
    var card = document.createElement('div');
    card.className = 'audit-entry';

    var adminName = escapeHtml(entry.admin && entry.admin.name ? entry.admin.name : 'Unknown');
    var targetName = escapeHtml(entry.target_staff && entry.target_staff.name ? entry.target_staff.name : 'Unknown');
    var timeStr = window.ClockDB.formatDateTime(entry.created_at);

    var oldVal = entry.old_value ? JSON.stringify(entry.old_value, null, 2) : '-';
    var newVal = entry.new_value ? JSON.stringify(entry.new_value, null, 2) : '-';

    card.innerHTML = '<div class="audit-entry-action">' + escapeHtml(entry.action) + '</div>' +
      '<div class="text-sm text-gray-600 mt-1">' +
        '<span class="font-medium">' + adminName + '</span> edited ' +
        '<span class="font-medium">' + targetName + '</span>\'s shift' +
      '</div>' +
      (entry.reason ? '<div class="text-xs text-gray-500 mt-1">Reason: ' + escapeHtml(entry.reason) + '</div>' : '') +
      '<details class="mt-2 text-xs text-gray-600">' +
        '<summary class="cursor-pointer">View details</summary>' +
        '<pre class="mt-1 bg-gray-100 p-2 rounded overflow-x-auto">Old:\n' + escapeHtml(oldVal) + '\n\nNew:\n' + escapeHtml(newVal) + '</pre>' +
      '</details>' +
      '<div class="audit-entry-time mt-1">' + timeStr + '</div>';

    return card;
  }

  // ===== Utilities =====

  /**
   * Escape HTML entities to prevent XSS in dynamically generated markup.
   * @param {string} text
   * @returns {string}
   */
  function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    var map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, function(m) { return map[m]; });
  }

  // ===== Main Initialisation =====

  /**
   * Initialise the entire admin module.
   * Guarded to prevent duplicate listeners when called multiple times.
   */
  function initAdmin() {
    if (adminInitialized) return;
    adminInitialized = true;

    initAdminButton();
    initAdminBack();
    initAdminTabs();
    initStaffModal();
    initTimesheetsControls();
    initShiftModal();
  }

  // ===== Expose globally =====
  window.ClockAdmin = {
    initAdmin: initAdmin,
    loadAdminStaff: loadAdminStaff,
    loadAdminTimesheets: loadAdminTimesheets,
    loadAdminAudit: loadAdminAudit
  };
})();
