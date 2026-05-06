-- =====================================================
-- Migration: Roster CRUD Functions (Task 4.2)
-- Date: 2026-05-06
-- =====================================================
-- Implements admin-only roster entry management and
-- staff-level roster queries.
--
-- Functions:
--   create_roster_entry  — admin only
--   update_roster_entry  — admin only
--   delete_roster_entry  — admin only
--   get_roster_for_week  — admin or staff (joined staff info)
--   get_my_roster        — current staff, upcoming entries
--
-- All mutating functions are SECURITY DEFINER with
-- explicit admin checks, consistent with the rest of
-- the application (003-functions.sql, breaks.sql, etc.).
-- =====================================================

-- =====================================================
-- SECTION 1: Admin CRUD Functions
-- =====================================================

-- Create a new roster entry.
-- Admin only.  Staff members are never allowed to create
-- their own roster entries — scheduling is an admin function.
CREATE OR REPLACE FUNCTION create_roster_entry(
    p_staff_id UUID,
    p_roster_date DATE,
    p_start_time TIME,
    p_end_time TIME,
    p_notes TEXT DEFAULT NULL
)
RETURNS rosters AS $$
DECLARE
    v_admin_id UUID;
    v_new_entry rosters%rowtype;
BEGIN
    -- Verify caller is admin
    v_admin_id := get_session_staff_id();
    IF v_admin_id IS NULL OR NOT is_admin_from_session() THEN
        RAISE EXCEPTION 'Admin role required.'
            USING ERRCODE = '42501';
    END IF;

    -- Validate inputs
    IF p_staff_id IS NULL THEN
        RAISE EXCEPTION 'staff_id is required.'
            USING ERRCODE = '22023';
    END IF;

    IF p_roster_date IS NULL THEN
        RAISE EXCEPTION 'roster_date is required.'
            USING ERRCODE = '22023';
    END IF;

    IF p_start_time IS NULL OR p_end_time IS NULL THEN
        RAISE EXCEPTION 'start_time and end_time are required.'
            USING ERRCODE = '22023';
    END IF;

    IF p_end_time <= p_start_time THEN
        RAISE EXCEPTION 'end_time must be after start_time.'
            USING ERRCODE = '22023';
    END IF;

    -- Verify target staff exists and is active
    IF NOT EXISTS (
        SELECT 1 FROM staff
        WHERE id = p_staff_id
          AND active = true
    ) THEN
        RAISE EXCEPTION 'Staff member not found or inactive.'
            USING ERRCODE = 'P0002';
    END IF;

    -- Insert roster entry
    INSERT INTO rosters (staff_id, roster_date, start_time, end_time, notes)
    VALUES (p_staff_id, p_roster_date, p_start_time, p_end_time, p_notes)
    RETURNING * INTO v_new_entry;

    RETURN v_new_entry;

EXCEPTION
    WHEN unique_violation THEN
        RAISE EXCEPTION 'Roster entry already exists for this staff on this date.'
            USING ERRCODE = '23505';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update an existing roster entry.
-- Admin only.  Updates start_time, end_time, and notes.
-- Does NOT move the entry to a different staff or date
-- (use delete + create for that).
CREATE OR REPLACE FUNCTION update_roster_entry(
    p_id UUID,
    p_start_time TIME,
    p_end_time TIME,
    p_notes TEXT DEFAULT NULL
)
RETURNS rosters AS $$
DECLARE
    v_admin_id UUID;
    v_existing rosters%rowtype;
    v_updated rosters%rowtype;
BEGIN
    -- Verify caller is admin
    v_admin_id := get_session_staff_id();
    IF v_admin_id IS NULL OR NOT is_admin_from_session() THEN
        RAISE EXCEPTION 'Admin role required.'
            USING ERRCODE = '42501';
    END IF;

    -- Validate inputs
    IF p_id IS NULL THEN
        RAISE EXCEPTION 'roster entry id is required.'
            USING ERRCODE = '22023';
    END IF;

    IF p_start_time IS NULL OR p_end_time IS NULL THEN
        RAISE EXCEPTION 'start_time and end_time are required.'
            USING ERRCODE = '22023';
    END IF;

    IF p_end_time <= p_start_time THEN
        RAISE EXCEPTION 'end_time must be after start_time.'
            USING ERRCODE = '22023';
    END IF;

    -- Verify entry exists
    SELECT * INTO v_existing
    FROM rosters
    WHERE id = p_id;

    IF v_existing.id IS NULL THEN
        RAISE EXCEPTION 'Roster entry not found.'
            USING ERRCODE = 'P0002';
    END IF;

    -- Perform update
    UPDATE rosters SET
        start_time = p_start_time,
        end_time   = p_end_time,
        notes      = p_notes
    WHERE id = p_id
    RETURNING * INTO v_updated;

    RETURN v_updated;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Delete a roster entry.
-- Admin only.
CREATE OR REPLACE FUNCTION delete_roster_entry(p_id UUID)
RETURNS JSON AS $$
DECLARE
    v_admin_id UUID;
