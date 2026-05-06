# Mucha Kitchen ClockOn — Project State Document

> **Last updated**: 2026-05-06 23:21 AWST
> **Purpose**: Any agent can read this file and pick up the project cold.

---

## 1. What Is This?

A staff clock-on/off web app for **Mucha Kitchen**, a small Japanese restaurant in Perth, WA. Staff use a PIN to log in, then clock on/off. Admin (Admin) manages staff, timesheets, rosters, and payroll from a mobile-friendly admin panel.

**Live URL**: `https://YOUR-GITHUB-USER.github.io/clock-on-off/index.html?v=9`
**GitHub repo**: `git@github.com:YOUR-GITHUB-USER/clock-on-off.git` (branch: `main`)
**Deployment**: GitHub Pages (static site, no server-side rendering)
**Latest commit**: `0c65515` — "Fix syntax error in payroll summary table + bump to v=9"

---

## 2. Architecture

### Stack
- **Frontend only** — static HTML/CSS/JS, no build step, no framework
- **Backend**: Supabase (PostgreSQL + PostgREST + GoTrue)
- **Auth**: PIN-based, custom RPC `authenticate_staff(p_pin)` returns staff record
- **Session**: Stored in `localStorage` via `ClockAuth.createSession()`

### File Structure
```
clock-on-off-app/
├── index.html          # Single-page app, all screens in one file (467 lines)
├── config.js           # Supabase URL + key overrides (9 lines, gitignored)
├── db.js               # All Supabase RPC/data functions (876 lines)
├── auth.js             # PIN auth, session management, screen routing (385 lines)
├── app.js              # Main clock UI, shifts, breaks, navigation (1033 lines)
├── admin.js            # Admin panel: staff, timesheets, roster, audit (2083 lines)
├── styles.css          # All styles, mobile-first (1127 lines)
├── supabase/           # SQL migrations (already applied to production)
│   ├── 001-initial-schema.sql
│   ├── 002-rls-policies.sql
│   ├── 003-functions.sql
│   └── 004-breaks-and-roster.sql
├── project-specs/      # Feature specifications
├── project-docs/       # Architecture docs, design specs
└── project-tasks/      # Task lists (partially outdated — see §7 below)
```

### Global Modules
- `window.ClockDB` — database layer (db.js)
- `window.ClockAuth` — auth + session + screen routing (auth.js)
- `window.ClockApp` — main app logic (app.js)
- `window.ClockAdmin` — admin panel (admin.js)

### Cache Busting
GitHub Pages caches aggressively. All `<script>` tags use `?v=N` query params.
**Current version**: `v=9`. **Every code push must bump this in index.html.**

---

## 3. Supabase Configuration

- **Project URL**: `https://YOUR-PROJECT.supabase.co`
- **Anon key**: `YOUR-ANON-KEY`
- **Supabase Management API token**: `[REDACTED — see local config]`
- **Management API endpoint**: `https://api.supabase.com/v1/projects/YOUR-PROJECT-ID/database/query`
- **Admin staff ID**: `REDACTED` (Admin)
- **Admin's PIN**: `[REDACTED — see local config]`

### Database Schema

**Tables:**

| Table | Key Columns | Notes |
|-------|-------------|-------|
| `staff` | id, name, pin, role, active, expected_start_time, expected_end_time | expected_* nullable |
| `shifts` | id, staff_id, clock_in, clock_out, clock_in_adjusted, clock_out_adjusted, notes | clock_out nullable = active shift |
| `breaks` | id, shift_id, break_start, break_end, created_at | break_end nullable = on break |
| `rosters` | id, staff_id, roster_date, start_time, end_time, shift_type, notes, created_at, updated_at | shift_type: 'lunch' or 'dinner' |
| `audit_log` | id, staff_id, action, details, created_at | Immutable log |

**Key Constraints:**
- `rosters` unique on `(staff_id, roster_date, shift_type)` — max 2 entries per staff per day (lunch + dinner)
- All RPC functions use `SECURITY DEFINER`
- RLS policies on all tables (see `002-rls-policies.sql`)

**Key RPC Functions:**

