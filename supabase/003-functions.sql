-- =====================================================
-- Clock On/Off App - Server-Side Functions (Hardened)
-- =====================================================
-- Run this migration AFTER 001-initial-schema.sql and
-- 002-rls-policies.sql.
-- Contains:
--   1. PIN authentication & session management
--   2. Staff CRUD with server-side bcrypt hashing
--   3. Time-window-enforced clock on/off
--   4. Audit-log helper
--   5. Utility functions for the client
-- =====================================================

-- =====================================================
-- SECTION 1: Authentication & Sessions
-- =====================================================

-- Generate a secure random token (UUIDv4) for sessions.
CREATE OR REPLACE FUNCTION generate_session_token()
RETURNS TEXT AS $$
BEGIN
    RETURN gen_random_uuid()::text;
END;
$$ LANGUAGE plpgsql STABLE;

-- Authenticate a staff member by plaintext PIN.
-- Returns a JSON object: { staff: <record>, token: <string> }
-- The client must send the token back as x-session-token header.
CREATE OR REPLACE FUNCTION authenticate_staff(p_pin TEXT)
RETURNS JSON AS $$
DECLARE
    v_staff staff%rowtype;
    v_token TEXT;
    v_now TIMESTAMPTZ;
BEGIN
    v_now := now();

    -- Validate input
    IF p_pin IS NULL OR length(trim(p_pin)) < 4 OR length(trim(p_pin)) > 6 THEN
        RAISE EXCEPTION 'PIN must be 4-6 digits.'
            USING ERRCODE = '22023';
    END IF;

    -- Find staff by bcrypt-comparing the submitted PIN to stored hash.
    -- crypt(input, stored_hash) produces the same hash if the salt matches.
    SELECT * INTO v_staff
    FROM staff
    WHERE pin_hash = crypt(p_pin, pin_hash)
      AND active = true
    LIMIT 1;

    IF v_staff.id IS NULL THEN
        -- Wrong PIN — increment failed_attempts on the matched staff (if we can identify them by PIN alone)
        -- Since bcrypt comparison failed, we can't know which staff. However, if we want rate limiting
        -- we need to track by some identifier. For simplicity, we don't know which staff member failed.
        -- Future enhancement: add a login_attempts table by IP or username.
        RAISE EXCEPTION 'Invalid PIN or inactive staff.'
            USING ERRCODE = '28000';
    END IF;

    -- Check if account is locked due to too many failed attempts
    IF v_staff.locked_until IS NOT NULL AND v_staff.locked_until > v_now THEN
        RAISE EXCEPTION 'Account temporarily locked. Try again after %.', to_char(v_staff.locked_until, 'YYYY-MM-DD HH24:MI:SS')
            USING ERRCODE = '28000';
    END IF;

    -- Reset failed attempts and lockout on successful login
    IF v_staff.failed_attempts > 0 OR v_staff.locked_until IS NOT NULL THEN
        UPDATE staff SET failed_attempts = 0, locked_until = NULL WHERE id = v_staff.id;
    END IF;

    -- Clean up expired sessions for this staff member
    DELETE FROM staff_sessions
    WHERE staff_id = v_staff.id
      AND expires_at <= v_now;

    -- Create new session token (8 hour expiry)
    v_token := generate_session_token();
    INSERT INTO staff_sessions (staff_id, token, expires_at)
    VALUES (v_staff.id, v_token, v_now + INTERVAL '8 hours');

    RETURN json_build_object(
        'staff', json_build_object(
            'id', v_staff.id,
            'name', v_staff.name,
            'role', v_staff.role,
            'active', v_staff.active,
            'created_at', v_staff.created_at
        ),
        'token', v_token
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Logout: invalidate a session token.
CREATE OR REPLACE FUNCTION logout_staff(p_token TEXT)
RETURNS VOID AS $$
BEGIN
    DELETE FROM staff_sessions WHERE token = p_token;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get the current session’s staff record (convenience RPC).
CREATE OR REPLACE FUNCTION get_current_staff()
RETURNS JSON AS $$
DECLARE
    v_staff_id UUID;
    v_staff staff%rowtype;
BEGIN
    v_staff_id := get_session_staff_id();
    IF v_staff_id IS NULL THEN
        RAISE EXCEPTION 'No valid session.'
            USING ERRCODE = '28000';
    END IF;

    SELECT * INTO v_staff
    FROM staff
    WHERE id = v_staff_id
      AND active = true;

    IF v_staff.id IS NULL THEN
        RAISE EXCEPTION 'Staff not found or inactive.'
            USING ERRCODE = '28000';
    END IF;

    RETURN json_build_object(
        'id', v_staff.id,
        'name', v_staff.name,
        'role', v_staff.role,
        'active', v_staff.active,
        'created_at', v_staff.created_at
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- SECTION 2: Admin Staff CRUD with Server-Side Hashing
-- =====================================================

-- Create a new staff member with server-side bcrypt hashing.
-- Only admins may call this (enforced by checking the session).
CREATE OR REPLACE FUNCTION create_staff_with_pin(
    p_name TEXT,
    p_pin TEXT,
    p_role TEXT DEFAULT 'staff',
    p_active BOOLEAN DEFAULT true
)
RETURNS JSON AS $$
DECLARE
    v_admin_id UUID;
    v_new_staff staff%rowtype;
BEGIN
    -- Verify caller is admin
    v_admin_id := get_session_staff_id();
    IF v_admin_id IS NULL OR NOT is_admin_from_session() THEN
        RAISE EXCEPTION 'Admin role required.'
            USING ERRCODE = '42501';
    END IF;

    -- Validate
    IF p_name IS NULL OR trim(p_name) = '' THEN
        RAISE EXCEPTION 'Name is required.'
            USING ERRCODE = '22023';
    END IF;

    IF p_pin IS NULL OR length(trim(p_pin)) < 4 OR length(trim(p_pin)) > 6 OR p_pin ~ '\D' THEN
        RAISE EXCEPTION 'PIN must be 4-6 digits.'
            USING ERRCODE = '22023';
    END IF;

    IF p_role IS NULL OR p_role NOT IN ('staff', 'admin') THEN
        RAISE EXCEPTION 'Role must be staff or admin.'
            USING ERRCODE = '22023';
    END IF;

    -- Insert with bcrypt hash (cost factor 8 — adjust higher for more security)
    INSERT INTO staff (name, pin_hash, role, active)
    VALUES (trim(p_name), crypt(p_pin, gen_salt('bf', 8)), p_role, p_active)
    RETURNING * INTO v_new_staff;

    RETURN json_build_object(
        'id', v_new_staff.id,
        'name', v_new_staff.name,
        'role', v_new_staff.role,
        'active', v_new_staff.active,
        'created_at', v_new_staff.created_at
    );

EXCEPTION
    WHEN unique_violation THEN
        RAISE EXCEPTION 'PIN already in use. Please choose a different PIN.'
            USING ERRCODE = '23505';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update a staff member.  If p_pin is provided it is re-hashed server-side.
CREATE OR REPLACE FUNCTION update_staff_with_pin(
    p_staff_id UUID,
    p_name TEXT DEFAULT NULL,
    p_pin TEXT DEFAULT NULL,
    p_role TEXT DEFAULT NULL,
    p_active BOOLEAN DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_admin_id UUID;
    v_existing staff%rowtype;
BEGIN
    -- Verify caller is admin
    v_admin_id := get_session_staff_id();
    IF v_admin_id IS NULL OR NOT is_admin_from_session() THEN
        RAISE EXCEPTION 'Admin role required.'
            USING ERRCODE = '42501';
    END IF;

    -- Cannot update self via this RPC (avoid locking yourself out accidentally)
    IF p_staff_id = v_admin_id THEN
        RAISE EXCEPTION 'Use direct SQL or a separate self-service endpoint to update your own record.'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_existing FROM staff WHERE id = p_staff_id;
    IF v_existing.id IS NULL THEN
        RAISE EXCEPTION 'Staff not found.'
            USING ERRCODE = 'P0002';
    END IF;

    -- Validate optional PIN
    IF p_pin IS NOT NULL THEN
        IF length(trim(p_pin)) < 4 OR length(trim(p_pin)) > 6 OR p_pin ~ '\D' THEN
            RAISE EXCEPTION 'PIN must be 4-6 digits.'
                USING ERRCODE = '22023';
        END IF;
    END IF;

    UPDATE staff SET
        name       = COALESCE(trim(p_name), name),
        pin_hash   = COALESCE(crypt(p_pin, gen_salt('bf', 8)), pin_hash),
        role       = COALESCE(p_role, role),
        active     = COALESCE(p_active, active)
    WHERE id = p_staff_id;

    RETURN json_build_object('success', true);

EXCEPTION
    WHEN unique_violation THEN
        RAISE EXCEPTION 'PIN already in use. Please choose a different PIN.'
            USING ERRCODE = '23505';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Deactivate (soft-delete) a staff member.  Admin only.
CREATE OR REPLACE FUNCTION deactivate_staff_member(p_staff_id UUID)
RETURNS JSON AS $$
DECLARE
    v_admin_id UUID;
BEGIN
    v_admin_id := get_session_staff_id();
    IF v_admin_id IS NULL OR NOT is_admin_from_session() THEN
        RAISE EXCEPTION 'Admin role required.'
            USING ERRCODE = '42501';
    END IF;

    IF p_staff_id = v_admin_id THEN
        RAISE EXCEPTION 'You cannot deactivate yourself.'
            USING ERRCODE = '42501';
    END IF;

    UPDATE staff SET active = false WHERE id = p_staff_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Staff not found.'
            USING ERRCODE = 'P0002';
    END IF;

    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Unlock a staff member after too many failed login attempts. Admin only.
CREATE OR REPLACE FUNCTION unlock_staff(p_staff_id UUID)
RETURNS JSON AS $$
DECLARE
    v_admin_id UUID;
    v_staff staff%rowtype;
BEGIN
    v_admin_id := get_session_staff_id();
    IF v_admin_id IS NULL OR NOT is_admin_from_session() THEN
        RAISE EXCEPTION 'Admin role required.'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_staff FROM staff WHERE id = p_staff_id;
    IF v_staff.id IS NULL THEN
        RAISE EXCEPTION 'Staff not found.'
            USING ERRCODE = 'P0002';
    END IF;

    UPDATE staff SET failed_attempts = 0, locked_until = NULL WHERE id = p_staff_id;

    RETURN json_build_object(
        'success', true,
        'staff_id', p_staff_id,
        'name', v_staff.name,
        'message', 'Account unlocked. Failed attempts reset to 0.'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- SECTION 3: Time-Window Clock On / Clock Off
-- =====================================================

-- Clock on with server-side time-window validation and session verification.
CREATE OR REPLACE FUNCTION clock_on_shift(
    p_clock_in TIMESTAMPTZ,
    p_adjusted BOOLEAN DEFAULT false,
    p_notes TEXT DEFAULT NULL
)
RETURNS shifts AS $$
DECLARE
    v_now TIMESTAMPTZ;
    v_window_start TIMESTAMPTZ;
    v_window_end TIMESTAMPTZ;
    v_staff_id UUID;
    v_new_shift shifts%rowtype;
BEGIN
    -- Resolve staff from session token
    v_staff_id := get_session_staff_id();
    IF v_staff_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required. Please log in.'
            USING ERRCODE = '28000';
    END IF;

    -- Verify staff is active
    IF NOT EXISTS (SELECT 1 FROM staff WHERE id = v_staff_id AND active = true) THEN
        RAISE EXCEPTION 'Staff member not found or inactive.'
            USING ERRCODE = '28000';
    END IF;

    -- Server time window: up to 10 minutes in the past only (no future)
    v_now := now();
    v_window_start := v_now - INTERVAL '10 minutes';
    v_window_end := v_now;

    IF p_clock_in < v_window_start OR p_clock_in > v_window_end THEN
        RAISE EXCEPTION 'Clock-in time must be within 10 minutes in the past of current server time. Submitted: %, Allowed: % to %',
            p_clock_in, v_window_start, v_window_end
            USING ERRCODE = '22023';
    END IF;

    -- Prevent duplicate open shifts
    IF EXISTS (
        SELECT 1 FROM shifts
        WHERE staff_id = v_staff_id
          AND clock_out IS NULL
    ) THEN
        RAISE EXCEPTION 'You already have an active shift. Clock off first.'
            USING ERRCODE = '23000';
    END IF;

    INSERT INTO shifts (staff_id, clock_in, clock_in_adjusted, notes)
    VALUES (v_staff_id, p_clock_in, p_adjusted, p_notes)
    RETURNING * INTO v_new_shift;

    RETURN v_new_shift;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Clock off with server-side time-window validation and session verification.
CREATE OR REPLACE FUNCTION clock_off_shift(
    p_shift_id UUID,
    p_clock_out TIMESTAMPTZ,
    p_adjusted BOOLEAN DEFAULT false
)
RETURNS shifts AS $$
DECLARE
    v_now TIMESTAMPTZ;
    v_window_start TIMESTAMPTZ;
    v_window_end TIMESTAMPTZ;
    v_staff_id UUID;
    v_existing shifts%rowtype;
    v_updated shifts%rowtype;
BEGIN
    v_staff_id := get_session_staff_id();
    IF v_staff_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required. Please log in.'
            USING ERRCODE = '28000';
    END IF;

    -- Verify staff is active
    IF NOT EXISTS (SELECT 1 FROM staff WHERE id = v_staff_id AND active = true) THEN
        RAISE EXCEPTION 'Staff member not found or inactive.'
            USING ERRCODE = '28000';
    END IF;

    v_now := now();
    v_window_start := v_now - INTERVAL '10 minutes';
    v_window_end := v_now;

    IF p_clock_out < v_window_start OR p_clock_out > v_window_end THEN
        RAISE EXCEPTION 'Clock-out time must be within 10 minutes in the past of current server time. Submitted: %, Allowed: % to %',
            p_clock_out, v_window_start, v_window_end
            USING ERRCODE = '22023';
    END IF;

    -- Verify the shift exists, is open, and belongs to this staff member
    SELECT * INTO v_existing
    FROM shifts
    WHERE id = p_shift_id
      AND clock_out IS NULL;

    IF v_existing.id IS NULL THEN
        RAISE EXCEPTION 'Shift not found or already clocked off.'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_existing.staff_id != v_staff_id THEN
        RAISE EXCEPTION 'You can only clock off your own shift.'
            USING ERRCODE = '42501';
    END IF;

    UPDATE shifts
    SET clock_out = p_clock_out,
        clock_out_adjusted = p_adjusted
    WHERE id = p_shift_id
    RETURNING * INTO v_updated;

    RETURN v_updated;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- SECTION 4: Admin Shift Update with Audit Logging
-- =====================================================

-- Admin-only shift update that automatically writes an audit_log entry.
CREATE OR REPLACE FUNCTION admin_update_shift(
    p_shift_id UUID,
    p_clock_in TIMESTAMPTZ DEFAULT NULL,
    p_clock_out TIMESTAMPTZ DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_admin_id UUID;
    v_old shifts%rowtype;
    v_new shifts%rowtype;
BEGIN
    v_admin_id := get_session_staff_id();
    IF v_admin_id IS NULL OR NOT is_admin_from_session() THEN
        RAISE EXCEPTION 'Admin role required.'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_old FROM shifts WHERE id = p_shift_id;
    IF v_old.id IS NULL THEN
        RAISE EXCEPTION 'Shift not found.'
            USING ERRCODE = 'P0002';
    END IF;

    UPDATE shifts SET
        clock_in   = COALESCE(p_clock_in, clock_in),
        clock_out  = COALESCE(p_clock_out, clock_out),
        notes      = COALESCE(p_notes, notes)
    WHERE id = p_shift_id
    RETURNING * INTO v_new;

    -- Write audit trail
    INSERT INTO audit_log (
        admin_id, target_staff_id, shift_id, action,
        old_value, new_value, reason
    ) VALUES (
        v_admin_id, v_new.staff_id, p_shift_id, 'SHIFT_EDIT',
        jsonb_build_object(
            'clock_in', v_old.clock_in,
            'clock_out', v_old.clock_out,
            'notes', v_old.notes
        ),
        jsonb_build_object(
            'clock_in', v_new.clock_in,
            'clock_out', v_new.clock_out,
            'notes', v_new.notes
        ),
        p_reason
    );

    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- SECTION 5: Utility Functions
-- =====================================================

-- Check if a timestamp is within the allowed ±N minute window.
CREATE OR REPLACE FUNCTION validate_time_window(
    p_timestamp TIMESTAMPTZ,
    p_tolerance_minutes INTEGER DEFAULT 10
)
RETURNS BOOLEAN AS $$
DECLARE
    v_now TIMESTAMPTZ;
BEGIN
    v_now := now();
    RETURN p_timestamp BETWEEN (v_now - (p_tolerance_minutes || ' minutes')::INTERVAL)
                           AND (v_now + (p_tolerance_minutes || ' minutes')::INTERVAL);
END;
$$ LANGUAGE plpgsql STABLE;

-- Return current time-window boundaries as JSON (for client UI limits).
CREATE OR REPLACE FUNCTION get_time_window_info(
    p_tolerance_minutes INTEGER DEFAULT 10
)
RETURNS JSON AS $$
DECLARE
    v_now TIMESTAMPTZ;
BEGIN
    v_now := now();
    RETURN json_build_object(
        'now', v_now,
        'window_start', v_now - (p_tolerance_minutes || ' minutes')::INTERVAL,
        'window_end', v_now + (p_tolerance_minutes || ' minutes')::INTERVAL,
        'tolerance_minutes', p_tolerance_minutes
    );
END;
$$ LANGUAGE plpgsql STABLE;

-- =====================================================
-- SECURITY & OPERATIONS NOTES
-- =====================================================
--
-- 1. All functions in this file are SECURITY DEFINER so
--    they bypass RLS.  They perform their own authorization
--    checks (session token → staff_id → role verification).
--
-- 2. The authenticate_staff RPC is the ONLY entry point
--    that reads pin_hash.  It uses pgcrypto crypt() with
--    the stored salt for safe comparison.
--
-- 3. Time-window functions enforce ±10 minutes from the
--    database server clock (now()), NOT from client input.
--
-- 4. admin_update_shift writes to audit_log automatically.
--    Direct UPDATE on shifts by admins via REST is blocked
--    by RLS unless they go through this RPC (or RLS allows
--    it because is_admin_from_session() is true).  The app
--    should ALWAYS use admin_update_shift so the audit
--    trail is guaranteed.
--
-- 5. To adjust bcrypt cost factor, change the 8 in
--    gen_salt('bf', 8).  Higher = slower but more secure.
--
-- =====================================================
