-- Apply before deploying the shift-deletion UI.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_delete_shift(p_shift_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_admin_id UUID;
    v_shift public.shifts%rowtype;
BEGIN
    v_admin_id := public.get_session_staff_id();
    IF v_admin_id IS NULL OR NOT public.is_admin_from_session() THEN
        RAISE EXCEPTION 'Admin role required.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Shift not found or already deleted.' USING ERRCODE = 'P0002';
    END IF;

    -- Keep the original UUID in the snapshot: the foreign key is cleared on deletion.
    INSERT INTO public.audit_log (admin_id, target_staff_id, shift_id, action, old_value)
    VALUES (v_admin_id, v_shift.staff_id, p_shift_id, 'SHIFT_DELETE', to_jsonb(v_shift));

    DELETE FROM public.shifts WHERE id = p_shift_id;
    RETURN json_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_shift(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_shift(UUID) TO anon, authenticated;

COMMIT;
