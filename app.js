/**
 * app.js - Core Application Module (Global Scope Version)
 *
 * Handles:
 * - View routing with smooth transitions
 * - Clock status display (active/inactive with elapsed timer)
 * - Clock on/off actions with ±10 minute time picker enforcement
 * - Shift history display
 * - Toast/notification system
 * - Error handling for all network and DB operations
 */

(function() {
  'use strict';

  // ===== State =====
  var currentShift = null;
  var serverTime = null;
  var timeWindowMin = null;
  var timeWindowMax = null;
  var durationTimer = null;
  var isTimePickerOpen = false;

  // ===== Toast System =====

  function showToast(message, type, duration) {
    type = type || 'info';
    duration = duration || 4000;
    var container = document.getElementById('toast-container');
    if (!container) return;

    var toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.textContent = message;

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

    if (!statusIndicator || !statusText || !shiftDuration || !actionBtn) return;

    if (currentShift) {
      // Clocked ON
      statusIndicator.className = 'status-indicator mb-4 clocked-on';
      statusText.textContent = 'Clocked On';
      shiftDuration.classList.remove('hidden');
      actionBtn.textContent = 'Clock Off';
      actionBtn.className = 'w-full py-4 text-xl font-bold rounded-lg mb-4 transition-colors clocked-on';
      startDurationTimer();
    } else {
      // Clocked OFF
      statusIndicator.className = 'status-indicator mb-4 clocked-off';
      statusText.textContent = 'Clocked Off';
      shiftDuration.classList.add('hidden');
      actionBtn.textContent = 'Clock On';
      actionBtn.className = 'w-full py-4 text-xl font-bold rounded-lg mb-4 transition-colors clocked-off';
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

  // ===== Time Picker (±10 min enforcement) =====

  /**
   * Fetch server time and initialize the time picker.
   * Defaults to server time. Calculates min/max window.
   */
  async function initTimePicker() {
    var timePicker = document.getElementById('time-picker');
    var timePickerHint = document.getElementById('time-picker-hint');

    if (!timePicker || !timePickerHint) return;

    try {
      if (!window.ClockDB) throw new Error('Database not initialized');

      serverTime = await window.ClockDB.getServerTime();
      timeWindowMin = new Date(serverTime.getTime() - 10 * 60 * 1000);
      timeWindowMax = new Date(serverTime.getTime() + 10 * 60 * 1000);

      // Set picker to server time
      var hours = String(serverTime.getHours()).padStart(2, '0');
      var minutes = String(serverTime.getMinutes()).padStart(2, '0');
      timePicker.value = hours + ':' + minutes;

      // Update hint with allowed window
      var minStr = timeWindowMin.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
      var maxStr = timeWindowMax.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
      timePickerHint.textContent = 'Allowed window: ' + minStr + ' \u2013 ' + maxStr;
      timePickerHint.className = 'text-xs text-gray-500 mt-1';

    } catch (error) {
      console.error('Failed to get server time:', error);
      showToast('Using device time (server unavailable). Window is \u00b110 min.', 'info', 5000);

      // Fallback to client time
      var now = new Date();
      serverTime = now;
      timeWindowMin = new Date(now.getTime() - 10 * 60 * 1000);
      timeWindowMax = new Date(now.getTime() + 10 * 60 * 1000);

      var h = String(now.getHours()).padStart(2, '0');
      var m = String(now.getMinutes()).padStart(2, '0');
      timePicker.value = h + ':' + m;

      var minStr2 = timeWindowMin.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
      var maxStr2 = timeWindowMax.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
      timePickerHint.textContent = 'Device time window: ' + minStr2 + ' \u2013 ' + maxStr2;
      timePickerHint.className = 'text-xs text-orange-600 mt-1';
    }

    // Set min/max attributes for native time picker constraints
    timePicker.min = formatTimeInput(timeWindowMin);
    timePicker.max = formatTimeInput(timeWindowMax);
  }

  /**
   * Format a Date as HH:MM for input[type=time] min/max attributes
   */
  function formatTimeInput(date) {
    var h = String(date.getHours()).padStart(2, '0');
    var m = String(date.getMinutes()).padStart(2, '0');
    return h + ':' + m;
  }

  /**
   * Validate selected time is within ±10 minute window.
   * Returns Date object if valid, null if invalid.
   */
  function getSelectedTime() {
    var timePicker = document.getElementById('time-picker');
    if (!timePicker) return null;

    var value = timePicker.value;
    if (!value) return null;

    var parts = value.split(':');
    if (parts.length !== 2) return null;

    var hours = parseInt(parts[0], 10);
    var minutes = parseInt(parts[1], 10);

    if (isNaN(hours) || isNaN(minutes)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

    // Build selected time using the same calendar date as serverTime
    var base = serverTime || new Date();
    var selected = new Date(base);
    selected.setHours(hours, minutes, 0, 0);

    // Handle midnight-crossing edge case:
    // If serverTime is 00:05 and user picks 23:58, that's -7 minutes (within window).
    // If serverTime is 23:58 and user picks 00:05, that's +7 minutes (within window).
    var diffMs = selected.getTime() - base.getTime();
    var tenMinMs = 10 * 60 * 1000;

    // If the naive diff is more than 10 min, try shifting by one day to see if it's the cross-midnight case
    if (diffMs > tenMinMs) {
      selected.setDate(selected.getDate() - 1);
      diffMs = selected.getTime() - base.getTime();
    } else if (diffMs < -tenMinMs) {
      selected.setDate(selected.getDate() + 1);
      diffMs = selected.getTime() - base.getTime();
    }

    if (diffMs < -tenMinMs || diffMs > tenMinMs) {
      return null;
    }

    return selected;
  }

  /**
   * Show time picker panel.
   * Re-fetches server time each time to ensure accuracy.
   */
  async function showTimePicker() {
    if (isTimePickerOpen) return;
    var container = document.getElementById('time-picker-container');
    var actionBtn = document.getElementById('clock-action-btn');
    if (!container || !actionBtn) return;

    actionBtn.disabled = true;

    try {
      await initTimePicker();
      container.classList.remove('hidden');
      isTimePickerOpen = true;
    } catch (e) {
      console.error('Failed to open time picker:', e);
      showToast('Could not open time picker. Try again.', 'error');
      actionBtn.disabled = false;
    }
  }

  /**
   * Close time picker without action.
   */
  function hideTimePicker() {
    var container = document.getElementById('time-picker-container');
    var actionBtn = document.getElementById('clock-action-btn');
    if (container) container.classList.add('hidden');
    if (actionBtn) actionBtn.disabled = false;
    isTimePickerOpen = false;
  }

  /**
   * Confirm time selection and execute clock action.
   */
  async function confirmTimeAction() {
    var selectedTime = getSelectedTime();
    var actionBtn = document.getElementById('clock-action-btn');

    if (!selectedTime) {
      showToast('Selected time is outside the allowed \u00b110 minute window.', 'error', 5000);
      return;
    }

    if (!window.ClockAuth || !window.ClockAuth.getSession()) {
      showToast('Not authenticated. Please log in again.', 'error');
      return;
    }

    var session = window.ClockAuth.getSession();
    var isClockOn = !currentShift;

    try {
      if (actionBtn) actionBtn.disabled = true;
      hideTimePicker();

      var baseTime = serverTime || new Date();
      var adjusted = Math.abs(selectedTime.getTime() - baseTime.getTime()) > 60 * 1000;
      var isoTime = selectedTime.toISOString();

      if (isClockOn) {
        var newShift = await window.ClockDB.clockOn(isoTime, adjusted);
        currentShift = newShift;
        updateStatusDisplay();

        var timeStr = window.ClockDB.formatTime(isoTime);
        var adjStr = adjusted ? ' (adjusted)' : '';
        showToast('Clocked on at ' + timeStr + adjStr, 'success');
      } else {
        if (!currentShift || !currentShift.id) {
          throw new Error('No active shift to clock off from.');
        }
        var updatedShift = await window.ClockDB.clockOff(currentShift.id, isoTime, adjusted);
        var durationMs = window.ClockDB.calculateDuration(currentShift.clock_in, isoTime);
        var durationStr = window.ClockDB.formatDuration(durationMs);

        currentShift = null;
        stopDurationTimer();
        updateStatusDisplay();

        var timeStr2 = window.ClockDB.formatTime(isoTime);
        var adjStr2 = adjusted ? ' (adjusted)' : '';
        showToast('Clocked off at ' + timeStr2 + adjStr2 + ' \u2022 Shift: ' + durationStr, 'success');
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
    if (!actionBtn) return;

    actionBtn.addEventListener('click', function(e) {
      e.preventDefault();
      showTimePicker();
    });
  }

  // ===== Time Picker Buttons =====

  function initTimePickerButtons() {
    var timeCancel = document.getElementById('time-cancel');
    var timeConfirm = document.getElementById('time-confirm');

    if (timeCancel) {
      timeCancel.addEventListener('click', function(e) {
        e.preventDefault();
        hideTimePicker();
      });
    }

    if (timeConfirm) {
      timeConfirm.addEventListener('click', function(e) {
        e.preventDefault();
        confirmTimeAction();
      });
    }

    // Also listen for Enter key in the time picker input
    var timePicker = document.getElementById('time-picker');
    if (timePicker) {
      timePicker.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          confirmTimeAction();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          hideTimePicker();
        }
      });
    }
  }

  // ===== My Shifts View =====

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

      var shifts = await window.ClockDB.getStaffShifts(session.id, 30);
      shiftsLoading.classList.add('hidden');

      if (!shifts || shifts.length === 0) {
        shiftsEmpty.classList.remove('hidden');
        return;
      }

      shifts.forEach(function(shift) {
        shiftsList.appendChild(createShiftCard(shift));
      });

    } catch (error) {
      console.error('Failed to load shifts:', error);
      shiftsLoading.classList.add('hidden');
      showToast('Failed to load shifts. ' + (error.message || ''), 'error');
    }
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
        if (window.ClockAuth.isAdmin()) {
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
    stopDurationTimer();
  }

  // ===== Main Initialization =====

  async function init() {
    initClockAction();
    initTimePickerButtons();
    initNavigation();

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
    initTimePicker: initTimePicker
  };
})();
