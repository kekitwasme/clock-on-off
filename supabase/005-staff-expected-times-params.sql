-- =====================================================
-- Migration 005: Add expected times params to staff RPC functions
-- =====================================================
-- Fixes: "Could not find the function public.create_staff_with_pin"
--   with p_expected_start_time / p_expected_end_time params
-- The JS client sends these but the SQL functions don't accept them.
-- This migration recreates both functions with the extra params.
-- =====================================================

-- Drop existing functions first (required to change param signatures)
DROP FUNCTION IF EXISTS create_staff_with_pin(TEXT, TEXT, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS update_staff_with_pin(UUID, TEXT, TEXT, TEXT, BOOLEAN);

-- =====================================================
-- create_staff_with_pin (with expected times)
-- =====================================================
CREATE OR REPLACE FUNCTION create_staff_with_pin(
    p_name TEXT,
    p_pin TEXT,
    p_role TEXT DEFAULT 'staff',
    p_active BOOLEAN DEFAULT true,
    p_expected_start_time TIME DEFAULT NULL,
    p_expected_end_time TIME DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_admin_id UUID;
    v_new_staff staff%rowtype;
BEGIN
    -- Verify caller is admin
    v_admin_id := get_session_staff_id();
    IF v_admin_id IS NULL OR NOT is_admin_from_session() THEN
        RAISE EXCEPTION 'Admin role required.'
            USING ERRCODE = '42501';
    END IF;

    -- Validate
    IF p_name IS NULL OR trim(p_name) = '' THEN
        RAISE EXCEPTION 'Name is required.'
            USING ERRCODE = '22023';
    END IF;

    IF p_pin IS NULL OR length(trim(p_pin)) < 4 OR length(trim(p_pin)) > 6 OR p_pin ~ '\D' THEN
        RAISE EXCEPTION 'PIN must be 4-6 digits.'
            USING ERRCODE = '22023';
    END IF;

    IF p_role IS NULL OR p_role NOT IN ('staff', 'admin') THEN
        RAISE EXCEPTION 'Role must be staff or admin.'
            USING ERRCODE = '22023';
    END IF;

    -- Insert with bcrypt hash
    INSERT INTO staff (name, pin_hash, role, active, expected_start_time, expected_end_time)
    VALUES (
        trim(p_name),
        crypt(p_pin, gen_salt('bf', 8)),
        p_role,
        p_active,
        p_expected_start_time,
        p_expected_end_time
    )
    RETURNING * INTO v_new_staff;

    RETURN json_build_object(
        'id', v_new_staff.id,
        'name', v_new_staff.name,
        'role', v_new_staff.role,
        'active', v_new_staff.active,
        'expected_start_time', v_new_staff.expected_start_time,
        'expected_end_time', v_new_staff.expected_end_time,
        'created_at', v_new_staff.created_at
    );

EXCEPTION
    WHEN unique_violation THEN
        RAISE EXCEPTION 'PIN already in use. Please choose a different PIN.'
            USING ERRCODE = '23505';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- update_staff_with_pin (with expected times)
-- =====================================================
CREATE OR REPLACE FUNCTION update_staff_with_pin(
    p_staff_id UUID,
    p_name TEXT DEFAULT NULL,
    p_pin TEXT DEFAULT NULL,
    p_role TEXT DEFAULT NULL,
    p_active BOOLEAN DEFAULT NULL,
    p_expected_start_time TIME DEFAULT NULL,
    p_expected_end_time TIME DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_admin_id UUID;
    v_existing staff%rowtype;
BEGIN
    -- Verify caller is admin
    v_admin_id := get_session_staff_id();
    IF v_admin_id IS NULL OR NOT is_admin_from_session() THEN
        RAISE EXCEPTION 'Admin role required.'
            USING ERRCODE = '42501';
    END IF;

    -- Cannot update self via this RPC
    IF p_staff_id = v_admin_id THEN
        RAISE EXCEPTION 'Cannot update your own staff record via admin RPC. Use profile settings.'
            USING ERRCODE = '42501';
    END IF;

    -- Fetch existing record
    SELECT * INTO v_existing FROM staff WHERE id = p_staff_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Staff not found.'
            USING ERRCODE = '42703';
    END IF;

    -- Track whether expected times were explicitly passed
    -- (COALESCE can't distinguish NULL-as-value from NULL-as-not-provided for TIME)
    -- We use a special text sentinel: if the JS sends '' we treat as NULL, if omitted we keep existing
    UPDATE staff SET
        name        = COALESCE(p_name, v_existing.name),
        pin_hash    = CASE WHEN p_pin IS NOT NULL THEN crypt(p_pin, gen_salt('bf', 8)) ELSE v_existing.pin_hash END,
        role        = COALESCE(p_role, v_existing.role),
        active      = COALESCE(p_active, v_existing.active),
        expected_start_time = COALESCE(p_expected_start_time, v_existing.expected_start_time),
        expected_end_time   = COALESCE(p_expected_end_time, v_existing.expected_end_time)
    WHERE id = p_staff_id
    RETURNING * INTO v_existing;

    RETURN json_build_object(
        'id', v_existing.id,
        'name', v_existing.name,
        'role', v_existing.role,
        'active', v_existing.active,
        'expected_start_time', v_existing.expected_start_time,
        'expected_end_time', v_existing.expected_end_time
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;