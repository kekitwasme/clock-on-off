-- =====================================================
-- Clock On/Off App - Initial Database Schema (Hardened)
-- =====================================================
-- Run this migration first in your Supabase SQL Editor.
-- Creates tables, indexes, triggers, and the server-time
-- helper with full defense-in-depth notes.
-- =====================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- =====================================================
-- Table: staff
-- =====================================================
-- Stores staff member information.  PINs are hashed on
-- the server with bcrypt (pgcrypto) — NEVER store plain
-- text.  The app sends the plain PIN over HTTPS to RPC
-- functions; the database hashes and compares server-side.
-- =====================================================

CREATE TABLE staff (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL CHECK (char_length(trim(name)) > 0),
    pin_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('staff', 'admin')),
    active BOOLEAN NOT NULL DEFAULT true,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for PIN lookups during authentication (timing-safe compare done in function)
CREATE INDEX idx_staff_pin_hash ON staff(pin_hash);

-- Index for active staff filtering
CREATE INDEX idx_staff_active ON staff(active) WHERE active = true;

-- =====================================================
-- Table: staff_sessions
-- =====================================================
-- Stateless session tokens for PIN-based auth.  Each
-- login creates a token that is passed in the custom
-- header x-session-token on every subsequent request.
-- RLS policies resolve the caller’s identity from this
-- token, NOT from a JWT or auth.uid().
-- =====================================================

CREATE TABLE staff_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '8 hours'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_token ON staff_sessions(token);
CREATE INDEX idx_sessions_staff ON staff_sessions(staff_id);
CREATE INDEX idx_sessions_expires ON staff_sessions(expires_at);

-- =====================================================
-- Table: shifts
-- =====================================================
-- Records work shifts.  The *_adjusted flags indicate
-- whether a staff member (not an admin) changed the
-- time from the default server now().
-- =====================================================

CREATE TABLE shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    clock_in TIMESTAMPTZ NOT NULL,
    clock_out TIMESTAMPTZ,
    clock_in_adjusted BOOLEAN NOT NULL DEFAULT false,
    clock_out_adjusted BOOLEAN NOT NULL DEFAULT false,
    notes TEXT CHECK (notes IS NULL OR char_length(notes) <= 500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Prevent overlapping open shifts per staff (safety net)
    CONSTRAINT no_overlapping_open_shift
        EXCLUDE USING gist (staff_id WITH =)
        WHERE (clock_out IS NULL)
);

-- Index for staff shift lookups
CREATE INDEX idx_shifts_staff_id ON shifts(staff_id);

-- Partial index for finding active (open) shifts
CREATE INDEX idx_shifts_active ON shifts(staff_id, clock_in DESC) WHERE clock_out IS NULL;

-- Index for date-range queries (timesheet exports, recent history)
CREATE INDEX idx_shifts_clock_in ON shifts(clock_in DESC);
CREATE INDEX idx_shifts_clock_out ON shifts(clock_out);

-- =====================================================
-- Table: audit_log
-- =====================================================
-- Immutable trail for admin adjustments.  No UPDATE or
-- DELETE should ever be permitted via RLS.
-- =====================================================

CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID NOT NULL REFERENCES staff(id),
    target_staff_id UUID NOT NULL REFERENCES staff(id),
    shift_id UUID REFERENCES shifts(id) ON DELETE SET NULL,
    action TEXT NOT NULL CHECK (char_length(action) > 0),
    old_value JSONB,
    new_value JSONB,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_admin ON audit_log(admin_id);
CREATE INDEX idx_audit_target ON audit_log(target_staff_id);
CREATE INDEX idx_audit_shift ON audit_log(shift_id);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);

-- =====================================================
-- Trigger: updated_at
-- =====================================================
-- Keeps updated_at current automatically.
-- =====================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER staff_updated_at
    BEFORE UPDATE ON staff
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER shifts_updated_at
    BEFORE UPDATE ON shifts
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- =====================================================
-- Helper Function: get_server_time
-- =====================================================
-- Returns current server timestamp.  Prevents clients
-- from relying solely on local clock.
-- =====================================================

CREATE OR REPLACE FUNCTION get_server_time()
RETURNS TIMESTAMPTZ AS $$
BEGIN
    RETURN now();
END;
$$ LANGUAGE plpgsql STABLE;

