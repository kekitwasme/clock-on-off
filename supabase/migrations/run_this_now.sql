-- =====================================================
-- Nuclear option: drop ALL versions of these functions, then recreate
-- =====================================================

-- Drop all possible signatures of get_my_roster
DROP FUNCTION IF EXISTS get_my_roster(UUID, INTEGER);
DROP FUNCTION IF EXISTS get_my_roster(INTEGER);

-- Drop all possible signatures of get_roster_for_week
DROP FUNCTION IF EXISTS get_roster_for_week(DATE, DATE);

-- Verify they're gone (should return empty)
-- SELECT proname, pg_get_function_identity_arguments(oid) FROM pg_proc WHERE proname IN ('get_my_roster', 'get_roster_for_week');

-- get_roster_for_week (no JOIN, subquery for staff_name)
CREATE FUNCTION get_roster_for_week(
    p_start_date DATE,
    p_end_date DATE
)
RETURNS TABLE (
    roster_id UUID,
    roster_staff_id UUID,
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
        r.id,
        r.staff_id,
        (SELECT s.name FROM staff s WHERE s.id = r.staff_id),
        r.roster_date,
        r.start_time,
        r.end_time,
        r.notes,
        r.shift_type,
        r.created_at,
        r.updated_at
    FROM rosters r
    WHERE r.roster_date BETWEEN p_start_date AND p_end_date
      AND (v_is_admin OR r.staff_id = v_staff_id)
    ORDER BY r.roster_date, r.start_time;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- get_my_roster (session-based, no JOIN, subquery for staff_name)
CREATE FUNCTION get_my_roster(
    p_days_ahead INTEGER DEFAULT 30
)
RETURNS TABLE (
    roster_id UUID,
    roster_staff_id UUID,
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
        r.id,
        r.staff_id,
        (SELECT s.name FROM staff s WHERE s.id = r.staff_id),
        r.roster_date,
        r.start_time,
        r.end_time,
        r.notes,
        r.shift_type,
        r.created_at,
        r.updated_at
    FROM rosters r
    WHERE r.staff_id = v_staff_id
      AND r.roster_date >= v_today
      AND r.roster_date <= v_end_date
    ORDER BY r.roster_date, r.shift_type, r.start_time;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;