# Clock On/Off App — Feature Update Architecture
## Date: 2026-05-06
## Version: 1.0

This document provides the technical foundation for implementing 4 major features:
1. **Break Tracking**
2. **Late/Early Alerts**
3. **Daily Shift Grouping**
4. **Roster View + Editor**

---

## 1. Database Schema Additions

### 1.1 Breaks Table
```sql
CREATE TABLE breaks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    break_start TIMESTAMPTZ NOT NULL,
    break_end TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_breaks_shift_id ON breaks(shift_id);
```

### 1.2 Staff Table — Expected Times
```sql
ALTER TABLE staff ADD COLUMN expected_start_time TIME;
ALTER TABLE staff ADD COLUMN expected_end_time TIME;
```

### 1.3 Rosters Table
```sql
CREATE TABLE rosters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    roster_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rosters_staff_date ON rosters(staff_id, roster_date);
CREATE INDEX idx_rosters_date ON rosters(roster_date);
```

---

## 2. SQL Functions

### 2.1 Break Functions
```sql
-- Start a break for a shift (validates not already on break)
CREATE OR REPLACE FUNCTION start_break(p_shift_id UUID)
RETURNS UUID AS $$
DECLARE
  v_break_id UUID;
BEGIN
  IF is_on_break(p_shift_id) THEN
    RAISE EXCEPTION 'Already on break';
  END IF;
  INSERT INTO breaks (shift_id, break_start)
  VALUES (p_shift_id, now())
  RETURNING id INTO v_break_id;
  RETURN v_break_id;
END;
$$ LANGUAGE plpgsql;

-- End a break
CREATE OR REPLACE FUNCTION end_break(p_break_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE breaks SET break_end = now() WHERE id = p_break_id AND break_end IS NULL;
END;
$$ LANGUAGE plpgsql;

-- Get all breaks for a shift
CREATE OR REPLACE FUNCTION get_shift_breaks(p_shift_id UUID)
RETURNS TABLE (id UUID, break_start TIMESTAMPTZ, break_end TIMESTAMPTZ, duration_minutes INT) AS $$
BEGIN
  RETURN QUERY
  SELECT b.id, b.break_start, b.break_end,
    CASE WHEN b.break_end IS NOT NULL
      THEN EXTRACT(EPOCH FROM (b.break_end - b.break_start))/60
      ELSE EXTRACT(EPOCH FROM (now() - b.break_start))/60
    END::INT as duration_minutes
  FROM breaks b
  WHERE b.shift_id = p_shift_id
  ORDER BY b.break_start;
END;
$$ LANGUAGE plpgsql;

-- Check if shift is currently on break
CREATE OR REPLACE FUNCTION is_on_break(p_shift_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM breaks
    WHERE shift_id = p_shift_id AND break_end IS NULL
  );
END;
$$ LANGUAGE plpgsql;
```

### 2.2 Updated Shift Duration (deducts breaks)
```sql
-- Modify existing shift duration calculation or create new version
-- Pattern: total shift minutes minus SUM of completed break minutes
-- Ongoing breaks are NOT deducted until ended (clock-off forces end)
```

### 2.3 Roster Functions
```sql
CREATE OR REPLACE FUNCTION create_roster_entry(
  p_staff_id UUID, p_roster_date DATE, p_start_time TIME, p_end_time TIME, p_notes TEXT DEFAULT NULL
)
RETURNS UUID AS $$ ... $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_roster_entry(
  p_id UUID, p_start_time TIME, p_end_time TIME, p_notes TEXT
)
RETURNS VOID AS $$ ... $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION delete_roster_entry(p_id UUID)
RETURNS VOID AS $$ ... $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_roster_for_week(p_start_date DATE, p_end_date DATE)
RETURNS TABLE (...) AS $$ ... $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_my_roster(p_staff_id UUID, p_days_ahead INT DEFAULT 7)
RETURNS TABLE (...) AS $$ ... $$ LANGUAGE plpgsql;
```

---

## 3. File Modification Map

| Task | Feature | Files to Modify |
|------|---------|-----------------|
| 1.1 | Break Tracking | `supabase/migrations/...` or SQL Editor |
| 1.2 | Break Tracking | `supabase/migrations/...` or SQL Editor |
| 1.3 | Break Tracking | `supabase/migrations/...` or SQL Editor, `db.js` |
| 1.4 | Break Tracking | `index.html`, `app.js`, `styles.css` |
| 1.5 | Break Tracking | `app.js` |
| 1.6 | Break Tracking | `timesheets.html`, `app.js` |
| 1.7 | Break Tracking | Test plan |
| 2.1 | Late/Early | `supabase/migrations/...` or SQL Editor |
| 2.2 | Late/Early | `staff.html`, `app.js` |
| 2.3 | Late/Early | `app.js` |
| 2.4 | Late/Early | `app.js` |
| 2.5 | Late/Early | `timesheets.html`, `app.js` |
| 2.6 | Late/Early | Test plan |
| 3.1 | Daily Grouping | `timesheets.html`, `app.js` |
| 3.2 | Daily Grouping | `timesheets.html`, `app.js`, `styles.css` |
| 3.3 | Daily Grouping | `timesheets.html`, `app.js`, `styles.css` |
| 3.4 | Daily Grouping | `app.js` |
| 3.5 | Daily Grouping | Test plan |
| 4.1 | Roster | `supabase/migrations/...` or SQL Editor |
| 4.2 | Roster | `supabase/migrations/...` or SQL Editor |
| 4.3 | Roster | New `roster.html`, `app.js`, `styles.css`, `admin.js` |
| 4.4 | Roster | `app.js` |
| 4.5 | Roster | `index.html`, `app.js` |
| 4.6 | Roster | `shifts.html`, `app.js` |
| 4.7 | Roster | `index.html`, `app.js` |
| 4.8 | Roster | Test plan |
| 5.1–5.3 | Integration | All files |