| Function | Purpose |
|----------|---------|
| `authenticate_staff(p_pin)` | PIN login, returns staff record |
| `clock_in(p_staff_id, p_clock_in)` | Start a shift |
| `clock_out(p_shift_id, p_clock_out)` | End a shift |
| `adjust_shift(p_shift_id, p_clock_in, p_clock_out, p_staff_id, p_reason)` | Manual time adjustment (audit logged) |
| `get_all_shifts(p_start, p_end, p_staff_id)` | Fetch shifts with date/staff filter |
| `start_break(p_shift_id)` | Start a break on active shift |
| `end_break(p_break_id)` | End a break |
| `get_shift_breaks(p_shift_id)` | Get all breaks for a shift |
| `is_on_break(p_shift_id)` | Check if staff is on break |
| `create_roster_entry(p_staff_id, p_roster_date, p_start_time, p_end_time, p_shift_type, p_notes)` | Create/update roster entry |
| `update_roster_entry(p_roster_id, p_start_time, p_end_time, p_shift_type, p_notes)` | Update roster |
| `delete_roster_entry(p_roster_id)` | Delete roster |
| `get_roster_for_week(p_start_date, p_end_date)` | Get roster week |
| `get_my_roster(p_days_ahead)` | Get upcoming roster for current user |

---

## 4. App Screens & User Flows

### PIN Screen
- 6-digit PIN entry, dots fill as you type
- `#pin-enter` button validates via `authenticate_staff` RPC
- On success: session saved to localStorage, routes to app screen

### Main Screen (Staff)
- Shows staff name, clock status, action button (Clock On / Clock Off / Start Break / End Break)
- "📋 My Shifts" button → shift history
- "⚙️ Admin Panel" button → admin (only for role='admin')
- Next shift display from roster (if scheduled today)
- Bottom nav: Home, My Shifts

### My Shifts Screen (Staff)
- Toggle: **Worked** (past shifts) vs **Scheduled** (roster entries)
- Shifts grouped by date, cards show clock in/out, duration, breaks, late/early badges

### Admin Panel (Admin only)
Four tabs:

1. **Staff** — List, add, edit, deactivate staff. Modal for add/edit with expected times.
2. **Timesheets** — View all shifts. Filters: date range (Today/Yesterday/7d/30d/Custom), staff dropdown. Two views:
   - **📅 By Date** — shifts grouped by day (original)
   - **👤 By Staff** — each staff gets a card with weekly totals, status badges, shift table
   - **Payroll Summary** table shown in By Staff view
   - Export CSV: detail format (By Date) or staff summary format (By Staff)
3. **Roster** — Weekly grid, 2 rows per staff (Lunch/Dinner). Click cell to add/edit. Week nav (prev/next). "📥 Import CSV" button.
4. **Audit Log** — Chronological log of admin actions (shift adjustments, staff changes)

---

## 5. Completed Features

All deployed and live at `?v=9`:

- ✅ Duplicate staff entries bug fix (adminInitialized flag)
- ✅ Break tracking (start/end break, live timer, validation)
- ✅ Late/Early alerts (15min yellow, 30min orange thresholds)
- ✅ Daily shift grouping in My Shifts + Timesheets
- ✅ Worked/Scheduled toggle in My Shifts
- ✅ Roster view with week navigation
- ✅ Roster CRUD (add/edit/delete per cell in weekly grid)
- ✅ Lunch/Dinner shift types (2 sub-rows per staff in roster grid)
- ✅ CSV/Google Sheets roster import (preview, validation, name matching)
- ✅ App renamed to "Mucha Kitchen ClockOn"
- ✅ Timesheet redesign: By Date / By Staff toggle
- ✅ Staff cards with total hours + status badges (late/early/adjusted)
- ✅ Payroll summary table
- ✅ Two CSV export modes (detail + staff summary)
- ✅ Admin Panel tabs (Staff, Timesheets, Roster, Audit Log)
- ✅ Timesheets date filters (Today/Yesterday/7d/30d/Custom)
- ✅ Shift edit modal (manual time adjustment with audit log)

---

## 6. Known Issues & Bugs

