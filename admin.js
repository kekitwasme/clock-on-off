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

  // ===== Date Filter State =====
  var currentDateFilter = 'last7'; // 'today' | 'yesterday' | 'last7' | 'last30' | 'custom'
  var customStartDate = null;
  var customEndDate = null;

  // ===== Timesheet View State =====
  var currentTimesheetView = 'date'; // 'date' | 'staff'

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
        else if (tabName === 'roster') loadAdminRoster();
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

    var expectedTimeBadge = '';
    if (staff.expected_start_time || staff.expected_end_time) {
      var startLabel = staff.expected_start_time ? escapeHtml(staff.expected_start_time.slice(0, 5)) : '?';
      var endLabel = staff.expected_end_time ? escapeHtml(staff.expected_end_time.slice(0, 5)) : '?';
      expectedTimeBadge = '<span class="text-xs text-blue-600 font-semibold">🕒 ' + startLabel + ' — ' + endLabel + '</span>';
    }

    var lockBadge = staff.locked_until ? '<span class="text-xs text-red-600 font-semibold">🔒 Locked until ' + escapeHtml(staff.locked_until.slice(0, 16).replace('T', ' ')) + '</span>' : '';

    card.innerHTML = '<div class="staff-info">' +
        '<div class="flex items-center gap-2 mb-1">' +
          '<span class="font-semibold text-gray-800">' + escapeHtml(staff.name) + '</span>' +
          roleBadge +
        '</div>' +
        '<div class="text-sm text-gray-500">' + statusBadge + (expectedTimeBadge ? ' • ' + expectedTimeBadge : '') + (lockBadge ? ' • ' + lockBadge : '') + '</div>' +
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
    var expectedStart = document.getElementById('staff-expected-start-input').value || null;
    var expectedEnd = document.getElementById('staff-expected-end-input').value || null;

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
      var staffData = { name: name, role: role, active: active, expectedStartTime: expectedStart, expectedEndTime: expectedEnd };
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

  // ===== Date Grouping Helper =====

  /**
   * Group shifts by calendar date (YYYY-MM-DD).
   * Returns a sorted array of { dateKey, dateLabel, staffCount, totalHours, shifts }.
   * Active shifts (in progress) are counted in staffCount but not totalHours.
   * @param {Array} shifts
   * @returns {Array}
   */
  function groupShiftsByDate(shifts) {
    if (!shifts || shifts.length === 0) return [];

    var groups = {};
    shifts.forEach(function(shift) {
      var dateKey = shift.clock_in ? shift.clock_in.slice(0, 10) : 'Unknown';
      if (!groups[dateKey]) {
        groups[dateKey] = {
          dateKey: dateKey,
          shifts: [],
          staffCount: 0,
          totalHours: 0
        };
      }
      groups[dateKey].shifts.push(shift);
      groups[dateKey].staffCount += 1;

      // Only add to total hours if shift is completed (has clock_out)
      if (shift.clock_out) {
        var durationMs = window.ClockDB.calculateDuration(shift.clock_in, shift.clock_out);
        groups[dateKey].totalHours += durationMs / (1000 * 60 * 60); // convert to hours
      }
    });

    // Convert to array and sort by date descending (newest first)
    var result = Object.values(groups);
    result.sort(function(a, b) {
      if (a.dateKey === 'Unknown') return 1;
      if (b.dateKey === 'Unknown') return -1;
      return b.dateKey.localeCompare(a.dateKey);
    });

    // Format date label for each group
    result.forEach(function(group) {
      if (group.dateKey === 'Unknown') {
        group.dateLabel = 'Unknown Date';
      } else {
        var date = new Date(group.dateKey + 'T00:00:00');
        var today = new Date();
        today.setHours(0, 0, 0, 0);
        var yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        var dayDiff = Math.round((today - date) / (1000 * 60 * 60 * 24));

        var options = { weekday: 'short', day: 'numeric', month: 'short' };
        var dateStr = date.toLocaleDateString('en-AU', options);

        if (dayDiff === 0) {
          group.dateLabel = 'Today, ' + dateStr;
        } else if (dayDiff === 1) {
          group.dateLabel = 'Yesterday, ' + dateStr;
        } else {
          group.dateLabel = dateStr;
        }
      }
      // Round total hours to 1 decimal
      group.totalHoursStr = Math.round(group.totalHours * 10) / 10;
    });

    return result;
  }

  // ===== Date Filter Helpers =====

  /**
   * Get the date range for the current filter.
   * @returns {{startDate: string|null, endDate: string|null}}
   */
  function getDateRangeForFilter() {
    var now = new Date();
    var start = new Date(now);
    var end = new Date(now);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    switch (currentDateFilter) {
      case 'today':
        break;
      case 'yesterday':
        start.setDate(start.getDate() - 1);
        end.setDate(end.getDate() - 1);
        break;
      case 'last7':
        start.setDate(start.getDate() - 6);
        break;
      case 'last30':
        start.setDate(start.getDate() - 29);
        break;
      case 'custom':
        if (customStartDate) {
          start = new Date(customStartDate);
          start.setHours(0, 0, 0, 0);
        }
        if (customEndDate) {
          end = new Date(customEndDate);
          end.setHours(23, 59, 59, 999);
        }
        break;
    }

    return {
      startDate: start.toISOString(),
      endDate: end.toISOString()
    };
  }

  /**
   * Build and inject the date filter bar into the timesheets tab.
   */
  function buildDateFilterBar() {
    var container = document.getElementById('timesheets-list');
    if (!container) return;

    // Check if filter bar already exists
    var existingBar = document.getElementById('date-filter-bar');
    if (existingBar) existingBar.remove();

    var bar = document.createElement('div');
    bar.id = 'date-filter-bar';
    bar.className = 'filter-bar';

    var pills = [
      { key: 'today', label: 'Today' },
      { key: 'yesterday', label: 'Yesterday' },
      { key: 'last7', label: 'Last 7 days' },
      { key: 'last30', label: 'Last 30 days' },
      { key: 'custom', label: 'Custom' }
    ];

    pills.forEach(function(pill) {
      var btn = document.createElement('button');
      btn.className = 'filter-pill' + (currentDateFilter === pill.key ? ' filter-pill-active' : '');
      btn.textContent = pill.label;
      btn.dataset.filter = pill.key;
      btn.addEventListener('click', function() {
        onDateFilterChange(pill.key);
      });
      bar.appendChild(btn);
    });

    // Custom date inputs container
    var customContainer = document.createElement('div');
    customContainer.id = 'custom-date-container';
    customContainer.className = 'flex gap-2 mt-2' + (currentDateFilter === 'custom' ? '' : ' hidden');

    var startInput = document.createElement('input');
    startInput.type = 'date';
    startInput.id = 'custom-start-date';
    startInput.className = 'flex-1 p-2 border border-gray-300 rounded text-sm';
    startInput.value = customStartDate || '';
    startInput.addEventListener('change', function() {
      customStartDate = startInput.value || null;
      if (customStartDate && customEndDate) {
        loadAdminTimesheets();
      }
    });

    var endInput = document.createElement('input');
    endInput.type = 'date';
    endInput.id = 'custom-end-date';
    endInput.className = 'flex-1 p-2 border border-gray-300 rounded text-sm';
    endInput.value = customEndDate || '';
    endInput.addEventListener('change', function() {
      customEndDate = endInput.value || null;
      if (customStartDate && customEndDate) {
        loadAdminTimesheets();
      }
    });

    customContainer.appendChild(startInput);
    customContainer.appendChild(endInput);

    // Insert before the timesheets list
    container.parentNode.insertBefore(bar, container);
    container.parentNode.insertBefore(customContainer, container);
  }

  /**
   * Handle date filter pill click.
   * @param {string} filter
   */
  function onDateFilterChange(filter) {
    currentDateFilter = filter;

    // Update pill active states
    document.querySelectorAll('#date-filter-bar .filter-pill').forEach(function(btn) {
      if (btn.dataset.filter === filter) {
        btn.classList.add('filter-pill-active');
      } else {
        btn.classList.remove('filter-pill-active');
      }
    });

    // Show/hide custom date inputs
    var customContainer = document.getElementById('custom-date-container');
    if (customContainer) {
      if (filter === 'custom') {
        customContainer.classList.remove('hidden');
      } else {
        customContainer.classList.add('hidden');
      }
    }

    loadAdminTimesheets();
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

    // Ensure filter bar is built
    buildDateFilterBar();

    timesheetsList.innerHTML = '<div class="loading-spinner"></div><p class="text-center text-gray-600 mt-2">Loading...</p>';

    try {
      var filters = {};
      if (staffFilter && staffFilter.value) filters.staffId = staffFilter.value;

      var dateRange = getDateRangeForFilter();
      filters.startDate = dateRange.startDate;
      filters.endDate = dateRange.endDate;

      currentTimesheets = await window.ClockDB.getAllShifts(filters);

      if (!currentTimesheets || currentTimesheets.length === 0) {
        timesheetsList.innerHTML = '<p class="text-center text-gray-500 py-4">No shifts found.</p>';
        isLoadingTimesheets = false;
        return;
      }

      if (currentTimesheetView === 'staff') {
        renderTimesheetsByStaff(currentTimesheets);
      } else {
        renderTimesheets(currentTimesheets);
      }
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
   * Render the timesheet cards grouped by date into the list container.
   * @param {Array} shifts
   */
  function renderTimesheets(shifts) {
    var timesheetsList = document.getElementById('timesheets-list');
    if (!timesheetsList) return;
    timesheetsList.innerHTML = '';

    var grouped = groupShiftsByDate(shifts);

    if (grouped.length === 0) {
      timesheetsList.innerHTML = '<p class="text-center text-gray-500 py-4">No shifts found.</p>';
      return;
    }

    grouped.forEach(function(group, index) {
      var dateGroup = document.createElement('div');
      dateGroup.className = 'date-group';

      // Create header
      var header = document.createElement('div');
      header.className = 'date-group-header';
      header.innerHTML =
        '<div class="date-group-title">' + escapeHtml(group.dateLabel) + '</div>' +
        '<div class="date-group-meta">' +
          '<span>' + group.staffCount + (group.staffCount === 1 ? ' staff' : ' staff') + '</span>' +
          '<span>•</span>' +
          '<span>' + group.totalHoursStr + (group.totalHoursStr === 1 ? ' hr' : ' hrs') + '</span>' +
        '</div>';

      // Add collapse/expand on click
      header.addEventListener('click', function() {
        dateGroup.classList.toggle('date-group-collapsed');
      });

      // Create content container
      var content = document.createElement('div');
      content.className = 'date-group-content';

      group.shifts.forEach(function(shift) {
        content.appendChild(createTimesheetCard(shift));
      });

      dateGroup.appendChild(header);
      dateGroup.appendChild(content);
      timesheetsList.appendChild(dateGroup);
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

    var lateEarlyBadge = '';
    if (shift.staff && !isActive) {
      var staffExpectedStart = shift.staff.expected_start_time;
      var staffExpectedEnd = shift.staff.expected_end_time;
      var lateEarly = [];
      if (staffExpectedStart) {
        var startAlert = checkLateEarlyForShift(shift.clock_in, staffExpectedStart);
        if (startAlert) lateEarly.push(startAlert);
      }
      if (staffExpectedEnd && shift.clock_out) {
        var endAlert = checkLateEarlyForShift(shift.clock_out, staffExpectedEnd);
        if (endAlert) lateEarly.push(endAlert);
      }
      if (lateEarly.length > 0) {
        var isCritical = lateEarly.some(function(a) { return a.critical; });
        card.classList.add(isCritical ? 'border-orange-400' : 'border-yellow-400');
        card.classList.add('border-2');
        lateEarlyBadge = '<div class="flex flex-wrap gap-1 mt-2">' +
          lateEarly.map(function(a) {
            return '<span class="' + (a.critical ? 'late-badge-critical' : 'late-badge') + '">' + escapeHtml(a.message) + '</span>';
          }).join('') +
        '</div>';
      }
    }

    card.innerHTML = '<div class="timesheet-row-header">' +
        '<span class="font-semibold text-gray-800">' + staffName + '</span>' +
        '<span class="text-sm ' + (isActive ? 'text-green-600' : 'text-gray-500') + '">' + dateStr + '</span>' +
      '</div>' +
      '<div class="timesheet-row-times">' +
        '<span><span class="text-green-600">' + clockInStr + '</span> → <span class="' + (isActive ? 'text-orange-600' : 'text-red-600') + '">' + clockOutStr + '</span></span>' +
        '<span class="shift-duration">' + duration + '</span>' +
      '</div>' +
      adjustedBadges.join('') +
      lateEarlyBadge +
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
    var viewDateBtn = document.getElementById('timesheet-view-date');
    var viewStaffBtn = document.getElementById('timesheet-view-staff');

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
    if (viewDateBtn) {
      viewDateBtn.addEventListener('click', function() {
        currentTimesheetView = 'date';
        updateViewToggleButtons();
        renderTimesheets(currentTimesheets);
      });
    }
    if (viewStaffBtn) {
      viewStaffBtn.addEventListener('click', function() {
        currentTimesheetView = 'staff';
        updateViewToggleButtons();
        renderTimesheetsByStaff(currentTimesheets);
      });
    }
  }

  function updateViewToggleButtons() {
    var viewDateBtn = document.getElementById('timesheet-view-date');
    var viewStaffBtn = document.getElementById('timesheet-view-staff');
    if (viewDateBtn) {
      viewDateBtn.classList.toggle('bg-blue-600', currentTimesheetView === 'date');
      viewDateBtn.classList.toggle('bg-gray-200', currentTimesheetView !== 'date');
      viewDateBtn.classList.toggle('text-white', currentTimesheetView === 'date');
      viewDateBtn.classList.toggle('text-gray-800', currentTimesheetView !== 'date');
    }
    if (viewStaffBtn) {
      viewStaffBtn.classList.toggle('bg-blue-600', currentTimesheetView === 'staff');
      viewStaffBtn.classList.toggle('bg-gray-200', currentTimesheetView !== 'staff');
      viewStaffBtn.classList.toggle('text-white', currentTimesheetView === 'staff');
      viewStaffBtn.classList.toggle('text-gray-800', currentTimesheetView !== 'staff');
    }
  }

  // ===== Date Filter Helpers (exposed for external use) =====

  /**
   * Set the current date filter programmatically.
   * @param {string} filter
   */
  function setDateFilter(filter) {
    currentDateFilter = filter;
    onDateFilterChange(filter);
  }

  /**
   * Get the current date filter.
   * @returns {string}
   */
  function getDateFilter() {
    return currentDateFilter;
  }

  // ===== Staff-Centric Timesheet View =====

  /**
   * Group shifts by staff member for the "By Staff" view.
   * @param {Array} shifts
   * @returns {Array} — [{ staff, shifts: [], totalHours, lateCount, earlyCount, missedCount }]
   */
  function groupShiftsByStaff(shifts) {
    var staffMap = {};

    shifts.forEach(function(shift) {
      var staffId = shift.staff_id || (shift.staff && shift.staff.id);
      var staffName = shift.staff && shift.staff.name ? shift.staff.name : 'Unknown';
      if (!staffId) return;

      if (!staffMap[staffId]) {
        staffMap[staffId] = {
          staff: shift.staff || { id: staffId, name: staffName },
          shifts: [],
          totalMinutes: 0,
          adjustedCount: 0,
          lateCount: 0,
          earlyCount: 0
        };
      }

      staffMap[staffId].shifts.push(shift);

      if (shift.clock_out) {
        var mins = Math.round(window.ClockDB.calculateDuration(shift.clock_in, shift.clock_out) / 60000);
        staffMap[staffId].totalMinutes += mins;
      }

      if (shift.clock_in_adjusted || shift.clock_out_adjusted) {
        staffMap[staffId].adjustedCount++;
      }

      // Check late/early
      if (shift.staff && !shift.clock_out) return; // skip active shifts
      var expectedStart = shift.staff && shift.staff.expected_start_time;
      var expectedEnd = shift.staff && shift.staff.expected_end_time;
      if (expectedStart) {
        var startAlert = checkLateEarlyForShift(shift.clock_in, expectedStart);
        if (startAlert) {
          if (startAlert.critical) staffMap[staffId].lateCount++;
        }
      }
      if (expectedEnd && shift.clock_out) {
        var endAlert = checkLateEarlyForShift(shift.clock_out, expectedEnd);
        if (endAlert) {
          if (endAlert.critical) staffMap[staffId].earlyCount++;
        }
      }
    });

    return Object.values(staffMap).sort(function(a, b) {
      return a.staff.name.localeCompare(b.staff.name);
    });
  }

  /**
   * Render timesheets grouped by staff member.
   * @param {Array} shifts
   */
  function renderTimesheetsByStaff(shifts) {
    var timesheetsList = document.getElementById('timesheets-list');
    var payrollDiv = document.getElementById('payroll-summary');
    var payrollContent = document.getElementById('payroll-summary-content');
    if (!timesheetsList) return;
    timesheetsList.innerHTML = '';

    if (payrollDiv) payrollDiv.classList.remove('hidden');

    var grouped = groupShiftsByStaff(shifts);

    if (grouped.length === 0) {
      timesheetsList.innerHTML = '<p class="text-center text-gray-500 py-4">No shifts found.</p>';
      if (payrollDiv) payrollDiv.classList.add('hidden');
      return;
    }

    // Build payroll summary table
    if (payrollContent) {
      var table = document.createElement('table');
      table.className = 'w-full text-sm';
      table.innerHTML =
        '<thead><tr class="bg-gray-100">' +
        '<th class="p-2 text-left">Staff</th>' +
        '<th class="p-2 text-right">Total Hrs</th>' +
        '<th class="p-2 text-right">Late</th>' +
        '<th class="p-2 text-right">Early</th>' +
        '<th class="p-2 text-right">Adjusted</th>' +
        '<th class="p-2 text-right">Shifts</th>' +
        '</tr></thead>';
      var tbody = document.createElement('tbody');
      grouped.forEach(function(group) {
        var hours = (group.totalMinutes / 60).toFixed(1);
        var tr = document.createElement('tr');
        tr.className = 'border-b';
        tr.innerHTML =
          '<td class="p-2 font-semibold">' + escapeHtml(group.staff.name) + '</td>' +
          '<td class="p-2 text-right">' + hours + '</td>' +
          '<td class="p-2 text-right ' + (group.lateCount > 0 ? 'text-orange-600' : 'text-gray-400') + '"'>' + group.lateCount + '</td>' +
          '<td class="p-2 text-right ' + (group.earlyCount > 0 ? 'text-orange-600' : 'text-gray-400') + '"'>' + group.earlyCount + '</td>' +
          '<td class="p-2 text-right ' + (group.adjustedCount > 0 ? 'text-blue-600' : 'text-gray-400') + '"'>' + group.adjustedCount + '</td>' +
          '<td class="p-2 text-right">' + group.shifts.length + '</td>';
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      payrollContent.innerHTML = '';
      payrollContent.appendChild(table);
    }

    // Build staff cards
    grouped.forEach(function(group) {
      var card = document.createElement('div');
      card.className = 'staff-timesheet-card';

      var hours = (group.totalMinutes / 60).toFixed(1);
      var badges = [];
      if (group.lateCount > 0) badges.push('<span class="badge-late">⚠️ ' + group.lateCount + ' late</span>');
      if (group.earlyCount > 0) badges.push('<span class="badge-early">🚪 ' + group.earlyCount + ' early</span>');
      if (group.adjustedCount > 0) badges.push('<span class="badge-adjusted">📝 ' + group.adjustedCount + ' adjusted</span>');

      card.innerHTML =
        '<div class="staff-timesheet-header">' +
          '<div class="staff-timesheet-name">' + escapeHtml(group.staff.name) + '</div>' +
          '<div class="staff-timesheet-total">' + hours + ' hrs</div>' +
        '</div>' +
        '<div class="staff-timesheet-badges">' + badges.join('') + '</div>';

      // Build shift table
      var table = document.createElement('table');
      table.className = 'staff-timesheet-table';
      table.innerHTML =
        '<thead><tr>' +
        '<th>Date</th><th>Clock In</th><th>Clock Out</th><th>Duration</th><th>Status</th><th></th>' +
        '</tr></thead>';
      var tbody = document.createElement('tbody');

      // Sort shifts by date
      group.shifts.sort(function(a, b) {
        return new Date(a.clock_in) - new Date(b.clock_in);
      });

      group.shifts.forEach(function(shift) {
        var dateStr = window.ClockDB.formatDate(shift.clock_in);
        var clockInStr = window.ClockDB.formatTime(shift.clock_in);
        var clockOutStr = shift.clock_out ? window.ClockDB.formatTime(shift.clock_out) : '--';
        var duration = shift.clock_out
          ? window.ClockDB.formatDuration(window.ClockDB.calculateDuration(shift.clock_in, shift.clock_out))
          : 'Active';

        // Determine status
        var status = '<span class="status-ok">✅</span>';
        if (!shift.clock_out) {
          status = '<span class="status-active">🟢 Active</span>';
        } else if (shift.clock_in_adjusted || shift.clock_out_adjusted) {
          status = '<span class="status-adjusted">📝 Adj</span>';
        } else {
          var startAlert = checkLateEarlyForShift(shift.clock_in, shift.staff && shift.staff.expected_start_time);
          var endAlert = shift.clock_out ? checkLateEarlyForShift(shift.clock_out, shift.staff && shift.staff.expected_end_time) : null;
          if (startAlert && startAlert.critical) status = '<span class="status-late">⚠️ Late</span>';
          else if (endAlert && endAlert.critical) status = '<span class="status-early">🚪 Early</span>';
        }

        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td>' + dateStr + '</td>' +
          '<td>' + clockInStr + '</td>' +
          '<td>' + clockOutStr + '</td>' +
          '<td>' + duration + '</td>' +
          '<td>' + status + '</td>' +
          '<td><button class="btn-edit-sm" data-shift-id="' + shift.id + '"">✏️</button></td>';

        var editBtn = tr.querySelector('.btn-edit-sm');
        if (editBtn) {
          editBtn.addEventListener('click', function() {
            openShiftModal(shift);
          });
        }

        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      card.appendChild(table);
      timesheetsList.appendChild(card);
    });
  }

  // ===== Payroll Export =====

  /**
   * Export timesheets in payroll-friendly format (staff summary).
   */
  function exportTimesheetsPayrollCSV() {
    if (!currentTimesheets || currentTimesheets.length === 0) {
      if (window.ClockApp) window.ClockApp.showToast('No timesheets to export.', 'error');
      return;
    }

    var grouped = groupShiftsByStaff(currentTimesheets);

    var headers = ['Staff', 'Total_Hours', 'Late_Count', 'Early_Count', 'Adjusted_Count', 'Shift_Count'];
    var csvLines = [headers.join(',')];

    grouped.forEach(function(group) {
      var hours = (group.totalMinutes / 60).toFixed(1);
      csvLines.push([
        group.staff.name,
        hours,
        group.lateCount,
        group.earlyCount,
        group.adjustedCount,
        group.shifts.length
      ].map(window.ClockDB.csvEscape).join(','));
    });

    var csvContent = csvLines.join('\r\n');
    var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'payroll_summary_' + new Date().toISOString().split('T')[0] + '.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    if (window.ClockApp) {
      window.ClockApp.showToast('Exported payroll summary for ' + grouped.length + ' staff.', 'success');
    }
  }

  /**
   * Export timesheets — asks which format.
   */
  function exportTimesheetsCSV() {
    if (currentTimesheetView === 'staff') {
      exportTimesheetsPayrollCSV();
    } else {
      exportTimesheetsDetailCSV();
    }
  }

  /**
   * Export detailed timesheets (by date) to CSV.
   */
  function exportTimesheetsDetailCSV() {
    if (!currentTimesheets || currentTimesheets.length === 0) {
      if (window.ClockApp) window.ClockApp.showToast('No timesheets to export.', 'error');
      return;
    }

    var grouped = groupShiftsByDate(currentTimesheets);

    var headers = [
      'staff_name', 'date', 'clock_in', 'clock_out',
      'duration_minutes', 'clock_in_adjusted', 'clock_out_adjusted', 'notes'
    ];

    var csvLines = [headers.join(',')];

    grouped.forEach(function(group) {
      // Date group header row
      csvLines.push([
        'DATE: ' + group.dateLabel,
        group.dateKey,
        '',
        '',
        '',
        '',
        '',
        group.staffCount + ' staff, ' + group.totalHoursStr + ' hrs'
      ].map(window.ClockDB.csvEscape).join(','));

      // Individual shift rows
      group.shifts.forEach(function(shift) {
        var duration = shift.clock_out
          ? Math.round(window.ClockDB.calculateDuration(shift.clock_in, shift.clock_out) / 60000)
          : '';

        csvLines.push([
          shift.staff && shift.staff.name ? shift.staff.name : 'Unknown',
          window.ClockDB.formatDate(shift.clock_in),
          window.ClockDB.formatDateTime(shift.clock_in),
          shift.clock_out ? window.ClockDB.formatDateTime(shift.clock_out) : '',
          duration,
          shift.clock_in_adjusted ? 'Yes' : 'No',
          shift.clock_out_adjusted ? 'Yes' : 'No',
          (shift.notes || '').replace(/"/g, '""')
        ].map(window.ClockDB.csvEscape).join(','));
      });

      // Subtotal row
      csvLines.push([
        'SUBTOTAL',
        group.dateKey,
        '',
        '',
        Math.round(group.totalHours * 60), // total minutes
        '',
        '',
        group.staffCount + ' shifts, ' + group.totalHoursStr + ' hours'
      ].map(window.ClockDB.csvEscape).join(','));

      // Blank separator row
      csvLines.push(['', '', '', '', '', '', '', ''].join(','));
    });

    var csvContent = csvLines.join('\r\n');
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

  // ===== Late/Early Badge Helper =====

  /**
   * Check if a shift time is late/early compared to expected time.
   * @param {string} actualISO — ISO timestamp of actual clock time
   * @param {string} expectedTime — "HH:MM" expected time
   * @returns {object|null} — { message, critical } or null
   */
  function checkLateEarlyForShift(actualISO, expectedTime) {
    if (!expectedTime || typeof expectedTime !== 'string') return null;

    var actual = new Date(actualISO);
    var parts = expectedTime.split(':');
    if (parts.length !== 2) return null;

    var expHours = parseInt(parts[0], 10);
    var expMinutes = parseInt(parts[1], 10);
    if (isNaN(expHours) || isNaN(expMinutes)) return null;

    var expected = new Date(actual);
    expected.setHours(expHours, expMinutes, 0, 0);

    var diffMs = actual.getTime() - expected.getTime();
    // Handle midnight crossing
    if (diffMs > 12 * 3600 * 1000) {
      expected.setDate(expected.getDate() + 1);
      diffMs = actual.getTime() - expected.getTime();
    } else if (diffMs < -12 * 3600 * 1000) {
      expected.setDate(expected.getDate() - 1);
      diffMs = actual.getTime() - expected.getTime();
    }

    var diffMinutes = Math.round(diffMs / 60000);
    var absMinutes = Math.abs(diffMinutes);

    if (absMinutes <= 15) return null;

    var lateEarly = diffMinutes > 0 ? 'late' : 'early';
    var critical = absMinutes > 30;
    var message = absMinutes + ' min ' + lateEarly;

    return { message: message, critical: critical };
  }

  // ===== Roster View =====

  var currentRosterWeekStart = null;
  var isLoadingRoster = false;

  /**
   * Get Monday of the week for a given date.
   */
  function getWeekStart(date) {
    var d = new Date(date);
    var day = d.getDay();
    var diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /**
   * Format date as YYYY-MM-DD.
   */
  function formatDateKey(date) {
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, '0');
    var d = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  /**
   * Format date for display.
   */
  function formatRosterDate(date) {
    return date.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  /**
   * Load and display the roster week grid.
   */
  async function loadAdminRoster() {
    if (isLoadingRoster) return;
    isLoadingRoster = true;

    var container = document.getElementById('roster-grid-container');
    var loading = document.getElementById('roster-loading');
    var empty = document.getElementById('roster-empty');
    var weekLabel = document.getElementById('roster-week-label');

    if (!container) { isLoadingRoster = false; return; }

    if (!currentRosterWeekStart) {
      currentRosterWeekStart = getWeekStart(new Date());
    }

    var weekEnd = new Date(currentRosterWeekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    if (weekLabel) {
      weekLabel.textContent = formatRosterDate(currentRosterWeekStart) + ' — ' + formatRosterDate(weekEnd);
    }

    container.innerHTML = '';
    if (loading) loading.classList.remove('hidden');
    if (empty) empty.classList.add('hidden');

    try {
      var staffList = await window.ClockDB.getAllStaff();
      var rosterEntries = await window.ClockDB.getRosterForWeek(
        formatDateKey(currentRosterWeekStart),
        formatDateKey(weekEnd)
      );

      if (loading) loading.classList.add('hidden');

      // Build grid
      var grid = document.createElement('div');
      grid.className = 'roster-grid';

      // Header row
      var headerRow = document.createElement('div');
      headerRow.className = 'roster-grid-header';
      headerRow.textContent = 'Staff';
      grid.appendChild(headerRow);

      var dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      for (var i = 0; i < 7; i++) {
        var dayHeader = document.createElement('div');
        dayHeader.className = 'roster-grid-header';
        var dayDate = new Date(currentRosterWeekStart);
        dayDate.setDate(dayDate.getDate() + i);
        dayHeader.textContent = dayNames[i] + ' ' + dayDate.getDate();
        grid.appendChild(dayHeader);
      }

      // Staff rows - one per staff with lunch/dinner sub-rows
      staffList.forEach(function(staff) {
        // Staff name cell (spans both shift rows visually)
        var staffCell = document.createElement('div');
        staffCell.className = 'roster-grid-staff';
        staffCell.textContent = staff.name;
        staffCell.style.gridRow = 'span 2';
        grid.appendChild(staffCell);

        // Lunch row
        var lunchLabel = document.createElement('div');
        lunchLabel.className = 'roster-shift-label';
        lunchLabel.textContent = 'Lunch';
        grid.appendChild(lunchLabel);

        for (var d = 0; d < 7; d++) {
          var cellDate = new Date(currentRosterWeekStart);
          cellDate.setDate(cellDate.getDate() + d);
          var dateKey = formatDateKey(cellDate);

          var cell = document.createElement('div');
          cell.className = 'roster-cell';

          var entry = rosterEntries.find(function(r) {
            return r.staff_id === staff.id && r.roster_date === dateKey && r.shift_type === 'lunch';
          });

          if (entry) {
            cell.classList.add('roster-cell-scheduled');
            cell.innerHTML =
              '<span class="roster-time">' + entry.start_time.slice(0, 5) + '–' + entry.end_time.slice(0, 5) + '</span>' +
              (entry.notes ? '<span class="roster-notes">' + escapeHtml(entry.notes) + '</span>' : '');
          } else {
            cell.innerHTML = '<span class="roster-add">+</span>';
          }

          cell.addEventListener('click', function() {
            openRosterModal(staff, dateKey, 'lunch', entry);
          });

          grid.appendChild(cell);
        }

        // Dinner row
        var dinnerLabel = document.createElement('div');
        dinnerLabel.className = 'roster-shift-label';
        dinnerLabel.textContent = 'Dinner';
        grid.appendChild(dinnerLabel);

        for (var d = 0; d < 7; d++) {
          var cellDate = new Date(currentRosterWeekStart);
          cellDate.setDate(cellDate.getDate() + d);
          var dateKey = formatDateKey(cellDate);

          var cell = document.createElement('div');
          cell.className = 'roster-cell';

          var entry = rosterEntries.find(function(r) {
            return r.staff_id === staff.id && r.roster_date === dateKey && r.shift_type === 'dinner';
          });

          if (entry) {
            cell.classList.add('roster-cell-scheduled');
            cell.innerHTML =
              '<span class="roster-time">' + entry.start_time.slice(0, 5) + '–' + entry.end_time.slice(0, 5) + '</span>' +
              (entry.notes ? '<span class="roster-notes">' + escapeHtml(entry.notes) + '</span>' : '');
          } else {
            cell.innerHTML = '<span class="roster-add">+</span>';
          }

          cell.addEventListener('click', function() {
            openRosterModal(staff, dateKey, 'dinner', entry);
          });

          grid.appendChild(cell);
        }
      });

      container.appendChild(grid);

      if (rosterEntries.length === 0) {
        if (empty) empty.classList.remove('hidden');
      }
    } catch (error) {
      console.error('Failed to load roster:', error);
      if (loading) loading.classList.add('hidden');
      if (window.ClockApp) {
        window.ClockApp.showToast(error.message || 'Failed to load roster.', 'error');
      }
    } finally {
      isLoadingRoster = false;
    }
  }

  /**
   * Open the roster edit modal.
   * @param {object} staff
   * @param {string} dateKey
   * @param {object|null} entry
   */
  function openRosterModal(staff, dateKey, shiftType, entry) {
    var modal = document.getElementById('roster-modal');
    if (!modal) return;

    document.getElementById('roster-id').value = entry ? entry.id : '';
    document.getElementById('roster-staff-input').value = staff.id;
    document.getElementById('roster-date-input').value = dateKey;
    document.getElementById('roster-start-input').value = entry ? entry.start_time.slice(0, 5) : '';
    document.getElementById('roster-end-input').value = entry ? entry.end_time.slice(0, 5) : '';
    document.getElementById('roster-notes-input').value = entry ? (entry.notes || '') : '';
    document.getElementById('roster-shift-type-input').value = shiftType;

    document.getElementById('roster-modal-title').textContent = (entry ? 'Edit' : 'Add') + ' ' + shiftType.charAt(0).toUpperCase() + shiftType.slice(1) + ' Roster';
    document.getElementById('roster-delete-btn').classList.toggle('hidden', !entry);

    modal.classList.remove('hidden');
  }

  /**
   * Initialise roster modal event handlers.
   */
  function initRosterModal() {
    var cancelBtn = document.getElementById('roster-modal-cancel');
    var form = document.getElementById('roster-form');
    var overlay = document.querySelector('#roster-modal .modal-overlay');
    var deleteBtn = document.getElementById('roster-delete-btn');

    if (cancelBtn) {
      cancelBtn.addEventListener('click', function() {
        var modal = document.getElementById('roster-modal');
        if (modal) modal.classList.add('hidden');
      });
    }
    if (overlay) {
      overlay.addEventListener('click', function() {
        var modal = document.getElementById('roster-modal');
        if (modal) modal.classList.add('hidden');
      });
    }
    if (form) {
      form.addEventListener('submit', async function(e) {
        e.preventDefault();
        await submitRosterForm();
      });
    }
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async function(e) {
        e.preventDefault();
        var rosterId = document.getElementById('roster-id').value;
        if (!rosterId) return;
        if (window.confirm('Delete this roster entry?')) {
          try {
            await window.ClockDB.deleteRosterEntry(rosterId);
            if (window.ClockApp) window.ClockApp.showToast('Roster entry deleted.', 'success');
            document.getElementById('roster-modal').classList.add('hidden');
            loadAdminRoster();
          } catch (err) {
            if (window.ClockApp) window.ClockApp.showToast(err.message || 'Failed to delete.', 'error');
          }
        }
      });
    }
  }

  /**
   * Submit the roster form (create or update).
   * @param {boolean} force — bypass conflict check
   */
  async function submitRosterForm() {
    var rosterId = document.getElementById('roster-id').value;
    var staffId = document.getElementById('roster-staff-input').value;
    var date = document.getElementById('roster-date-input').value;
    var start = document.getElementById('roster-start-input').value;
    var end = document.getElementById('roster-end-input').value;
    var notes = document.getElementById('roster-notes-input').value.trim() || null;
    var shiftType = document.getElementById('roster-shift-type-input').value || 'lunch';

    if (!staffId || !date || !start || !end) {
      if (window.ClockApp) window.ClockApp.showToast('Staff, date, start time, and end time are required.', 'error');
      return;
    }

    try {
      if (rosterId) {
        await window.ClockDB.updateRosterEntry(rosterId, {
          startTime: start,
          endTime: end,
          notes: notes
        });
        if (window.ClockApp) window.ClockApp.showToast('Roster entry updated.', 'success');
      } else {
        await window.ClockDB.createRosterEntry({
          staffId: staffId,
          rosterDate: date,
          startTime: start,
          endTime: end,
          notes: notes,
          shiftType: shiftType
        });
        if (window.ClockApp) window.ClockApp.showToast('Roster entry created.', 'success');
      }
      document.getElementById('roster-modal').classList.add('hidden');
      loadAdminRoster();
    } catch (error) {
      var msg = error.message || '';
      console.error('Failed to save roster:', error);
      if (window.ClockApp) window.ClockApp.showToast(msg || 'Failed to save roster entry.', 'error');
    }
  }

  /**
   * Initialise roster week navigation buttons.
   */
  function initRosterNav() {
    var prevBtn = document.getElementById('roster-prev-week');
    var nextBtn = document.getElementById('roster-next-week');
    var currentBtn = document.getElementById('roster-current-week');
    var importBtn = document.getElementById('roster-import-btn');

    if (prevBtn) {
      prevBtn.addEventListener('click', function() {
        currentRosterWeekStart.setDate(currentRosterWeekStart.getDate() - 7);
        loadAdminRoster();
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', function() {
        currentRosterWeekStart.setDate(currentRosterWeekStart.getDate() + 7);
        loadAdminRoster();
      });
    }
    if (currentBtn) {
      currentBtn.addEventListener('click', function() {
        currentRosterWeekStart = getWeekStart(new Date());
        loadAdminRoster();
      });
    }
    if (importBtn) {
      importBtn.addEventListener('click', function() {
        openRosterImportModal();
      });
    }

    initRosterImportModal();
  }

  // ===== Roster CSV Import =====

  var rosterImportData = []; // Parsed CSV rows ready for import

  function openRosterImportModal() {
    var modal = document.getElementById('roster-import-modal');
    if (!modal) return;

    // Reset form
    document.getElementById('roster-import-file').value = '';
    document.getElementById('roster-import-text').value = '';
    document.getElementById('roster-import-preview').classList.add('hidden');
    document.getElementById('roster-import-summary').classList.add('hidden');
    document.getElementById('roster-import-preview-btn').classList.remove('hidden');
    document.getElementById('roster-import-submit').classList.add('hidden');
    rosterImportData = [];

    modal.classList.remove('hidden');
  }

  function initRosterImportModal() {
    var cancelBtn = document.getElementById('roster-import-cancel');
    var previewBtn = document.getElementById('roster-import-preview-btn');
    var submitBtn = document.getElementById('roster-import-submit');
    var overlay = document.querySelector('#roster-import-modal .modal-overlay');
    var fileInput = document.getElementById('roster-import-file');

    if (cancelBtn) {
      cancelBtn.addEventListener('click', function() {
        document.getElementById('roster-import-modal').classList.add('hidden');
      });
    }
    if (overlay) {
      overlay.addEventListener('click', function() {
        document.getElementById('roster-import-modal').classList.add('hidden');
      });
    }
    if (previewBtn) {
      previewBtn.addEventListener('click', function() {
        previewRosterImport();
      });
    }
    if (submitBtn) {
      submitBtn.addEventListener('click', function() {
        submitRosterImport();
      });
    }
    if (fileInput) {
      fileInput.addEventListener('change', function(e) {
        if (e.target.files && e.target.files[0]) {
          var reader = new FileReader();
          reader.onload = function(evt) {
            document.getElementById('roster-import-text').value = evt.target.result;
          };
          reader.readAsText(e.target.files[0]);
        }
      });
    }
  }

  function parseCSV(text) {
    var lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];

    var headers = lines[0].split(',').map(function(h) { return h.trim().toLowerCase(); });
    var rows = [];

    for (var i = 1; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      // Simple CSV parsing (handles basic commas, not quoted fields with commas)
      var cells = line.split(',').map(function(c) { return c.trim(); });
      if (cells.length < 4) continue; // Need at least Name, Date, Start, End

      var row = {};
      for (var j = 0; j < headers.length && j < cells.length; j++) {
        row[headers[j]] = cells[j];
      }
      rows.push(row);
    }

    return rows;
  }

  async function previewRosterImport() {
    var text = document.getElementById('roster-import-text').value.trim();
    if (!text) {
      if (window.ClockApp) window.ClockApp.showToast('Please paste or upload CSV data.', 'error');
      return;
    }

    var parsed = parseCSV(text);
    if (parsed.length === 0) {
      if (window.ClockApp) window.ClockApp.showToast('No valid rows found in CSV.', 'error');
      return;
    }

    // Get staff list for name matching
    var staffList = [];
    try {
      staffList = await window.ClockDB.getAllStaff();
    } catch (err) {
      console.error('Failed to load staff:', err);
    }

    var previewDiv = document.getElementById('roster-import-preview-content');
    var summaryDiv = document.getElementById('roster-import-summary');
    previewDiv.innerHTML = '';

    rosterImportData = [];
    var valid = 0;
    var invalid = 0;
    var errors = [];

    var table = document.createElement('table');
    table.className = 'w-full text-sm';
    table.innerHTML =
      '<thead><tr class="bg-gray-100">' +
      '<th class="p-2 text-left">Status</th>' +
      '<th class="p-2 text-left">Name</th>' +
      '<th class="p-2 text-left">Shift</th>' +
      '<th class="p-2 text-left">Date</th>' +
      '<th class="p-2 text-left">Start</th>' +
      '<th class="p-2 text-left">End</th>' +
      '<th class="p-2 text-left">Notes</th>' +
      '</tr></thead>';
    var tbody = document.createElement('tbody');

    parsed.forEach(function(row, idx) {
      // Try different header name variations
      var name = row.name || row['staff name'] || row.staff || '';
      var shiftType = row.shift || row['shift type'] || row.shift_type || row.type || 'lunch';
      if (shiftType.toLowerCase().indexOf('dinner') !== -1 || shiftType.toLowerCase().indexOf('evening') !== -1) {
        shiftType = 'dinner';
      } else {
        shiftType = 'lunch';
      }
      var date = row.date || row['roster_date'] || row['roster date'] || '';
      var start = row.start || row['start time'] || row.start_time || '';
      var end = row.end || row['end time'] || row.end_time || '';
      var notes = row.notes || row.note || '';

      var staff = staffList.find(function(s) {
        return s.name.toLowerCase() === name.toLowerCase();
      });

      var error = null;
      if (!name) error = 'Missing name';
      else if (!staff) error = 'Staff not found: ' + name;
      else if (!date) error = 'Missing date';
      else if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) error = 'Invalid date format (use YYYY-MM-DD)';
      else if (!start) error = 'Missing start time';
      else if (!/^\d{2}:\d{2}$/.test(start)) error = 'Invalid start time (use HH:MM)';
      else if (!end) error = 'Missing end time';
      else if (!/^\d{2}:\d{2}$/.test(end)) error = 'Invalid end time (use HH:MM)';
      else if (start >= end) error = 'Start time must be before end time';

      var tr = document.createElement('tr');
      tr.className = error ? 'bg-red-50' : 'bg-green-50';
      tr.innerHTML =
        '<td class="p-2">' + (error ? '❌' : '✅') + '</td>' +
        '<td class="p-2">' + escapeHtml(name) + '</td>' +
        '<td class="p-2">' + escapeHtml(shiftType) + '</td>' +
        '<td class="p-2">' + escapeHtml(date) + '</td>' +
        '<td class="p-2">' + escapeHtml(start) + '</td>' +
        '<td class="p-2">' + escapeHtml(end) + '</td>' +
        '<td class="p-2 text-xs text-gray-500">' + (error ? escapeHtml(error) : escapeHtml(notes)) + '</td>';
      tbody.appendChild(tr);

      if (error) {
        invalid++;
        errors.push('Row ' + (idx + 1) + ': ' + error);
      } else {
        valid++;
        rosterImportData.push({
          staffId: staff.id,
          date: date,
          startTime: start,
          endTime: end,
          notes: notes || null,
          shiftType: shiftType
        });
      }
    });

    table.appendChild(tbody);
    previewDiv.appendChild(table);

    document.getElementById('roster-import-preview').classList.remove('hidden');

    summaryDiv.classList.remove('hidden');
    if (invalid === 0) {
      summaryDiv.className = 'mb-4 p-3 rounded-lg bg-green-100 text-green-800';
      summaryDiv.textContent = '✅ All ' + valid + ' rows valid. Ready to import.';
      document.getElementById('roster-import-preview-btn').classList.add('hidden');
      document.getElementById('roster-import-submit').classList.remove('hidden');
    } else {
      summaryDiv.className = 'mb-4 p-3 rounded-lg bg-red-100 text-red-800';
      summaryDiv.innerHTML = '❌ ' + valid + ' valid, ' + invalid + ' invalid. Fix errors and preview again.' +
        '<div class="mt-2 text-xs">' + errors.slice(0, 5).map(function(e) { return '<div>' + escapeHtml(e) + '</div>'; }).join('') +
        (errors.length > 5 ? '<div>...and ' + (errors.length - 5) + ' more</div>' : '') + '</div>';
    }
  }

  async function submitRosterImport() {
    if (rosterImportData.length === 0) {
      if (window.ClockApp) window.ClockApp.showToast('No valid rows to import.', 'error');
      return;
    }

    var submitBtn = document.getElementById('roster-import-submit');
    if (submitBtn) submitBtn.disabled = true;

    var success = 0;
    var failed = 0;
    var errors = [];

    for (var i = 0; i < rosterImportData.length; i++) {
      var row = rosterImportData[i];
      try {
        await window.ClockDB.createRosterEntry({
          staffId: row.staffId,
          rosterDate: row.date,
          startTime: row.startTime,
          endTime: row.endTime,
          notes: row.notes,
          shiftType: row.shiftType || 'lunch'
        });
        success++;
      } catch (err) {
        // If it already exists, try updating
        try {
          var weekStart = getWeekStart(new Date(row.date));
          var weekEnd = new Date(weekStart);
          weekEnd.setDate(weekEnd.getDate() + 6);
          var existing = await window.ClockDB.getRosterForWeek(
            formatDateKey(weekStart),
            formatDateKey(weekEnd)
          );
          var entry = existing.find(function(e) {
            return e.staff_id === row.staffId && e.roster_date === row.date && e.shift_type === (row.shiftType || 'lunch');
          });
          if (entry) {
            await window.ClockDB.updateRosterEntry(entry.id, {
              startTime: row.startTime,
              endTime: row.endTime,
              notes: row.notes
            });
            success++;
          } else {
            failed++;
            errors.push('Row ' + (i + 1) + ': ' + (err.message || 'Failed'));
          }
        } catch (updateErr) {
          failed++;
          errors.push('Row ' + (i + 1) + ': ' + (err.message || 'Failed'));
        }
      }
    }

    if (submitBtn) submitBtn.disabled = false;

    var summaryDiv = document.getElementById('roster-import-summary');
    summaryDiv.classList.remove('hidden');
    if (failed === 0) {
      summaryDiv.className = 'mb-4 p-3 rounded-lg bg-green-100 text-green-800';
      summaryDiv.textContent = '✅ Imported ' + success + ' roster entries successfully!';
      if (window.ClockApp) window.ClockApp.showToast('Roster imported: ' + success + ' entries.', 'success');
      setTimeout(function() {
        document.getElementById('roster-import-modal').classList.add('hidden');
        loadAdminRoster();
      }, 1500);
    } else {
      summaryDiv.className = 'mb-4 p-3 rounded-lg bg-yellow-100 text-yellow-800';
      summaryDiv.innerHTML = '⚠️ ' + success + ' imported, ' + failed + ' failed.' +
        '<div class="mt-2 text-xs">' + errors.slice(0, 3).map(function(e) { return '<div>' + escapeHtml(e) + '</div>'; }).join('') + '</div>';
      if (window.ClockApp) window.ClockApp.showToast('Import partial: ' + success + ' ok, ' + failed + ' failed.', 'warning');
    }
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
    initRosterModal();
    initRosterNav();
  }

  // ===== Expose globally =====
  window.ClockAdmin = {
    initAdmin: initAdmin,
    loadAdminStaff: loadAdminStaff,
    loadAdminTimesheets: loadAdminTimesheets,
    loadAdminRoster: loadAdminRoster,
    loadAdminAudit: loadAdminAudit,
    setDateFilter: setDateFilter,
    getDateFilter: getDateFilter
  };
})();
