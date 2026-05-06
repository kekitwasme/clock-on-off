# Clock On/Off App — Feature Update Task List
## Date: 2026-05-06

This update adds 4 major features: **Break Tracking**, **Late/Early Alerts**, **Daily Shift Grouping**, and **Roster View + Editor**.

---

## Feature 1: Break Tracking

### [ ] Task 1.1: Create `breaks` table and indexes
- **Files:** SQL migration (Supabase)
- **Description:** Create `breaks` table with `id`, `shift_id`, `break_start`, `break_end`, `created_at`. Add `idx_breaks_shift_id` index.
- **Dependencies:** None

### [ ] Task 1.2: Create SQL functions for break management
- **Files:** Supabase SQL Editor / migration
- **Description:** Implement `start_break(p_shift_id)`, `end_break(p_break_id)`, `get_shift_breaks(p_shift_id)`, `is_on_break(p_shift_id)`.
- **Dependencies:** Task 1.1

### [ ] Task 1.3: Update `shift_duration` calculation to subtract break time
- **Files:** Supabase SQL / existing shift calculation function
- **Description:** Modify existing shift duration logic (or create new version) to query `breaks` table and deduct total break duration from shift duration. Ensure backward compatibility with shifts that have no breaks.
- **Dependencies:** Task 1.1, Task 1.2

### [ ] Task 1.4: Add break buttons to main clock screen
- **Files:** `index.html` (main screen), `app.js` (clock logic), `styles.css`
- **Description:** When clocked on, display "Start Break" button alongside "Clock Off". When on break, show "End Break" button, status shows "On Break", timer counts break duration live. When break ends, return to "Clocked On" status.
- **Dependencies:** Task 1.2

### [ ] Task 1.5: Add break validation in UI
- **Files:** `app.js`
- **Description:** Prevent "Start Break" if already on break. Prevent "Clock Off" while on break (show message: "End break first"). Ensure break time is within shift window.
- **Dependencies:** Task 1.4

### [ ] Task 1.6: Show breaks in shift history with visual indicator
- **Files:** `timesheets.html` / `app.js` (shift history rendering)
- **Description:** In shift history / timesheet view, display break indicators on shift cards (e.g., "1 break — 45 min total" or icon). Show break details on shift card expand.
- **Dependencies:** Task 1.3, Task 1.4

### [ ] Task 1.7: QA — Break tracking end-to-end test
- **Files:** Test plan / manual QA
- **Description:** Verify: start break → timer counts → end break → duration correct → shift duration deducts breaks → multiple breaks per shift → validation rules enforced → UI updates correctly.
- **Dependencies:** Tasks 1.1–1.6

---

## Feature 2: Late/Early Alerts

### [ ] Task 2.1: Add `expected_start_time` and `expected_end_time` to `staff` table
- **Files:** SQL migration (Supabase)
- **Description:** `ALTER TABLE staff ADD COLUMN expected_start_time TIME; ALTER TABLE staff ADD COLUMN expected_end_time TIME;`. Both nullable. Existing staff without values should not trigger false alerts.
- **Dependencies:** None

### [ ] Task 2.2: Update staff edit modal with expected time inputs
- **Files:** `staff.html` / `app.js` (staff management UI)
- **Description:** Add two `<input type="time">` fields to the Add/Edit Staff modal. Save to new columns. Display expected times on staff card if set.
- **Dependencies:** Task 2.1

### [ ] Task 2.3: Add late/early check on clock on
- **Files:** `app.js` (clock on handler)
- **Description:** When staff clocks on, compare actual time to `expected_start_time`. If diff > 15 min: show yellow toast. If diff > 30 min: show orange toast with manager check prompt. Handle null expected times gracefully (no alert).
- **Dependencies:** Task 2.1

### [ ] Task 2.4: Add late/early check on clock off
- **Files:** `app.js` (clock off handler)
- **Description:** Same logic as Task 2.3 but comparing clock-off time to `expected_end_time`. Show yellow/orange toast if outside thresholds.
- **Dependencies:** Task 2.3

