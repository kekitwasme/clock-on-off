/**
 * admin-timesheet.js - Timesheet Module
 *
 * Handles admin timesheet viewing, filtering, grouping by date/staff,
 * payroll summary, CSV export, and shift editing.
 */

(function() {
  'use strict';

  // ===== State =====
  var currentTimesheets = [];
  var isLoading = false;
  var currentView = 'staff'; // 'date' | 'staff'
  var currentDateFilter = 'thisweek';
  var customStartDate = null;
  var customEndDate = null;

  // ===== Constants =====
  var VIEW_DATE = 'date';
  var VIEW_STAFF = 'staff';

  // ===== Public API =====

  /**
   * Initialise timesheet controls (staff filter, view toggles, export).
   */
  function initControls() {
    initStaffFilter();
    initViewToggles();
    initExportButton();
  }

  /**
   * Load and display timesheets with current filters.
   */
  async function load() {
    if (isLoading) return;
    isLoading = true;

    var container = getContainer();
    if (!container) { isLoading = false; return; }

    ensureFilterBar();
    showLoading(container);

    try {
      var filters = buildFilters();
      currentTimesheets = await window.ClockDB.getAllShifts(filters);
      render();
    } catch (err) {
      console.error('Failed to load timesheets:', err);
      showError(container, 'Failed to load timesheets.');
      showToast(err.message || 'Failed to load timesheets.', 'error');
    } finally {
      isLoading = false;
    }
  }

  /**
   * Set the date filter programmatically.
   * @param {string} filter - 'today' | 'yesterday' | 'thisweek' | 'last7' | 'last30' | 'custom'
   */
  function setDateFilter(filter) {
    currentDateFilter = filter;
    refreshFilterPills();
    toggleCustomInputs();
    load();
  }

  /**
   * Get the current date filter.
   * @returns {string}
   */
  function getDateFilter() {
    return currentDateFilter;
  }

  /**
   * Get the current timesheet data.
   * @returns {Array}
   */
  function getData() {
    return currentTimesheets;
  }

  // ===== Rendering =====

  function render() {
    if (currentView === VIEW_STAFF) {
      renderByStaff();
    } else {
      renderByDate();
    }
  }

  /**
   * Render timesheets grouped by date.
   */
  function renderByDate() {
    var container = getContainer();
    if (!container) return;

    container.innerHTML = '';

    var grouped = groupByDate(currentTimesheets);
    if (grouped.length === 0) {
      showEmpty(container);
      return;
    }

    grouped.forEach(function(group) {
      container.appendChild(buildDateGroup(group));
    });
  }

  /**
   * Render timesheets grouped by staff with payroll summary.
   */
  function renderByStaff() {
    var container = getContainer();
    if (!container) return;

    container.innerHTML = '';

    var grouped = groupByStaff(currentTimesheets);
    if (grouped.length === 0) {
      showEmpty(container);
      return;
    }

    grouped.forEach(function(group) {
      container.appendChild(buildStaffCard(group));
    });
  }

  // ===== Date Group Building =====

  function buildDateGroup(group) {
    var wrapper = document.createElement('div');
    wrapper.className = 'date-group';

    var header = document.createElement('div');
    header.className = 'date-group-header';
    header.innerHTML = buildDateHeaderHtml(group);
    header.addEventListener('click', function() {
      wrapper.classList.toggle('date-group-collapsed');
    });

    var content = document.createElement('div');
    content.className = 'date-group-content';
    group.shifts.forEach(function(shift) {
      content.appendChild(buildShiftCard(shift));
    });

    wrapper.appendChild(header);
    wrapper.appendChild(content);
    return wrapper;
  }

  function buildDateHeaderHtml(group) {
    return '<div class="date-group-title">' + escapeHtml(group.dateLabel) + '</div>' +
      '<div class="date-group-meta">' +
        '<span>' + group.staffCount + (group.staffCount === 1 ? ' staff' : ' staff') + '</span>' +
        '<span>&bull;</span>' +
        '<span>' + group.totalHoursStr + (group.totalHoursStr === 1 ? ' hr' : ' hrs') + '</span>' +
      '</div>';
  }

  // ===== Shift Card Building =====

  function buildShiftCard(shift) {
    var card = document.createElement('div');
    card.className = 'timesheet-row';

    var isActive = !shift.clock_out;
    var staffName = escapeHtml(getStaffName(shift));
    var dateStr = window.ClockDB.formatDate(shift.clock_in);
    var clockInStr = window.ClockDB.formatTime(shift.clock_in);
    var clockOutStr = isActive ? 'Active' : window.ClockDB.formatTime(shift.clock_out);
    var duration = isActive
      ? 'In progress'
      : window.ClockDB.formatDuration(window.ClockDB.calculateDuration(shift.clock_in, shift.clock_out));

    var adjustedHtml = buildAdjustedBadges(shift);
    var lateEarlyHtml = buildLateEarlyBadges(shift, card);

    card.innerHTML =
      '<div class="timesheet-row-header">' +
        '<span class="font-semibold text-gray-800">' + staffName + '</span>' +
        '<span class="text-sm ' + (isActive ? 'text-green-600' : 'text-gray-500') + '">' + dateStr + '</span>' +
      '</div>' +
      '<div class="timesheet-row-times">' +
        '<span><span class="text-green-600">' + clockInStr + '</span> &rarr; <span class="' + (isActive ? 'text-orange-600' : 'text-red-600') + '">' + clockOutStr + '</span></span>' +
        '<span class="shift-duration">' + duration + '</span>' +
      '</div>' +
      adjustedHtml +
      lateEarlyHtml +
      '<div class="mt-3 flex justify-end gap-2">' +
        '<button class="btn-edit text-sm px-3 py-2" data-action="edit-shift" data-shift-id="' + shift.id + '">&#9999;&#65039; Edit</button>' +
      '</div>';

    var editBtn = card.querySelector('[data-action="edit-shift"]');
    if (editBtn) {
      editBtn.addEventListener('click', function() {
        openShiftEdit(shift);
      });
    }

    return card;
  }

  function buildAdjustedBadges(shift) {
    var badges = [];
    if (shift.clock_in_adjusted) badges.push('<span class="shift-adjusted-badge">in adjusted</span>');
    if (shift.clock_out_adjusted) badges.push('<span class="shift-adjusted-badge">out adjusted</span>');
    return badges.join('');
  }

  function buildLateEarlyBadges(shift, card) {
    if (!shift.staff || !shift.clock_out) return '';

    var alerts = [];
    if (shift.staff.expected_start_time) {
      var startAlert = checkLateEarly(shift.clock_in, shift.staff.expected_start_time);
      if (startAlert) alerts.push(startAlert);
    }
    if (shift.staff.expected_end_time && shift.clock_out) {
      var endAlert = checkLateEarly(shift.clock_out, shift.staff.expected_end_time);
      if (endAlert) alerts.push(endAlert);
    }

    if (alerts.length === 0) return '';

    var critical = alerts.some(function(a) { return a.critical; });
    card.classList.add(critical ? 'border-orange-400' : 'border-yellow-400');
    card.classList.add('border-2');

    return '<div class="flex flex-wrap gap-1 mt-2">' +
      alerts.map(function(a) {
        var cls = a.critical ? 'late-badge-critical' : 'late-badge';
        return '<span class="' + cls + '">' + escapeHtml(a.message) + '</span>';
      }).join('') +
      '</div>';
  }

  // ===== Staff Card Building =====

  function buildStaffCard(group) {
    var card = document.createElement('div');
    card.className = 'staff-timesheet-card';

    var hours = (group.totalMinutes / 60).toFixed(1);
    var badges = buildStaffBadges(group);
    var dayTotals = calculateDayTotals(group.shifts);

    card.innerHTML =
      '<div class="staff-timesheet-header">' +
        '<div class="staff-timesheet-name">' + escapeHtml(group.staff.name) + '</div>' +
        '<div class="staff-timesheet-total">' + hours + ' hrs</div>' +
      '</div>' +
      '<div class="staff-timesheet-badges">' + badges + '</div>' +
      '<div class="staff-day-totals">' +
        '<span class="day-total-badge day-total-weekday">Mon–Fri: ' + dayTotals.weekday.toFixed(1) + 'h</span>' +
        '<span class="day-total-badge day-total-saturday">Sat: ' + dayTotals.saturday.toFixed(1) + 'h</span>' +
        '<span class="day-total-badge day-total-sunday">Sun: ' + dayTotals.sunday.toFixed(1) + 'h</span>' +
      '</div>';

    card.appendChild(buildStaffShiftTable(group.shifts));
    return card;
  }

  function calculateDayTotals(shifts) {
    var totals = { weekday: 0, saturday: 0, sunday: 0 };
    shifts.forEach(function(shift) {
      if (!shift.clock_out) return;
      var hrs = window.ClockDB.calculateDuration(shift.clock_in, shift.clock_out) / (1000 * 60 * 60);
      var day = new Date(shift.clock_in).getDay(); // 0=Sun, 6=Sat
      if (day === 0) totals.sunday += hrs;
      else if (day === 6) totals.saturday += hrs;
      else totals.weekday += hrs;
    });
    return totals;
  }

  function buildStaffBadges(group) {
    var badges = [];
    if (group.lateCount > 0) badges.push('<span class="badge-late">&#9888;&#65039; ' + group.lateCount + ' late</span>');
    if (group.earlyCount > 0) badges.push('<span class="badge-early">&#128682; ' + group.earlyCount + ' early</span>');
    if (group.adjustedCount > 0) badges.push('<span class="badge-adjusted">&#9999;&#65039; ' + group.adjustedCount + ' adjusted</span>');
    return badges.join('');
  }

  function buildStaffShiftTable(shifts) {
    var table = document.createElement('table');
    table.className = 'staff-timesheet-table';
    table.innerHTML =
      '<thead><tr>' +
        '<th>Date</th><th>In</th><th>Out</th><th>Dur</th><th>Status</th><th></th>' +
      '</tr></thead>';

    var tbody = document.createElement('tbody');
    var sorted = shifts.slice().sort(function(a, b) {
      return new Date(a.clock_in) - new Date(b.clock_in);
    });

    sorted.forEach(function(shift) {
      tbody.appendChild(buildStaffShiftRow(shift));
    });

    table.appendChild(tbody);

    var wrapper = document.createElement('div');
    wrapper.className = 'staff-timesheet-table-scroll';
    wrapper.appendChild(table);
    return wrapper;
  }

  function buildStaffShiftRow(shift) {
    var isActive = !shift.clock_out;
    var dateStr = window.ClockDB.formatDate(shift.clock_in);
    var clockInStr = window.ClockDB.formatTime(shift.clock_in);
    var clockOutStr = shift.clock_out ? window.ClockDB.formatTime(shift.clock_out) : '--';
    var duration = isActive
      ? 'Active'
      : window.ClockDB.formatDuration(window.ClockDB.calculateDuration(shift.clock_in, shift.clock_out));
    var status = buildShiftStatus(shift);

    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + dateStr + '</td>' +
      '<td>' + clockInStr + '</td>' +
      '<td>' + clockOutStr + '</td>' +
      '<td>' + duration + '</td>' +
      '<td>' + status + '</td>' +
      '<td><button class="btn-edit-sm" data-shift-id="' + shift.id + '">&#9999;&#65039;</button></td>';

    var editBtn = tr.querySelector('.btn-edit-sm');
    if (editBtn) {
      editBtn.addEventListener('click', function() {
        openShiftEdit(shift);
      });
    }

    return tr;
  }

  function buildShiftStatus(shift) {
    if (!shift.clock_out) return '<span class="status-active">&#128994; Active</span>';
    if (shift.clock_in_adjusted || shift.clock_out_adjusted) return '<span class="status-adjusted">&#9999;&#65039; Adj</span>';

    var startAlert = checkLateEarly(shift.clock_in, shift.staff && shift.staff.expected_start_time);
    if (startAlert && startAlert.critical) return '<span class="status-late">&#9888;&#65039; Late</span>';

    var endAlert = shift.clock_out ? checkLateEarly(shift.clock_out, shift.staff && shift.staff.expected_end_time) : null;
    if (endAlert && endAlert.critical) return '<span class="status-early">&#128682; Early</span>';

    return '<span class="status-ok">&#9989;</span>';
  }



  // ===== Data Grouping =====

  function groupByDate(shifts) {
    if (!shifts || shifts.length === 0) return [];

    var groups = {};
    shifts.forEach(function(shift) {
      var dateKey = shift.clock_in ? shift.clock_in.slice(0, 10) : 'Unknown';
      if (!groups[dateKey]) {
        groups[dateKey] = { dateKey: dateKey, shifts: [], staffCount: 0, totalHours: 0 };
      }
      groups[dateKey].shifts.push(shift);
      groups[dateKey].staffCount += 1;

      if (shift.clock_out) {
        var ms = window.ClockDB.calculateDuration(shift.clock_in, shift.clock_out);
        groups[dateKey].totalHours += ms / (1000 * 60 * 60);
      }
    });

    var result = Object.values(groups);
    result.sort(function(a, b) {
      if (a.dateKey === 'Unknown') return 1;
      if (b.dateKey === 'Unknown') return -1;
      return b.dateKey.localeCompare(a.dateKey);
    });

    result.forEach(function(group) {
      group.dateLabel = formatDateLabel(group.dateKey);
      group.totalHoursStr = Math.round(group.totalHours * 10) / 10;
    });

    return result;
  }

  function groupByStaff(shifts) {
    var map = {};

    shifts.forEach(function(shift) {
      var staffId = shift.staff_id || (shift.staff && shift.staff.id);
      var staffName = getStaffName(shift);
      if (!staffId) return;

      if (!map[staffId]) {
        map[staffId] = {
          staff: shift.staff || { id: staffId, name: staffName },
          shifts: [],
          totalMinutes: 0,
          adjustedCount: 0,
          lateCount: 0,
          earlyCount: 0
        };
      }

      map[staffId].shifts.push(shift);

      if (shift.clock_out) {
        map[staffId].totalMinutes += Math.round(window.ClockDB.calculateDuration(shift.clock_in, shift.clock_out) / 60000);
      }
      if (shift.clock_in_adjusted || shift.clock_out_adjusted) {
        map[staffId].adjustedCount++;
      }

      countLateEarly(shift, map[staffId]);
    });

    return Object.values(map).sort(function(a, b) {
      return a.staff.name.localeCompare(b.staff.name);
    });
  }

  function countLateEarly(shift, group) {
    if (!shift.clock_out || !shift.staff) return;

    if (shift.staff.expected_start_time) {
      var alert = checkLateEarly(shift.clock_in, shift.staff.expected_start_time);
      if (alert && alert.critical) group.lateCount++;
    }
    if (shift.staff.expected_end_time) {
      var alert = checkLateEarly(shift.clock_out, shift.staff.expected_end_time);
      if (alert && alert.critical) group.earlyCount++;
    }
  }

  // ===== Date Filter =====

  function buildFilters() {
    var filters = {};
    var staffFilter = document.getElementById('timesheet-staff-filter');
    if (staffFilter && staffFilter.value) filters.staffId = staffFilter.value;

    var range = getDateRange();
    filters.startDate = range.startDate;
    filters.endDate = range.endDate;
    return filters;
  }

  function getDateRange() {
    var now = new Date();
    var start = new Date(now);
    var end = new Date(now);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    switch (currentDateFilter) {
      case 'today': break;
      case 'yesterday':
        start.setDate(start.getDate() - 1);
        end.setDate(end.getDate() - 1);
        break;
      case 'thisweek':
        var dayOfWeek = start.getDay();
        var mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        start.setDate(start.getDate() + mondayOffset);
        start.setHours(0, 0, 0, 0);
        var sundayOffset = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
        end.setDate(end.getDate() + sundayOffset);
        end.setHours(23, 59, 59, 999);
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

    return { startDate: start.toISOString(), endDate: end.toISOString() };
  }

  function formatDateLabel(dateKey) {
    if (dateKey === 'Unknown') return 'Unknown Date';

    var date = new Date(dateKey + 'T00:00:00');
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var diff = Math.round((today - date) / (1000 * 60 * 60 * 24));
    var dateStr = date.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });

    if (diff === 0) return 'Today, ' + dateStr;
    if (diff === 1) return 'Yesterday, ' + dateStr;
    return dateStr;
  }

  // ===== Filter Bar =====

  function ensureFilterBar() {
    if (document.getElementById('date-filter-bar')) return;

    var container = getContainer();
    if (!container || !container.parentNode) return;

    var bar = document.createElement('div');
    bar.id = 'date-filter-bar';
    bar.className = 'filter-bar';

    var pills = [
      { key: 'today', label: 'Today' },
      { key: 'yesterday', label: 'Yesterday' },
      { key: 'thisweek', label: 'This Week' },
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
        onFilterChange(pill.key);
      });
      bar.appendChild(btn);
    });

    var customContainer = document.createElement('div');
    customContainer.id = 'custom-date-container';
    customContainer.className = 'flex gap-2 mt-2' + (currentDateFilter === 'custom' ? '' : ' hidden');

    var startInput = buildDateInput('custom-start-date', customStartDate, function(val) {
      customStartDate = val || null;
      if (customStartDate && customEndDate) load();
    });
    var endInput = buildDateInput('custom-end-date', customEndDate, function(val) {
      customEndDate = val || null;
      if (customStartDate && customEndDate) load();
    });

    customContainer.appendChild(startInput);
    customContainer.appendChild(endInput);

    container.parentNode.insertBefore(bar, container);
    container.parentNode.insertBefore(customContainer, container);
  }

  function buildDateInput(id, value, onChange) {
    var input = document.createElement('input');
    input.type = 'date';
    input.id = id;
    input.className = 'flex-1 p-2 border border-gray-300 rounded text-sm';
    input.value = value || '';
    input.addEventListener('change', function() {
      onChange(input.value);
    });
    return input;
  }

  function onFilterChange(filter) {
    currentDateFilter = filter;
    refreshFilterPills();
    toggleCustomInputs();
    load();
  }

  function refreshFilterPills() {
    document.querySelectorAll('#date-filter-bar .filter-pill').forEach(function(btn) {
      btn.classList.toggle('filter-pill-active', btn.dataset.filter === currentDateFilter);
    });
  }

  function toggleCustomInputs() {
    var container = document.getElementById('custom-date-container');
    if (container) {
      container.classList.toggle('hidden', currentDateFilter !== 'custom');
    }
  }

  // ===== CSV Export =====

  function exportCSV() {
    exportDetailCSV();
  }

  function exportDetailCSV() {
    if (!currentTimesheets || currentTimesheets.length === 0) {
      showToast('No timesheets to export.', 'error');
      return;
    }

    var grouped = groupByDate(currentTimesheets);
    var headers = ['staff_name', 'date', 'clock_in', 'clock_out', 'duration_minutes', 'clock_in_adjusted', 'clock_out_adjusted', 'notes'];
    var lines = [headers.join(',')];

    grouped.forEach(function(group) {
      lines.push(['DATE: ' + group.dateLabel, group.dateKey, '', '', '', '', '', group.staffCount + ' staff, ' + group.totalHoursStr + ' hrs'].map(window.ClockDB.csvEscape).join(','));

      group.shifts.forEach(function(shift) {
        lines.push([
          getStaffName(shift),
          window.ClockDB.formatDate(shift.clock_in),
          window.ClockDB.formatDateTime(shift.clock_in),
          shift.clock_out ? window.ClockDB.formatDateTime(shift.clock_out) : '',
          shift.clock_out ? Math.round(window.ClockDB.calculateDuration(shift.clock_in, shift.clock_out) / 60000) : '',
          shift.clock_in_adjusted ? 'Yes' : 'No',
          shift.clock_out_adjusted ? 'Yes' : 'No',
          (shift.notes || '').replace(/"/g, '""')
        ].map(window.ClockDB.csvEscape).join(','));
      });

      lines.push(['SUBTOTAL', group.dateKey, '', '', Math.round(group.totalHours * 60), '', '', group.staffCount + ' shifts, ' + group.totalHoursStr + ' hours'].map(window.ClockDB.csvEscape).join(','));
      lines.push(['', '', '', '', '', '', '', ''].join(','));
    });

    downloadCSV(lines.join('\r\n'), 'timesheets_' + isoDate() + '.csv');
    showToast('Exported ' + currentTimesheets.length + ' shifts.', 'success');
  }

  function downloadCSV(content, filename) {
    var blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // ===== Shift Edit Modal =====

  function openShiftEdit(shift) {
    var modal = document.getElementById('shift-modal');
    if (!modal) return;

    document.getElementById('edit-shift-id').value = shift.id;
    document.getElementById('edit-shift-staff-id').value = shift.staff_id || (shift.staff && shift.staff.id) || '';
    document.getElementById('edit-clock-in').value = new Date(shift.clock_in).toISOString().slice(0, 16);
    document.getElementById('edit-clock-out').value = shift.clock_out ? new Date(shift.clock_out).toISOString().slice(0, 16) : '';
    document.getElementById('edit-shift-notes').value = shift.notes || '';

    var reasonInput = document.getElementById('edit-shift-reason');
    if (reasonInput) reasonInput.value = '';

    modal.classList.remove('hidden');
  }

  function initShiftEditModal() {
    var cancelBtn = document.getElementById('shift-modal-cancel');
    var form = document.getElementById('shift-form');
    var overlay = document.querySelector('#shift-modal .modal-overlay');

    if (cancelBtn) {
      cancelBtn.addEventListener('click', hideModal);
    }
    if (overlay) {
      overlay.addEventListener('click', hideModal);
    }
    if (form) {
      form.addEventListener('submit', function(e) {
        e.preventDefault();
        submitShiftEdit();
      });
    }

    function hideModal() {
      var modal = document.getElementById('shift-modal');
      if (modal) modal.classList.add('hidden');
    }
  }

  async function submitShiftEdit() {
    var shiftId = document.getElementById('edit-shift-id').value;
    var clockInVal = document.getElementById('edit-clock-in').value;
    var clockOutVal = document.getElementById('edit-clock-out').value;
    var notes = document.getElementById('edit-shift-notes').value.trim();
    var reason = document.getElementById('edit-shift-reason').value.trim();

    if (!clockInVal) { showToast('Clock-in time is required.', 'error'); return; }
    if (clockOutVal && new Date(clockOutVal) <= new Date(clockInVal)) {
      showToast('Clock-out must be after clock-in.', 'error');
      return;
    }
    if (!reason) { showToast('Reason for adjustment is required.', 'error'); return; }

    try {
      var currentShift = await window.ClockDB.getShiftById(shiftId);
      if (!currentShift) { showToast('Shift not found.', 'error'); return; }

      await window.ClockDB.updateShift(shiftId, {
        clockIn: new Date(clockInVal).toISOString(),
        clockOut: clockOutVal ? new Date(clockOutVal).toISOString() : null,
        notes: notes || null,
        reason: reason || 'Manual adjustment by admin'
      });

      showToast('Shift updated. Change logged in audit trail.', 'success');
      document.getElementById('shift-modal').classList.add('hidden');
      load();
    } catch (err) {
      console.error('Failed to update shift:', err);
      showToast(err.message || 'Failed to update shift.', 'error');
    }
  }

  // ===== Control Initialisation =====

  function initStaffFilter() {
    var staffFilter = document.getElementById('timesheet-staff-filter');
    if (!staffFilter) return;

    (async function() {
      try {
        var staff = await window.ClockDB.getAllStaff();
        var allOption = staffFilter.querySelector('option[value=""]');
        staffFilter.innerHTML = '';
        if (allOption) staffFilter.appendChild(allOption);

        staff.forEach(function(s) {
          var option = document.createElement('option');
          option.value = s.id;
          option.textContent = s.name;
          staffFilter.appendChild(option);
        });
      } catch (err) {
        console.error('Failed to populate staff filter:', err);
      }
    })();

    staffFilter.addEventListener('change', load);
  }

  function initViewToggles() {
    var viewDateBtn = document.getElementById('timesheet-view-date');
    var viewStaffBtn = document.getElementById('timesheet-view-staff');

    if (viewDateBtn) {
      viewDateBtn.addEventListener('click', function() {
        setView(VIEW_DATE);
      });
    }
    if (viewStaffBtn) {
      viewStaffBtn.addEventListener('click', function() {
        setView(VIEW_STAFF);
      });
    }
  }

  function setView(view) {
    currentView = view;
    refreshToggleStyles();
    render();
  }

  function refreshToggleStyles() {
    var viewDateBtn = document.getElementById('timesheet-view-date');
    var viewStaffBtn = document.getElementById('timesheet-view-staff');

    if (viewDateBtn) updateToggleStyle(viewDateBtn, currentView === VIEW_DATE);
    if (viewStaffBtn) updateToggleStyle(viewStaffBtn, currentView === VIEW_STAFF);
  }

  function updateToggleStyle(btn, active) {
    btn.classList.toggle('bg-blue-600', active);
    btn.classList.toggle('bg-gray-200', !active);
    btn.classList.toggle('text-white', active);
    btn.classList.toggle('text-gray-800', !active);
  }

  function initExportButton() {
    var exportBtn = document.getElementById('export-csv-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', exportCSV);
    }
  }

  // ===== Utilities =====

  function getContainer() {
    return document.getElementById('timesheets-list');
  }

  function showLoading(container) {
    container.innerHTML = '<div class="loading-spinner"></div><p class="text-center text-gray-600 mt-2">Loading...</p>';
  }

  function showError(container, message) {
    container.innerHTML = '<p class="text-center text-red-500 py-4">' + escapeHtml(message) + '</p>';
  }

  function showEmpty(container) {
    container.innerHTML = '<p class="text-center text-gray-500 py-4">No shifts found.</p>';
  }


  function getStaffName(shift) {
    return (shift.staff && shift.staff.name) ? shift.staff.name : 'Unknown';
  }

  function isoDate() {
    return new Date().toISOString().split('T')[0];
  }

  function showToast(message, type) {
    if (window.ClockApp && window.ClockApp.showToast) {
      window.ClockApp.showToast(message, type);
    }
  }

  function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(text).replace(/[&<>"']/g, function(m) { return map[m]; });
  }

  /**
   * Check if a shift time is late/early compared to expected time.
   * @param {string} actualISO
   * @param {string} expectedTime
   * @returns {{message: string, critical: boolean}|null}
   */
  function checkLateEarly(actualISO, expectedTime) {
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
    return { message: absMinutes + ' min ' + lateEarly, critical: absMinutes > 30 };
  }

  // ===== Expose =====
  window.ClockAdminTimesheet = {
    initControls: initControls,
    initShiftEditModal: initShiftEditModal,
    load: load,
    setDateFilter: setDateFilter,
    getDateFilter: getDateFilter,
    getData: getData,
    render: render
  };
})();
