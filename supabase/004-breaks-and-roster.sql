-- =====================================================
-- Clock On/Off App — Breaks & Roster Schema + Functions
-- =====================================================
-- Run this migration AFTER 003-functions.sql.
-- Contains:
--   1. breaks table + indexes + triggers
--   2. rosters table + indexes + triggers
--   3. Alter staff: add expected_start_time / expected_end_time
--   4. Break management functions
--   5. Roster CRUD + query functions
-- =====================================================

-- =====================================================
-- SECTION 1: breaks table
-- =====================================================

CREATE TABLE breaks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    break_start TIMESTAMPTZ NOT NULL,
    break_end TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_breaks_shift_id ON breaks(shift_id);
CREATE INDEX idx_breaks_break_start ON breaks(break_start DESC);

-- updated_at trigger for breaks
CREATE TRIGGER breaks_updated_at
    BEFORE UPDATE ON breaks
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- Enable RLS
ALTER TABLE breaks ENABLE ROW LEVEL SECURITY;

-- Staff can SELECT breaks for their own shifts. Admins can SELECT all.
CREATE POLICY breaks_select ON breaks
    FOR SELECT
    USING (
        shift_id IN (
            SELECT id FROM shifts
            WHERE staff_id = get_session_staff_id()
        )
        OR is_admin_from_session()
    );

-- Staff can INSERT breaks for their own shifts (via RPC or direct).
-- Admins can INSERT breaks for any shift.
CREATE POLICY breaks_insert ON breaks
    FOR INSERT
    WITH CHECK (
        shift_id IN (
            SELECT id FROM shifts
            WHERE staff_id = get_session_staff_id()
        )
        OR is_admin_from_session()
    );

-- Staff can UPDATE breaks for their own shifts. Admins can UPDATE any.
CREATE POLICY breaks_update ON breaks
    FOR UPDATE
    USING (
        shift_id IN (
            SELECT id FROM shifts
            WHERE staff_id = get_session_staff_id()
        )
        OR is_admin_from_session()
    )
    WITH CHECK (
        shift_id IN (
            SELECT id FROM shifts
            WHERE staff_id = get_session_staff_id()
        )
        OR is_admin_from_session()
    );

-- Only admins may DELETE breaks directly (staff end via update).
CREATE POLICY breaks_delete_admin ON breaks
    FOR DELETE
    USING (is_admin_from_session());

-- =====================================================
-- SECTION 2: rosters table
-- =====================================================

CREATE TABLE rosters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    roster_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    notes TEXT CHECK (notes IS NULL OR char_length(notes) <= 200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Prevent duplicate roster entries for same staff + date (replace if needed)
    CONSTRAINT unique_roster_staff_date
        UNIQUE (staff_id, roster_date)
);

CREATE INDEX idx_rosters_staff_date ON rosters(staff_id, roster_date);
CREATE INDEX idx_rosters_date ON rosters(roster_date);

-- updated_at trigger for rosters
CREATE TRIGGER rosters_updated_at
    BEFORE UPDATE ON rosters
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- Enable RLS
ALTER TABLE rosters ENABLE ROW LEVEL SECURITY;

-- Staff can SELECT their own roster entries. Admins can SELECT all.
CREATE POLICY rosters_select ON rosters
    FOR SELECT
    USING (
        staff_id = get_session_staff_id()
        OR is_admin_from_session()
    );

-- Only admins may INSERT roster entries.
CREATE POLICY rosters_insert_admin ON rosters
    FOR INSERT
    WITH CHECK (is_admin_from_session());

-- Only admins may UPDATE roster entries.
CREATE POLICY rosters_update_admin ON rosters
    FOR UPDATE
    USING (is_admin_from_session())
    WITH CHECK (is_admin_from_session());

-- Only admins may DELETE roster entries.
CREATE POLICY rosters_delete_admin ON rosters
    FOR DELETE
    USING (is_admin_from_session());

