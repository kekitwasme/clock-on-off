-- Drop old create_roster_entry without p_force (5-param version)
-- The old signature: (uuid, date, time, time, text) conflicts with the new one
DROP FUNCTION IF EXISTS create_roster_entry(UUID, DATE, TIME, TIME, TEXT);
-- Also drop the 6-param version if it exists (old with notes but no force/shift_type)
DROP FUNCTION IF EXISTS create_roster_entry(UUID, DATE, TIME, TIME, TEXT, BOOLEAN);