-- =====================================================
-- Schema Reference: breaks table
-- =====================================================
-- Purpose: Stores individual break records linked to shifts.
--          A shift may have MULTIPLE breaks.
--          break_end is NULL while the break is in progress.
--
-- Relationships:
--   - shift_id → shifts.id (ON DELETE CASCADE)
--
-- Indexes:
--   - idx_breaks_shift_id         : Shift break lookups
--   - idx_breaks_active           : Finding open breaks per shift
--   - idx_breaks_break_start      : Date-range queries
--   - idx_breaks_break_end        : Date-range queries
--
-- Constraints:
--   - no_overlapping_open_break   : Prevents multiple open breaks per shift
--
-- RLS Policies:
--   - SELECT : Staff sees own breaks; Admin sees all
--   - INSERT : Staff for own shifts; Admin for any
--   - UPDATE : Staff for own shifts; Admin for any
--   - DELETE : Admin only
--
-- Functions:
--   - is_on_break(p_shift_id UUID)        → BOOLEAN
--   - start_break(p_shift_id UUID)        → breaks record
--   - end_break(p_break_id UUID)           → breaks record
--   - get_shift_breaks(p_shift_id UUID)    → TABLE(id, break_start, break_end, duration_minutes)
-- =====================================================

CREATE TABLE breaks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    break_start TIMESTAMPTZ NOT NULL,
    break_end TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT no_overlapping_open_break
        EXCLUDE USING gist (shift_id WITH =)
        WHERE (break_end IS NULL)
);

CREATE INDEX idx_breaks_shift_id ON breaks(shift_id);
CREATE INDEX idx_breaks_active ON breaks(shift_id, break_start DESC) WHERE break_end IS NULL;
CREATE INDEX idx_breaks_break_start ON breaks(break_start DESC);
CREATE INDEX idx_breaks_break_end ON breaks(break_end);

ALTER TABLE breaks ENABLE ROW LEVEL SECURITY;

-- (RLS policies and functions defined in migration 20250506_01_create_breaks_table.sql)
