-- =====================================================
-- Migration: Add expected_start_time and expected_end_time to staff (Task 2.1)
-- Date: 2026-05-06
-- =====================================================
-- Adds nullable TIME columns to the staff table to store
-- each staff member's expected shift start and end times.
-- These values are used to flag late/early clock-on and
-- clock-off events in the timesheet view.
--
-- Both columns are nullable to maintain backward
-- compatibility: existing staff without values will not
-- trigger false alerts.
-- =====================================================

-- =====================================================
-- Alter Table: staff
-- =====================================================

ALTER TABLE staff
    ADD COLUMN expected_start_time TIME,
    ADD COLUMN expected_end_time TIME;

-- =====================================================
-- Validation
-- =====================================================
-- Optional: ensure expected_end_time is after expected_start_time
-- when both are set.  Only enforced at the DB level if you
-- want to prevent obviously inverted ranges.
--
-- ALTER TABLE staff
--     ADD CONSTRAINT check_expected_time_order
--     CHECK (
--         expected_start_time IS NULL
--         OR expected_end_time IS NULL
--         OR expected_end_time > expected_start_time
--     );
--
-- (Constraint omitted for flexibility — e.g. graveyard shifts
--  that cross midnight are handled by the app layer.)

-- =====================================================
-- Backward Compatibility Notes
-- =====================================================
--
-- 1. Existing staff rows will have NULL for both new columns.
--    The alert logic must skip comparison when either column
--    is NULL for the staff member being evaluated.
--
-- 2. No indexes are needed on these TIME columns because
--    lookups are always by staff.id; the values are read
--    after the staff row is already fetched.
--
-- 3. RLS policies on staff (SELECT, UPDATE) automatically
--    cover the new columns without modification.
--
-- 4. The updated_at trigger on staff continues to fire
--    when either expected time is changed.
--
-- =====================================================