- **[FIXED] v=8 syntax error** — extra `"` in payroll table HTML broke admin.js, causing infinite loading. Fixed in v=9.
- **Browser test session flaky** — the headless Chromium on this host sometimes loses its debug port. Need to restart to test. Not a production issue.
- **No roster vs actual comparison yet** — By Staff view doesn't cross-reference roster entries with actual shifts to show missed shifts or variance. This is the next logical feature.

---

## 7. Task List Status

The file `project-tasks/feature-update-tasklist.md` has 29 tasks all marked `[ ]` (unchecked), but **all the implementation is actually done**. The task list was written before work started and never updated. Don't trust it for status — trust §5 above.

---

## 8. Pending / Next Features

These are discussed but **not yet confirmed** by Admin:

1. **Roster vs Actual Comparison** — In By Staff view, cross-reference rostered times with actual clock data. Show:
   - Missed shifts (🚫 — rostered but no shift recorded)
   - Time variance (e.g., "Rostered 9-5, worked 9:05-5:02, +7min")
   - Weekly compliance score per staff
   - Requires: fetching roster data alongside shifts, matching by staff+date

2. **Pay Period Locking** — Once payroll is processed for a week, lock those shifts from further edits. Prevent accidental post-payroll adjustments.

3. **Staff Availability / Leave** — Let staff mark days unavailable so admin doesn't roster them.

---

## 9. Development Workflow

### Making Changes
1. Edit files in `/home/ubuntu/Desktop/clock-on-off-app/`
2. Run `node -c <file>.js` to check syntax before pushing
3. Bump cache version: find `?v=9` in `index.html`, increment to next number
4. `git add -A && git commit -m "description" && git push origin main`
5. Wait ~45s for GitHub Pages to deploy
6. Verify with `curl -sI "https://YOUR-GITHUB-USER.github.io/clock-on-off/admin.js?v=N"` — check Last-Modified

### Running SQL Migrations
Supabase CLI `db push` fails with `schema_migrations_pkey` conflict. Use the Management API instead:
```bash
curl -s -X POST "https://api.supabase.com/v1/projects/YOUR-PROJECT-ID/database/query" \
  -H "Authorization: Bearer [REDACTED — see local config]" \
  -H "Content-Type: application/json" \
  -d '{"query": "YOUR SQL HERE"}'
```

### Testing in Browser
Chromium on this host runs with `--remote-debugging-port=9222`. Use the browser tool to navigate and interact. PIN entry can be tricky via JS — the buttons use `data-pin` attributes and `ClockAuth.enterPinDigit()` internally.

### Important Gotchas
- **Always bump cache version** in index.html after code changes
- **Always run `node -c`** on modified JS files before pushing
- **Don't use `p_force`** in `createRosterEntry` — the SQL function doesn't accept it
- **GitHub Pages caching** is aggressive; `?v=N` query params are the only reliable cache-bust method
- **`SECURITY DEFINER`** on all RPC functions — don't change this without understanding RLS implications

---

## 10. Admin's Context & Preferences

- **Admin** is the owner of Mucha Kitchen (small Japanese restaurant, Perth WA)
- Timezone: `Australia/Perth` (AWST, UTC+8)
- Wants mobile-first, touch-friendly, simple
- No unnecessary complexity — if it can be done simply, do it simply
- Values practical payroll/admin utility over fancy features
- Sees the app as a tool that "just works" — reliability matters
- PIN: `REDACTED`, role: admin

---

## 11. Key Files Quick Reference

| File | What it does | Key functions |
|------|-------------|---------------|
| `index.html` | Single page, all screens, script tags | `#pin-screen`, `#app-screen`, admin tabs |
| `db.js` | All Supabase calls | `loginStaff`, `clockIn`, `clockOut`, `startBreak`, `endBreak`, `createRosterEntry`, `getAllShifts` |
| `auth.js` | Auth, session, screen routing | `enterPinDigit`, `createSession`, `showScreen`, `isAdmin` |
| `app.js` | Main UI, clock actions, shifts | `initClockAction`, `initShiftsToggle`, `checkRosterForToday` |
| `admin.js` | Admin panel, timesheets, roster | `loadAdminTimesheets`, `renderTimesheetsByStaff`, `exportTimesheetsCSV`, `openRosterImportModal` |
| `styles.css` | All styles | Mobile-first, Tailwind-ish utility classes |