-- =====================================================
-- SECTION 3: Alter staff — expected times for late/early alerts
-- =====================================================

ALTER TABLE staff
    ADD COLUMN IF NOT EXISTS expected_start_time TIME,
    ADD COLUMN IF NOT EXISTS expected_end_time TIME;

-- =====================================================
-- SECTION 4: Break Management Functions
-- =====================================================

-- Start a new break for a shift.
-- Validates: shift exists, belongs to caller (or admin), not already on break.
CREATE OR REPLACE FUNCTION start_break(p_shift_id UUID)
RETURNS breaks AS $$
DECLARE
    v_staff_id UUID;
    v_shift shifts%rowtype;
    v_new_break breaks%rowtype;
BEGIN
    v_staff_id := get_session_staff_id();
    IF v_staff_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required. Please log in.'
            USING ERRCODE = '28000';
    END IF;

    -- Resolve shift and verify ownership or admin
    SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id;
    IF v_shift.id IS NULL THEN
        RAISE EXCEPTION 'Shift not found.'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_shift.staff_id != v_staff_id AND NOT is_admin_from_session() THEN
        RAISE EXCEPTION 'You can only start breaks on your own shift.'
            USING ERRCODE = '42501';
    END IF;

    -- Prevent starting a break on an already-closed shift
    IF v_shift.clock_out IS NOT NULL THEN
        RAISE EXCEPTION 'Cannot start a break on a closed shift.'
            USING ERRCODE = '23000';
    END IF;

    -- Prevent starting a break if already on break
    IF EXISTS (
        SELECT 1 FROM breaks
        WHERE shift_id = p_shift_id
          AND break_end IS NULL
    ) THEN
        RAISE EXCEPTION 'You are already on a break. End it first.'
            USING ERRCODE = '23000';
    END IF;

    INSERT INTO breaks (shift_id, break_start)
    VALUES (p_shift_id, now())
    RETURNING * INTO v_new_break;

    RETURN v_new_break;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- End a break by setting break_end.
-- Validates: break exists, belongs to caller's shift (or admin), not already ended.
CREATE OR REPLACE FUNCTION end_break(p_break_id UUID)
RETURNS breaks AS $$
DECLARE
    v_staff_id UUID;
    v_existing breaks%rowtype;
    v_updated breaks%rowtype;
BEGIN
    v_staff_id := get_session_staff_id();
    IF v_staff_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required. Please log in.'
            USING ERRCODE = '28000';
    END IF;

    SELECT b.* INTO v_existing
    FROM breaks b
    JOIN shifts s ON s.id = b.shift_id
    WHERE b.id = p_break_id;

    IF v_existing.id IS NULL THEN
        RAISE EXCEPTION 'Break not found.'
            USING ERRCODE = 'P0002';
    END IF;

    -- Verify ownership or admin
    IF NOT EXISTS (
        SELECT 1 FROM shifts
        WHERE id = v_existing.shift_id
          AND staff_id = v_staff_id
    ) AND NOT is_admin_from_session() THEN
        RAISE EXCEPTION 'You can only end breaks on your own shift.'
            USING ERRCODE = '42501';
    END IF;

    IF v_existing.break_end IS NOT NULL THEN
        RAISE EXCEPTION 'Break has already ended.'
            USING ERRCODE = '23000';
    END IF;

    UPDATE breaks
    SET break_end = now()
    WHERE id = p_break_id
    RETURNING * INTO v_updated;

    RETURN v_updated;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Return all breaks for a shift, ordered oldest first.
-- Validates: caller owns the shift or is admin.
CREATE OR REPLACE FUNCTION get_shift_breaks(p_shift_id UUID)
RETURNS SETOF breaks AS $$
DECLARE
    v_staff_id UUID;
