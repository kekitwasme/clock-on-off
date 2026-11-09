-- Apply before deploying the matching frontend. Payroll and audit rows are retained.
BEGIN;

ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.staff DROP CONSTRAINT IF EXISTS deleted_staff_inactive;
ALTER TABLE public.staff ADD CONSTRAINT deleted_staff_inactive
    CHECK (deleted_at IS NULL OR active = false);

-- Also reject sessions created by a login that was already in flight at deletion.
CREATE OR REPLACE FUNCTION public.get_session_staff_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT ss.staff_id FROM public.staff_sessions ss
    JOIN public.staff s ON s.id = ss.staff_id
    WHERE ss.token = public.get_session_token()
      AND ss.expires_at > now()
      AND s.deleted_at IS NULL;
$$;

-- Serialize new shifts with deletion so an in-flight clock-on cannot orphan an open shift.
CREATE OR REPLACE FUNCTION public.check_shift_staff_not_deleted()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_deleted_at TIMESTAMPTZ;
BEGIN
    SELECT deleted_at INTO v_deleted_at FROM public.staff WHERE id = NEW.staff_id FOR SHARE;
    IF v_deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'This employee has been deleted.' USING ERRCODE = '28000';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_shift_staff_not_deleted ON public.shifts;
CREATE TRIGGER check_shift_staff_not_deleted BEFORE INSERT ON public.shifts
    FOR EACH ROW EXECUTE FUNCTION public.check_shift_staff_not_deleted();

CREATE OR REPLACE FUNCTION public.delete_staff_member(p_staff_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_admin_id UUID;
    v_staff public.staff%rowtype;
BEGIN
    v_admin_id := public.get_session_staff_id();
    IF v_admin_id IS NULL OR NOT public.is_admin_from_session() THEN
        RAISE EXCEPTION 'Admin role required.' USING ERRCODE = '42501';
    END IF;
    IF p_staff_id = v_admin_id THEN
        RAISE EXCEPTION 'You cannot delete yourself.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_staff FROM public.staff WHERE id = p_staff_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Staff not found.' USING ERRCODE = 'P0002';
    END IF;
    IF v_staff.deleted_at IS NOT NULL THEN
        RETURN json_build_object('success', true);
    END IF;
    IF EXISTS (SELECT 1 FROM public.shifts WHERE staff_id = p_staff_id AND clock_out IS NULL) THEN
        RAISE EXCEPTION 'Close this employee''s open shift before deleting them.' USING ERRCODE = '22023';
    END IF;

    UPDATE public.staff SET active = false, deleted_at = now() WHERE id = p_staff_id;
    DELETE FROM public.staff_sessions WHERE staff_id = p_staff_id;
    INSERT INTO public.audit_log (admin_id, target_staff_id, action, old_value, new_value)
    VALUES (v_admin_id, p_staff_id, 'delete_staff',
        jsonb_build_object('active', v_staff.active),
        jsonb_build_object('active', false, 'deleted_at', now()));

    RETURN json_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_staff_member(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_staff_member(UUID) TO anon, authenticated;

COMMIT;
