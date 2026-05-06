-- =====================================================
-- Migration: Create breaks table (Task 1.1)
-- Date: 2026-05-06
-- =====================================================
-- Stores individual break records linked to shifts.
-- A shift may have MULTIPLE breaks.
-- break_end is NULL while the break is in progress.
-- break_start must be within the shift's clock_in window.
-- =====================================================

-- =====================================================
-- Table: breaks
-- =====================================================

CREATE TABLE breaks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    break_start TIMESTAMPTZ NOT NULL,
    break_end TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Prevent overlapping open breaks per shift (safety net)
    CONSTRAINT no_overlapping_open_break
        EXCLUDE USING gist (shift_id WITH =)
        WHERE (break_end IS NULL)
);

-- Index for shift break lookups
CREATE INDEX idx_breaks_shift_id ON breaks(shift_id);

-- Partial index for finding active (open) breaks
CREATE INDEX idx_breaks_active ON breaks(shift_id, break_start DESC) WHERE break_end IS NULL;

-- Index for date-range queries
CREATE INDEX idx_breaks_break_start ON breaks(break_start DESC);
CREATE INDEX idx_breaks_break_end ON breaks(break_end);

-- =====================================================
-- Enable RLS
-- =====================================================

ALTER TABLE breaks ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- RLS Policies
-- =====================================================

-- Staff can view breaks for their own shifts.
-- Admins can view all breaks.
CREATE POLICY breaks_select ON breaks
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM shifts s
            WHERE s.id = breaks.shift_id
              AND s.staff_id = get_session_staff_id()
        )
        OR is_admin_from_session()
    );

-- Staff can insert breaks for their own shifts (start break).
-- Admins can insert on behalf of anyone (manual entry).
CREATE POLICY breaks_insert ON breaks
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM shifts s
            WHERE s.id = breaks.shift_id
              AND s.staff_id = get_session_staff_id()
        )
        OR is_admin_from_session()
    );

-- Staff can update breaks for their own shifts (end break).
-- Admins can update any break (manual adjustment).
CREATE POLICY breaks_update ON breaks
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM shifts s
            WHERE s.id = breaks.shift_id
              AND s.staff_id = get_session_staff_id()
        )
        OR is_admin_from_session()
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM shifts s
            WHERE s.id = breaks.shift_id
              AND s.staff_id = get_session_staff_id()
        )
        OR is_admin_from_session()
    );

-- Only admins may delete breaks.
CREATE POLICY breaks_delete_admin ON breaks
    FOR DELETE
    USING (is_admin_from_session());

-- =====================================================
-- Functions: Break Management
-- =====================================================

-- Check if a shift is currently on break.
CREATE OR REPLACE FUNCTION is_on_break(p_shift_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM breaks
        WHERE shift_id = p_shift_id AND break_end IS NULL
    );
END;
$$ LANGUAGE plpgsql STABLE;

-- Start a break for a shift.
-- Validates: not already on break, shift exists and is open, belongs to caller.
-- Returns the new break record.
CREATE OR REPLACE FUNCTION start_break(p_shift_id UUID)
RETURNS breaks AS $$
DECLARE
    v_staff_id UUID;
    v_shift shifts%rowtype;
    v_new_break breaks%rowtype;
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

    -- Verify shift exists, is open, and belongs to this staff member
    SELECT * INTO v_shift
    FROM shifts
    WHERE id = p_shift_id
      AND clock_out IS NULL;

    IF v_shift.id IS NULL THEN
        RAISE EXCEPTION 'Shift not found or already clocked off.'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_shift.staff_id != v_staff_id THEN
        RAISE EXCEPTION 'You can only start a break for your own shift.'
            USING ERRCODE = '42501';
    END IF;

    -- Prevent double breaks
    IF is_on_break(p_shift_id) THEN
        RAISE EXCEPTION 'You are already on a break. End it first.'
            USING ERRCODE = '23000';
    END IF;

    -- Insert break record with current server time
    INSERT INTO breaks (shift_id, break_start)
    VALUES (p_shift_id, now())
    RETURNING * INTO v_new_break;

    RETURN v_new_break;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- End a break.
-- Validates: break exists, is open, belongs to caller's shift.
-- Returns the updated break record.
CREATE OR REPLACE FUNCTION end_break(p_break_id UUID)
RETURNS breaks AS $$
DECLARE
    v_staff_id UUID;
    v_break breaks%rowtype;
    v_shift shifts%rowtype;
    v_updated breaks%rowtype;
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

    -- Verify break exists and is open
    SELECT * INTO v_break
    FROM breaks
    WHERE id = p_break_id
      AND break_end IS NULL;

    IF v_break.id IS NULL THEN
        RAISE EXCEPTION 'Break not found or already ended.'
            USING ERRCODE = 'P0002';
    END IF;

    -- Verify the break belongs to a shift owned by this staff member
    SELECT * INTO v_shift
    FROM shifts
    WHERE id = v_break.shift_id;

    IF v_shift.staff_id != v_staff_id THEN
        RAISE EXCEPTION 'You can only end your own break.'
            USING ERRCODE = '42501';
    END IF;

    UPDATE breaks
    SET break_end = now()
    WHERE id = p_break_id
    RETURNING * INTO v_updated;

    RETURN v_updated;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get all breaks for a shift with duration in minutes.
-- Ongoing breaks report duration from break_start to now().
CREATE OR REPLACE FUNCTION get_shift_breaks(p_shift_id UUID)
RETURNS TABLE (
    id UUID,
    break_start TIMESTAMPTZ,
    break_end TIMESTAMPTZ,
    duration_minutes INT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        b.id,
        b.break_start,
        b.break_end,
        CASE
            WHEN b.break_end IS NOT NULL
            THEN EXTRACT(EPOCH FROM (b.break_end - b.break_start))::INT / 60
            ELSE EXTRACT(EPOCH FROM (now() - b.break_start))::INT / 60
        END AS duration_minutes
    FROM breaks b
    WHERE b.shift_id = p_shift_id
    ORDER BY b.break_start;
END;
$$ LANGUAGE plpgsql STABLE;

-- =====================================================
-- SECURITY & OPERATIONS NOTES
-- =====================================================
--
-- 1. start_break and end_break are SECURITY DEFINER so
--    they bypass RLS. They perform their own authorization
--    checks (session token → staff_id → shift ownership).
--
-- 2. The no_overlapping_open_break constraint prevents
--    multiple simultaneous open breaks for the same shift.
--
-- 3. Break time is always server time (now()) — clients
--    do not submit break timestamps. This eliminates
--    clock-manipulation risks for breaks.
--
-- 4. RLS SELECT/INSERT/UPDATE policies join to shifts to
--    verify ownership. Admins bypass via is_admin_from_session().
--
-- 5. Clock-off while on break is blocked at the application
--    layer (UI guard) and should also be blocked in the
--    clock_off_shift function if extended in a later task.
--
-- =====================================================
