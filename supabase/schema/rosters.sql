-- =====================================================
-- Schema Reference: rosters
-- =====================================================
-- Part of the Clock On/Off App roster view + editor feature.
--
-- Purpose:
--   Stores scheduled shift blocks per staff member per day.
--   Powers the admin "Roster" week grid and the staff
--   "My Roster" / "Next Shift" home-screen displays.
--
-- Related tables:
--   - staff (FK staff_id, ON DELETE CASCADE)
--
-- Related functions (see project spec):
--   - create_roster_entry(p_staff_id, p_date, p_start, p_end, p_notes)
--   - update_roster_entry(p_roster_id, p_start, p_end, p_notes)
--   - delete_roster_entry(p_roster_id)
--   - get_roster_for_week(p_start_date, p_end_date)
--   - get_my_roster(p_days_ahead)
--
-- =====================================================

CREATE TABLE rosters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    roster_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    notes TEXT CHECK (notes IS NULL OR char_length(notes) <= 200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_rosters_staff_date ON rosters(staff_id, roster_date);
CREATE INDEX idx_rosters_date ON rosters(roster_date);

-- updated_at trigger (assumes set_updated_at() already exists)
CREATE TRIGGER rosters_updated_at
    BEFORE UPDATE ON rosters
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- Row-Level Security
ALTER TABLE rosters ENABLE ROW LEVEL SECURITY;

CREATE POLICY rosters_select ON rosters
    FOR SELECT
    USING (
        staff_id = get_session_staff_id()
        OR is_admin_from_session()
    );

CREATE POLICY rosters_insert_admin ON rosters
    FOR INSERT
    WITH CHECK (is_admin_from_session());

CREATE POLICY rosters_update_admin ON rosters
    FOR UPDATE
    USING (is_admin_from_session())
    WITH CHECK (is_admin_from_session());

CREATE POLICY rosters_delete_admin ON rosters
    FOR DELETE
    USING (is_admin_from_session());
