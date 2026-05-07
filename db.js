/**
 * db.js - Supabase Client Module (Hardened)
 *
 * Handles all database operations for the Mucha Kitchen ClockOn app.
 * Uses Supabase free tier with Row-Level Security (RLS).
 *
 * SECURITY MODEL (no Supabase Auth, anon key only):
 *   1. Staff log in via authenticate_staff(pin) RPC.
 *      The database hashes the PIN server-side with bcrypt.
 *   2. On success, a session token is returned.
 *   3. The Supabase client is RE-INITIALISED with the token
 *      in the x-session-token header.
 *   4. ALL subsequent requests pass the token header.
 *   5. RLS resolves identity from the token.
 *
 * IMPORTANT: Replace the placeholder credentials below with
 * your actual Supabase project credentials before deploying.
 */

(function() {
  'use strict';

  // ===== Supabase Configuration =====
  // Priority 1: window.SUPABASE_CONFIG (set via config.js or inline script)
  // Priority 2: Hardcoded constants below (edit directly)
  var SUPABASE_URL = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url) || 'YOUR_SUPABASE_URL_HERE';
  var SUPABASE_ANON_KEY = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.anonKey) || 'YOUR_SUPABASE_ANON_KEY_HERE';

  // Module-level state
  var supabase = null;
  var currentSessionToken = null;

  /**
   * Initialize (or re-initialize) the Supabase client.
   * Call this once at app startup with no token.
   * Call again after login with the session token.
   *
   * @param {string|null} sessionToken - Optional x-session-token header value.
   * @returns {object} Supabase client instance
   */
  function init(sessionToken) {
    sessionToken = sessionToken || null;

    if (typeof window === 'undefined' || typeof window.supabase === 'undefined' || typeof window.supabase.createClient !== 'function') {
      throw new Error('Supabase library not loaded. Ensure the CDN script is included before db.js.');
    }

    currentSessionToken = sessionToken || null;

    var options = {
      global: {},
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false
      }
    };

    if (currentSessionToken) {
      options.global.headers = {
        'x-session-token': currentSessionToken
      };
    }

    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, options);
    return supabase;
  }

  /**
   * Get the active Supabase client instance.
   */
  function getClient() {
    if (!supabase) {
      throw new Error('Supabase client not initialized. Call init() first.');
    }
    return supabase;
  }

  /**
   * Get the current session token (if logged in).
   */
  function getSessionToken() {
    return currentSessionToken;
  }

  // ===== Server Time =====

  /**
   * Get current server time from Supabase.
   * This prevents clients from manipulating their local clock.
   * @returns {Promise<Date>}
   */
  async function getServerTime() {
    var client = getClient();
    var result = await client.rpc('get_server_time');
    var data = result.data;
    var error = result.error;

    if (error) {
      throw new Error('Failed to get server time: ' + (error.message || error.details || JSON.stringify(error)));
    }

    if (!data) {
      throw new Error('Server returned empty timestamp.');
    }

    return new Date(data);
  }

  /**
   * Get server time as ISO string.
   * @returns {Promise<string>}
   */
  async function getServerTimeISO() {
    var t = await getServerTime();
    return t.toISOString();
  }

  // ===== Authentication =====

  /**
   * Log in a staff member by PIN.
   * The PIN is sent as plain text over HTTPS to the RPC;
   * the database hashes and verifies it server-side.
   *
   * @param {string} pin - Plain-text 4-6 digit PIN.
   * @returns {Promise<{staff: object, token: string}>}
   */
  async function loginStaff(pin) {
    var client = init(); // Ensure fresh client without old token

    var result = await client.rpc('authenticate_staff', {
      p_pin: String(pin).trim()
    });
    var data = result.data;
    var error = result.error;

    if (error) {
      var msg = error.message || error.details || 'Authentication failed.';
      throw new Error(msg);
    }

    if (!data || !data.staff || !data.token) {
      throw new Error('Invalid server response during login.');
    }

    // Re-initialize client with the new session token
    init(data.token);

    return { staff: data.staff, token: data.token };
  }

  /**
   * Log out the current staff member.
   * Destroys the server-side session and clears the local token.
   */
  async function logoutStaff() {
    var token = currentSessionToken;
    if (token) {
      try {
        var client = getClient();
        await client.rpc('logout_staff', { p_token: token });
      } catch (err) {
        // Best-effort: even if the RPC fails we still clear local state
        console.warn('logout_staff RPC failed (session may already be expired):', err.message);
      }
    }
    currentSessionToken = null;
    init(null);
  }

  /**
   * Resolve the current session to a staff record (convenience).
   * @returns {Promise<object|null>}
   */
  async function getCurrentStaff() {
    var client = getClient();
    var result = await client.rpc('get_current_staff');
    var data = result.data;
    var error = result.error;

    if (error) {
      if (error.message && error.message.indexOf('No valid session') !== -1) {
        return null;
      }
      throw new Error('Failed to resolve session: ' + error.message);
    }

    return data || null;
  }

  // ===== Staff Functions =====

  /**
   * Get staff member by ID (RLS-enforced).
   * @param {string} staffId
   * @returns {Promise<object|null>}
   */
  async function getStaffById(staffId) {
    var client = getClient();
    var result = await client
      .from('staff')
      .select('id, name, role, active, created_at')
      .eq('id', staffId)
      .maybeSingle();

    if (result.error) {
      throw new Error('Failed to get staff: ' + result.error.message);
    }

    return result.data;
  }

  /**
   * Get active staff names/IDs for login screen (public, no auth required).
   * @returns {Promise<Array>}
   */
  async function getActiveStaffNames() {
    var client = getClient();
    var result = await client.rpc('get_active_staff_names');

    if (result.error) {
      throw new Error('Failed to get staff names: ' + result.error.message);
    }
    return result.data || [];
  }

  /**
   * Get all staff (admin only — enforced by RLS + server checks).
   * @returns {Promise<Array>}
   */
  async function getAllStaff() {
    var client = getClient();
    var result = await client
      .from('staff')
      .select('id, name, role, active, expected_start_time, expected_end_time, failed_attempts, locked_until, created_at')
      .order('name', { ascending: true });

    if (result.error) {
      throw new Error('Failed to get staff list: ' + result.error.message);
    }

    return result.data || [];
  }

  /**
   * Create a new staff member (admin only).
   * PIN is hashed server-side; client sends plain PIN.
   *
   * @param {object} staffData - { name, pin, role?, active? }
   * @returns {Promise<object>}
   */
  async function createStaff(staffData) {
    var client = getClient();
    var result = await client.rpc('create_staff_with_pin', {
      p_name: staffData.name,
      p_pin: staffData.pin,
      p_role: staffData.role || 'staff',
      p_active: staffData.active !== undefined ? staffData.active : true,
      p_expected_start_time: staffData.expectedStartTime || null,
      p_expected_end_time: staffData.expectedEndTime || null
    });

    if (result.error) {
      throw new Error('Failed to create staff: ' + result.error.message);
    }

    return result.data;
  }

  /**
   * Update a staff member (admin only).
   * If pin is provided it is re-hashed server-side.
   *
   * @param {string} staffId
   * @param {object} updates - { name?, pin?, role?, active? }
   * @returns {Promise<object>}
   */
  async function updateStaff(staffId, updates) {
    var client = getClient();
    var result = await client.rpc('update_staff_with_pin', {
      p_staff_id: staffId,
      p_name: updates.name !== undefined ? updates.name : null,
      p_pin: updates.pin !== undefined ? updates.pin : null,
      p_role: updates.role !== undefined ? updates.role : null,
      p_active: updates.active !== undefined ? updates.active : null,
      p_expected_start_time: updates.expectedStartTime !== undefined ? (updates.expectedStartTime || null) : null,
      p_expected_end_time: updates.expectedEndTime !== undefined ? (updates.expectedEndTime || null) : null
    });

    if (result.error) {
      throw new Error('Failed to update staff: ' + result.error.message);
    }

    return result.data;
  }

  /**
   * Deactivate a staff member (soft delete). Admin only.
   * @param {string} staffId
   * @returns {Promise<void>}
   */
  async function deactivateStaff(staffId) {
    var client = getClient();
    var result = await client.rpc('deactivate_staff_member', {
      p_staff_id: staffId
    });

    if (result.error) {
      throw new Error('Failed to deactivate staff: ' + result.error.message);
    }

    return result.data;
  }

  // ===== Shift Functions =====

  /**
   * Get the active (open) shift for a staff member.
   * @param {string} staffId
   * @returns {Promise<object|null>}
   */
  async function getActiveShift(staffId) {
    var client = getClient();
    var result = await client
      .from('shifts')
      .select('id, staff_id, clock_in, clock_out, clock_in_adjusted, clock_out_adjusted, notes, created_at')
      .eq('staff_id', staffId)
      .is('clock_out', null)
      .order('clock_in', { ascending: false })
      .maybeSingle();

    if (result.error) {
      throw new Error('Failed to get active shift: ' + result.error.message);
    }

    return result.data;
  }

  /**
   * Clock on — server-validated time window and session.
   *
   * @param {string} clockInTime - ISO timestamp
   * @param {boolean} adjusted - Was time adjusted from default now()?
   * @param {string|null} notes - Optional notes
   * @returns {Promise<object>}
   */
  async function clockOn(clockInTime, adjusted, notes) {
    adjusted = adjusted !== undefined ? adjusted : false;
    notes = notes || null;

    var client = getClient();
    var result = await client.rpc('clock_on_shift', {
      p_clock_in: clockInTime,
      p_adjusted: adjusted,
      p_notes: notes
    });

    if (result.error) {
      var msg = result.error.message || 'Failed to clock on.';
      if (msg.indexOf('within') !== -1) {
        throw new Error('Time must be within ±10 minutes of current server time.');
      }
      if (msg.indexOf('active shift') !== -1) {
        throw new Error('You already have an active shift. Please clock off first.');
      }
      throw new Error(msg);
    }

    return result.data;
  }

  /**
   * Clock off — server-validated time window and session.
   *
   * @param {string} shiftId - Shift UUID
   * @param {string} clockOutTime - ISO timestamp
   * @param {boolean} adjusted - Was time adjusted from default now()?
   * @returns {Promise<object>}
   */
  async function clockOff(shiftId, clockOutTime, adjusted) {
    adjusted = adjusted !== undefined ? adjusted : false;

    var client = getClient();
    var result = await client.rpc('clock_off_shift', {
      p_shift_id: shiftId,
      p_clock_out: clockOutTime,
      p_adjusted: adjusted
    });

    if (result.error) {
      var msg = result.error.message || 'Failed to clock off.';
      if (msg.indexOf('within') !== -1) {
        throw new Error('Time must be within ±10 minutes of current server time.');
      }
      if (msg.indexOf('own shift') !== -1) {
        throw new Error('You can only clock off your own shift.');
      }
      throw new Error(msg);
    }

    return result.data;
  }

  /**
   * Get shift history for a staff member.
   *
   * @param {string} staffId
   * @param {number} limit - Max rows (default 30)
   * @param {number} daysBack - Only shifts within last N days (default 7)
   * @returns {Promise<Array>}
   */
  async function getStaffShifts(staffId, limit, daysBack) {
    limit = limit !== undefined ? limit : 30;
    daysBack = daysBack !== undefined ? daysBack : 7;

    var client = getClient();
    var since = new Date();
    since.setDate(since.getDate() - daysBack);

    var result = await client
      .from('shifts')
      .select('id, staff_id, clock_in, clock_out, clock_in_adjusted, clock_out_adjusted, notes, created_at, breaks(id, break_start, break_end, created_at)')
      .eq('staff_id', staffId)
      .gte('clock_in', since.toISOString())
      .order('clock_in', { ascending: false })
      .limit(limit);

    if (result.error) {
      throw new Error('Failed to get shifts: ' + result.error.message);
    }

    return result.data || [];
  }

  /**
   * Get a single shift by ID.
   * @param {string} shiftId
   * @returns {Promise<object|null>}
   */
  async function getShiftById(shiftId) {
    var client = getClient();
    var result = await client
      .from('shifts')
      .select('id, staff_id, clock_in, clock_out, clock_in_adjusted, clock_out_adjusted, notes, created_at')
      .eq('id', shiftId)
      .maybeSingle();

    if (result.error) {
      throw new Error('Failed to get shift: ' + result.error.message);
    }

    return result.data;
  }

  /**
   * Get all shifts with staff info (admin only).
   *
   * @param {object} filters - { staffId?, startDate?, endDate?, activeOnly? }
   * @returns {Promise<Array>}
   */
  async function getAllShifts(filters) {
    filters = filters || {};
    var client = getClient();
    var query = client
      .from('shifts')
      .select('\n            id,\n            staff_id,\n            clock_in,\n            clock_out,\n            clock_in_adjusted,\n            clock_out_adjusted,\n            notes,\n            created_at,\n            staff:staff_id ( id, name, role ),\n            breaks(id, break_start, break_end, created_at)\n        ');

    if (filters.staffId) {
      query = query.eq('staff_id', filters.staffId);
    }

    if (filters.startDate) {
      query = query.gte('clock_in', filters.startDate);
    }

    if (filters.endDate) {
      query = query.lte('clock_in', filters.endDate);
    }

    if (filters.activeOnly) {
      query = query.is('clock_out', null);
    }

    var result = await query
      .order('clock_in', { ascending: false })
      .limit(filters.limit || 100);

    if (result.error) {
      throw new Error('Failed to get shifts: ' + result.error.message);
    }

    return result.data || [];
  }

  /**
   * Update shift times via the admin RPC (enforces audit logging).
   * Only admins may call this; the database enforces it.
   *
   * @param {string} shiftId
   * @param {object} updates - { clockIn?, clockOut?, notes?, reason? }
   * @returns {Promise<object>}
   */
  async function updateShift(shiftId, updates) {
    var client = getClient();
    var result = await client.rpc('admin_update_shift', {
      p_shift_id: shiftId,
      p_clock_in: updates.clockIn !== undefined ? updates.clockIn : null,
      p_clock_out: updates.clockOut !== undefined ? updates.clockOut : null,
      p_notes: updates.notes !== undefined ? updates.notes : null,
      p_reason: updates.reason !== undefined ? updates.reason : null
    });

    if (result.error) {
      throw new Error('Failed to update shift: ' + result.error.message);
    }

    return result.data;
  }

  // ===== Break Functions =====

  /**
   * Start a break for the active shift.
   * @param {string} shiftId
   * @returns {Promise<object>}
   */
  async function startBreak(shiftId) {
    var client = getClient();
    var result = await client.rpc('start_break', {
      p_shift_id: shiftId
    });

    if (result.error) {
      var msg = result.error.message || 'Failed to start break.';
      if (msg.indexOf('Already on break') !== -1) {
        throw new Error('You are already on a break.');
      }
      throw new Error(msg);
    }

    return result.data;
  }

  /**
   * End a break.
   * @param {string} breakId
   * @returns {Promise<object>}
   */
  async function endBreak(breakId) {
    var client = getClient();
    var result = await client.rpc('end_break', {
      p_break_id: breakId
    });

    if (result.error) {
      throw new Error(result.error.message || 'Failed to end break.');
    }

    return result.data;
  }

  /**
   * Get the active (open) break for a shift.
   * @param {string} shiftId
   * @returns {Promise<object|null>}
   */
  async function getActiveBreak(shiftId) {
    var client = getClient();
    var result = await client
      .from('breaks')
      .select('id, shift_id, break_start, break_end, created_at')
      .eq('shift_id', shiftId)
      .is('break_end', null)
      .maybeSingle();

    if (result.error) {
      throw new Error('Failed to get break status: ' + result.error.message);
    }

    return result.data;
  }

  // ===== Audit Log Functions =====

  /**
   * Get all breaks for a shift.
   * @param {string} shiftId
   * @returns {Promise<Array>}
   */
  async function getShiftBreaks(shiftId) {
    var client = getClient();
    var result = await client
      .from('breaks')
      .select('id, shift_id, break_start, break_end, created_at')
      .eq('shift_id', shiftId)
      .order('break_start', { ascending: true });

    if (result.error) {
      throw new Error('Failed to get breaks: ' + result.error.message);
    }
    return result.data || [];
  }

  /**
   * Calculate total break duration for a shift in milliseconds.
   * @param {string} shiftId
   * @returns {Promise<number>}
   */
  async function getShiftBreakDuration(shiftId) {
    var client = getClient();
    var result = await client.rpc('get_shift_break_duration_minutes', {
      p_shift_id: shiftId
    });

    if (result.error) {
      throw new Error('Failed to get break duration: ' + result.error.message);
    }
    return (result.data || 0) * 60 * 1000;
  }

  // ===== Roster Functions =====

  /**
   * Create a roster entry (admin only).
   * @param {object} entry - { staffId, date, startTime, endTime, notes? }
   * @returns {Promise<object>}
   */
  async function createRosterEntry(entry) {
    var client = getClient();
    var result = await client.rpc('create_roster_entry', {
      p_staff_id: entry.staffId,
      p_roster_date: entry.rosterDate,
      p_start_time: entry.startTime,
      p_end_time: entry.endTime,
      p_notes: entry.notes || null,
      p_shift_type: entry.shiftType || 'lunch'
    });

    if (result.error) {
      throw new Error('Failed to create roster: ' + result.error.message);
    }
    return result.data;
  }

  /**
   * Update a roster entry (admin only).
   * @param {string} rosterId
   * @param {object} updates - { startTime?, endTime?, notes? }
   * @returns {Promise<object>}
   */
  async function updateRosterEntry(rosterId, updates) {
    var client = getClient();
    var result = await client.rpc('update_roster_entry', {
      p_id: rosterId,
      p_start_time: updates.startTime || null,
      p_end_time: updates.endTime || null,
      p_notes: updates.notes !== undefined ? updates.notes : null
    });

    if (result.error) {
      throw new Error('Failed to update roster: ' + result.error.message);
    }
    return result.data;
  }

  /**
   * Delete a roster entry (admin only).
   * @param {string} rosterId
   * @returns {Promise<void>}
   */
  async function deleteRosterEntry(rosterId) {
    var client = getClient();
    var result = await client.rpc('delete_roster_entry', {
      p_roster_id: rosterId
    });

    if (result.error) {
      throw new Error('Failed to delete roster: ' + result.error.message);
    }
    return result.data;
  }

  /**
   * Get roster entries for a date range.
   * @param {string} startDate - ISO date string (YYYY-MM-DD)
   * @param {string} endDate - ISO date string
   * @returns {Promise<Array>}
   */
  async function getRosterForWeek(startDate, endDate) {
    var client = getClient();
    var result = await client.rpc('get_roster_for_week', {
      p_start_date: startDate,
      p_end_date: endDate
    });

    if (result.error) {
      throw new Error('Failed to get roster: ' + result.error.message);
    }
    return result.data || [];
  }

  /**
   * Get upcoming roster entries for a staff member.
   * @param {string} staffId
   * @param {number} daysAhead
   * @returns {Promise<Array>}
   */
  async function getMyRoster(staffId, daysAhead) {
    daysAhead = daysAhead !== undefined ? daysAhead : 14;
    var client = getClient();
    var result = await client.rpc('get_my_roster', {
      p_staff_id: staffId,
      p_days_ahead: daysAhead
    });

    if (result.error) {
      throw new Error('Failed to get roster: ' + result.error.message);
    }
    return result.data || [];
  }

  /**
   * Get audit log entries (admin only).
   * @param {number} limit
   * @returns {Promise<Array>}
   */
  async function getAuditLog(limit) {
    limit = limit !== undefined ? limit : 50;
    var client = getClient();
    var result = await client
      .from('audit_log')
      .select('\n            id,\n            action,\n            reason,\n            old_value,\n            new_value,\n            created_at,\n            admin:admin_id ( name ),\n            target_staff:target_staff_id ( name ),\n            shift:shift_id ( clock_in, clock_out )\n        ')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (result.error) {
      throw new Error('Failed to get audit log: ' + result.error.message);
    }

    return result.data || [];
  }

  // ===== Utility Functions =====

  /**
   * Calculate shift duration in milliseconds.
   * @param {string} clockIn - ISO timestamp
   * @param {string|null} clockOut - ISO timestamp or null
   * @returns {number}
   */
  function calculateDuration(clockIn, clockOut) {
    var start = new Date(clockIn).getTime();
    var end = clockOut ? new Date(clockOut).getTime() : Date.now();
    return end - start;
  }

  /**
   * Format duration as human-readable string.
   * @param {number} ms
   * @returns {string}
   */
  function formatDuration(ms) {
    var totalMinutes = Math.round(ms / 60000);
    var hours = Math.floor(totalMinutes / 60);
    var minutes = totalMinutes % 60;

    if (hours > 0 && minutes > 0) {
      return hours + 'h ' + minutes + 'm';
    }
    if (hours > 0) {
      return hours + 'h';
    }
    return minutes + 'm';
  }

  /**
   * Format timestamp for display.
   * @param {string} isoString
   * @returns {string}
   */
  function formatDateTime(isoString) {
    var date = new Date(isoString);
    return date.toLocaleString('en-AU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  /**
   * Format time only.
   * @param {string} isoString
   * @returns {string}
   */
  function formatTime(isoString) {
    var date = new Date(isoString);
    return date.toLocaleTimeString('en-AU', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  /**
   * Format date only.
   * @param {string} isoString
   * @returns {string}
   */
  function formatDate(isoString) {
    var date = new Date(isoString);
    return date.toLocaleDateString('en-AU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short'
    });
  }

  /**
   * Escape a field for CSV output (wraps in quotes, escapes inner quotes).
   * @param {string|number|null} field
   * @returns {string}
   */
  function csvEscape(field) {
    if (field === null || field === undefined) return '""';
    var str = String(field).replace(/"/g, '""');
    return '"' + str + '"';
  }

  /**
   * Unlock a staff member after failed login lockout (admin only).
   * @param {string} staffId
   * @returns {Promise<object>}
   */
  async function unlockStaff(staffId) {
    var client = getClient();
    var result = await client.rpc('unlock_staff', {
      p_staff_id: staffId
    });

    if (result.error) {
      throw new Error('Failed to unlock staff: ' + result.error.message);
    }

    return result.data;
  }

  // ===== Expose globally =====
  window.ClockDB = {
    init: init,
    getClient: getClient,
    getSessionToken: getSessionToken,
    getServerTime: getServerTime,
    getServerTimeISO: getServerTimeISO,
    loginStaff: loginStaff,
    logoutStaff: logoutStaff,
    getCurrentStaff: getCurrentStaff,
    getStaffById: getStaffById,
    getActiveStaffNames: getActiveStaffNames,
    getAllStaff: getAllStaff,
    createStaff: createStaff,
    updateStaff: updateStaff,
    deactivateStaff: deactivateStaff,
    unlockStaff: unlockStaff,
    getActiveShift: getActiveShift,
    clockOn: clockOn,
    clockOff: clockOff,
    getStaffShifts: getStaffShifts,
    getShiftById: getShiftById,
    getAllShifts: getAllShifts,
    updateShift: updateShift,
    getAuditLog: getAuditLog,
    startBreak: startBreak,
    endBreak: endBreak,
    getActiveBreak: getActiveBreak,
    getShiftBreaks: getShiftBreaks,
    getShiftBreakDuration: getShiftBreakDuration,
    createRosterEntry: createRosterEntry,
    updateRosterEntry: updateRosterEntry,
    deleteRosterEntry: deleteRosterEntry,
    getRosterForWeek: getRosterForWeek,
    getMyRoster: getMyRoster,
    calculateDuration: calculateDuration,
    formatDuration: formatDuration,
    formatDateTime: formatDateTime,
    formatTime: formatTime,
    formatDate: formatDate,
    csvEscape: csvEscape
  };
})();
