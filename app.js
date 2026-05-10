/**
 * app.js - Core Application Module (Global Scope Version)
 *
 * Handles:
 * - View routing with smooth transitions
 * - Clock status display (active/inactive with elapsed timer)
 * - Clock on/off actions (auto-rounded: up for on, down for off)
 * - Shift history display
 * - Toast/notification system
 * - Error handling for all network and DB operations
 */

(function() {
  'use strict';

  // ===== State =====
  var currentShift = null;
  var serverTime = null;
  var durationTimer = null;

  // ===== Break State =====
  var currentBreak = null;
  var breakTimerInterval = null;

  // ===== Roster State =====
  var upcomingRoster = null;

  // ===== Late/Early Check Helper =====

  /**
   * Check if actual time is significantly different from expected time.
   * @param {Date|string} actualTime - The actual clock on/off time
   * @param {string|null} expectedTime - Expected time as "HH:MM" string, or null
   * @param {string} action - 'on' or 'off' for message wording
   * @returns {object|null} - { message: string, severity: string } or null
   */
  function checkLateEarly(actualTime, expectedTime, action) {
    if (!expectedTime || typeof expectedTime !== 'string') {
      return null;
    }

    // Parse expected time "HH:MM"
    var parts = expectedTime.split(':');
    if (parts.length !== 2) return null;

    var expHours = parseInt(parts[0], 10);
    var expMinutes = parseInt(parts[1], 10);
    if (isNaN(expHours) || isNaN(expMinutes)) return null;

    // Build expected Date on same day as actualTime
    var actual = new Date(actualTime);
    var expected = new Date(actual);
    expected.setHours(expHours, expMinutes, 0, 0);

    // Calculate minute difference (accounting for midnight crossing)
    var diffMs = actual.getTime() - expected.getTime();
    // Normalize to same-day comparison: if diff is > 12h, adjust by 24h
    var twelveHours = 12 * 60 * 60 * 1000;
    if (diffMs > twelveHours) {
      expected.setDate(expected.getDate() + 1);
      diffMs = actual.getTime() - expected.getTime();
    } else if (diffMs < -twelveHours) {
      expected.setDate(expected.getDate() - 1);
      diffMs = actual.getTime() - expected.getTime();
    }

    var diffMinutes = Math.round(diffMs / 60000);
    if (Math.abs(diffMinutes) <= 15) {
      return null; // Within threshold, no alert
    }

    var absMinutes = Math.abs(diffMinutes);
    var isLate = diffMinutes > 0;
    var verb = action === 'on'
      ? (isLate ? 'Started' : 'Started early')
      : (isLate ? 'Finished' : 'Finished early');

    var severity;
    var message;
    if (absMinutes > 30) {
      severity = 'alert'; // orange
      var suffix = action === 'on' ? ' — check with manager?' : ' — check with manager?';
      message = verb + ' ' + absMinutes + ' min ' + (isLate ? 'late' : 'early') + suffix;
    } else {
      severity = 'warning'; // yellow
      message = verb + ' ' + absMinutes + ' min ' + (isLate ? 'late' : 'early');
    }

    return { message: message, severity: severity };
  }

  // ===== Break Timer =====

  function startBreakTimer() {
    stopBreakTimer();
    updateBreakTimerDisplay();
    breakTimerInterval = setInterval(updateBreakTimerDisplay, 1000);
  }

  function stopBreakTimer() {
    if (breakTimerInterval) {
      clearInterval(breakTimerInterval);
      breakTimerInterval = null;
    }
  }

  function updateBreakTimerDisplay() {
    var breakTimerEl = document.getElementById('break-timer-display');
    if (!breakTimerEl || !currentBreak || !currentBreak.break_start) {
      if (breakTimerEl) breakTimerEl.classList.add('hidden');
      return;
    }
    var start = new Date(currentBreak.break_start);
    var now = serverTime ? new Date(serverTime.getTime() + (Date.now() - serverTime.getTime())) : new Date();
    var diff = now - start;
    var mins = Math.floor(diff / 60000);
    var secs = Math.floor((diff % 60000) / 1000);
    breakTimerEl.textContent = 'Break: ' + String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
    breakTimerEl.classList.remove('hidden');
  }

  // ===== Toast System =====

  function showToast(message, type, duration) {
    type = type || 'info';
    duration = duration || 4000;
    var container = document.getElementById('toast-container');
    if (!container) return;

    var toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.textContent = message;

    // Click to dismiss
    toast.addEventListener('click', function() {
      if (toast.classList.contains('hiding')) return;
      toast.classList.add('hiding');
      setTimeout(function() {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    });

    container.appendChild(toast);

    setTimeout(function() {
      toast.classList.add('hiding');
      setTimeout(function() {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 350);
    }, duration);
  }

  // ===== Clock Status Display =====

  function updateStatusDisplay() {
    var statusIndicator = document.getElementById('status-indicator');
    var statusText = statusIndicator ? statusIndicator.querySelector('.status-text') : null;
    var shiftDuration = document.getElementById('shift-duration');
    var actionBtn = document.getElementById('clock-action-btn');
    var breakBtn = document.getElementById('break-action-btn');
    var breakTimerEl = document.getElementById('break-timer-display');
    var nextShiftCard = document.getElementById('next-shift-card');
    var nextShiftText = document.getElementById('next-shift-text');

    if (!statusIndicator || !statusText || !shiftDuration || !actionBtn) return;

    // Update next shift display
    if (nextShiftCard && nextShiftText) {
      if (upcomingRoster) {
        var rDate = new Date(upcomingRoster.roster_date);
        var dateStr = rDate.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
        nextShiftText.textContent = 'Next shift: ' + dateStr + ', ' +
          upcomingRoster.start_time.slice(0, 5) + ' — ' + upcomingRoster.end_time.slice(0, 5);
        nextShiftCard.classList.remove('hidden');
      } else {
        nextShiftCard.classList.add('hidden');
      }
    }

    if (currentShift) {
      if (currentBreak) {
        // On Break
        statusIndicator.className = 'status-indicator mb-4 status-on-break';
        statusText.textContent = 'On Break';
        shiftDuration.classList.remove('hidden');
        actionBtn.textContent = 'Clock Off';
        actionBtn.className = 'w-full py-4 text-xl font-bold rounded-lg mb-4 transition-colors clocked-on';
        if (breakBtn) {
          breakBtn.textContent = 'End Break';
          breakBtn.className = 'break-btn break-btn-active w-full mb-4';
          breakBtn.classList.remove('hidden');
        }
        startBreakTimer();
      } else {
        // Clocked On, Not On Break
        statusIndicator.className = 'status-indicator mb-4 clocked-on';
        statusText.textContent = 'Clocked On';
        shiftDuration.classList.remove('hidden');
        actionBtn.textContent = 'Clock Off';
        actionBtn.className = 'w-full py-4 text-xl font-bold rounded-lg mb-4 transition-colors clocked-on';
        if (breakBtn) {
          breakBtn.textContent = 'Start Break';
          breakBtn.className = 'break-btn w-full mb-4';
          breakBtn.classList.remove('hidden');
        }
        if (breakTimerEl) breakTimerEl.classList.add('hidden');
        stopBreakTimer();
        startDurationTimer();
      }
    } else {
      // Clocked Off
      statusIndicator.className = 'status-indicator mb-4 clocked-off';
      statusText.textContent = 'Clocked Off';
      shiftDuration.classList.add('hidden');
      actionBtn.textContent = 'Clock On';
      actionBtn.className = 'w-full py-4 text-xl font-bold rounded-lg mb-4 transition-colors clocked-off';
      if (breakBtn) breakBtn.classList.add('hidden');
      if (breakTimerEl) breakTimerEl.classList.add('hidden');
      stopBreakTimer();
      stopDurationTimer();
    }
  }

  function startDurationTimer() {
    stopDurationTimer();
    updateDurationDisplay();
    durationTimer = setInterval(updateDurationDisplay, 1000);
  }

  function updateDurationDisplay() {
    if (!currentShift || !window.ClockDB) return;
    var duration = document.getElementById('shift-duration');
    if (!duration) return;
    var ms = window.ClockDB.calculateDuration(currentShift.clock_in, null);
    duration.textContent = window.ClockDB.formatDuration(ms);
  }

  function stopDurationTimer() {
    if (durationTimer) {
      clearInterval(durationTimer);
      durationTimer = null;
    }
  }

  // ===== Direct Clock Action (no picker) =====

  /**
   * Execute clock on/off with auto-rounded time.
   * Clock ON: rounds UP to nearest 5 min.
   * Clock OFF: rounds DOWN to nearest 5 min.
   */
  async function doClockAction() {
    var actionBtn = document.getElementById('clock-action-btn');
    if (!window.ClockAuth || !window.ClockAuth.getSession()) {
      showToast('Not authenticated. Please log in again.', 'error');
      return;
    }

    try {
      if (actionBtn) actionBtn.disabled = true;

      // Get server time
      var now;
      try {
        if (!window.ClockDB) throw new Error('DB not ready');
        now = await window.ClockDB.getServerTime();
      } catch (e) {
        console.warn('Server time unavailable, using device time:', e.message);
        now = new Date();
      }

      var isClockOn = !currentShift;
      var rounded = new Date(now.getTime());

      if (isClockOn) {
        // Round UP to nearest 5 min
        var m = rounded.getMinutes();
        var rem = m % 5;
        if (rem !== 0) {
          rounded.setMinutes(m + (5 - rem), 0, 0);
        } else {
          rounded.setSeconds(0, 0);
        }
      } else {
        // Round DOWN to nearest 5 min
        rounded.setMinutes(Math.floor(rounded.getMinutes() / 5) * 5, 0, 0);
      }

      var adjusted = Math.abs(rounded.getTime() - now.getTime()) > 60 * 1000;
      var isoTime = rounded.toISOString();

      if (isClockOn) {
        var newShift = await window.ClockDB.clockOn(isoTime, adjusted, null, true);
        currentShift = newShift;
        updateStatusDisplay();

        var timeStr = window.ClockDB.formatTime(isoTime);
        var adjStr = adjusted ? ' (adjusted)' : '';
        showToast('Clocked on at ' + timeStr + adjStr, 'success');

        // Late/early check
        try {
          var staff = await window.ClockDB.getCurrentStaff();
          if (staff && staff.expected_start_time) {
            var alertResult = checkLateEarly(isoTime, staff.expected_start_time, 'on');
            if (alertResult) {
              showToast(alertResult.message, alertResult.severity, 6000);
            }
          }
        } catch (checkErr) {
          console.warn('Late/early check failed for clock on:', checkErr.message);
        }
        if (actionBtn) actionBtn.disabled = false;
      } else {
        if (!currentShift || !currentShift.id) {
          throw new Error('No active shift to clock off from.');
        }
        if (currentBreak) {
          showToast('End your break first before clocking off.', 'error');
          if (actionBtn) actionBtn.disabled = false;
          return;
        }
        var updatedShift = await window.ClockDB.clockOff(currentShift.id, isoTime, adjusted);
        var durationMs = window.ClockDB.calculateDuration(currentShift.clock_in, isoTime);
        var durationStr = window.ClockDB.formatDuration(durationMs);

        currentShift = null;
        currentBreak = null;
        stopDurationTimer();
        updateStatusDisplay();

        var timeStr2 = window.ClockDB.formatTime(isoTime);
        var adjStr2 = adjusted ? ' (adjusted)' : '';
        showToast('Clocked off at ' + timeStr2 + adjStr2 + ' \u2022 Shift: ' + durationStr, 'success');

        // Late/early check
        try {
          var staffOff = await window.ClockDB.getCurrentStaff();
          if (staffOff && staffOff.expected_end_time) {
            var alertOff = checkLateEarly(isoTime, staffOff.expected_end_time, 'off');
            if (alertOff) {
              showToast(alertOff.message, alertOff.severity, 6000);
            }
          }
        } catch (checkErr) {
          console.warn('Late/early check failed for clock off:', checkErr.message);
        }
        if (actionBtn) actionBtn.disabled = false;
      }

    } catch (error) {
      console.error('Clock action failed:', error);
      showToast(error.message || 'Failed to record time. Please try again.', 'error');
      if (actionBtn) actionBtn.disabled = false;
    }
  }

  // ===== Clock Action Button =====

  function initClockAction() {
    var actionBtn = document.getElementById('clock-action-btn');
    if (actionBtn) {
      actionBtn.addEventListener('click', function(e) {
        e.preventDefault();
        doClockAction();
      });
    }

    var breakBtn = document.getElementById('break-action-btn');
    if (breakBtn) {
      breakBtn.addEventListener('click', function(e) {
        e.preventDefault();
        if (currentBreak) {
          endBreakAction();
        } else {
          startBreakAction();
        }
      });
    }
  }

  async function startBreakAction() {
    if (!currentShift || !currentShift.id) {
      showToast('You must be clocked on to start a break.', 'error');
      return;
    }
    if (currentBreak) {
      showToast('You are already on a break.', 'error');
      return;
    }
    var breakBtn = document.getElementById('break-action-btn');
    try {
      if (breakBtn) breakBtn.disabled = true;
      var result = await window.ClockDB.startBreak(currentShift.id);
      currentBreak = result;
      updateStatusDisplay();
      showToast('Break started', 'success');
    } catch (error) {
      console.error('Start break failed:', error);
      showToast(error.message || 'Failed to start break. Please try again.', 'error');
      // Refresh break state in case server thinks we're already on break
      try {
        var refreshedBreak = await window.ClockDB.getActiveBreak(currentShift.id);
        if (refreshedBreak) {
          currentBreak = refreshedBreak;
          updateStatusDisplay();
        }
      } catch (refreshErr) {
        console.error('Failed to refresh break state:', refreshErr);
      }
    } finally {
      if (breakBtn) breakBtn.disabled = false;
    }
  }

  async function endBreakAction() {
    if (!currentBreak || !currentBreak.id) {
      showToast('You are not currently on a break.', 'error');
      return;
    }
    var breakBtn = document.getElementById('break-action-btn');
    try {
      if (breakBtn) breakBtn.disabled = true;
      var result = await window.ClockDB.endBreak(currentBreak.id);
      currentBreak = null;
      updateStatusDisplay();
      showToast('Break ended', 'success');
    } catch (error) {
      console.error('End break failed:', error);
      showToast(error.message || 'Failed to end break. Please try again.', 'error');
      // Refresh break state in case break was already ended server-side
      if (currentShift && currentShift.id) {
        try {
          var refreshedBreak = await window.ClockDB.getActiveBreak(currentShift.id);
          if (!refreshedBreak) {
            currentBreak = null;
            updateStatusDisplay();
          }
        } catch (refreshErr) {
          console.error('Failed to refresh break state:', refreshErr);
        }
      }
    } finally {
      if (breakBtn) breakBtn.disabled = false;
    }
  }

  // ===== Date Grouping Helper (shared with admin) =====

  /**
   * Group shifts by calendar date (YYYY-MM-DD).
   * Returns a sorted array of { dateKey, dateLabel, shiftCount, totalHours, shifts }.
   * Active shifts counted in shiftCount but not totalHours.
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
          shiftCount: 0,
          totalHours: 0
        };
      }
      groups[dateKey].shifts.push(shift);
      groups[dateKey].shiftCount += 1;

      if (shift.clock_out) {
        var durationMs = window.ClockDB.calculateDuration(shift.clock_in, shift.clock_out);
        groups[dateKey].totalHours += durationMs / (1000 * 60 * 60);
      }
    });

    var result = Object.values(groups);
    result.sort(function(a, b) {
      if (a.dateKey === 'Unknown') return 1;
      if (b.dateKey === 'Unknown') return -1;
      return b.dateKey.localeCompare(a.dateKey);
    });

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
      group.totalHoursStr = Math.round(group.totalHours * 10) / 10;
    });

    return result;
  }

  function groupRosterByDate(roster) {
    if (!roster || roster.length === 0) return [];

    var groups = {};
    roster.forEach(function(entry) {
      var dateKey = entry.roster_date;
      if (!groups[dateKey]) {
        groups[dateKey] = { date: dateKey, entries: [] };
      }
      groups[dateKey].entries.push(entry);
    });

    var result = Object.values(groups);
    result.sort(function(a, b) { return a.date.localeCompare(b.date); });
    return result;
  }

  function buildShiftSection(shiftType, entries) {
    var section = document.createElement('div');
    section.className = 'sched-shift-section sched-shift-' + shiftType;

    var label = document.createElement('div');
    label.className = 'sched-shift-label';
    var icon = shiftType === 'lunch' ? '🍽' : '🌙';
    var text = shiftType === 'lunch' ? 'Lunch' : 'Dinner';
    label.innerHTML = icon + ' ' + text;
    section.appendChild(label);

    var shiftsWrap = document.createElement('div');
    shiftsWrap.className = 'sched-shift-entries';
    entries.forEach(function(entry) {
      shiftsWrap.appendChild(createRosterCard(entry));
    });
    section.appendChild(shiftsWrap);

    return section;
  }

  // ===== My Shifts View =====

  var currentShiftsView = 'worked'; // 'worked' | 'scheduled'

  function initShiftsToggle() {
    var workedBtn = document.getElementById('shifts-toggle-worked');
    var scheduledBtn = document.getElementById('shifts-toggle-scheduled');

    if (workedBtn) {
      workedBtn.addEventListener('click', function() {
        currentShiftsView = 'worked';
        updateShiftsToggleUI();
        loadMyShifts();
      });
    }
    if (scheduledBtn) {
      scheduledBtn.addEventListener('click', function() {
        currentShiftsView = 'scheduled';
        updateShiftsToggleUI();
        loadMyShifts();
      });
    }
  }

  function updateShiftsToggleUI() {
    var workedBtn = document.getElementById('shifts-toggle-worked');
    var scheduledBtn = document.getElementById('shifts-toggle-scheduled');
    if (!workedBtn || !scheduledBtn) return;

    if (currentShiftsView === 'worked') {
      workedBtn.className = 'flex-1 py-2 text-sm font-semibold rounded-md bg-white shadow text-gray-800 transition-all';
      scheduledBtn.className = 'flex-1 py-2 text-sm font-semibold rounded-md text-gray-500 hover:text-gray-700 transition-all';
    } else {
      workedBtn.className = 'flex-1 py-2 text-sm font-semibold rounded-md text-gray-500 hover:text-gray-700 transition-all';
      scheduledBtn.className = 'flex-1 py-2 text-sm font-semibold rounded-md bg-white shadow text-gray-800 transition-all';
    }
  }

  async function loadMyShifts() {
    var shiftsList = document.getElementById('shifts-list');
    var shiftsLoading = document.getElementById('shifts-loading');
    var shiftsEmpty = document.getElementById('shifts-empty');

    if (!shiftsList || !shiftsLoading || !shiftsEmpty) return;

    shiftsList.innerHTML = '';
    shiftsLoading.classList.remove('hidden');
    shiftsEmpty.classList.add('hidden');

    try {
      var session = window.ClockAuth.getSession();
      if (!session) {
        showToast('Not authenticated.', 'error');
        return;
      }

      if (currentShiftsView === 'scheduled') {
        // Load roster entries grouped by day with lunch/dinner distinction
        var roster = await window.ClockDB.getMyRoster(30);
        shiftsLoading.classList.add('hidden');

        if (!roster || roster.length === 0) {
          shiftsEmpty.textContent = 'No upcoming shifts scheduled';
          shiftsEmpty.classList.remove('hidden');
          return;
        }

        // Group by date
        var grouped = groupRosterByDate(roster);
        grouped.forEach(function(group) {
          var dayCard = document.createElement('div');
          dayCard.className = 'sched-day-card';

          // Day header
          var dayHeader = document.createElement('div');
          dayHeader.className = 'sched-day-header';
          var dayDate = new Date(group.date + 'T00:00:00');
          var todayStr = new Date().toISOString().slice(0, 10);
          var tomorrowStr = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
          var dayLabel;
          if (group.date === todayStr) {
            dayLabel = 'Today';
          } else if (group.date === tomorrowStr) {
            dayLabel = 'Tomorrow';
          } else {
            dayLabel = dayDate.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short' });
          }
          var isPast = group.date < todayStr;
          dayHeader.innerHTML =
            '<span class="sched-day-header-title">' + escapeHtml(dayLabel) + '</span>' +
            '<span class="sched-day-header-meta">' + group.date.slice(8, 10) + '/' + group.date.slice(5, 7) + '</span>' +
            (isPast ? '<span class="sched-day-past-badge">Past</span>' : '');
          dayCard.appendChild(dayHeader);

          // Lunch section
          var lunchEntries = group.entries.filter(function(e) { return e.shift_type === 'lunch'; });
          var dinnerEntries = group.entries.filter(function(e) { return e.shift_type === 'dinner'; });

          if (lunchEntries.length > 0) {
            dayCard.appendChild(buildShiftSection('lunch', lunchEntries));
          }
          if (dinnerEntries.length > 0) {
            dayCard.appendChild(buildShiftSection('dinner', dinnerEntries));
          }

          // Fallback for entries without shift_type (legacy data)
          var untyped = group.entries.filter(function(e) { return e.shift_type !== 'lunch' && e.shift_type !== 'dinner'; });
          if (untyped.length > 0) {
            untyped.forEach(function(entry) {
              dayCard.appendChild(createRosterCard(entry));
            });
          }

          shiftsList.appendChild(dayCard);
        });
      } else {
        // Load worked shifts
        var shifts = await window.ClockDB.getStaffShifts(session.id, 30);
        shiftsLoading.classList.add('hidden');

        if (!shifts || shifts.length === 0) {
          shiftsEmpty.textContent = 'No shifts recorded yet';
          shiftsEmpty.classList.remove('hidden');
          return;
        }

        var grouped = groupShiftsByDate(shifts);
        grouped.forEach(function(group) {
          var dateGroup = document.createElement('div');
          dateGroup.className = 'date-group';

          var header = document.createElement('div');
          header.className = 'date-group-header';
          header.innerHTML =
            '<div class="date-group-title">' + escapeHtml(group.dateLabel) + '</div>' +
            '<div class="date-group-meta">' +
              '<span>' + group.shiftCount + (group.shiftCount === 1 ? ' shift' : ' shifts') + '</span>' +
              '<span>•</span>' +
              '<span>' + group.totalHoursStr + (group.totalHoursStr === 1 ? ' hr' : ' hrs') + '</span>' +
            '</div>';

          header.addEventListener('click', function() {
            dateGroup.classList.toggle('date-group-collapsed');
          });

          var content = document.createElement('div');
          content.className = 'date-group-content';

          group.shifts.forEach(function(shift) {
            content.appendChild(createShiftCard(shift));
          });

          dateGroup.appendChild(header);
          dateGroup.appendChild(content);
          shiftsList.appendChild(dateGroup);
        });
      }
    } catch (error) {
      console.error('Failed to load shifts:', error);
      shiftsLoading.classList.add('hidden');
      showToast('Failed to load shifts. ' + (error.message || ''), 'error');
    }
  }

  function createRosterCard(entry) {
    var card = document.createElement('div');
    var shiftType = entry.shift_type || 'lunch';
    var isPast = entry.roster_date < new Date().toISOString().slice(0, 10);

    card.className = 'sched-shift-card ' + (isPast ? 'sched-past' : 'sched-upcoming');
    card.innerHTML =
      '<div class="sched-shift-times">' +
        '<span class="sched-time-start">' + (entry.start_time || '').slice(0, 5) + '</span>' +
        '<span class="sched-time-arrow">→</span>' +
        '<span class="sched-time-end">' + (entry.end_time || '').slice(0, 5) + '</span>' +
      '</div>' +
      (entry.notes ? '<div class="sched-shift-notes">' + escapeHtml(entry.notes) + '</div>' : '');

    return card;
  }

  function createShiftCard(shift) {
    var card = document.createElement('div');
    var isActive = !shift.clock_out;
    var dateStr = window.ClockDB.formatDate(shift.clock_in);
    var clockInStr = window.ClockDB.formatTime(shift.clock_in);
    var clockOutStr = shift.clock_out ? window.ClockDB.formatTime(shift.clock_out) : 'Active';
    var duration = shift.clock_out
      ? window.ClockDB.formatDuration(window.ClockDB.calculateDuration(shift.clock_in, shift.clock_out))
      : 'In progress';

    var adjustedBadges = [];
    if (shift.clock_in_adjusted) {
      adjustedBadges.push('<span class="shift-adjusted-badge">in adjusted</span>');
    }
    if (shift.clock_out_adjusted) {
      adjustedBadges.push('<span class="shift-adjusted-badge">out adjusted</span>');
    }

    // Break info
    var breakInfo = '';
    if (shift.breaks && shift.breaks.length > 0) {
      var breakCount = shift.breaks.length;
      var totalBreakMs = 0;
      shift.breaks.forEach(function(b) {
        if (b.break_end) {
          totalBreakMs += new Date(b.break_end) - new Date(b.break_start);
        }
      });
      var totalBreakMin = Math.round(totalBreakMs / 60000);
      var breakLabel = breakCount === 1 ? '1 break' : breakCount + ' breaks';
      breakInfo = '<div class="text-xs text-amber-600 font-medium mt-1 flex items-center gap-1">' +
        '<span>\u2615</span>' +
        '<span>' + breakLabel + ' \u2022 ' + totalBreakMin + ' min total</span>' +
      '</div>';
    }

    card.className = 'shift-card ' + (isActive ? 'active' : 'completed');
    card.innerHTML =
      '<div class="flex justify-between items-start mb-2">' +
        '<span class="font-semibold text-gray-800">' + escapeHtml(dateStr) + '</span>' +
        (adjustedBadges.length ? adjustedBadges.join('') : '') +
      '</div>' +
      '<div class="flex justify-between items-center">' +
        '<div class="shift-time">' +
          '<span class="text-green-600 font-medium">' + escapeHtml(clockInStr) + '</span>' +
          '<span class="mx-2">\u2192</span>' +
          '<span class="' + (isActive ? 'text-orange-600 font-medium' : 'text-red-600 font-medium') + '">' + escapeHtml(clockOutStr) + '</span>' +
        '</div>' +
        '<div class="shift-duration">' + escapeHtml(duration) + '</div>' +
      '</div>' +
      breakInfo +
      (shift.notes ? '<p class="text-sm text-gray-500 mt-2">' + escapeHtml(shift.notes) + '</p>' : '');

    return card;
  }

  function escapeHtml(text) {
    if (typeof text !== 'string') return '';
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ===== Navigation =====

  function initNavigation() {
    // My Shifts button on main screen
    var myShiftsBtn = document.getElementById('my-shifts-btn');
    if (myShiftsBtn) {
      myShiftsBtn.addEventListener('click', function(e) {
        e.preventDefault();
        window.ClockAuth.showScreen('shifts');
        loadMyShifts();
      });
    }

    // Back button from shifts screen
    var shiftsBackBtn = document.getElementById('shifts-back-btn');
    if (shiftsBackBtn) {
      shiftsBackBtn.addEventListener('click', function(e) {
        e.preventDefault();
        window.ClockAuth.showScreen('app');
      });
    }

    // Admin panel button (conditional)
    var adminPanelBtn = document.getElementById('admin-panel-btn');
    if (adminPanelBtn) {
      adminPanelBtn.addEventListener('click', function(e) {
        e.preventDefault();
        if (window.ClockAuth.isAdminOrObserver()) {
          window.ClockAuth.showScreen('admin');
          // Initialize admin panel if available
          if (window.ClockAdmin && typeof window.ClockAdmin.initAdmin === 'function') {
            window.ClockAdmin.initAdmin();
          }
        } else {
          showToast('Admin access required.', 'error');
        }
      });
    }

    // Bottom navigation
    document.querySelectorAll('.nav-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        var view = btn.dataset.view;

        // Update active nav state
        document.querySelectorAll('.nav-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');

        if (view === 'home') {
          window.ClockAuth.showScreen('app');
        } else if (view === 'shifts') {
          window.ClockAuth.showScreen('shifts');
          loadMyShifts();
        }
      });
    });
  }

  // ===== Session Event Handlers =====

  async function handleLogin() {
    try {
      if (!window.ClockDB || !window.ClockAuth) return;
      var session = window.ClockAuth.getSession();
      if (!session) return;

      currentShift = await window.ClockDB.getActiveShift(session.id);
      if (currentShift && currentShift.id) {
        currentBreak = await window.ClockDB.getActiveBreak(currentShift.id);
      } else {
        currentBreak = null;
      }

      // Load upcoming roster
      try {
        var roster = await window.ClockDB.getMyRoster(14);
        var todayStr = new Date().toISOString().slice(0, 10);
        var upcoming = roster && roster.filter(function(r) { return r.roster_date >= todayStr; });
        upcomingRoster = (upcoming && upcoming.length > 0) ? upcoming[0] : null;
        checkRosterForToday();
      } catch (rosterErr) {
        console.warn('Failed to load roster:', rosterErr);
        upcomingRoster = null;
      }

      updateStatusDisplay();

      // Refresh server time in background
      serverTime = await window.ClockDB.getServerTime();
    } catch (error) {
      console.error('Failed to load shift status:', error);
      showToast('Failed to load shift status. ' + (error.message || ''), 'error');
    }
  }

  function handleLogout() {
    currentShift = null;
    currentBreak = null;
    upcomingRoster = null;
    stopDurationTimer();
    stopBreakTimer();
  }

  // ===== Roster info alongside clock status =====
  // If staff is scheduled for today but not clocked on yet, show reminder
  function checkRosterForToday() {
    if (!upcomingRoster || currentShift) return;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var rosterDate = new Date(upcomingRoster.roster_date);
    rosterDate.setHours(0, 0, 0, 0);
    if (rosterDate.getTime() === today.getTime()) {
      var now = new Date();
      var startParts = upcomingRoster.start_time.split(':');
      var startHour = parseInt(startParts[0], 10);
      var startMin = parseInt(startParts[1], 10);
      var startTime = new Date(today);
      startTime.setHours(startHour, startMin, 0, 0);
      var diffMin = Math.round((startTime - now) / 60000);
      if (diffMin > 0 && diffMin <= 30) {
        showToast('Your shift starts at ' + upcomingRoster.start_time.slice(0, 5) + '. Don\'t forget to clock on!', 'info', 6000);
      }
    }
  }

  async function init() {
    initClockAction();
    initNavigation();
    initShiftsToggle();

    window.addEventListener('session:login', handleLogin);
    window.addEventListener('session:restored', handleLogin);
    window.addEventListener('session:logout', handleLogout);

    // If session already exists, load shift status
    if (window.ClockAuth && window.ClockAuth.getSession()) {
      await handleLogin();
    }
  }

  // ===== Expose globally =====
  window.ClockApp = {
    init: init,
    showToast: showToast,
    updateStatusDisplay: updateStatusDisplay,
    loadMyShifts: loadMyShifts,
    checkLateEarly: checkLateEarly
  };
})();
