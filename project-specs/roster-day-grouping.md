# Roster Day-Grouping Redesign

## Goal

Reorganize the Roster admin view from **per-staff cards** (each card = one staff member's whole week) to **day-grouped layout** (each day = a section showing all staff, split into lunch and dinner).

## Current Behavior

- `admin-roster.js` renders one card per staff member
- Each card has a 7-column grid (Mon–Sun) with two rows: Lunch and Dinner
- Clicking a cell opens a modal to add/edit that shift
- Week navigation (prev/next/current) works fine — keep it

## New Behavior

### Layout: Grouped by Day

Each **day of the week** becomes its own section/card. Within each day:

1. **Day header** — shows day name + date (e.g., "Monday, May 11")
2. **Lunch section** — lists all staff rostered for lunch that day
   - Each entry shows: staff name, start–end time, notes (if any)
   - Click to edit opens the existing roster modal (reuse current modal)
   - Empty lunch section shows "+ Add lunch shift" button
3. **Dinner section** — same format, for dinner shifts
   - Visual distinction from lunch (keep current color coding: lunch = amber/yellow, dinner = purple/violet)
4. **Quick-add** — a small "+ Add staff" button per section to add a new shift entry

### Staff Display per Shift

For each rostered shift entry within a day section:
- Staff name (bold)
- Time range (e.g., "11:00–15:00")
- Notes if present (muted, truncated)
- Click opens the existing roster edit modal with that entry pre-filled

### Empty Days

Days with no rostered shifts still show (with a subtle empty state), so users can click to add shifts.

### Mobile Responsive

- On mobile, day sections stack vertically (already natural for this layout)
- Each staff entry should be touch-friendly (min 44px tap target)

## Implementation Details

### Files to Modify

1. **`admin-roster.js`** — Major rewrite of the rendering functions:
   - Replace `buildRosterCards` / `buildStaffCard` / `buildShiftRow` / `buildShiftCell` with day-grouped rendering
   - New functions: `buildDaySection(date, rosterEntries, staffList)`, `buildShiftList(shiftType, dateKey, rosterEntries, staffList)`, `buildShiftEntry(entry, staffList)`
   - Keep all modal, CRUD, CSV import, and week navigation logic unchanged
   - Keep the `findRosterEntry`, `openRosterModal`, etc. helpers — they still work

2. **`styles.css`** — Replace `.roster-staff-card*` styles with new day-grouped styles:
   - `.roster-day-card` — container for each day section
   - `.roster-day-header` — day name + date header
   - `.roster-shift-section` — lunch or dinner subsection within a day
   - `.roster-shift-section-header` — "Lunch" / "Dinner" label with color accent
   - `.roster-entry` — individual staff shift entry (clickable)
   - `.roster-entry-name`, `.roster-entry-time`, `.roster-entry-notes` — sub-elements
   - `.roster-empty-section` — empty state for a shift type with no entries
   - `.roster-add-shift` — the "+ Add" button

3. **`index.html`** — No changes expected (the roster tab container `#roster-grid-container` stays the same)

### Key Constraints

- **DO NOT modify** `db.js`, `auth.js`, `app.js`, or `admin.js` — only `admin-roster.js` and `styles.css`
- **DO NOT modify** the roster modal, CSV import, or week navigation — reuse as-is
- **Cache-bust**: After all changes, bump `?v=N` in index.html for all script/style references
- **Syntax check**: Run `node -c admin-roster.js` and `node -c styles.css` is not needed but check JS files
- **Keep lunch/dinner color distinction**: Lunch = amber (#d97706), Dinner = purple (#7c3aed)
- **All existing functionality must be preserved**: adding, editing, deleting shifts, CSV import, week nav

### Data Flow (unchanged)

The data retrieval stays the same:
```js
var staffList = await window.ClockDB.getAllStaff();
var rosterEntries = await window.ClockDB.getRosterForWeek(startDate, endDate);
```

Just the rendering changes from per-staff to per-day grouping.

## Testing Checklist

- [ ] Roster tab loads without errors
- [ ] Week navigation (prev/next/current) works
- [ ] Each day shows as a separate card/section
- [ ] Lunch and dinner are visually distinct within each day
- [ ] Clicking an existing shift entry opens the edit modal
- [ ] Clicking "+ Add" opens the add modal with correct day/shift-type pre-filled
- [ ] Creating, editing, and deleting shifts still works
- [ ] CSV import still works
- [ ] Mobile responsive — day cards stack, entries are tappable
- [ ] Empty days show with add buttons
- [ ] No JS errors in console