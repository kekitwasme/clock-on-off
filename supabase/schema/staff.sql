-- =====================================================
-- Schema Reference: staff table
-- =====================================================
-- Purpose: Stores staff member information including
--          authentication credentials, role, status,
--          and expected shift times.
--
-- Relationships:
--   - staff.id → shifts.staff_id (ON DELETE CASCADE)
--   - staff.id → breaks (via shifts)
--   - staff.id → rosters.staff_id (ON DELETE CASCADE)
--
-- Columns:
--   id                       UUID PRIMARY KEY
--   name                     TEXT NOT NULL, UNIQUE
--   pin_hash                 TEXT NOT NULL (bcrypt hashed)
--   role                     TEXT CHECK ('staff' | 'admin')
--   active                   BOOLEAN NOT NULL DEFAULT true
--   failed_attempts          INTEGER NOT NULL DEFAULT 0
--   locked_until             TIMESTAMPTZ (NULL when not locked)
--   expected_start_time      TIME NULL — expected daily shift start
--   expected_end_time        TIME NULL — expected daily shift end
--   created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
--   updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
--
-- Indexes:
--   - idx_staff_pin_hash     : PIN lookups during authentication
--   - idx_staff_active       : Active staff filtering (partial)
--
-- Constraints:
--   - UNIQUE (name)
--   - CHECK (role IN ('staff', 'admin'))
--
-- Notes:
--   - expected_start_time and expected_end_time are nullable
--     so existing staff do not trigger false late/early alerts.
--   - When both are set, the app layer compares actual
--     clock_in / clock_out against these times.
--   - The updated_at trigger fires on any column change.
-- =====================================================

CREATE TABLE staff (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL CHECK (char_length(trim(name)) > 0) UNIQUE,
    pin_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('staff', 'admin')),
    active BOOLEAN NOT NULL DEFAULT true,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    expected_start_time TIME,
    expected_end_time TIME,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_staff_pin_hash ON staff(pin_hash);
CREATE INDEX idx_staff_active ON staff(active) WHERE active = true;
