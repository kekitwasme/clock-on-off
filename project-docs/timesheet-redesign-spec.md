# Mucha Kitchen ClockOn — Timesheet Redesign Spec

## Current Problems

1. **Flat date-grouped list** — Hard to track one staff member across multiple days
2. **No roster comparison** — Can't see if staff worked their scheduled shifts
3. **Poor payroll export** — CSV is flat, not grouped by staff for easy payroll entry
4. **No weekly summary** — Can't see total hours per staff member at a glance
5. **Missed shifts not visible** — If someone doesn't show up, there's no record

## New Design: Staff-Centric View + Payroll Summary

### View Toggle: "By Date" / "By Staff"

**"By Date"** (current view, improved):
- Same daily grouping
- Better card layout

**"By Staff"** (new view):
- Each staff gets a card
- Card shows: name, role, weekly total hours, late count, early count
- Expandable table inside: Date | Rostered | Actual | Diff | Status
- Status: ✅ On time | ⚠️ Late | 🚫 Missed | 📝 Adjusted

### Staff Card Layout

```
┌────────────────────────────────────────────┐
│ Admin (Admin)                    Total: 38.5h │
│ ⚠️ 2 late | 🚫 1 missed | 📝 2 adjusted      │
├──────────┬──────────┬──────────┬─────────┤
│ Date     │ Rostered │ Actual   │ Status  │
├──────────┼──────────┼──────────┼─────────┤
│ Mon 5/7  │ 09-17    │ 09:05-17│ ⚠️ +5m  │
│ Tue 5/8  │ 10-15    │ --       │ 🚫 Miss │
│ Wed 5/9  │ 09-17    │ 09:00-  │ ✅ OK   │
│          │          │ 17:30   │ ⚠️ +30m │
└──────────┴──────────┴──────────┴─────────┘
```

### Payroll Summary (new tab or export)

```
┌─────────┬─────────┬────────┬──────┬───────┬─────────────┐
│ Staff   │ Total   │ Breaks │ Late │ Early │ Adjustments │
├─────────┼─────────┼────────┼──────┼───────┼─────────────┤
│ Admin     │ 38.5    │ 1.5    │ 2    │ 0     │ 2           │
│ Pem     │ 32.0    │ 1.0    │ 0    │ 1     │ 0           │
│ Kinzang │ 25.0    │ 0.5    │ 1    │ 0     │ 1           │
└─────────┴─────────┴────────┴──────┴───────┴─────────────┘
```

### CSV Export (Payroll-friendly)

Two export options:
1. **"Daily Detail"** — Current format, good for audit
2. **"Staff Summary"** — New format, good for payroll:

```csv
Staff,Total_Hours,Break_Hours,Adjusted_Shifts,Late_Count,Early_Count,Missed_Count,Notes
Admin,38.5,1.5,2,2,0,1,"2 late arrivals, 1 missed shift"
Pem,32.0,1.0,0,0,1,0,""
```

## Implementation Plan

1. Add "View By" toggle to timesheets tab
2. Create `renderTimesheetsByStaff()` function
3. Create `groupShiftsByStaff()` helper
4. Create `createStaffTimesheetCard()` function
5. Add payroll summary section
6. Update CSV export with "Staff Summary" option
7. Update `getAllShifts` to also fetch roster data for comparison
8. Add "Missed" status when roster exists but no shift recorded

## Database Changes

None needed — all data already exists. Just need to:
- Fetch roster for the same date range
- Compare roster entries to actual shifts
- Mark missing shifts

## UI Changes

### index.html
- Add "By Date" / "By Staff" toggle button group above timesheets list
- Add payroll summary section (collapsed by default)
- Add export format selector

### admin.js
- Add `currentTimesheetView` state variable
- Add `renderTimesheetsByStaff()` function
- Add `groupShiftsByStaff()` function
- Add `createStaffTimesheetCard()` function
- Add missed shift detection logic
- Update CSV export

### styles.css
- Add staff-card styles
- Add comparison table styles
- Add status badge styles (OK, Late, Missed, Adjusted)