BEGIN
    v_staff_id := get_session_staff_id();
    IF v_staff_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required. Please log in.'
            USING ERRCODE = '28000';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM shifts
        WHERE id = p_shift_id
          AND (staff_id = v_staff_id OR is_admin_from_session())
    ) THEN
        RAISE EXCEPTION 'Shift not found or access denied.'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT * FROM breaks
    WHERE shift_id = p_shift_id
    ORDER BY break_start ASC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Returns true if the shift currently has an open (unended) break.
-- Validates: caller owns the shift or is admin.
CREATE OR REPLACE FUNCTION is_on_break(p_shift_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_staff_id UUID;
    v_result BOOLEAN;
BEGIN
    v_staff_id := get_session_staff_id();
    IF v_staff_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required. Please log in.'
            USING ERRCODE = '28000';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM shifts
        WHERE id = p_shift_id
          AND (staff_id = v_staff_id OR is_admin_from_session())
    ) THEN
        RAISE EXCEPTION 'Shift not found or access denied.'
            USING ERRCODE = '42501';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM breaks
        WHERE shift_id = p_shift_id
          AND break_end IS NULL
    ) INTO v_result;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- =====================================================
-- SECTION 5: Roster CRUD + Query Functions
-- =====================================================

-- Create a roster entry.
-- Admin only. Validates time range, notes length.
CREATE OR REPLACE FUNCTION create_roster_entry(
    p_staff_id UUID,
    p_date DATE,
    p_start TIME,
    p_end TIME,
    p_notes TEXT DEFAULT NULL
)
RETURNS rosters AS $$
DECLARE
    v_admin_id UUID;
    v_entry rosters%rowtype;
BEGIN
    v_admin_id := get_session_staff_id();
    IF v_admin_id IS NULL OR NOT is_admin_from_session() THEN
        RAISE EXCEPTION 'Admin role required.'
            USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM staff WHERE id = p_staff_id AND active = true) THEN
        RAISE EXCEPTION 'Staff not found or inactive.'
            USING ERRCODE = 'P0002';
    END IF;

    IF p_date IS NULL THEN
        RAISE EXCEPTION 'Roster date is required.'
            USING ERRCODE = '22023';
    END IF;

    IF p_start IS NULL OR p_end IS NULL THEN
        RAISE EXCEPTION 'Start and end times are required.'
            USING ERRCODE = '22023';
    END IF;

    IF p_start >= p_end THEN
        RAISE EXCEPTION 'End time must be after start time.'
            USING ERRCODE = '22023';
    END IF;

    IF p_notes IS NOT NULL AND length(p_notes) > 200 THEN
        RAISE EXCEPTION 'Notes must be 200 characters or fewer.'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO rosters (staff_id, roster_date, start_time, end_time, notes)
    VALUES (p_staff_id, p_date, p_start, p_end, p_notes)
    RETURNING * INTO v_entry;

    RETURN v_entry;

EXCEPTION
    WHEN unique_violation THEN
        RAISE EXCEPTION 'This staff member already has a roster entry for that date.'
            USING ERRCODE = '23505';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update a roster entry.
-- Admin only. Validates same rules as create.
CREATE OR REPLACE FUNCTION update_roster_entry(
    p_roster_id UUID,
    p_start TIME,
    p_end TIME,
    p_notes TEXT DEFAULT NULL
)
RETURNS rosters AS $$
DECLARE
    v_admin_id UUID;
    v_existing rosters%rowtype;
    v_updated rosters%rowtype;
BEGIN
    v_admin_id := get_session_staff_id();
    IF v_admin_id IS NULL OR NOT is_admin_from_session() THEN
        RAISE EXCEPTION 'Admin role required.'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_existing FROM rosters WHERE id = p_roster_id;
    IF v_existing.id IS NULL THEN
        RAISE EXCEPTION 'Roster entry not found.'
            USING ERRCODE = 'P0002';
    END IF;

    IF p_start IS NULL OR p_end IS NULL THEN
        RAISE EXCEPTION 'Start and end times are required.'
            USING ERRCODE = '22023';
    END IF;

    IF p_start >= p_end THEN
        RAISE EXCEPTION 'End time must be after start time.'
            USING ERRCODE = '22023';
    END IF;

    IF p_notes IS NOT NULL AND length(p_notes) > 200 THEN
        RAISE EXCEPTION 'Notes must be 200 characters or fewer.'
            USING ERRCODE = '22023';
    END IF;

    UPDATE rosters SET
        start_time = p_start,
        end_time   = p_end,
        notes      = p_notes,
        updated_at = now()
    WHERE id = p_roster_id
    RETURNING * INTO v_updated;

    RETURN v_updated;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Delete a roster entry.
