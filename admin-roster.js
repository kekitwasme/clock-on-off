/**
 * admin-roster.js - Roster Module
 *
 * Per-staff card view with lunch/dinner sections.
 * Handles week navigation, CRUD operations, and CSV import.
 */

(function() {
  'use strict';

  // ===== State =====
  var currentWeekStart = null;
  var isLoading = false;
  var importData = [];

  // ===== Constants =====
  var DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // ===== Public API =====

  function initControls() {
    initWeekNav();
    initRosterModal();
    initImportModal();
  }

  async function load() {
    if (isLoading) return;
    isLoading = true;

    var container = document.getElementById('roster-grid-container');
    var loading = document.getElementById('roster-loading');
    var empty = document.getElementById('roster-empty');
    var weekLabel = document.getElementById('roster-week-label');

    if (!container) { isLoading = false; return; }

    if (!currentWeekStart) {
      currentWeekStart = getWeekStart(new Date());
    }

    var weekEnd = addDays(currentWeekStart, 6);
    if (weekLabel) {
      weekLabel.textContent = formatDisplayDate(currentWeekStart) + ' — ' + formatDisplayDate(weekEnd);
    }

    container.innerHTML = '';
    if (loading) loading.classList.remove('hidden');
    if (empty) empty.classList.add('hidden');

    try {
      var staffList = await window.ClockDB.getAllStaff();
      var rosterEntries = await window.ClockDB.getRosterForWeek(
        formatDateKey(currentWeekStart),
        formatDateKey(weekEnd)
      );

      if (loading) loading.classList.add('hidden');

      var wrapper = buildRosterCards(staffList, rosterEntries);
      container.appendChild(wrapper);

      if (rosterEntries.length === 0 && empty) {
        empty.classList.remove('hidden');
      }
    } catch (err) {
      console.error('Failed to load roster:', err);
      if (loading) loading.classList.add('hidden');
      showToast(err.message || 'Failed to load roster.', 'error');
    } finally {
      isLoading = false;
    }
  }

  function getCurrentWeekStart() {
    return currentWeekStart;
  }

  // ===== Card Layout =====

  function buildRosterCards(staffList, rosterEntries) {
    var wrapper = document.createElement('div');
    wrapper.className = 'roster-cards';

    if (staffList.length === 0) {
      wrapper.innerHTML = '<p class="text-gray-500 text-center py-4">No staff found.</p>';
      return wrapper;
    }

    staffList.forEach(function(staff) {
      var card = buildStaffCard(staff, rosterEntries);
      wrapper.appendChild(card);
    });

    return wrapper;
  }

  function buildStaffCard(staff, rosterEntries) {
    var card = document.createElement('div');
    card.className = 'roster-staff-card';

    // Staff name header
    var header = document.createElement('div');
    header.className = 'roster-staff-card-header';
    header.innerHTML = '<span class="roster-staff-card-name">' + escapeHtml(staff.name) + '</span>';
    card.appendChild(header);

    // Day labels row
    var dayRow = document.createElement('div');
    dayRow.className = 'roster-day-row';
    dayRow.innerHTML = '<div class="roster-day-label-cell"></div>';
    for (var d = 0; d < 7; d++) {
      var dayDate = addDays(currentWeekStart, d);
      var dayCell = document.createElement('div');
      dayCell.className = 'roster-day-label';
      dayCell.innerHTML =
        '<span class="roster-day-name">' + DAY_NAMES[d] + '</span>' +
        '<span class="roster-day-num">' + dayDate.getDate() + '</span>';
      dayRow.appendChild(dayCell);
    }
    card.appendChild(dayRow);

    // Lunch row
    var lunchRow = buildShiftRow(staff, 'lunch', rosterEntries);
    card.appendChild(lunchRow);

    // Dinner row
    var dinnerRow = buildShiftRow(staff, 'dinner', rosterEntries);
    card.appendChild(dinnerRow);

    return card;
  }

  function buildShiftRow(staff, shiftType, rosterEntries) {
    var row = document.createElement('div');
    row.className = 'roster-shift-row';

    // Shift label
    var label = document.createElement('div');
    label.className = 'roster-shift-label';
    label.textContent = capitalize(shiftType);
    row.appendChild(label);

    // 7 day cells
    for (var d = 0; d < 7; d++) {
      var cellDate = addDays(currentWeekStart, d);
      var dateKey = formatDateKey(cellDate);
      var entry = findRosterEntry(rosterEntries, staff.id, dateKey, shiftType);
      var cell = buildShiftCell(staff, dateKey, shiftType, entry);
      row.appendChild(cell);
    }

    return row;
  }

  function buildShiftCell(staff, dateKey, shiftType, entry) {
    var cell = document.createElement('div');
    cell.className = 'roster-shift-cell';

    if (entry) {
      cell.classList.add('roster-shift-cell-scheduled');
      cell.innerHTML =
        '<span class="roster-time">' + entry.start_time.slice(0, 5) + '–' + entry.end_time.slice(0, 5) + '</span>' +
        (entry.notes ? '<span class="roster-notes">' + escapeHtml(entry.notes) + '</span>' : '');
    } else {
      cell.innerHTML = '<span class="roster-add">+</span>';
    }

    cell.addEventListener('click', function() {
      openRosterModal(staff, dateKey, shiftType, entry);
    });

    return cell;
  }

  function findRosterEntry(entries, staffId, dateKey, shiftType) {
    return entries.find(function(r) {
      return r.staff_id === staffId && r.roster_date === dateKey && r.shift_type === shiftType;
    });
  }

  // ===== Week Navigation =====

  function initWeekNav() {
    var prevBtn = document.getElementById('roster-prev-week');
    var nextBtn = document.getElementById('roster-next-week');
    var currentBtn = document.getElementById('roster-current-week');
    var importBtn = document.getElementById('roster-import-btn');

    if (prevBtn) {
      prevBtn.addEventListener('click', function() {
        currentWeekStart = addDays(currentWeekStart, -7);
        load();
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', function() {
        currentWeekStart = addDays(currentWeekStart, 7);
        load();
      });
    }
    if (currentBtn) {
      currentBtn.addEventListener('click', function() {
        currentWeekStart = getWeekStart(new Date());
        load();
      });
    }
    if (importBtn) {
      importBtn.addEventListener('click', openImportModal);
    }
  }

  // ===== Roster Modal =====

  function initRosterModal() {
    var cancelBtn = document.getElementById('roster-modal-cancel');
    var form = document.getElementById('roster-form');
    var overlay = document.querySelector('#roster-modal .modal-overlay');
    var deleteBtn = document.getElementById('roster-delete-btn');

    if (cancelBtn) cancelBtn.addEventListener('click', hideRosterModal);
    if (overlay) overlay.addEventListener('click', hideRosterModal);
    if (form) {
      form.addEventListener('submit', function(e) {
        e.preventDefault();
        submitRosterForm();
      });
    }
    if (deleteBtn) {
      deleteBtn.addEventListener('click', function(e) {
        e.preventDefault();
        deleteRosterEntry();
      });
    }
  }

  function openRosterModal(staff, dateKey, shiftType, entry) {
    var modal = document.getElementById('roster-modal');
    if (!modal) return;

    document.getElementById('roster-id').value = entry ? entry.id : '';
    document.getElementById('roster-staff-input').value = staff.id;
    var staffDisplay = document.getElementById('roster-staff-display');
    if (staffDisplay) staffDisplay.textContent = staff.name;
    document.getElementById('roster-date-input').value = dateKey;
    var startInput = document.getElementById('roster-start-input');
    var endInput = document.getElementById('roster-end-input');
    startInput.value = entry ? entry.start_time.slice(0, 5) : (shiftType === 'lunch' ? '11:00' : '17:00');
    endInput.value = entry ? entry.end_time.slice(0, 5) : (shiftType === 'lunch' ? '15:00' : '22:00');
    document.getElementById('roster-notes-input').value = entry ? (entry.notes || '') : '';
    document.getElementById('roster-shift-type-input').value = shiftType;

    // Update display dropdown
    var displaySelect = document.getElementById('roster-shift-type-display');
    if (displaySelect) {
      displaySelect.value = shiftType;
    }

    document.getElementById('roster-modal-title').textContent =
      (entry ? 'Edit' : 'Add') + ' ' + capitalize(shiftType) + ' Roster';
    document.getElementById('roster-delete-btn').classList.toggle('hidden', !entry);

    modal.classList.remove('hidden');
  }

  function hideRosterModal() {
    var modal = document.getElementById('roster-modal');
    if (modal) modal.classList.add('hidden');
  }

  async function submitRosterForm() {
    var rosterId = document.getElementById('roster-id').value;
    var staffId = document.getElementById('roster-staff-input').value;
    var date = document.getElementById('roster-date-input').value;
    var start = document.getElementById('roster-start-input').value;
    var end = document.getElementById('roster-end-input').value;
    var notes = document.getElementById('roster-notes-input').value.trim() || null;
    var shiftType = document.getElementById('roster-shift-type-input').value || 'lunch';

    if (!staffId || !date || !start || !end) {
      showToast('Staff, date, start time, and end time are required.', 'error');
      return;
    }

    // Enforce shift time constraints
    var startHour = parseInt(start.split(':')[0], 10);
    var endHour = parseInt(end.split(':')[0], 10);

    if (shiftType === 'lunch') {
      // Lunch: start must be AM (before 12:00), end must be PM (12:00+)
      if (startHour >= 12) {
        showToast('Lunch shift must start in the AM (before 12:00).', 'error');
        return;
      }
      if (endHour < 12) {
        showToast('Lunch shift must end in the PM (12:00 or later).', 'error');
        return;
      }
    } else if (shiftType === 'dinner') {
      // Dinner: start must be PM (12:00+), end must be AM (before 12:00) or late PM
      if (startHour < 12) {
        showToast('Dinner shift must start in the PM (12:00 or later).', 'error');
        return;
      }
      if (endHour >= 12 && end <= start) {
        showToast('Dinner shift end must be after start (or AM for late finishes).', 'error');
        return;
      }
    }

    try {
      if (rosterId) {
        await window.ClockDB.updateRosterEntry(rosterId, {
          startTime: start,
          endTime: end,
          notes: notes
        });
        showToast('Roster entry updated.', 'success');
      } else {
        await window.ClockDB.createRosterEntry({
          staffId: staffId,
          rosterDate: date,
          startTime: start,
          endTime: end,
          notes: notes,
          shiftType: shiftType
        });
        showToast('Roster entry created.', 'success');
      }
      hideRosterModal();
      load();
    } catch (err) {
      console.error('Failed to save roster:', err);
      showToast(err.message || 'Failed to save roster entry.', 'error');
    }
  }

  async function deleteRosterEntry() {
    var rosterId = document.getElementById('roster-id').value;
    if (!rosterId) return;
    if (!window.confirm('Delete this roster entry?')) return;

    try {
      await window.ClockDB.deleteRosterEntry(rosterId);
      showToast('Roster entry deleted.', 'success');
      hideRosterModal();
      load();
    } catch (err) {
      showToast(err.message || 'Failed to delete.', 'error');
    }
  }

  // ===== CSV Import =====

  function initImportModal() {
    var cancelBtn = document.getElementById('roster-import-cancel');
    var previewBtn = document.getElementById('roster-import-preview-btn');
    var submitBtn = document.getElementById('roster-import-submit');
    var overlay = document.querySelector('#roster-import-modal .modal-overlay');
    var fileInput = document.getElementById('roster-import-file');

    if (cancelBtn) cancelBtn.addEventListener('click', hideImportModal);
    if (overlay) overlay.addEventListener('click', hideImportModal);
    if (previewBtn) previewBtn.addEventListener('click', previewImport);
    if (submitBtn) submitBtn.addEventListener('click', submitImport);
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

  function openImportModal() {
    var modal = document.getElementById('roster-import-modal');
    if (!modal) return;

    document.getElementById('roster-import-file').value = '';
    document.getElementById('roster-import-text').value = '';
    document.getElementById('roster-import-preview').classList.add('hidden');
    document.getElementById('roster-import-summary').classList.add('hidden');
    document.getElementById('roster-import-preview-btn').classList.remove('hidden');
    document.getElementById('roster-import-submit').classList.add('hidden');
    importData = [];

    modal.classList.remove('hidden');
  }

  function hideImportModal() {
    var modal = document.getElementById('roster-import-modal');
    if (modal) modal.classList.add('hidden');
  }

  function parseCSV(text) {
    var lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];

    var headers = lines[0].split(',').map(function(h) { return h.trim().toLowerCase(); });
    var rows = [];

    for (var i = 1; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      var cells = line.split(',').map(function(c) { return c.trim(); });
      if (cells.length < 4) continue;

      var row = {};
      for (var j = 0; j < headers.length && j < cells.length; j++) {
        row[headers[j]] = cells[j];
      }
      rows.push(row);
    }

    return rows;
  }

  async function previewImport() {
    var text = document.getElementById('roster-import-text').value.trim();
    if (!text) { showToast('Please paste or upload CSV data.', 'error'); return; }

    var parsed = parseCSV(text);
    if (parsed.length === 0) { showToast('No valid rows found in CSV.', 'error'); return; }

    var staffList = [];
    try { staffList = await window.ClockDB.getAllStaff(); } catch (err) {}

    var previewDiv = document.getElementById('roster-import-preview-content');
    var summaryDiv = document.getElementById('roster-import-summary');
    previewDiv.innerHTML = '';

    importData = [];
    var valid = 0;
    var invalid = 0;
    var errors = [];

    var table = buildPreviewTable();
    var tbody = document.createElement('tbody');

    parsed.forEach(function(row, idx) {
      var result = validateRow(row, staffList);
      var tr = buildPreviewRow(row, result);
      tbody.appendChild(tr);

      if (result.error) {
        invalid++;
        errors.push('Row ' + (idx + 1) + ': ' + result.error);
      } else {
        valid++;
        importData.push(result.data);
      }
    });

    table.appendChild(tbody);
    previewDiv.appendChild(table);
    document.getElementById('roster-import-preview').classList.remove('hidden');

    showImportSummary(summaryDiv, valid, invalid, errors);
  }

  function buildPreviewTable() {
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
    return table;
  }

  function buildPreviewRow(row, result) {
    var name = row.name || row['staff name'] || row.staff || '';
    var shift = result.data ? result.data.shiftType : inferShiftType(row);
    var date = row.date || row.roster_date || row['roster date'] || '';
    var start = row.start || row['start time'] || row.start_time || '';
    var end = row.end || row['end time'] || row.end_time || '';
    var notes = row.notes || row.note || '';

    var tr = document.createElement('tr');
    tr.className = result.error ? 'bg-red-50' : 'bg-green-50';
    tr.innerHTML =
      '<td class="p-2">' + (result.error ? '\u274c' : '\u2705') + '</td>' +
      '<td class="p-2">' + escapeHtml(name) + '</td>' +
      '<td class="p-2">' + escapeHtml(shift) + '</td>' +
      '<td class="p-2">' + escapeHtml(date) + '</td>' +
      '<td class="p-2">' + escapeHtml(start) + '</td>' +
      '<td class="p-2">' + escapeHtml(end) + '</td>' +
      '<td class="p-2 text-xs text-gray-500">' + (result.error ? escapeHtml(result.error) : escapeHtml(notes)) + '</td>';
    return tr;
  }

  function validateRow(row, staffList) {
    var name = row.name || row['staff name'] || row.staff || '';
    var date = row.date || row.roster_date || row['roster date'] || '';
    var start = row.start || row['start time'] || row.start_time || '';
    var end = row.end || row['end time'] || row.end_time || '';
    var notes = row.notes || row.note || '';
    var shiftType = inferShiftType(row);

    if (!name) return { error: 'Missing name' };

    var staff = staffList.find(function(s) { return s.name.toLowerCase() === name.toLowerCase(); });
    if (!staff) return { error: 'Staff not found: ' + name };

    if (!date) return { error: 'Missing date' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Invalid date format (use YYYY-MM-DD)' };
    if (!start) return { error: 'Missing start time' };
    if (!/^\d{2}:\d{2}$/.test(start)) return { error: 'Invalid start time (use HH:MM)' };
    if (!end) return { error: 'Missing end time' };
    if (!/^\d{2}:\d{2}$/.test(end)) return { error: 'Invalid end time (use HH:MM)' };
    if (start >= end) return { error: 'Start time must be before end time' };

    return {
      error: null,
      data: {
        staffId: staff.id,
        date: date,
        startTime: start,
        endTime: end,
        notes: notes || null,
        shiftType: shiftType
      }
    };
  }

  function inferShiftType(row) {
    var shift = row.shift || row['shift type'] || row.shift_type || row.type || 'lunch';
    var lower = shift.toLowerCase();
    if (lower.indexOf('dinner') !== -1 || lower.indexOf('evening') !== -1) return 'dinner';
    return 'lunch';
  }

  function showImportSummary(div, valid, invalid, errors) {
    div.classList.remove('hidden');
    if (invalid === 0) {
      div.className = 'mb-4 p-3 rounded-lg bg-green-100 text-green-800';
      div.textContent = '\u2705 All ' + valid + ' rows valid. Ready to import.';
      document.getElementById('roster-import-preview-btn').classList.add('hidden');
      document.getElementById('roster-import-submit').classList.remove('hidden');
    } else {
      div.className = 'mb-4 p-3 rounded-lg bg-red-100 text-red-800';
      div.innerHTML = '\u274c ' + valid + ' valid, ' + invalid + ' invalid. Fix errors and preview again.' +
        '<div class="mt-2 text-xs">' + errors.slice(0, 5).map(function(e) { return '<div>' + escapeHtml(e) + '</div>'; }).join('') +
        (errors.length > 5 ? '<div>...and ' + (errors.length - 5) + ' more</div>' : '') + '</div>';
    }
  }

  async function submitImport() {
    if (importData.length === 0) { showToast('No valid rows to import.', 'error'); return; }

    var submitBtn = document.getElementById('roster-import-submit');
    if (submitBtn) submitBtn.disabled = true;

    var success = 0;
    var failed = 0;
    var errors = [];

    for (var i = 0; i < importData.length; i++) {
      var row = importData[i];
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
        var handled = await tryUpdateExisting(row);
        if (handled) {
          success++;
        } else {
          failed++;
          errors.push('Row ' + (i + 1) + ': ' + (err.message || 'Failed'));
        }
      }
    }

    if (submitBtn) submitBtn.disabled = false;
    showImportResult(success, failed, errors);
  }

  async function tryUpdateExisting(row) {
    try {
      var weekStart = getWeekStart(new Date(row.date));
      var weekEnd = addDays(weekStart, 6);
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
        return true;
      }
    } catch (e) {}
    return false;
  }

  function showImportResult(success, failed, errors) {
    var summaryDiv = document.getElementById('roster-import-summary');
    summaryDiv.classList.remove('hidden');

    if (failed === 0) {
      summaryDiv.className = 'mb-4 p-3 rounded-lg bg-green-100 text-green-800';
      summaryDiv.textContent = '\u2705 Imported ' + success + ' roster entries successfully!';
      showToast('Roster imported: ' + success + ' entries.', 'success');
      setTimeout(function() {
        hideImportModal();
        load();
      }, 1500);
    } else {
      summaryDiv.className = 'mb-4 p-3 rounded-lg bg-yellow-100 text-yellow-800';
      summaryDiv.innerHTML = '\u26a0\uFE0F ' + success + ' imported, ' + failed + ' failed.' +
        '<div class="mt-2 text-xs">' + errors.slice(0, 3).map(function(e) { return '<div>' + escapeHtml(e) + '</div>'; }).join('') + '</div>';
      showToast('Import partial: ' + success + ' ok, ' + failed + ' failed.', 'warning');
    }
  }

  // ===== Utilities =====

  function getWeekStart(date) {
    var d = new Date(date);
    var day = d.getDay();
    var diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function addDays(date, days) {
    var d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  function formatDateKey(date) {
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, '0');
    var d = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  function formatDisplayDate(date) {
    return date.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

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

  // ===== Expose =====
  window.ClockAdminRoster = {
    initControls: initControls,
    load: load,
    getCurrentWeekStart: getCurrentWeekStart
  };
})();