-- =====================================================
-- Migration Part 2: Function updates for shift_type
-- Date: 2026-05-08
-- =====================================================
-- Run in Supabase Dashboard SQL Editor.
-- shift_type column and unique index already exist.
-- This drops old functions and recreates them.

-- Drop old functions with changed signatures first
DROP FUNCTION IF EXISTS get_roster_for_week(DATE, DATE);
DROP FUNCTION IF EXISTS get_my_roster(UUID, INTEGER);
DROP FUNCTION IF EXISTS get_my_roster(INTEGER);

-- Update create_roster_entry (adds p_shift_type, p_force)
CREATE OR REPLACE FUNCTION create_roster_entry(
    p_staff_id UUID,
    p_roster_date DATE,
    p_start_time TIME,
    p_end_time TIME,
    p_notes TEXT DEFAULT NULL,
    p_force BOOLEAN DEFAULT FALSE,
    p_shift_type TEXT DEFAULT 'lunch'
)
RETURNS rosters AS $$
DECLARE
    v_admin_id UUID;
    v_conflict TEXT;
    v_new_entry rosters%rowtype;
BEGIN
    v_admin_id := get_session_staff_id();
    IF v_admin_id IS NULL OR NOT is_admin_from_session() THEN
        RAISE EXCEPTION 'Admin role required.'
            USING ERRCODE = '42501';
    END IF;

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

    IF p_shift_type NOT IN ('lunch', 'dinner') THEN
        RAISE EXCEPTION 'shift_type must be lunch or dinner.'
            USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM staff WHERE id = p_staff_id AND active = true) THEN
        RAISE EXCEPTION 'Staff member not found or inactive.'
            USING ERRCODE = 'P0002';
    END IF;

    IF NOT COALESCE(p_force, FALSE) THEN
        v_conflict := detect_roster_conflict(
            p_staff_id, p_roster_date,
            p_start_time, p_end_time,
            NULL,
            p_shift_type
        );
        IF v_conflict IS NOT NULL THEN
            RAISE EXCEPTION '%', v_conflict
                USING ERRCODE = 'ROSTER_CONFLICT',
                      HINT = 'Set p_force to TRUE to bypass this check.';
        END IF;
    END IF;

    INSERT INTO rosters (staff_id, roster_date, start_time, end_time, notes, shift_type)
    VALUES (p_staff_id, p_roster_date, p_start_time, p_end_time, p_notes, p_shift_type)
    RETURNING * INTO v_new_entry;

    RETURN v_new_entry;

EXCEPTION
    WHEN unique_violation THEN
        RAISE EXCEPTION 'Roster entry already exists for this staff/date/shift type.'
            USING ERRCODE = '23505';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update update_roster_entry (adds p_shift_type)
CREATE OR REPLACE FUNCTION update_roster_entry(
    p_id UUID,
    p_start_time TIME,
    p_end_time TIME,
    p_notes TEXT DEFAULT NULL,
    p_force BOOLEAN DEFAULT FALSE,
    p_shift_type TEXT DEFAULT NULL
)
RETURNS rosters AS $$
DECLARE
    v_admin_id UUID;
    v_existing rosters%rowtype;
    v_conflict TEXT;
    v_updated rosters%rowtype;
    v_new_shift_type TEXT;
BEGIN
    v_admin_id := get_session_staff_id();
    IF v_admin_id IS NULL OR NOT is_admin_from_session() THEN
        RAISE EXCEPTION 'Admin role required.'
            USING ERRCODE = '42501';
    END IF;

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

    SELECT * INTO v_existing FROM rosters WHERE id = p_id;
    IF v_existing.id IS NULL THEN
        RAISE EXCEPTION 'Roster entry not found.'
            USING ERRCODE = 'P0002';
    END IF;

    v_new_shift_type := COALESCE(p_shift_type, v_existing.shift_type);

    IF v_new_shift_type NOT IN ('lunch', 'dinner') THEN
        RAISE EXCEPTION 'shift_type must be lunch or dinner.'
            USING ERRCODE = '22023';
    END IF;

    IF NOT COALESCE(p_force, FALSE) THEN
        v_conflict := detect_roster_conflict(
            v_existing.staff_id, v_existing.roster_date,
            p_start_time, p_end_time,
            p_id,
            v_new_shift_type
        );
        IF v_conflict IS NOT NULL THEN
            RAISE EXCEPTION '%', v_conflict
                USING ERRCODE = 'ROSTER_CONFLICT',
                      HINT = 'Set p_force to TRUE to bypass this check.';
        END IF;
    END IF;

    UPDATE rosters SET
        start_time = p_start_time,
        end_time   = p_end_time,
        notes      = p_notes,
        shift_type = v_new_shift_type
    WHERE id = p_id
    RETURNING * INTO v_updated;

    RETURN v_updated;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update detect_roster_conflict to scope by shift_type
