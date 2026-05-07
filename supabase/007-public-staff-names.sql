-- =====================================================
-- Migration 007: Public staff name list + logo asset
-- =====================================================
-- Adds a public function to list active staff names/IDs
-- for the login screen staff selector (unauthenticated).
-- =====================================================

CREATE OR REPLACE FUNCTION get_active_staff_names()
RETURNS TABLE (
    id UUID,
    name TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT s.id, s.name
    FROM staff s
    WHERE s.active = true
    ORDER BY s.name ASC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;