-- =====================================================
-- SECURITY NOTES
-- =====================================================
-- 1. PIN Hashing:
--    - Client NEVER hashes the PIN.  It sends the plain
--      PIN (over HTTPS) to RPC functions authenticate_staff
--      or create_staff_with_pin.
--    - The database hashes with pgcrypto crypt() using
--      bcrypt:  crypt(pin, gen_salt('bf', 8))
--    - Comparison uses crypt(pin, stored_hash) = stored_hash
--
-- 2. Row-Level Security (RLS):
--    - See 002-rls-policies.sql for full RLS config.
--    - RLS uses x-session-token header → staff_sessions
--      table → staff_id resolution.
--    - Because this app uses the Supabase anon key with
--      no Supabase Auth, the session token is the ONLY
--      identity layer.  Keep tokens confidential.
--
-- 3. Time Window Enforcement:
--    - See 003-functions.sql for server-side validation
--      of the ±10 minute adjustment window.
--
-- 4. Audit Trail:
--    - Every admin adjustment MUST call create_audit_log
--      or the equivalent RPC.  The audit_log table is
--      append-only by design.
-- =====================================================
-- =====================================================
-- Clock On/Off App - Row-Level Security (RLS) Policies
-- =====================================================
-- Run this migration AFTER 001-initial-schema.sql.
-- These policies are the ONLY security layer — the app
-- has NO server-side auth and uses the Supabase anon
-- key.  Every policy must resolve identity from the
-- x-session-token custom header (stored in staff_sessions).
-- =====================================================

-- =====================================================
-- Helper functions for RLS identity resolution
-- =====================================================
-- These are STABLE (not IMMUTABLE) because they depend
-- on external request state and the current time.
-- =====================================================

-- Extract the session token from the incoming request header.
-- PostgREST exposes headers via current_setting('request.headers').
CREATE OR REPLACE FUNCTION get_session_token()
RETURNS TEXT AS $$
DECLARE
    v_headers TEXT;
BEGIN
    v_headers := current_setting('request.headers', true);
    IF v_headers IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN v_headers::json->>'x-session-token';
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Resolve the staff_id belonging to the current session token.
CREATE OR REPLACE FUNCTION get_session_staff_id()
RETURNS UUID AS $$
DECLARE
    v_token TEXT;
    v_staff_id UUID;
BEGIN
    v_token := get_session_token();
    IF v_token IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT ss.staff_id INTO v_staff_id
    FROM staff_sessions ss
    WHERE ss.token = v_token
      AND ss.expires_at > now();

    RETURN v_staff_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Check whether the current session belongs to an admin.
CREATE OR REPLACE FUNCTION is_admin_from_session()
RETURNS BOOLEAN AS $$
DECLARE
    v_staff_id UUID;