-- Admin only.
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

-- Get roster entries for a date range (inclusive).
-- Returns staff name alongside roster data. Admin sees all; staff sees only their own.
CREATE OR REPLACE FUNCTION get_roster_for_week(
    p_start_date DATE,
    p_end_date DATE
)
RETURNS TABLE (
    roster_id UUID,
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

    RETURN QUERY
    SELECT
        r.id AS roster_id,
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
    ORDER BY r.roster_date ASC, r.start_time ASC, s.name ASC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Get a staff member's upcoming roster entries.
-- Defaults to next 14 days. Staff sees only their own; admins can see any.
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
      AND r.roster_date >= CURRENT_DATE
      AND r.roster_date <= (CURRENT_DATE + (p_days_ahead || ' days')::INTERVAL)
    ORDER BY r.roster_date ASC, r.start_time ASC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- =====================================================
-- SECTION 6: Shift Duration Function (Break-Aware)
-- =====================================================

-- Calculate total break duration for a shift in minutes.
CREATE OR REPLACE FUNCTION get_shift_break_duration_minutes(p_shift_id UUID)
RETURNS NUMERIC AS $$
DECLARE
    v_total NUMERIC;
BEGIN
    SELECT COALESCE(
        SUM(
            EXTRACT(EPOCH FROM (COALESCE(b.break_end, now()) - b.break_start)) / 60
        ),
        0
    ) INTO v_total
    FROM breaks b
    WHERE b.shift_id = p_shift_id;

    RETURN v_total;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Calculate shift duration in minutes, subtracting completed breaks.
-- For open shifts, uses now() as clock_out; for breaks, uses now() for open breaks.
CREATE OR REPLACE FUNCTION get_shift_duration_minus_breaks(p_shift_id UUID)
RETURNS NUMERIC AS $$
DECLARE
    v_shift shifts%rowtype;
    v_total_minutes NUMERIC;
    v_break_minutes NUMERIC;
BEGIN
    SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id;
    IF v_shift.id IS NULL THEN
        RAISE EXCEPTION 'Shift not found.'
            USING ERRCODE = 'P0002';
    END IF;

    v_total_minutes := EXTRACT(EPOCH FROM (
        COALESCE(v_shift.clock_out, now()) - v_shift.clock_in
    )) / 60;

    v_break_minutes := get_shift_break_duration_minutes(p_shift_id);

    RETURN GREATEST(v_total_minutes - v_break_minutes, 0);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- =====================================================
-- SECURITY & OPERATIONS NOTES
-- =====================================================
--
-- 1. All functions are SECURITY DEFINER so they bypass RLS.
--    Each performs its own authorization checks via
--    get_session_staff_id() / is_admin_from_session().
--
-- 2. Break functions prevent double-starting breaks and
--    ending already-ended breaks. They prevent breaks
--    on closed shifts.
--
-- 3. Roster functions are admin-only for mutation.
--    get_roster_for_week and get_my_roster enforce
--    staff-can-only-see-own, admin-sees-all.
--
-- 4. The breaks and rosters tables have updated_at
--    triggers and RLS policies consistent with the
--    existing staff/shifts/audit_log security model.
--
-- 5. get_shift_duration_minus_breaks returns the raw
--    numeric minutes; UI formatting (HH:MM) is a
--    client concern.
--
-- =====================================================
