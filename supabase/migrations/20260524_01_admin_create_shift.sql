-- Migration: Add admin_create_shift RPC
-- Date: 2026-05-24
-- Purpose: Allow admins to manually create timesheet entries for staff

create or replace function admin_create_shift(
  p_staff_id uuid,
  p_clock_in timestamptz,
  p_clock_out timestamptz,
  p_notes text
)
returns table (
  id uuid,
  staff_id uuid,
  clock_in timestamptz,
  clock_out timestamptz,
  clock_in_adjusted boolean,
  clock_out_adjusted boolean,
  notes text,
  created_at timestamptz
)
language plpgsql
security definer
as $$
begin
  -- Verify caller is admin
  if not is_admin_from_session() then
    raise exception 'Admin access required';
  end if;

  -- Validate clock-in is before clock-out when both provided
  if p_clock_out is not null and p_clock_out <= p_clock_in then
    raise exception 'Clock-out must be after clock-in';
  end if;

  -- Insert the shift record
  return query
  insert into shifts (
    staff_id,
    clock_in,
    clock_out,
    clock_in_adjusted,
    clock_out_adjusted,
    notes
  ) values (
    p_staff_id,
    p_clock_in,
    p_clock_out,
    false,
    false,
    p_notes
  )
  returning
    shifts.id,
    shifts.staff_id,
    shifts.clock_in,
    shifts.clock_out,
    shifts.clock_in_adjusted,
    shifts.clock_out_adjusted,
    shifts.notes,
    shifts.created_at;
end;
$$;
