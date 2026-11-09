-- Run in a disposable database with schema, RLS, functions and the shift-deletion migration applied.
BEGIN;
DO $$
<<fixture>>
DECLARE
    admin_id UUID;
    employee_id UUID;
    shift_id UUID;
BEGIN
    INSERT INTO staff (name, pin_hash, role) VALUES ('Test admin', 'delete-shift-admin', 'admin') RETURNING id INTO admin_id;
    INSERT INTO staff (name, pin_hash, role) VALUES ('Test employee', 'delete-shift-employee', 'staff') RETURNING id INTO employee_id;
    INSERT INTO staff_sessions (staff_id, token) VALUES (admin_id, 'delete-shift-admin-token'), (employee_id, 'delete-shift-employee-token');
    INSERT INTO shifts (staff_id, clock_in, clock_out, notes)
    VALUES (employee_id, now() - interval '2 hours', now(), 'Original notes') RETURNING id INTO shift_id;
    INSERT INTO audit_log (admin_id, target_staff_id, shift_id, action)
    VALUES (admin_id, employee_id, shift_id, 'SHIFT_EDIT');

    PERFORM set_config('request.headers', '{}', true);
    BEGIN
        PERFORM admin_delete_shift(shift_id);
        RAISE EXCEPTION 'Anonymous deletion permitted';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    PERFORM set_config('request.headers', '{"x-session-token":"delete-shift-employee-token"}', true);
    BEGIN
        PERFORM admin_delete_shift(shift_id);
        RAISE EXCEPTION 'Staff deletion permitted';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    PERFORM set_config('request.headers', '{"x-session-token":"delete-shift-admin-token"}', true);
    PERFORM admin_delete_shift(shift_id);
    ASSERT NOT EXISTS (SELECT 1 FROM shifts WHERE id = fixture.shift_id), 'Shift not deleted';
    ASSERT EXISTS (SELECT 1 FROM staff WHERE id = fixture.employee_id), 'Employee deleted';
    ASSERT EXISTS (SELECT 1 FROM audit_log WHERE target_staff_id = fixture.employee_id AND action = 'SHIFT_EDIT' AND audit_log.shift_id IS NULL), 'Previous audit history lost';
    ASSERT EXISTS (SELECT 1 FROM audit_log WHERE action = 'SHIFT_DELETE' AND old_value->>'id' = fixture.shift_id::text AND old_value->>'notes' = 'Original notes' AND audit_log.shift_id IS NULL), 'Deletion snapshot missing';
    BEGIN
        PERFORM admin_delete_shift(shift_id);
        RAISE EXCEPTION 'Repeated deletion succeeded';
    EXCEPTION WHEN no_data_found THEN NULL;
    END;

    INSERT INTO shifts (staff_id, clock_in) VALUES (employee_id, now()) RETURNING id INTO shift_id;
    PERFORM admin_delete_shift(shift_id);
    ASSERT NOT EXISTS (SELECT 1 FROM shifts WHERE id = fixture.shift_id), 'Open shift not deleted';
END;
$$;
ROLLBACK;