### [ ] Task 2.5: Show late/early badges in timesheet view
- **Files:** `timesheets.html` / `app.js` (timesheet rendering)
- **Description:** On shift cards in timesheets, display "⚠️ 20 min late" badge if shift was late/early. Admin sees all late/early shifts highlighted (e.g., yellow border).
- **Dependencies:** Task 2.3, Task 2.4

### [ ] Task 2.6: QA — Late/early alert validation
- **Files:** Test plan / manual QA
- **Description:** Test: staff with no expected times → no alerts. Staff with expected times → clock on early/late at various thresholds → correct toast colors/messages. Admin timesheet badges display correctly.
- **Dependencies:** Tasks 2.1–2.5

---

## Feature 3: Daily Shift Grouping

### [ ] Task 3.1: Implement client-side shift grouping by date
- **Files:** `timesheets.html` / `app.js`
- **Description:** Group `getAllShifts()` data by calendar date. Each date header shows: formatted date, total staff count, total hours. Shifts listed under each header. Default: last 7 days.
- **Dependencies:** None

### [ ] Task 3.2: Add date range filter UI
- **Files:** `timesheets.html` / `app.js` / `styles.css`
- **Description:** Add filter controls: Today, Yesterday, Last 7 days, Last 30 days, Custom (date picker range). Filter updates grouped view.
- **Dependencies:** Task 3.1

### [ ] Task 3.3: Mobile collapsible date sections
- **Files:** `timesheets.html` / `app.js` / `styles.css`
- **Description:** Make each date group collapsible on mobile (tap header to expand/collapse). Desktop: all expanded by default.
- **Dependencies:** Task 3.1

### [ ] Task 3.4: Update CSV export to group by date with subtotals
- **Files:** `app.js` (CSV export logic)
- **Description:** Modify existing CSV export to include date group headers, staff entries under each date, and subtotal hours per date. Maintain existing export functionality.
- **Dependencies:** Task 3.1

### [ ] Task 3.5: QA — Daily grouping and filters
- **Files:** Test plan / manual QA
- **Description:** Verify: shifts group correctly by date, totals accurate, filters work (Today, 7 days, 30 days, custom), mobile collapsible works, CSV export has subtotals.
- **Dependencies:** Tasks 3.1–3.4

---

## Feature 4: Roster View + Editor

### [ ] Task 4.1: Create `rosters` table and indexes
- **Files:** SQL migration (Supabase)
- **Description:** Create `rosters` table with `id`, `staff_id`, `roster_date`, `start_time`, `end_time`, `notes`, `created_at`, `updated_at`. Add `idx_rosters_staff_date` and `idx_rosters_date` indexes.
- **Dependencies:** None

### [ ] Task 4.2: Create SQL functions for roster CRUD
- **Files:** Supabase SQL Editor / migration
- **Description:** Implement `create_roster_entry`, `update_roster_entry`, `delete_roster_entry`, `get_roster_for_week(p_start_date, p_end_date)`, `get_my_roster(p_days_ahead)`.
- **Dependencies:** Task 4.1

### [ ] Task 4.3: Build Admin "Roster" tab and week grid UI
- **Files:** New `roster.html` or add to admin panel, `app.js`, `styles.css`
- **Description:** New "Roster" tab in admin panel. Week grid: 7 columns (Mon–Sun), rows = staff names. Each cell shows time range if scheduled. Click cell to edit. Modal form: staff dropdown, date picker, time range, notes.
- **Dependencies:** Task 4.2

### [ ] Task 4.4: Add roster conflict check (double-booking warning)
- **Files:** `app.js` (roster save handler)
- **Description:** Before saving roster entry, check if same staff already has an overlapping roster entry on the same date. If so, highlight conflict and warn admin.
- **Dependencies:** Task 4.3