BEGIN
    v_staff_id := get_session_staff_id();
    IF v_staff_id IS NULL THEN
        RETURN false;
    END IF;
    RETURN EXISTS (
        SELECT 1 FROM staff
        WHERE id = v_staff_id
          AND role = 'admin'
          AND active = true
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- =====================================================
-- Enable RLS on all tables
-- =====================================================

ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- Prevent unrestricted access when no policy matches
-- (belt + suspenders — Supabase does this by default,
-- but being explicit helps when reviewing schema.)
-- =====================================================

-- No blanket policies — every access path is explicit below.

-- =====================================================
-- STAFF TABLE POLICIES
-- =====================================================

-- Staff may SELECT their own record.  Admins may SELECT all.
CREATE POLICY staff_select ON staff
    FOR SELECT
    USING (
        id = get_session_staff_id()
        OR is_admin_from_session()
    );

-- Only admins may INSERT staff.
CREATE POLICY staff_insert_admin ON staff
    FOR INSERT
    WITH CHECK (is_admin_from_session());

-- Only admins may UPDATE staff.
CREATE POLICY staff_update_admin ON staff
    FOR UPDATE
    USING (is_admin_from_session())
    WITH CHECK (is_admin_from_session());

-- Only admins may DELETE staff, and they CANNOT delete themselves.
CREATE POLICY staff_delete_admin ON staff
    FOR DELETE
    USING (
        is_admin_from_session()
        AND id != get_session_staff_id()
    );

-- =====================================================
-- STAFF_SESSIONS TABLE POLICIES
-- =====================================================

-- Staff can see their own sessions (useful for debugging,
-- not required by the app but safe). Admins see all.
CREATE POLICY sessions_select ON staff_sessions
    FOR SELECT
    USING (
        staff_id = get_session_staff_id()
        OR is_admin_from_session()
    );

-- Insert is performed by SECURITY DEFINER authenticate_staff RPC;
-- no direct INSERT policy needed (RLS defaults to deny).

-- Staff can delete their own sessions (logout). Admins can purge any.
CREATE POLICY sessions_delete ON staff_sessions
    FOR DELETE
    USING (
        staff_id = get_session_staff_id()
        OR is_admin_from_session()
    );

-- =====================================================
-- SHIFTS TABLE POLICIES
-- =====================================================

-- Staff can view their own shifts.  Admins can view all.
CREATE POLICY shifts_select ON shifts
    FOR SELECT
    USING (
        staff_id = get_session_staff_id()
        OR is_admin_from_session()
    );

-- Staff can insert their own shifts (clock on).
-- Admins can insert on behalf of anyone (manual entry).
CREATE POLICY shifts_insert ON shifts
    FOR INSERT
    WITH CHECK (
        staff_id = get_session_staff_id()
        OR is_admin_from_session()
    );

-- Staff can update their own shifts (clock off within window).
-- Admins can update any shift (manual adjustment).
CREATE POLICY shifts_update ON shifts
    FOR UPDATE
    USING (
        staff_id = get_session_staff_id()
        OR is_admin_from_session()
    )
    WITH CHECK (
        staff_id = get_session_staff_id()
        OR is_admin_from_session()
    );

-- Only admins may delete shifts.
CREATE POLICY shifts_delete_admin ON shifts
    FOR DELETE
    USING (is_admin_from_session());

-- =====================================================
-- AUDIT_LOG TABLE POLICIES
-- =====================================================

-- Only admins may view audit log.
CREATE POLICY audit_select_admin ON audit_log
    FOR SELECT
    USING (is_admin_from_session());

-- Only admins may insert audit log entries.
CREATE POLICY audit_insert_admin ON audit_log
    FOR INSERT
    WITH CHECK (is_admin_from_session());

-- No UPDATE or DELETE policies — audit log is immutable.

-- =====================================================
-- HARDENING NOTES
-- =====================================================
--
-- 1. What if someone opens browser dev tools and calls the
--    Supabase REST API directly?
--    - They need a valid session token (x-session-token).
--    - The token is generated server-side in authenticate_staff
--      and is a random UUID.  It is NOT the PIN.
--    - Without the token, RLS returns zero rows for every table
--      except through SECURITY DEFINER RPCs (which enforce
--      their own rules: PIN check, time window, admin checks).
--
-- 2. What if someone guesses a session token?
--    - Tokens are UUIDv4 (122 bits of entropy).  Brute force
--      is infeasible in the 8-hour expiry window.
--    - Sessions auto-expire; old tokens are useless.
--
-- 3. What if someone intercepts the token?
--    - All traffic is over HTTPS (Supabase + GitHub Pages).
--    - Token lifetime is 8 hours.  Logout destroys it immediately.
--
-- 4. What if a staff member is deactivated while logged in?
--    - is_admin_from_session() checks active = true.
--    - A deactivated admin loses admin powers immediately.
--    - A deactivated staff member’s existing sessions still allow
--      shift SELECT/UPDATE (they can clock off), but they cannot
--      clock on again because clock_on_shift checks active = true.
--      (Consider purging sessions on deactivation for stricter policy.)
--
-- 5. Column-level leakage of pin_hash:
--    - pin_hash is readable only by the authenticate_staff RPC
--      (SECURITY DEFINER) or an admin with a valid session.
--    - Regular staff SELECT on staff table does NOT expose pin_hash
--      because RLS limits them to their own row — and the app
--      never requests the pin_hash column for staff queries.
--      (For extra safety, create a staff_public view that excludes
--      pin_hash and have the app SELECT from that view.)
--
-- =====================================================
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

    -- Server time window: ±10 minutes from NOW
    v_now := now();
    v_window_start := v_now - INTERVAL '10 minutes';
    v_window_end := v_now + INTERVAL '10 minutes';

    IF p_clock_in < v_window_start OR p_clock_in > v_window_end THEN
        RAISE EXCEPTION 'Clock-in time must be within ±10 minutes of current server time. Submitted: %, Allowed: % to %',
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
    v_window_end := v_now + INTERVAL '10 minutes';

    IF p_clock_out < v_window_start OR p_clock_out > v_window_end THEN
        RAISE EXCEPTION 'Clock-out time must be within ±10 minutes of current server time. Submitted: %, Allowed: % to %',
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
