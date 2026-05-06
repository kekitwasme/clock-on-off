-- =====================================================
-- Migration: Create rosters table (Task 4.1)
-- Date: 2026-05-06
-- =====================================================
-- Stores weekly roster entries linking staff to scheduled
-- shift times on specific dates.  Each row is a single
-- scheduled block (start_time → end_time) for one staff
-- member on one calendar day.
--
-- Conflicts (overlapping bookings for the same staff on
-- the same day) are detected at the application layer.
-- The notes field is capped at 200 characters to prevent
-- abuse and encourage concise scheduling remarks.
-- =====================================================

-- =====================================================
-- Table: rosters
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

-- =====================================================
-- Indexes
-- =====================================================

-- Primary lookup: staff's roster on a specific date
CREATE INDEX idx_rosters_staff_date ON rosters(staff_id, roster_date);

-- Date-range queries (week view, date filters)
CREATE INDEX idx_rosters_date ON rosters(roster_date);

-- =====================================================
-- Trigger: updated_at
-- =====================================================

CREATE TRIGGER rosters_updated_at
    BEFORE UPDATE ON rosters
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- =====================================================
-- Enable RLS
-- =====================================================

ALTER TABLE rosters ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- RLS Policies
-- =====================================================

-- Staff can view their own roster entries.
-- Admins can view all roster entries.
CREATE POLICY rosters_select ON rosters
    FOR SELECT
    USING (
        staff_id = get_session_staff_id()
        OR is_admin_from_session()
    );

-- Admins may insert roster entries for any staff.
-- Staff cannot insert their own roster entries directly
-- (rostering is an admin function).
CREATE POLICY rosters_insert_admin ON rosters
    FOR INSERT
    WITH CHECK (is_admin_from_session());

-- Admins may update any roster entry.
-- Staff cannot update roster entries directly.
CREATE POLICY rosters_update_admin ON rosters
    FOR UPDATE
    USING (is_admin_from_session())
    WITH CHECK (is_admin_from_session());

-- Admins may delete roster entries.
CREATE POLICY rosters_delete_admin ON rosters
    FOR DELETE
    USING (is_admin_from_session());

-- =====================================================
-- SECURITY & OPERATIONS NOTES
-- =====================================================
--
-- 1. Roster ownership:
--    - The staff_id column references staff(id).  When a
--      staff member is deleted, all their roster entries
--      cascade via ON DELETE CASCADE.
--
-- 2. RLS model:
--    - Staff can READ their own rosters (home screen,
--      "My Roster" view).
--    - Only admins can CREATE, UPDATE, or DELETE roster
--      entries.  This centralises scheduling authority.
--    - The app should disable roster editing UI for
--      non-admin staff at the client layer as well.
--
-- 3. Conflict detection:
--    - Overlapping times for the same staff on the same
--      roster_date are NOT blocked at the DB level
--      (no EXCLUDE constraint).  The application layer
--      queries existing entries before insert and shows
--      a warning to the admin.
--    - Rationale: edge cases (split shifts, training
--      sessions, on-call blocks) are better handled by
--      explicit UI warnings than hard DB rejections.
--
-- 4. Time columns:
--    - start_time and end_time are plain TIME (no zone).
--    - They represent wall-clock scheduling intent, not
--      absolute instants.  Cross-midnight shifts are
--      handled by the application layer if needed.
--
-- 5. updated_at trigger:
--    - Reuses the existing set_updated_at() function
--      from 001-initial-schema.sql.  Keeps updated_at
--      current on every roster edit.
--
-- =====================================================