### [ ] Task 4.5: Add "My Roster" to staff home screen
- **Files:** `index.html` (main screen), `app.js`
- **Description:** Below clock status, show next upcoming shift: "Next shift: Wed 7 May, 11:00 am — 3:00 pm". Query `get_my_roster`.
- **Dependencies:** Task 4.2

### [ ] Task 4.6: Add "Scheduled" toggle to My Shifts screen
- **Files:** `shifts.html` / `app.js` (staff shifts view)
- **Description:** In "My Shifts" screen, add toggle between "Worked" (past completed shifts) and "Scheduled" (upcoming roster entries). Show roster entries in similar card format.
- **Dependencies:** Task 4.2, Task 4.5

### [ ] Task 4.7: Show roster info alongside clock status
- **Files:** `index.html` / `app.js`
- **Description:** If staff is scheduled for today but not clocked on yet, show: "Scheduled 11am–3pm, not clocked on yet". If clocked on and matches roster, show "On scheduled shift".
- **Dependencies:** Task 4.5

### [ ] Task 4.8: QA — Roster CRUD and conflict handling
- **Files:** Test plan / manual QA
- **Description:** Verify: admin can create/update/delete roster entries, week grid displays correctly, conflict warning fires on double-book, staff sees "My Roster" and "Next shift", toggle between worked/scheduled shifts works.
- **Dependencies:** Tasks 4.1–4.7

---

## Final Integration & Validation

### [ ] Task 5.1: Cross-feature regression test
- **Files:** Full app
- **Description:** Test that new features don't break existing clock on/off, staff management, or timesheet functionality. Verify backward compatibility with old shifts and staff records.
- **Dependencies:** All Tasks 1.1–4.7

### [ ] Task 5.2: Mobile responsiveness check
- **Files:** All HTML/CSS
- **Description:** Test all new UI on mobile viewport: break buttons, time inputs, date filters, roster grid, collapsible sections, modals.
- **Dependencies:** All Tasks 1.1–4.7

### [ ] Task 5.3: Final integration QA sign-off
- **Files:** Test plan / manual QA
- **Description:** Complete end-to-end walkthrough of all 4 features. Screenshot evidence for each. Confirm production readiness.
- **Dependencies:** Tasks 5.1, 5.2

---

## Implementation Order

| Order | Task | Feature |
|-------|------|---------|
| 1 | 1.1 | Break Tracking |
| 2 | 1.2 | Break Tracking |
| 3 | 1.3 | Break Tracking |
| 4 | 1.4 | Break Tracking |
| 5 | 1.5 | Break Tracking |
| 6 | 1.6 | Break Tracking |
| 7 | 1.7 | Break Tracking |
| 8 | 2.1 | Late/Early Alerts |
| 9 | 2.2 | Late/Early Alerts |
| 10 | 2.3 | Late/Early Alerts |
| 11 | 2.4 | Late/Early Alerts |
| 12 | 2.5 | Late/Early Alerts |
| 13 | 2.6 | Late/Early Alerts |
| 14 | 3.1 | Daily Shift Grouping |
| 15 | 3.2 | Daily Shift Grouping |
| 16 | 3.3 | Daily Shift Grouping |
| 17 | 3.4 | Daily Shift Grouping |
| 18 | 3.5 | Daily Shift Grouping |
| 19 | 4.1 | Roster View + Editor |
| 20 | 4.2 | Roster View + Editor |
| 21 | 4.3 | Roster View + Editor |
| 22 | 4.4 | Roster View + Editor |
| 23 | 4.5 | Roster View + Editor |
| 24 | 4.6 | Roster View + Editor |
| 25 | 4.7 | Roster View + Editor |
| 26 | 4.8 | Roster View + Editor |
| 27 | 5.1 | Integration |
| 28 | 5.2 | Integration |
| 29 | 5.3 | Integration |

---

**Total Tasks:** 29 (23 implementation + 6 QA)
**Estimated Completion:** TBD by developer agents
