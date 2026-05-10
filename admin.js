/**
 * admin.js - Admin Panel Module (Hardened)
 *
 * Coordinates staff management, timesheets, roster, and audit log.
 * Delegates timesheet rendering to admin-timesheet.js
 * and roster rendering to admin-roster.js.
 */

(function() {
  'use strict';

  // ===== State =====
  var currentStaffList = [];
  var adminInitialized = false;
  var isLoadingStaff = false;
  var isLoadingAudit = false;

  // ===== Admin Panel Access =====

  function initAdminButton() {
    var adminBtn = document.getElementById('admin-panel-btn');
    if (!adminBtn) return;

    adminBtn.addEventListener('click', function() {
      if (!window.ClockAuth || !window.ClockAuth.isAdminOrObserver()) {
        showToast('Access denied. Admin or Observer role required.', 'error');
        return;
      }
      window.ClockAuth.showScreen('admin');
      // Load the default tab based on role
      var session = window.ClockAuth.getSession();
      if (session && session.role === 'observer') {
        window.ClockAdminRoster.load();
      } else {
        loadAdminStaff();
      }
    });
  }

  function initAdminBack() {
    var btn = document.getElementById('admin-back-btn');
    if (!btn) return;
    btn.addEventListener('click', function() {
      window.ClockAuth.showScreen('app');
    });
  }

  // ===== Admin Tabs =====

  var tabsInitialized = false;

  function initAdminTabs() {
    // Show/hide tabs based on role (always refresh)
    var session = window.ClockAuth ? window.ClockAuth.getSession() : null;
    var role = session ? session.role : null;
    var isObserverUser = role === 'observer';

    // First, show all tabs (reset from any previous observer hiding)
    document.querySelectorAll('.admin-tab').forEach(function(tab) {
      tab.style.display = '';
    });

    if (isObserverUser) {
      // Hide Staff, Timesheets, Audit tabs for observers
      document.querySelectorAll('.admin-tab[data-tab="staff"], .admin-tab[data-tab="timesheets"], .admin-tab[data-tab="audit"]').forEach(function(tab) {
        tab.style.display = 'none';
      });
      // Hide Staff, Timesheets, Audit content panels
      var staffTab = document.getElementById('admin-staff-tab');
      if (staffTab) staffTab.classList.add('hidden');
      var tsTab = document.getElementById('admin-timesheets-tab');
      if (tsTab) tsTab.classList.add('hidden');
      var auditTab = document.getElementById('admin-audit-tab');
      if (auditTab) auditTab.classList.add('hidden');
      // Show Roster tab content
      var rosterTab = document.getElementById('admin-roster-tab');
      if (rosterTab) rosterTab.classList.remove('hidden');
      // Make the Roster tab active
      document.querySelectorAll('.admin-tab').forEach(function(t) {
        t.classList.remove('active');
        t.className = 'admin-tab flex-1 py-2 px-3 bg-gray-200 text-gray-800 rounded text-sm whitespace-nowrap';
      });
      var rosterTabBtn = document.querySelector('.admin-tab[data-tab="roster"]');
      if (rosterTabBtn) {
        rosterTabBtn.classList.add('active');
        rosterTabBtn.className = 'admin-tab active flex-1 py-2 px-3 bg-gray-800 text-white rounded text-sm whitespace-nowrap';
      }
      // Hide Add Staff button for observers
      var addStaffBtn = document.getElementById('add-staff-btn');
      if (addStaffBtn) addStaffBtn.classList.add('hidden');
    }

    // Only bind click handlers once
    if (tabsInitialized) return;
    tabsInitialized = true;

    document.querySelectorAll('.admin-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        var tabName = tab.dataset.tab;

        document.querySelectorAll('.admin-tab').forEach(function(t) {
          t.classList.remove('active');
          t.className = 'admin-tab flex-1 py-2 px-3 bg-gray-200 text-gray-800 rounded text-sm whitespace-nowrap';
        });
        tab.classList.add('active');
        tab.className = 'admin-tab active flex-1 py-2 px-3 bg-gray-800 text-white rounded text-sm whitespace-nowrap';

        document.querySelectorAll('.admin-tab-content').forEach(function(content) {
          content.classList.add('hidden');
        });
        var contentEl = document.getElementById('admin-' + tabName + '-tab');
        if (contentEl) contentEl.classList.remove('hidden');

        if (tabName === 'staff') loadAdminStaff();
        else if (tabName === 'timesheets') window.ClockAdminTimesheet.load();
        else if (tabName === 'roster') window.ClockAdminRoster.load();
        else if (tabName === 'audit') loadAdminAudit();
      });
    });
  }

  // ===== Staff Management =====

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
      showToast(error.message || 'Failed to load staff list.', 'error');
    } finally {
      isLoadingStaff = false;
    }
  }

  function createStaffCard(staff) {
    var card = document.createElement('div');
    card.className = 'staff-card' + (staff.active ? '' : ' inactive');

    var roleBadge = staff.role === 'admin'
      ? '<span class="text-xs bg-gray-800 text-white px-2 py-1 rounded">Admin</span>'
      : staff.role === 'observer'
      ? '<span class="text-xs bg-purple-100 text-purple-800 px-2 py-1 rounded">Observer</span>'
      : '<span class="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">Staff</span>';

    var statusBadge = staff.active
      ? '<span class="text-xs text-green-600">\u25CF Active</span>'
      : '<span class="text-xs text-gray-500">\u25CF Inactive</span>';

    var expectedTimeBadge = '';
    if (staff.expected_start_time || staff.expected_end_time) {
      var startLabel = staff.expected_start_time ? escapeHtml(staff.expected_start_time.slice(0, 5)) : '?';
      var endLabel = staff.expected_end_time ? escapeHtml(staff.expected_end_time.slice(0, 5)) : '?';
      expectedTimeBadge = '<span class="text-xs text-blue-600 font-semibold">\uD83D\uDD52 ' + startLabel + ' \u2014 ' + endLabel + '</span>';
    }

    var lockBadge = staff.locked_until
      ? '<span class="text-xs text-red-600 font-semibold">\uD83D\uDD12 Locked until ' + escapeHtml(staff.locked_until.slice(0, 16).replace('T', ' ')) + '</span>'
      : '';

    card.innerHTML = '<div class="staff-info">' +
        '<div class="flex items-center gap-2 mb-1">' +
          '<span class="font-semibold text-gray-800">' + escapeHtml(staff.name) + '</span>' +
          roleBadge +
        '</div>' +
        '<div class="text-sm text-gray-500">' + statusBadge + (expectedTimeBadge ? ' \u2022 ' + expectedTimeBadge : '') + (lockBadge ? ' \u2022 ' + lockBadge : '') + '</div>' +
      '</div>' +
      '<div class="staff-actions">' +
        '<button class="btn-edit" data-action="edit" data-staff-id="' + staff.id + '">\u270F\uFE0F</button>' +
        (staff.active ? '<button class="btn-delete" data-action="deactivate" data-staff-id="' + staff.id + '">\uD83D\uDEAB</button>' : '') +
        (staff.locked_until ? '<button class="btn-unlock" data-action="unlock" data-staff-id="' + staff.id + '">\uD83D\uDD13</button>' : '') +
      '</div>';

    card.querySelectorAll('button').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var action = btn.dataset.action;
        var staffId = btn.dataset.staffId;
        var staffRecord = currentStaffList.find(function(s) { return s.id === staffId; });

        if (action === 'edit') openStaffModal(staffRecord);
        else if (action === 'deactivate') confirmDeactivate(staffRecord);
        else if (action === 'unlock') confirmUnlock(staffRecord);
      });
    });

    return card;
  }

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
      document.getElementById('staff-expected-start-input').value = staff.expected_start_time || '';
      document.getElementById('staff-expected-end-input').value = staff.expected_end_time || '';
    } else {
      title.textContent = 'Add Staff';
      document.getElementById('staff-id').value = '';
      document.getElementById('staff-pin-input').value = '';
      document.getElementById('staff-pin-input').placeholder = '4-6 digits';
      document.getElementById('staff-role-input').value = 'staff';
      document.getElementById('staff-active-input').checked = true;
      document.getElementById('staff-expected-start-input').value = '';
      document.getElementById('staff-expected-end-input').value = '';
    }

    modal.classList.remove('hidden');
  }

  function confirmDeactivate(staff) {
    if (!staff) return;
    var msg = 'Deactivate ' + escapeHtml(staff.name) + '?\n\nTheir shift history will be preserved, but they will no longer be able to log in.';
    if (window.confirm(msg)) {
      deactivateStaffMember(staff.id);
    }
  }

  function confirmUnlock(staff) {
    if (!staff) return;
    var msg = 'Unlock ' + escapeHtml(staff.name) + '\'s account?\n\nThis resets failed login attempts and removes the lockout.';
    if (window.confirm(msg)) {
      unlockStaffMember(staff.id);
    }
  }

  async function unlockStaffMember(staffId) {
    try {
      await window.ClockDB.unlockStaff(staffId);
      showToast('Staff member unlocked.', 'success');
      loadAdminStaff();
    } catch (error) {
      console.error('Failed to unlock staff:', error);
      showToast(error.message || 'Failed to unlock staff.', 'error');
    }
  }

  async function deactivateStaffMember(staffId) {
    try {
      await window.ClockDB.deactivateStaff(staffId);
      showToast('Staff member deactivated.', 'success');
      loadAdminStaff();
    } catch (error) {
      console.error('Failed to deactivate staff:', error);
      showToast(error.message || 'Failed to deactivate staff.', 'error');
    }
  }

  function initStaffModal() {
    var addBtn = document.getElementById('add-staff-btn');
    var cancelBtn = document.getElementById('staff-modal-cancel');
    var form = document.getElementById('staff-form');
    var overlay = document.querySelector('#staff-modal .modal-overlay');

    if (addBtn) addBtn.addEventListener('click', function() { openStaffModal(null); });
    if (cancelBtn) cancelBtn.addEventListener('click', hideStaffModal);
    if (overlay) overlay.addEventListener('click', hideStaffModal);
    if (form) {
      form.addEventListener('submit', function(e) {
        e.preventDefault();
        submitStaffForm();
      });
    }

    function hideStaffModal() {
      var modal = document.getElementById('staff-modal');
      if (modal) modal.classList.add('hidden');
    }
  }

  var isSubmittingStaff = false;

  async function submitStaffForm() {
    if (isSubmittingStaff) return;
    isSubmittingStaff = true;

    var staffId = document.getElementById('staff-id').value;
    var name = document.getElementById('staff-name-input').value.trim();
    var pin = document.getElementById('staff-pin-input').value.trim();
    var role = document.getElementById('staff-role-input').value;
    var active = document.getElementById('staff-active-input').checked;
    var expectedStart = document.getElementById('staff-expected-start-input').value || null;
    var expectedEnd = document.getElementById('staff-expected-end-input').value || null;

    if (!name) {
      showToast('Name is required.', 'error');
      isSubmittingStaff = false;
      return;
    }

    if (!staffId) {
      if (!pin || pin.length < 4 || pin.length > 6 || !/^\d+$/.test(pin)) {
        showToast('PIN must be 4-6 digits.', 'error');
        isSubmittingStaff = false;
        return;
      }
    }

    try {
      var staffData = {
        name: name,
        role: role,
        active: active,
        expectedStartTime: expectedStart,
        expectedEndTime: expectedEnd
      };
      if (pin) staffData.pin = pin;

      if (staffId) {
        await window.ClockDB.updateStaff(staffId, staffData);
        showToast('Staff updated.', 'success');
      } else {
        await window.ClockDB.createStaff(staffData);
        showToast('Staff member added.', 'success');
      }

      document.getElementById('staff-modal').classList.add('hidden');
      loadAdminStaff();
    } catch (error) {
      console.error('Failed to save staff:', error);
      showToast(error.message || 'Failed to save staff.', 'error');
    } finally {
      isSubmittingStaff = false;
    }
  }

  // ===== Audit Log =====

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
      showToast(error.message || 'Failed to load audit log.', 'error');
    } finally {
      isLoadingAudit = false;
    }
  }

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

  function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(text).replace(/[&<>"']/g, function(m) { return map[m]; });
  }

  function showToast(message, type) {
    if (window.ClockApp && window.ClockApp.showToast) {
      window.ClockApp.showToast(message, type);
    }
  }

  // ===== Main Initialisation =====

  function initAdmin() {
    // Always refresh tab visibility (role may change between logins)
    initAdminTabs();

    if (adminInitialized) return;
    adminInitialized = true;

    initAdminButton();
    initAdminBack();
    initStaffModal();

    // Delegate to timesheet and roster modules
    if (window.ClockAdminTimesheet) {
      window.ClockAdminTimesheet.initControls();
      window.ClockAdminTimesheet.initShiftEditModal();
    }
    if (window.ClockAdminRoster) {
      window.ClockAdminRoster.initControls();
    }
  }

  // ===== Expose globally =====
  window.ClockAdmin = {
    initAdmin: initAdmin,
    loadAdminStaff: loadAdminStaff,
    loadAdminTimesheets: function() {
      if (window.ClockAdminTimesheet) window.ClockAdminTimesheet.load();
    },
    loadAdminRoster: function() {
      if (window.ClockAdminRoster) window.ClockAdminRoster.load();
    },
    loadAdminAudit: loadAdminAudit,
    setDateFilter: function(filter) {
      if (window.ClockAdminTimesheet) window.ClockAdminTimesheet.setDateFilter(filter);
    },
    getDateFilter: function() {
      return window.ClockAdminTimesheet ? window.ClockAdminTimesheet.getDateFilter() : 'last7';
    }
  };
})();
