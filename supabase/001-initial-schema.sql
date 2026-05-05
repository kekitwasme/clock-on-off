-- =====================================================
-- Clock On/Off App - Initial Database Schema (Hardened)
-- =====================================================
-- Run this migration first in your Supabase SQL Editor.
-- Creates tables, indexes, triggers, and the server-time
-- helper with full defense-in-depth notes.
-- =====================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- =====================================================
-- Table: staff
-- =====================================================
-- Stores staff member information.  PINs are hashed on
-- the server with bcrypt (pgcrypto) — NEVER store plain
-- text.  The app sends the plain PIN over HTTPS to RPC
-- functions; the database hashes and compares server-side.
-- =====================================================

CREATE TABLE staff (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL CHECK (char_length(trim(name)) > 0) UNIQUE,
    pin_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('staff', 'admin')),
    active BOOLEAN NOT NULL DEFAULT true,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for PIN lookups during authentication (timing-safe compare done in function)
CREATE INDEX idx_staff_pin_hash ON staff(pin_hash);

-- Index for active staff filtering
CREATE INDEX idx_staff_active ON staff(active) WHERE active = true;

-- =====================================================
-- Table: staff_sessions
-- =====================================================
-- Stateless session tokens for PIN-based auth.  Each
-- login creates a token that is passed in the custom
-- header x-session-token on every subsequent request.
-- RLS policies resolve the caller’s identity from this
-- token, NOT from a JWT or auth.uid().
-- =====================================================

CREATE TABLE staff_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '8 hours'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_token ON staff_sessions(token);
CREATE INDEX idx_sessions_staff ON staff_sessions(staff_id);
CREATE INDEX idx_sessions_expires ON staff_sessions(expires_at);

-- =====================================================
-- Table: shifts
-- =====================================================
-- Records work shifts.  The *_adjusted flags indicate
-- whether a staff member (not an admin) changed the
-- time from the default server now().
-- =====================================================

CREATE TABLE shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    clock_in TIMESTAMPTZ NOT NULL,
    clock_out TIMESTAMPTZ,
    clock_in_adjusted BOOLEAN NOT NULL DEFAULT false,
    clock_out_adjusted BOOLEAN NOT NULL DEFAULT false,
    notes TEXT CHECK (notes IS NULL OR char_length(notes) <= 500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Prevent overlapping open shifts per staff (safety net)
    CONSTRAINT no_overlapping_open_shift
        EXCLUDE USING gist (staff_id WITH =)
        WHERE (clock_out IS NULL)
);

-- Index for staff shift lookups
CREATE INDEX idx_shifts_staff_id ON shifts(staff_id);

-- Partial index for finding active (open) shifts
CREATE INDEX idx_shifts_active ON shifts(staff_id, clock_in DESC) WHERE clock_out IS NULL;

-- Index for date-range queries (timesheet exports, recent history)
CREATE INDEX idx_shifts_clock_in ON shifts(clock_in DESC);
CREATE INDEX idx_shifts_clock_out ON shifts(clock_out);

-- =====================================================
-- Table: audit_log
-- =====================================================
-- Immutable trail for admin adjustments.  No UPDATE or
-- DELETE should ever be permitted via RLS.
-- =====================================================

CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID NOT NULL REFERENCES staff(id),
    target_staff_id UUID NOT NULL REFERENCES staff(id),
    shift_id UUID REFERENCES shifts(id) ON DELETE SET NULL,
    action TEXT NOT NULL CHECK (char_length(action) > 0),
    old_value JSONB,
    new_value JSONB,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_admin ON audit_log(admin_id);
CREATE INDEX idx_audit_target ON audit_log(target_staff_id);
CREATE INDEX idx_audit_shift ON audit_log(shift_id);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);

-- =====================================================
-- Trigger: updated_at
-- =====================================================
-- Keeps updated_at current automatically.
-- =====================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER staff_updated_at
    BEFORE UPDATE ON staff
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER shifts_updated_at
    BEFORE UPDATE ON shifts
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- =====================================================
-- Helper Function: get_server_time
-- =====================================================
-- Returns current server timestamp.  Prevents clients
-- from relying solely on local clock.
-- =====================================================

CREATE OR REPLACE FUNCTION get_server_time()
RETURNS TIMESTAMPTZ AS $$
BEGIN
    RETURN now();
END;
$$ LANGUAGE plpgsql STABLE;

-- =====================================================
-- SECURITY NOTES
-- =====================================================
-- 1. PIN Hashing:
--    - Client NEVER hashes the PIN.  It sends the plain
--      PIN (over HTTPS) to RPC functions authenticate_staff
--      or create_staff_with_pin.
--    - The database hashes with pgcrypto crypt() using
--      bcrypt:  crypt(pin, gen_salt('bf', 8))
--    - Comparison uses crypt(pin, stored_hash) = stored_hash
--
-- 2. Row-Level Security (RLS):
--    - See 002-rls-policies.sql for full RLS config.
--    - RLS uses x-session-token header → staff_sessions
--      table → staff_id resolution.
--    - Because this app uses the Supabase anon key with
--      no Supabase Auth, the session token is the ONLY
--      identity layer.  Keep tokens confidential.
--
-- 3. Time Window Enforcement:
--    - See 003-functions.sql for server-side validation
--      of the ±10 minute adjustment window.
--
-- 4. Audit Trail:
--    - Every admin adjustment MUST call create_audit_log
--      or the equivalent RPC.  The audit_log table is
--      append-only by design.
-- =====================================================
