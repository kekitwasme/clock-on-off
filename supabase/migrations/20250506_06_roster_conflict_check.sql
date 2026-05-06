-- =====================================================
-- Migration: Roster Conflict Detection (Task 4.4)
-- Date: 2026-05-06
-- =====================================================
-- Adds double-booking conflict detection to roster entry
-- creation and updates.
--
-- A conflict exists when the same staff member has an
-- overlapping time range on the same roster_date.
-- Overlap = existing.start_time < new_end_time AND
--           existing.end_time   > new_start_time
--
-- The create_roster_entry function gains a p_force
-- parameter (default false).  When false, overlapping
-- entries raise an exception.  When true, the check is
-- skipped so admins can intentionally create split
-- shifts or overlapping training blocks.
-- =====================================================

-- =====================================================
-- SECTION 1: Conflict Detection Helper
-- =====================================================

-- Detects whether a roster conflict exists for a staff
-- member on a given date, excluding a specific entry (for
-- updates).  Returns a TEXT description of the first
-- conflict found, or NULL if none.
CREATE OR REPLACE FUNCTION detect_roster_conflict(
    p_staff_id UUID,
    p_roster_date DATE,
    p_start_time TIME,
    p_end_time TIME,
    p_exclude_id UUID DEFAULT NULL
)
RETURNS TEXT AS $$
DECLARE
    v_conflict TEXT;
    v_existing RECORD;
BEGIN
    SELECT
        r.id,
        r.start_time,
        r.end_time
    INTO v_existing
    FROM rosters r
    WHERE r.staff_id = p_staff_id
      AND r.roster_date = p_roster_date
      AND (p_exclude_id IS NULL OR r.id <> p_exclude_id)
      AND r.start_time < p_end_time
      AND r.end_time   > p_start_time
    LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
        v_conflict := format(
            'Conflict: existing entry %s (%s – %s) overlaps with requested time (%s – %s).',
            v_existing.id,
            v_existing.start_time::TEXT,
            v_existing.end_time::TEXT,
            p_start_time::TEXT,
            p_end_time::TEXT
        );
        RETURN v_conflict;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- =====================================================
-- SECTION 2: Updated create_roster_entry
-- =====================================================

CREATE OR REPLACE FUNCTION create_roster_entry(
    p_staff_id UUID,
    p_roster_date DATE,
    p_start_time TIME,
    p_end_time TIME,
    p_notes TEXT DEFAULT NULL,
    p_force BOOLEAN DEFAULT FALSE
)
RETURNS rosters AS $$
DECLARE
    v_admin_id UUID;
    v_conflict TEXT;
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

    -- Conflict detection (skip when p_force = true)
    IF NOT COALESCE(p_force, FALSE) THEN
        v_conflict := detect_roster_conflict(
            p_staff_id, p_roster_date,
            p_start_time, p_end_time,
            NULL
        );
        IF v_conflict IS NOT NULL THEN
            RAISE EXCEPTION '%', v_conflict
                USING ERRCODE = 'ROSTER_CONFLICT',
                      HINT = 'Set p_force to TRUE to bypass this check for split shifts or intentional overlaps.';
        END IF;
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

-- =====================================================
-- SECTION 3: Updated update_roster_entry
-- =====================================================

CREATE OR REPLACE FUNCTION update_roster_entry(
    p_id UUID,
    p_start_time TIME,
    p_end_time TIME,
    p_notes TEXT DEFAULT NULL,
    p_force BOOLEAN DEFAULT FALSE
)
RETURNS rosters AS $$
DECLARE
    v_admin_id UUID;
    v_existing rosters%rowtype;
    v_conflict TEXT;
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

    -- Conflict detection on update (skip when p_force = true)
    IF NOT COALESCE(p_force, FALSE) THEN
        v_conflict := detect_roster_conflict(
            v_existing.staff_id, v_existing.roster_date,
            p_start_time, p_end_time,
            p_id
        );
        IF v_conflict IS NOT NULL THEN
            RAISE EXCEPTION '%', v_conflict
                USING ERRCODE = 'ROSTER_CONFLICT',
                      HINT = 'Set p_force to TRUE to bypass this check for split shifts or intentional overlaps.';
        END IF;
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

-- =====================================================
-- SECURITY & OPERATIONS NOTES
-- =====================================================
--
-- 1. Error codes:
--    - ROSTER_CONFLICT :: Overlapping entry found.
--      The exception message includes the existing entry
--      id and its time range so the UI can display it.
--      HINT advises the caller to set p_force = TRUE.
--
-- 2. Bypassing the check:
--    - Admins can intentionally create overlapping blocks
--      (e.g. split shifts, training) by passing
--      p_force = TRUE.
--    - The UI should show a confirmation dialog when a
--      ROSTER_CONFLICT is caught, and retry with
--      p_force = TRUE if the admin confirms.
--
-- 3. detect_roster_conflict helper:
--    - Reusable for both create and update.
--    - p_exclude_id allows update to ignore its own row.
--    - Returns NULL when no conflict, or a descriptive
--      TEXT message when one is found.
--
-- 4. Performance:
--    - idx_rosters_staff_date is used for the conflict
--      lookup (staff_id + roster_date).
--    - The LIMIT 1 ensures early exit on first hit.
--
-- =====================================================
