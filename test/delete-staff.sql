-- Run only against a disposable database with schema, RLS, functions and the deletion migration applied.
BEGIN;
DO $$
<<fixture>>
DECLARE
    admin_id UUID;
    employee_id UUID;
    shift_id UUID;
    admin_token TEXT := 'test-admin-token';
BEGIN
    INSERT INTO staff (name, pin_hash, role) VALUES ('Test admin', 'test-admin-hash', 'admin') RETURNING id INTO admin_id;
    INSERT INTO staff (name, pin_hash, role) VALUES ('Test employee', 'test-employee-hash', 'staff') RETURNING id INTO employee_id;
    INSERT INTO staff_sessions (staff_id, token) VALUES (admin_id, admin_token), (employee_id, 'test-employee-token');
    INSERT INTO shifts (staff_id, clock_in) VALUES (employee_id, now() - interval '2 hours') RETURNING id INTO shift_id;

    PERFORM set_config('request.headers', '{}', true);
    BEGIN
        PERFORM delete_staff_member(employee_id);
        RAISE EXCEPTION 'Anonymous deletion was permitted';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    PERFORM set_config('request.headers', json_build_object('x-session-token', 'test-employee-token')::text, true);
    BEGIN
        PERFORM delete_staff_member(admin_id);
        RAISE EXCEPTION 'Non-admin deletion was permitted';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    PERFORM set_config('request.headers', json_build_object('x-session-token', admin_token)::text, true);
    BEGIN
        PERFORM delete_staff_member(admin_id);
        RAISE EXCEPTION 'Self-deletion was permitted';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        PERFORM delete_staff_member(employee_id);
        RAISE EXCEPTION 'Deletion with an open shift was permitted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;

    UPDATE shifts SET clock_out = now() WHERE id = shift_id;
    PERFORM delete_staff_member(employee_id);
    ASSERT EXISTS (SELECT 1 FROM staff WHERE id = fixture.employee_id AND NOT active AND deleted_at IS NOT NULL), 'Employee not archived';
    ASSERT EXISTS (SELECT 1 FROM shifts WHERE id = fixture.shift_id), 'Timesheet lost';
    ASSERT NOT EXISTS (SELECT 1 FROM staff_sessions WHERE staff_id = fixture.employee_id), 'Session not revoked';
    ASSERT (SELECT count(*) FROM audit_log WHERE target_staff_id = fixture.employee_id AND action = 'delete_staff') = 1, 'Missing audit entry';
    PERFORM delete_staff_member(employee_id);
    ASSERT (SELECT count(*) FROM audit_log WHERE target_staff_id = fixture.employee_id AND action = 'delete_staff') = 1, 'Duplicate audit entry';
    BEGIN
        UPDATE staff SET active = true WHERE id = fixture.employee_id;
        RAISE EXCEPTION 'Deleted employee reactivated';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        INSERT INTO shifts (staff_id, clock_in) VALUES (employee_id, now());
        RAISE EXCEPTION 'Deleted employee clocked on';
    EXCEPTION WHEN invalid_authorization_specification THEN NULL;
    END;
    INSERT INTO staff_sessions (staff_id, token) VALUES (employee_id, 'late-login-token');
    PERFORM set_config('request.headers', '{"x-session-token":"late-login-token"}', true);
    ASSERT get_session_staff_id() IS NULL, 'Deleted employee retained session access';
END;
$$;
ROLLBACK;
