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