---

## 4. State Management

### 4.1 Break Tracking State
```javascript
// In app.js — extend current session state
breakState = {
  currentBreakId: null,      // UUID of active break
  breakStartTime: null,      // Timestamp when break started
  isOnBreak: false,          // Boolean for UI state
  breakTimerInterval: null   // setInterval reference for live timer
}

// State transitions:
// CLOCKED_ON → startBreak() → ON_BREAK (timer running)
// ON_BREAK → endBreak() → CLOCKED_ON (timer stopped, break recorded)
// ON_BREAK → clockOff() → BLOCKED (must end break first)
```

### 4.2 Roster State
```javascript
// For roster grid editing
rosterState = {
  selectedWeekStart: Date,   // Monday of displayed week
  rosterEntries: [],         // Array of roster records for week
  editingCell: {staffId, date} | null,
  conflictWarnings: []       // Overlap alerts
}
```

---

## 5. UX Interaction Patterns

### 5.1 Break Button State Transitions
- **Clocked On, Not On Break:** Show "Start Break" (secondary button) + "Clock Off" (primary)
- **On Break:** Show "End Break" (primary, different color) + live break timer + status "On Break"
- **Break Ended:** Return to "Clocked On" state, show brief confirmation
- **Attempt Clock Off While On Break:** Block with toast "End your break first"

### 5.2 Toast Notification System
```
Position: top-center, fixed
Duration: 4 seconds (auto-dismiss)
Types:
  - Yellow warning: >15min late/early
  - Orange alert: >30min late/early
  - Red error: validation failures
  - Green success: actions completed
Animation: slide-down + fade-out
```

### 5.3 Roster Grid Interaction
```
Week grid: 7 columns (Mon-Sun), rows = staff names
Cell states:
  - Empty: click to add shift
  - Scheduled: click to edit
  - Conflict: red highlight + warning icon
Modal: staff dropdown, date (auto-filled), time range, notes
Save: validate overlap → save → refresh grid
```

### 5.4 Date Filter UX
```
Filter buttons: [Today] [Yesterday] [Last 7 Days] [Last 30 Days] [Custom]
- Default: Last 7 Days
- Custom: shows date range pickers
- Active filter highlighted
- Updates grouped view immediately
```

### 5.5 Mobile Collapsible Sections
```
Date group headers: tap to expand/collapse
- Default on mobile: Today expanded, others collapsed
- Default on desktop: all expanded
- Chevron icon rotates on toggle
- Smooth CSS transition for height
```

---

## 6. Error Handling & Validation

### 6.1 Break Validation
- No double breaks: `is_on_break()` check before `start_break()`
- No clock-off while on break: UI block + server-side guard
- Break must be within shift window: `break_start >= shift.start_time`

### 6.2 Roster Validation
- Double-booking check: query for overlapping entries on same date
- Time order: `start_time < end_time`
- Date in future or today (configurable)

### 6.3 Late/Early Calculation
- Grace period: 15 minutes = yellow, 30 minutes = orange
- Null expected times = no alert
- Compare actual time (TIMESTAMPTZ) to expected (TIME) on same day

---

## 7. Supabase Patterns

### 7.1 RLS Considerations
- `breaks`: staff can read breaks for their own shifts; admins read all
- `rosters`: staff read their own; admins CRUD all
- Use existing RLS pattern from `shifts` table

### 7.2 Function Security
- All SQL functions execute with SECURITY INVOKER (respects RLS)
- Admin-only operations checked via `app_metadata.role`

### 7.3 Data Fetching Pattern
```javascript
// Existing pattern from db.js:
// 1. Call RPC function OR direct table query
// 2. Handle errors with try/catch
// 3. Return standardized {data, error} object
// 4. UI layer handles loading/error states
```

---

## 8. CSS Architecture

All new styles are additive to existing `styles.css`. See the CSS section at the bottom of `styles.css` for the feature-update styles block. Key additions:
- `.break-btn` / `.break-btn-active` — break button variants
- `.toast` / `.toast-warning` / `.toast-alert` / `.toast-success` — notification system
- `.date-group` / `.date-group-header` / `.date-group-content` — shift grouping
- `.roster-grid` / `.roster-cell` / `.roster-cell-conflict` — roster table
- `.late-badge` / `.early-badge` — timesheet indicators
- `.filter-pill` / `.filter-pill-active` — date filter buttons

---

*Document ready for developer implementation. Reference this alongside the task list and feature spec.*
