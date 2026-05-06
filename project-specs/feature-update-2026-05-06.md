# Clock On/Off App - Feature Update Specification
## Date: 2026-05-06

### 1. Break Tracking
Staff must be able to record breaks without ending their shift.

**Requirements:**
- Add "Start Break" / "End Break" buttons to main screen (only when clocked on)
- Breaks stored in new `breaks` table: `id`, `shift_id`, `break_start`, `break_end`, `created_at`
- Break duration calculated and displayed
- Total break time deducted from shift duration in timesheets
- A shift can have MULTIPLE breaks (not just one)
- Staff cannot start a new break if already on break
- Staff cannot clock off while on break (must end break first)
- Breaks shown in shift history with visual indicator

**UI:**
- When clocked on: show "Start Break" button alongside "Clock Off"
- When on break: show "End Break" button, status shows "On Break", timer counts break duration
- When break ends: return to "Clocked On" status

**Database:**
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

**Functions:**
- `start_break(p_shift_id)` — creates break record, validates not already on break
- `end_break(p_break_id)` — sets break_end
- `get_shift_breaks(p_shift_id)` — returns all breaks for shift
- `is_on_break(p_shift_id)` — returns boolean

**Validation:**
- Cannot start break if already on break
- Cannot clock off while on break
- Break time must be within shift time window

---

### 2. Late/Early Alerts
Flag shifts that start significantly before or after expected time.

**Requirements:**
- New field on staff: `expected_start_time` (TIME type, e.g., '11:00')
- New field on staff: `expected_end_time` (TIME type, e.g., '22:00')
- When staff clocks on: compare actual time to expected_start_time
- If difference > 15 minutes: show yellow warning toast "Started 20 min late"
- If difference > 30 minutes: show orange warning toast "Started 45 min late — check with manager?"
- Same logic for clock off vs expected_end_time
- Alerts visible in timesheet view (late badge on shift card)
- Admin sees all late/early shifts highlighted in timesheets

**Database:**
```sql
ALTER TABLE staff ADD COLUMN expected_start_time TIME;
ALTER TABLE staff ADD COLUMN expected_end_time TIME;
```

**UI:**
- Edit staff modal: add two time inputs for expected start/end
- Toast notification on clock on/off when outside threshold
- Timesheet cards: show "⚠️ 20 min late" badge when applicable

---

### 3. Daily Shift Grouping
Group shifts by day in timesheets for easier reading.

**Requirements:**
- Timesheets view groups shifts by calendar date
- Each date header shows: date, total staff, total hours
- Individual shifts listed under each date header
- Default view: last 7 days grouped
- Filter: select date range (Today, Yesterday, Last 7 days, Last 30 days, Custom)
- Export CSV groups by date with subtotals
- Mobile: collapsible date sections

**UI:**
```
Wed, 6 May — 2 staff, 14.5 hours
  Admin: 11:45 am → 3:00 pm (3h 15m)
  Pem: 5:00 pm → 10:00 pm (5h)
Thu, 7 May — 1 staff, 8 hours
  Admin: 11:30 am → 10:30 pm (11h)
```

**Functions:**
- No new RPC needed — client-side grouping of existing `getAllShifts()` data

---

### 4. Roster View + Editor
Staff can see when they're scheduled. Admin can build weekly rosters.

**Requirements:**
- New table `rosters`: `id`, `staff_id`, `roster_date` (DATE), `start_time` (TIME), `end_time` (TIME), `notes`, `created_at`
- Week view: Monday-Sunday grid showing scheduled staff per day
- Staff view: when logged in, show "My Roster" with upcoming shifts
- Admin can: click day cell → add staff → set start/end times → save
- Admin can: drag to copy a shift to another day
- Roster conflicts: warn if staff double-booked
- Roster shows alongside clock status ("Scheduled 11am-3pm, not clocked on yet")

**Database:**
```sql
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
CREATE INDEX idx_rosters_staff_date ON rosters(staff_id, roster_date);
CREATE INDEX idx_rosters_date ON rosters(roster_date);
```

**Functions:**
- `create_roster_entry(p_staff_id, p_date, p_start, p_end, p_notes)`
- `update_roster_entry(p_roster_id, p_start, p_end, p_notes)`
- `delete_roster_entry(p_roster_id)`
- `get_roster_for_week(p_start_date, p_end_date)` — returns all entries in range
- `get_my_roster(p_days_ahead)` — returns upcoming roster for current staff

**UI — Admin:**
- New "Roster" tab in admin panel
- Week grid: 7 columns (Mon-Sun), rows = staff names
- Each cell: shows time range if scheduled, click to edit
- Add shift: modal with staff dropdown, date picker, time range
- Conflict check: highlight if same staff scheduled overlapping times

**UI — Staff:**
- Home screen: below clock status, show "Next shift: Wed 7 May, 11:00 am — 3:00 pm"
- My Shifts screen: add toggle between "Worked" and "Scheduled"

---

### Implementation Order
1. Break tracking (schema + UI + functions)
2. Late/early alerts (schema change + UI + logic)
3. Daily shift grouping (UI only, client-side)
4. Roster view + editor (schema + UI + functions)

### Notes
- All changes must maintain backward compatibility with existing data
- Existing staff without expected times should not trigger false alerts
- Mobile-first UI, touch-friendly
- Keep it simple — no drag-and-drop if it adds complexity, use modal forms instead
