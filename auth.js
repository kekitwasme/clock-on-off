/**
 * auth.js - Authentication Module (Global Scope Version)
 *
 * Handles PIN entry, validation, session management, role detection,
 * and screen navigation.
 */

(function() {
  'use strict';

  // ===== State =====
  var currentSession = null;
  var SESSION_KEY = 'clockAppSession';
  var SESSION_MAX_AGE_HOURS = 8; // Auto-logout after 8 hours

  // ===== PIN Entry UI =====

  var pinState = { pin: '', isSubmitting: false };

  function initPinScreen() {
    var pinDisplay = document.getElementById('pin-display');
    var pinError = document.getElementById('pin-error');
    var pinEnter = document.getElementById('pin-enter');
    var pinClear = document.getElementById('pin-clear');

    function updateDisplay() {
      var dots = pinDisplay.querySelectorAll('.pin-dot');
      dots.forEach(function(dot, index) {
        if (index < pinState.pin.length) {
          dot.classList.add('filled');
        } else {
          dot.classList.remove('filled');
        }
      });
      var canSubmit = pinState.pin.length >= 4 && pinState.pin.length <= 6;
      pinEnter.disabled = !canSubmit;
      pinEnter.style.opacity = canSubmit ? '1' : '0.5';
    }

    function clearPin() {
      pinState.pin = '';
      pinState.isSubmitting = false;
      updateDisplay();
      pinError.classList.add('hidden');
    }

    function handleDigit(digit) {
      if (pinState.isSubmitting) return;
      if (pinState.pin.length >= 6) return;
      pinState.pin += digit;
      updateDisplay();
      pinError.classList.add('hidden');
      if (pinState.pin.length === 6) {
        submitPin(pinState.pin);
      }
    }

    function handleBackspace() {
      if (pinState.isSubmitting) return;
      pinState.pin = pinState.pin.slice(0, -1);
      updateDisplay();
    }

    function handleEnter() {
      if (pinState.isSubmitting) return;
      if (pinState.pin.length >= 4 && pinState.pin.length <= 6) {
        submitPin(pinState.pin);
      }
    }

    // Digit buttons
    document.querySelectorAll('.pin-btn[data-pin]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        handleDigit(btn.dataset.pin);
      });
    });

    // Clear button
    pinClear.addEventListener('click', function(e) {
      e.preventDefault();
      clearPin();
    });

    // Enter button
    pinEnter.addEventListener('click', function(e) {
      e.preventDefault();
      handleEnter();
    });

    // Physical keyboard
    document.addEventListener('keydown', function(e) {
      if (document.getElementById('pin-screen').classList.contains('hidden')) return;

      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        handleDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleEnter();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        clearPin();
      }
    });

    updateDisplay();
  }

  // ===== Staff Selector =====

  async function loadStaffSelector() {
    var selector = document.getElementById('staff-selector');
    if (!selector) return;

    try {
      var staffList = await window.ClockDB.getAllStaff();
      var activeStaff = staffList.filter(function(s) { return s.active; });

      // Clear existing options except the placeholder
      while (selector.options.length > 1) {
        selector.remove(1);
      }

      activeStaff.forEach(function(staff) {
        var option = document.createElement('option');
        option.value = staff.id;
        option.textContent = staff.name;
        selector.appendChild(option);
      });
    } catch (err) {
      console.warn('Failed to load staff list for selector:', err.message);
    }
  }

  // ===== PIN Submission =====

  async function submitPin(pin) {
    if (!window.ClockDB) {
      showPinError('System not ready. Please refresh.');
      return;
    }

    // Check staff selector
    var selector = document.getElementById('staff-selector');
    var selectedStaffId = selector ? selector.value : '';

    if (!selectedStaffId) {
      showPinError('Please select your name first.');
      return;
    }

    var pinError = document.getElementById('pin-error');
    var pinDisplay = document.getElementById('pin-display');

    try {
      // Show loading state
      pinError.textContent = 'Verifying...';
      pinError.className = 'text-blue-600 text-center text-sm mt-2';
      pinError.classList.remove('hidden');

      // Call server-side authentication (PIN hashed server-side with bcrypt)
      var result = await window.ClockDB.loginStaff(pin);

      if (!result || !result.staff || !result.token) {
        throw new Error('Invalid server response during login.');
      }

      var staff = result.staff;
      var token = result.token;

      // Verify selected staff matches authenticated staff
      if (staff.id !== selectedStaffId) {
        // Wrong person — PIN belongs to a different staff member
        pinState.pin = '';
        pinState.isSubmitting = false;
        var dots = pinDisplay.querySelectorAll('.pin-dot');
        dots.forEach(function(dot) { dot.classList.remove('filled'); });
        pinEnter.disabled = true;
        pinEnter.style.opacity = '0.5';

        pinError.textContent = 'That PIN doesn\'t match the selected name. Try again.';
        pinError.className = 'text-red-600 text-center text-sm mt-2';
        pinError.classList.remove('hidden');
        return;
      }

      if (!staff.active) {
        pinError.textContent = 'Account deactivated. Contact your manager.';
        pinError.className = 'text-red-600 text-center text-sm mt-2';
        return;
      }

      // Success — create session with server token
      await createSession({
        id: staff.id,
        name: staff.name,
        role: staff.role,
        active: staff.active,
        token: token
      });

    } catch (error) {
      console.error('Auth error:', error);

      // Shake dots on error
      var dots = pinDisplay.querySelectorAll('.pin-dot');
      dots.forEach(function(dot) {
        dot.classList.add('error');
        setTimeout(function() { dot.classList.remove('error'); }, 350);
      });

      pinError.textContent = error.message || 'Invalid PIN. Try again.';
      pinError.className = 'text-red-600 text-center text-sm mt-2';
      pinError.classList.remove('hidden');

      // Clear PIN after delay
      setTimeout(function() {
        pinState.pin = '';
        pinState.isSubmitting = false;
        updatePinDisplay();
        pinError.classList.add('hidden');
      }, 1200);
    }
  }

  function updatePinDisplay() {
    var pinDisplay = document.getElementById('pin-display');
    var pinEnter = document.getElementById('pin-enter');
    if (!pinDisplay) return;
    var dots = pinDisplay.querySelectorAll('.pin-dot');
    dots.forEach(function(dot, index) {
      if (index < pinState.pin.length) {
        dot.classList.add('filled');
      } else {
        dot.classList.remove('filled');
      }
    });
    var canSubmit = pinState.pin.length >= 4 && pinState.pin.length <= 6;
    if (pinEnter) {
      pinEnter.disabled = !canSubmit;
      pinEnter.style.opacity = canSubmit ? '1' : '0.5';
    }
  }

  function showPinError(msg) {
    var pinError = document.getElementById('pin-error');
    pinError.textContent = msg;
    pinError.className = 'text-red-600 text-center text-sm mt-2';
    pinError.classList.remove('hidden');
    setTimeout(function() {
      pinState.pin = '';
      pinState.isSubmitting = false;
      updatePinDisplay();
      pinError.classList.add('hidden');
    }, 2000);
  }

  // ===== Session Management =====

  async function createSession(staffData) {
    currentSession = {
      id: staffData.id,
      name: staffData.name,
      role: staffData.role,
      active: staffData.active,
      token: staffData.token,
      loginTime: new Date().toISOString()
    };

    localStorage.setItem(SESSION_KEY, JSON.stringify(currentSession));

    // Update UI
    var nameEl = document.getElementById('staff-name');
    if (nameEl) nameEl.textContent = staffData.name;

    // Admin button visibility
    var adminBtn = document.getElementById('admin-panel-btn');
    if (adminBtn) {
      if (staffData.role === 'admin') {
        adminBtn.classList.remove('hidden');
      } else {
        adminBtn.classList.add('hidden');
      }
    }

    // Switch screen
    showScreen('app');

    // Notify other modules
    window.dispatchEvent(new CustomEvent('session:login', { detail: currentSession }));
  }

  async function loadSession() {
    try {
      var stored = localStorage.getItem(SESSION_KEY);
      if (!stored) return false;

      var session = JSON.parse(stored);

      // Check session age
      var loginTime = new Date(session.loginTime || 0);
      var now = new Date();
      var hoursSinceLogin = (now - loginTime) / (1000 * 60 * 60);
      if (hoursSinceLogin > SESSION_MAX_AGE_HOURS) {
        await logout();
        return false;
      }

      if (!window.ClockDB) {
        // DB not loaded yet, can't verify
        return false;
      }

      // Restore session with stored token
      if (session.token) {
        try {
          window.ClockDB.init(session.token);
          // Verify token is still valid server-side
          var currentStaff = await window.ClockDB.getCurrentStaff();
          if (!currentStaff || !currentStaff.active) {
            await logout();
            return false;
          }

          // Refresh session data from server
          currentSession = {
            id: currentStaff.id,
            name: currentStaff.name,
            role: currentStaff.role,
            active: currentStaff.active,
            token: session.token,
            loginTime: session.loginTime
          };
        } catch (err) {
          console.warn('Session token invalid or expired:', err.message);
          await logout();
          return false;
        }
      } else {
        // Old-format session without token — invalidate
        await logout();
        return false;
      }

      // Update UI
      var nameEl = document.getElementById('staff-name');
      if (nameEl) nameEl.textContent = currentSession.name;

      var adminBtn = document.getElementById('admin-panel-btn');
      if (adminBtn) {
        if (currentSession.role === 'admin') {
          adminBtn.classList.remove('hidden');
        } else {
          adminBtn.classList.add('hidden');
        }
      }

      return true;

    } catch (error) {
      console.error('Failed to load session:', error);
      return false;
    }
  }

  function getSession() {
    return currentSession;
  }

  function isAdmin() {
    return !!(currentSession && currentSession.role === 'admin');
  }

  async function logout() {
    // Destroy server-side session
    if (window.ClockDB) {
      try {
        await window.ClockDB.logoutStaff();
      } catch (err) {
        console.warn('Server logout failed:', err.message);
      }
    }

    currentSession = null;
    localStorage.removeItem(SESSION_KEY);

    var nameEl = document.getElementById('staff-name');
    if (nameEl) nameEl.textContent = '';

    var adminBtn = document.getElementById('admin-panel-btn');
    if (adminBtn) adminBtn.classList.add('hidden');

    // Reset PIN state
    pinState.pin = '';
    pinState.isSubmitting = false;

    showScreen('pin');

    // Reset PIN display and staff selector after screen switch
    setTimeout(function() {
      updatePinDisplay();
      var pinError = document.getElementById('pin-error');
      if (pinError) pinError.classList.add('hidden');
      var selector = document.getElementById('staff-selector');
      if (selector) selector.selectedIndex = 0;
    }, 50);

    window.dispatchEvent(new CustomEvent('session:logout'));
  }

  // ===== Screen Navigation =====

  function showScreen(screenName) {
    var screens = ['pin-screen', 'app-screen', 'shifts-screen', 'admin-screen'];
    screens.forEach(function(screenId) {
      var screen = document.getElementById(screenId);
      if (!screen) return;
      if (screenId === screenName + '-screen') {
        screen.classList.remove('hidden');
        // Scroll to top
        window.scrollTo(0, 0);
      } else {
        screen.classList.add('hidden');
      }
    });
  }

  // ===== Logout Button =====

  function initLogout() {
    var logoutBtn = document.getElementById('logout-btn');
    if (!logoutBtn) return;
    logoutBtn.addEventListener('click', async function(e) {
      e.preventDefault();
      if (confirm('Are you sure you want to log out?')) {
        await logout();
      }
    });
  }

  // ===== Main Initialization =====

  async function init() {
    initPinScreen();
    initLogout();

    var sessionLoaded = await loadSession();
    if (sessionLoaded) {
      showScreen('app');
      window.dispatchEvent(new CustomEvent('session:restored', { detail: currentSession }));
    } else {
      showScreen('pin');
      // Load staff selector on PIN screen
      loadStaffSelector();
    }
  }

  // ===== Expose globally =====
  window.ClockAuth = {
    init: init,
    initPinScreen: initPinScreen,
    initLogout: initLogout,
    createSession: createSession,
    loadSession: loadSession,
    getSession: getSession,
    isAdmin: isAdmin,
    logout: logout,
    showScreen: showScreen,
    loadStaffSelector: loadStaffSelector
  };
})();