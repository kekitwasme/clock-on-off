-- Relax clock_on_shift time validation: add p_skip_time_check param
-- When true, allows any time (no ±10 min constraint). Default false for backward compat.

-- Drop and recreate with new param
DROP FUNCTION IF EXISTS clock_on_shift(TIMESTAMPTZ, BOOLEAN, TEXT);

CREATE OR REPLACE FUNCTION clock_on_shift(
    p_clock_in TIMESTAMPTZ,
    p_adjusted BOOLEAN DEFAULT FALSE,
    p_notes TEXT DEFAULT NULL,
    p_skip_time_check BOOLEAN DEFAULT FALSE
)
RETURNS shifts AS $$
DECLARE
    v_staff_id UUID;
    v_existing shifts%rowtype;
    v_new_shift shifts%rowtype;
    v_time_diff INTERVAL;
BEGIN
    v_staff_id := get_session_staff_id();
    IF v_staff_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required. Please log in.'
            USING ERRCODE = '28000';
    END IF;

    -- Validate time window unless skip requested
    IF NOT COALESCE(p_skip_time_check, FALSE) THEN
        v_time_diff := p_clock_in - CURRENT_TIMESTAMP;
        IF v_time_diff > INTERVAL '10 minutes' OR v_time_diff < INTERVAL '-10 minutes' THEN
            RAISE EXCEPTION 'Clock-in time must be within ±10 minutes of current server time.'
                USING ERRCODE = '44000';
        END IF;
    END IF;

    -- Check for existing active shift
    SELECT * INTO v_existing FROM shifts
    WHERE staff_id = v_staff_id AND clock_out IS NULL
    LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
        RAISE EXCEPTION 'You already have an active shift. Please clock off first.'
            USING ERRCODE = '44000';
    END IF;

    INSERT INTO shifts (staff_id, clock_in, clock_in_adjusted, notes)
    VALUES (v_staff_id, p_clock_in, p_adjusted, p_notes)
    RETURNING * INTO v_new_shift;

    RETURN v_new_shift;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;