-- =====================================================
-- Migration 006: Fix roster functions
-- =====================================================
-- 1. delete_roster_entry: rename param from p_id to p_roster_id (match JS client)
-- 2. get_my_roster: show full current week instead of only future dates
-- =====================================================

-- Drop and recreate delete_roster_entry with correct param name
DROP FUNCTION IF EXISTS delete_roster_entry(UUID);

CREATE OR REPLACE FUNCTION delete_roster_entry(p_roster_id UUID)
RETURNS JSON AS $$
DECLARE
    v_admin_id UUID;
BEGIN
    v_admin_id := get_session_staff_id();
    IF v_admin_id IS NULL OR NOT is_admin_from_session() THEN
        RAISE EXCEPTION 'Admin role required.'
            USING ERRCODE = '42501';
    END IF;

    DELETE FROM rosters WHERE id = p_roster_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Roster entry not found.'
            USING ERRCODE = 'P0002';
    END IF;

    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop and recreate get_my_roster to show full current week
DROP FUNCTION IF EXISTS get_my_roster(UUID, INT);

CREATE OR REPLACE FUNCTION get_my_roster(
    p_staff_id UUID,
    p_days_ahead INT DEFAULT 14
)
RETURNS TABLE (
    roster_id UUID,
    roster_date DATE,
    start_time TIME,
    end_time TIME,
    notes TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
) AS $$
DECLARE
    v_caller_id UUID;
    v_is_admin BOOLEAN;
BEGIN
    v_caller_id := get_session_staff_id();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required. Please log in.'
            USING ERRCODE = '28000';
    END IF;

    v_is_admin := is_admin_from_session();

    IF p_staff_id IS NULL THEN
        RAISE EXCEPTION 'Staff ID is required.'
            USING ERRCODE = '22023';
    END IF;

    -- Staff can only query their own roster; admins can query anyone
    IF NOT v_is_admin AND p_staff_id != v_caller_id THEN
        RAISE EXCEPTION 'You can only view your own roster.'
            USING ERRCODE = '42501';
    END IF;

    -- Show from start of current week (Monday) through days_ahead
    RETURN QUERY
    SELECT
        r.id AS roster_id,
        r.roster_date,
        r.start_time,
        r.end_time,
        r.notes,
        r.created_at,
        r.updated_at
    FROM rosters r
    WHERE r.staff_id = p_staff_id
      AND r.roster_date >= DATE_TRUNC('week', CURRENT_DATE)::DATE
      AND r.roster_date <= (CURRENT_DATE + (p_days_ahead || ' days')::INTERVAL)
    ORDER BY r.roster_date ASC, r.start_time ASC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;