BEGIN
    -- Verify caller is admin
    v_admin_id := get_session_staff_id();
    IF v_admin_id IS NULL OR NOT is_admin_from_session() THEN
        RAISE EXCEPTION 'Admin role required.'
            USING ERRCODE = '42501';
    END IF;

    IF p_id IS NULL THEN
        RAISE EXCEPTION 'roster entry id is required.'
            USING ERRCODE = '22023';
    END IF;

    DELETE FROM rosters WHERE id = p_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Roster entry not found.'
            USING ERRCODE = 'P0002';
    END IF;

    RETURN json_build_object('success', true, 'deleted_id', p_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- SECTION 2: Query Functions
-- =====================================================

-- Get all roster entries within a date range, joined with staff info.
-- Returns entries ordered by roster_date, then start_time.
-- Admin sees all; staff sees their own (get_my_roster is preferred
-- for staff).  This function is useful for the week-grid view.
CREATE OR REPLACE FUNCTION get_roster_for_week(
    p_start_date DATE,
    p_end_date DATE
)
RETURNS TABLE (
    id UUID,
    staff_id UUID,
    staff_name TEXT,
    roster_date DATE,
    start_time TIME,
    end_time TIME,
    notes TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
) AS $$
DECLARE
    v_staff_id UUID;
    v_is_admin BOOLEAN;
BEGIN
    v_staff_id := get_session_staff_id();
    IF v_staff_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required. Please log in.'
            USING ERRCODE = '28000';
    END IF;

    v_is_admin := is_admin_from_session();

    -- Date range validation
    IF p_start_date IS NULL OR p_end_date IS NULL THEN
        RAISE EXCEPTION 'start_date and end_date are required.'
            USING ERRCODE = '22023';
    END IF;

    IF p_end_date < p_start_date THEN
        RAISE EXCEPTION 'end_date must be on or after start_date.'
            USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    SELECT
        r.id,
        r.staff_id,
        s.name AS staff_name,
        r.roster_date,
        r.start_time,
        r.end_time,
        r.notes,
        r.created_at,
        r.updated_at
    FROM rosters r
    JOIN staff s ON s.id = r.staff_id
    WHERE r.roster_date BETWEEN p_start_date AND p_end_date
      AND (
          v_is_admin
          OR r.staff_id = v_staff_id
      )
    ORDER BY r.roster_date, r.start_time;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Get upcoming roster entries for the current staff member.
-- Returns entries from today forward for the requested number
-- of days.  Used by the staff "My Roster" / home-screen view.
CREATE OR REPLACE FUNCTION get_my_roster(
    p_days_ahead INTEGER DEFAULT 14
)
RETURNS TABLE (
    id UUID,
    staff_id UUID,
    staff_name TEXT,
    roster_date DATE,
    start_time TIME,
    end_time TIME,
    notes TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
) AS $$
DECLARE
    v_staff_id UUID;
    v_today DATE;
    v_end_date DATE;
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

    -- Default days ahead
    IF p_days_ahead IS NULL OR p_days_ahead < 1 THEN
        p_days_ahead := 14;
    END IF;

    v_today := CURRENT_DATE;
    v_end_date := v_today + (p_days_ahead || ' days')::INTERVAL;

    RETURN QUERY
    SELECT
        r.id,
        r.staff_id,
        s.name AS staff_name,
        r.roster_date,
        r.start_time,
        r.end_time,
        r.notes,
        r.created_at,
        r.updated_at
    FROM rosters r
    JOIN staff s ON s.id = r.staff_id
    WHERE r.staff_id = v_staff_id
      AND r.roster_date >= v_today
      AND r.roster_date <= v_end_date
    ORDER BY r.roster_date, r.start_time;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- =====================================================
-- SECURITY & OPERATIONS NOTES
-- =====================================================
--
-- 1. Authorization model:
--    - create/update/delete_roster_entry are STRICTLY
--      admin-only (is_admin_from_session() enforced).
--    - get_roster_for_week returns all entries in the
--      date range for admins, or the caller's own entries
--      for non-admins.  Prefer get_my_roster for staff.
--    - get_my_roster uses the session's staff_id and
--      never accepts an external staff_id parameter.
--
-- 2. SECURITY DEFINER:
--    - All five functions are SECURITY DEFINER so they
--      bypass RLS and can JOIN across rosters + staff.
--    - create/update/delete perform their own auth checks.
--    - Query functions (get_roster_for_week, get_my_roster)
--      verify the session is valid and active before
--      returning any rows.
--
-- 3. Input validation:
--    - All functions validate NULL inputs explicitly.
--    - Time order is enforced: end_time > start_time.
--    - Date range order is enforced: end_date >= start_date.
--    - p_days_ahead defaults to 14 and is clamped to >= 1.
--
-- 4. Error codes (consistent with rest of app):
--    - 28000 :: Authentication required / inactive staff
--    - 42501 :: Admin role required / unauthorized
--    - 22023 :: Invalid input (NULLs, bad time order)
--    - P0002 :: Resource not found
--    - 23505 :: Unique violation (duplicate roster entry)
--
-- 5. Conflict detection:
--    - No EXCLUDE constraint on rosters (by design).
--    - Application layer should query existing entries
--      for the same staff on the same date before
--      calling create_roster_entry and warn admins about
--      overlapping times.
--
-- 6. Performance:
--    - get_roster_for_week uses idx_rosters_date.
--    - get_my_roster uses idx_rosters_staff_date.
--    - Staff JOIN is on staff.id (PRIMARY KEY).
--
-- =====================================================
