-- =====================================================
-- Migration: Update shift duration calculation to subtract break time (Task 1.3)
-- Date: 2026-05-06
-- =====================================================
-- Adds:
--   1. calculate_shift_duration(p_shift_id UUID) — net duration in minutes
--   2. Enhanced clock_off_shift — auto-ends active break before clocking off
--
-- Rules:
--   - Completed breaks (break_end IS NOT NULL) are deducted
--   - Ongoing breaks (break_end IS NULL) are NOT deducted until ended
--   - If staff clocks off while on break, break is auto-ended first
--   - Backward compatible: shifts with no breaks work as before
-- =====================================================

-- =====================================================
-- Function: calculate_shift_duration
-- =====================================================
-- Returns net shift duration in minutes (raw duration minus completed break time).
-- Ongoing breaks are NOT deducted. NULL if shift is still open.

CREATE OR REPLACE FUNCTION calculate_shift_duration(p_shift_id UUID)
RETURNS INTEGER AS $$
DECLARE
    v_shift shifts%rowtype;
    v_raw_minutes INTEGER;
    v_break_minutes INTEGER;
BEGIN
    -- Get the shift record
    SELECT * INTO v_shift
    FROM shifts
    WHERE id = p_shift_id;

    IF v_shift.id IS NULL THEN
        RAISE EXCEPTION 'Shift not found.'
            USING ERRCODE = 'P0002';
    END IF;

    -- Cannot calculate duration for an open shift
    IF v_shift.clock_out IS NULL THEN
        RETURN NULL;
    END IF;

    -- Calculate raw duration in minutes (rounded to nearest minute)
    v_raw_minutes := ROUND(EXTRACT(EPOCH FROM (v_shift.clock_out - v_shift.clock_in))::NUMERIC / 60)::INTEGER;

    -- Sum completed break durations in minutes (only breaks with break_end IS NOT NULL)
    SELECT COALESCE(SUM(
        ROUND(EXTRACT(EPOCH FROM (b.break_end - b.break_start))::NUMERIC / 60)::INTEGER
    ), 0)
    INTO v_break_minutes
    FROM breaks b
    WHERE b.shift_id = p_shift_id
      AND b.break_end IS NOT NULL;

    -- Net duration (never negative)
    RETURN GREATEST(v_raw_minutes - v_break_minutes, 0);
END;
$$ LANGUAGE plpgsql STABLE;

-- =====================================================
-- Function: clock_off_shift (ENHANCED)
-- =====================================================
-- Drops and recreates clock_off_shift with break-aware logic:
--   1. Validates session and time window (unchanged)
--   2. Checks if shift is currently on break
--   3. If on break: auto-ends the break using now() before clocking off
--   4. Performs the clock-off update
--   5. Returns the updated shift record

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
    v_active_break_id UUID;
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

    -- =====================================================
    -- BREAK-AWARE ENHANCEMENT
    -- If shift is currently on break, auto-end the break
    -- using the clock-out time (or now, whichever is earlier).
    -- This ensures the break duration is captured and deducted.
    -- =====================================================
    IF is_on_break(p_shift_id) THEN
        -- Find the active break for this shift
        SELECT id INTO v_active_break_id
        FROM breaks
        WHERE shift_id = p_shift_id
          AND break_end IS NULL
        LIMIT 1;

        IF v_active_break_id IS NOT NULL THEN
            -- End the break at the earlier of clock-out time or now
            -- to prevent backdating break_end beyond clock_out
            UPDATE breaks
            SET break_end = LEAST(p_clock_out, v_now)
            WHERE id = v_active_break_id;
        END IF;
    END IF;

    -- Perform the clock-off
    UPDATE shifts
    SET clock_out = p_clock_out,
        clock_out_adjusted = p_adjusted
    WHERE id = p_shift_id
    RETURNING * INTO v_updated;

    RETURN v_updated;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- SECURITY & OPERATIONS NOTES
-- =====================================================
--
-- 1. calculate_shift_duration is STABLE (not SECURITY DEFINER)
--    so it respects RLS when called directly. It is safe because
--    it only reads shifts and breaks tables.
--
-- 2. clock_off_shift remains SECURITY DEFINER because it must
--    bypass RLS to update shifts and (if needed) breaks tables.
--    It performs full session/ownership checks before mutation.
--
-- 3. Auto-ending breaks on clock-off uses LEAST(p_clock_out, now())
--    to prevent creating a break_end that is later than the
--    actual clock-off timestamp.
--
-- 4. If a staff member is on break and clocks off, the break is
--    silently ended. The UI should ideally warn the user first,
--    but the server handles it gracefully regardless.
--
-- 5. Backward compatibility: existing closed shifts with no breaks
--    will calculate correctly (break sum = 0). Open shifts return
--    NULL from calculate_shift_duration, preserving prior behavior
--    where duration was undefined until clock-off.
--
-- =====================================================