CREATE OR REPLACE FUNCTION detect_roster_conflict(
    p_staff_id UUID,
    p_roster_date DATE,
    p_start_time TIME,
    p_end_time TIME,
    p_exclude_id UUID DEFAULT NULL,
    p_shift_type TEXT DEFAULT 'lunch'
)
RETURNS TEXT AS $$
DECLARE
    v_conflict TEXT;
    v_existing RECORD;
BEGIN
    SELECT r.id, r.start_time, r.end_time, r.shift_type
    INTO v_existing
    FROM rosters r
    WHERE r.staff_id = p_staff_id
      AND r.roster_date = p_roster_date
      AND r.shift_type = p_shift_type
      AND (p_exclude_id IS NULL OR r.id <> p_exclude_id)
      AND r.start_time < p_end_time
      AND r.end_time   > p_start_time
    LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
        v_conflict := format(
            'Conflict: existing %s entry %s (%s – %s) overlaps with requested time (%s – %s).',
            v_existing.shift_type,
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

-- Recreate get_roster_for_week with shift_type in return columns
CREATE FUNCTION get_roster_for_week(
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
    shift_type TEXT,
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
        r.id AS id,
        r.staff_id AS staff_id,
        s.name AS staff_name,
        r.roster_date AS roster_date,
        r.start_time AS start_time,
        r.end_time AS end_time,
        r.notes AS notes,
        r.shift_type AS shift_type,
        r.created_at AS created_at,
        r.updated_at AS updated_at
    FROM rosters r
    JOIN staff s ON s.id = r.staff_id
    WHERE r.roster_date BETWEEN p_start_date AND p_end_date
      AND (v_is_admin OR r.staff_id = v_staff_id)
    ORDER BY r.roster_date, r.start_time;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Recreate get_my_roster (session-based, no p_staff_id param, returns shift_type)
DROP FUNCTION IF EXISTS get_my_roster(INTEGER);
CREATE FUNCTION get_my_roster(
    p_days_ahead INTEGER DEFAULT 30
)
RETURNS TABLE (
    id UUID,
    staff_id UUID,
    staff_name TEXT,
    roster_date DATE,
    start_time TIME,
    end_time TIME,
    notes TEXT,
    shift_type TEXT,
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

    IF NOT EXISTS (SELECT 1 FROM staff WHERE id = v_staff_id AND active = true) THEN
        RAISE EXCEPTION 'Staff member not found or inactive.'
            USING ERRCODE = '28000';
    END IF;

    IF p_days_ahead IS NULL OR p_days_ahead < 1 THEN
        p_days_ahead := 30;
    END IF;

    v_today := DATE_TRUNC('week', CURRENT_DATE)::DATE;
    v_end_date := CURRENT_DATE + (p_days_ahead || ' days')::INTERVAL;

    RETURN QUERY
    SELECT
        r.id AS id,
        r.staff_id AS staff_id,
        s.name AS staff_name,
        r.roster_date AS roster_date,
        r.start_time AS start_time,
        r.end_time AS end_time,
        r.notes AS notes,
        r.shift_type AS shift_type,
        r.created_at AS created_at,
        r.updated_at AS updated_at
    FROM rosters r
    JOIN staff s ON s.id = r.staff_id
    WHERE r.staff_id = v_staff_id
      AND r.roster_date >= v_today
      AND r.roster_date <= v_end_date
    ORDER BY r.roster_date, r.shift_type, r.start_time;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;