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

  // ===== Constants =====
  var DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // ===== Public API =====

  function initControls() {
    initWeekNav();
    initRosterModal();

    initCopyWeekBtn();
  }

  async function load() {
    if (isLoading) return;
    isLoading = true;

    var session = window.ClockAuth ? window.ClockAuth.getSession() : null;
    var isObserverUser = session && session.role === 'observer';

    var container = document.getElementById('roster-grid-container');
    var loading = document.getElementById('roster-loading');
    var empty = document.getElementById('roster-empty');
    var weekLabel = document.getElementById('roster-week-label');
    var copyWeekBtn = document.getElementById('roster-copy-week-btn');

    if (!container) { isLoading = false; return; }

    if (!currentWeekStart) {
      currentWeekStart = getWeekStart(new Date());
    }

    var weekEnd = addDays(currentWeekStart, 6);
    if (weekLabel) {
      weekLabel.textContent = formatDisplayDate(currentWeekStart) + ' — ' + formatDisplayDate(weekEnd);
    }

    // Hide copy-week button for observers
    if (copyWeekBtn) {
      if (isObserverUser) {
        copyWeekBtn.classList.add('hidden');
      } else {
        copyWeekBtn.classList.remove('hidden');
      }
    }

    // Save scroll position before re-rendering
    var scrollParent = getScrollParent(container);
    var savedScrollTop = scrollParent ? scrollParent.scrollTop : 0;

    container.innerHTML = '';
    if (loading) loading.classList.remove('hidden');
    if (empty) empty.classList.add('hidden');

    try {
      var staffList = await window.ClockDB.getRosterStaff();
      var rosterEntries = await window.ClockDB.getRosterForWeek(
        formatDateKey(currentWeekStart),
        formatDateKey(weekEnd)
      );

      if (loading) loading.classList.add('hidden');

      var wrapper = buildRosterCards(staffList, rosterEntries);
      container.appendChild(wrapper);

      // Restore scroll position after re-rendering
      if (scrollParent) {
        // Use requestAnimationFrame to ensure layout is complete before restoring
        var st = savedScrollTop;
        requestAnimationFrame(function() {
          scrollParent.scrollTop = st;
        });
      }

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

    var session = window.ClockAuth ? window.ClockAuth.getSession() : null;
    var isObserverUser = session && session.role === 'observer';

    staffList.forEach(function(staff) {
      var card = buildStaffCard(staff, rosterEntries, isObserverUser);
      wrapper.appendChild(card);
    });

    return wrapper;
  }

  function buildStaffCard(staff, rosterEntries, isObserverUser) {
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
    var lunchRow = buildShiftRow(staff, 'lunch', rosterEntries, isObserverUser);
    card.appendChild(lunchRow);

    // Dinner row
    var dinnerRow = buildShiftRow(staff, 'dinner', rosterEntries, isObserverUser);
    card.appendChild(dinnerRow);

    return card;
  }

  function buildShiftRow(staff, shiftType, rosterEntries, isObserverUser) {
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
      var cell = buildShiftCell(staff, dateKey, shiftType, entry, isObserverUser);
      row.appendChild(cell);
    }

    return row;
  }

  function buildShiftCell(staff, dateKey, shiftType, entry, isObserverUser) {
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

    if (!isObserverUser) {
      cell.addEventListener('click', function() {
        openRosterModal(staff, dateKey, shiftType, entry);
      });
    } else {
      cell.style.cursor = 'default';
    }

    return cell;
  }

  function findRosterEntry(entries, staffId, dateKey, shiftType) {
    return entries.find(function(r) {
      return (r.roster_staff_id || r.staff_id) === staffId && r.roster_date === dateKey && r.shift_type === shiftType;
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

    var session = window.ClockAuth ? window.ClockAuth.getSession() : null;
    var isObserverUser = session && session.role === 'observer';

    document.getElementById('roster-id').value = entry ? (entry.roster_id || entry.id) : '';
    document.getElementById('roster-staff-input').value = staff.id;
    var staffDisplay = document.getElementById('roster-staff-display');
    if (staffDisplay) staffDisplay.textContent = staff.name;
    document.getElementById('roster-date-input').value = dateKey;
    var startInput = document.getElementById('roster-start-input');
    var endInput = document.getElementById('roster-end-input');
    startInput.value = entry ? entry.start_time.slice(0, 5) : (shiftType === 'lunch' ? '10:30' : '17:00');
    endInput.value = entry ? entry.end_time.slice(0, 5) : (shiftType === 'lunch' ? '15:00' : '21:00');
    document.getElementById('roster-notes-input').value = entry ? (entry.notes || '') : '';
    document.getElementById('roster-shift-type-input').value = shiftType;

    // Update display dropdown
    var displaySelect = document.getElementById('roster-shift-type-display');
    if (displaySelect) {
      displaySelect.value = shiftType;
    }

    document.getElementById('roster-modal-title').textContent =
      (entry ? 'Edit' : 'Add') + ' ' + capitalize(shiftType) + ' Roster';

    // Observer: hide delete and save buttons, disable inputs
    var deleteBtn = document.getElementById('roster-delete-btn');
    var saveBtn = modal.querySelector('button[type="submit"]');
    var cancelBtn = document.getElementById('roster-modal-cancel');
    if (isObserverUser) {
      if (deleteBtn) deleteBtn.classList.add('hidden');
      if (saveBtn) saveBtn.classList.add('hidden');
      startInput.disabled = true;
      endInput.disabled = true;
      document.getElementById('roster-date-input').disabled = true;
      document.getElementById('roster-notes-input').disabled = true;
      if (displaySelect) displaySelect.disabled = true;
      // Change cancel to "Close" for observer
      if (cancelBtn) cancelBtn.textContent = 'Close';
    } else {
      if (deleteBtn) deleteBtn.classList.toggle('hidden', !entry);
      if (saveBtn) saveBtn.classList.remove('hidden');
      startInput.disabled = false;
      endInput.disabled = false;
      document.getElementById('roster-date-input').disabled = false;
      document.getElementById('roster-notes-input').disabled = false;
      if (displaySelect) displaySelect.disabled = true; // shift type is always disabled for editing
      if (cancelBtn) cancelBtn.textContent = 'Cancel';
    }

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
      // Dinner: both start and end must be PM (12:00+)
      if (startHour < 12) {
        showToast('Dinner shift must start in the PM (12:00 or later).', 'error');
        return;
      }
      if (endHour < 12) {
        showToast('Dinner shift must end in the PM (12:00 or later).', 'error');
        return;
      }
      if (end <= start) {
        showToast('Dinner shift end time must be after start time.', 'error');
        return;
      }
    }

    try {
      if (rosterId) {
        await window.ClockDB.updateRosterEntry(rosterId, {
          startTime: start,
          endTime: end,
          notes: notes,
          shiftType: shiftType
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

  // ===== Utilities =====

  function getScrollParent(el) {
    if (!el) return null;
    var parent = el.parentElement;
    while (parent) {
      var style = window.getComputedStyle(parent);
      var overflow = style.overflow + style.overflowY;
      if (/(auto|scroll)/.test(overflow)) {
        return parent;
      }
      parent = parent.parentElement;
    }
    return document.documentElement;
  }

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

  // ===== Copy Last Week's Roster =====

  function initCopyWeekBtn() {
    var btn = document.getElementById('roster-copy-week-btn');
    if (!btn) return;
    btn.addEventListener('click', function() {
      copyLastWeekRoster();
    });
  }

  async function copyLastWeekRoster() {
    var session = window.ClockAuth ? window.ClockAuth.getSession() : null;
    if (!session || session.role === 'observer') {
      showToast('Only admins can copy roster entries.', 'error');
      return;
    }

    if (!currentWeekStart) {
      showToast('No week selected.', 'error');
      return;
    }

    var prevWeekStart = addDays(currentWeekStart, -7);
    var prevWeekEnd = addDays(prevWeekStart, 6);
    var currentWeekEnd = addDays(currentWeekStart, 6);

    if (!window.confirm('Copy roster entries from ' + formatDisplayDate(prevWeekStart) + ' to ' + formatDisplayDate(prevWeekEnd) + ' into this week?')) {
      return;
    }

    // Disable button and show loading state
    var copyBtn = document.getElementById('roster-copy-week-btn');
    var origBtnText = copyBtn ? copyBtn.textContent : '';
    if (copyBtn) {
      copyBtn.disabled = true;
      copyBtn.textContent = 'Copying...';
    }

    try {
      // Fetch previous week's roster
      var prevEntries = await window.ClockDB.getRosterForWeek(
        formatDateKey(prevWeekStart),
        formatDateKey(prevWeekEnd)
      );

      if (!prevEntries || prevEntries.length === 0) {
        showToast('No roster entries found for last week.', 'info');
        return;
      }

      // Fetch current week's roster to check for conflicts
      var currentEntries = await window.ClockDB.getRosterForWeek(
        formatDateKey(currentWeekStart),
        formatDateKey(currentWeekEnd)
      );

      var created = 0;
      var skipped = 0;
      var errors = 0;

      for (var i = 0; i < prevEntries.length; i++) {
        var entry = prevEntries[i];
        // Shift the date forward by 7 days
        var origDate = new Date(entry.roster_date + 'T00:00:00');
        var newDate = addDays(origDate, 7);
        var newDateKey = formatDateKey(newDate);

        // Check if entry already exists for this staff/date/shift_type
        var conflict = currentEntries.find(function(e) {
          return (e.roster_staff_id || e.staff_id) === (entry.roster_staff_id || entry.staff_id)
            && e.roster_date === newDateKey
            && e.shift_type === entry.shift_type;
        });

        if (conflict) {
          skipped++;
          continue;
        }

        try {
          await window.ClockDB.createRosterEntry({
            staffId: entry.roster_staff_id || entry.staff_id,
            rosterDate: newDateKey,
            startTime: entry.start_time,
            endTime: entry.end_time,
            notes: entry.notes || null,
            shiftType: entry.shift_type || 'lunch'
          });
          created++;
        } catch (err) {
          errors++;
          console.error('Failed to copy roster entry:', err);
        }
      }

      var msg = 'Copied ' + created + ' entries';
      if (skipped > 0) msg += ', skipped ' + skipped + ' (already exist)';
      if (errors > 0) msg += ', ' + errors + ' errors';
      showToast(msg, errors > 0 ? 'warning' : 'success');
      isLoading = false; // Reset guard so load() proceeds
      load();
    } catch (err) {
      console.error('Failed to copy last week roster:', err);
      showToast(err.message || 'Failed to copy roster.', 'error');
    } finally {
      if (copyBtn) {
        copyBtn.disabled = false;
        copyBtn.textContent = origBtnText;
      }
    }
  }

  // ===== Expose =====
  window.ClockAdminRoster = {
    initControls: initControls,
    load: load,
    getCurrentWeekStart: getCurrentWeekStart
  };
})();