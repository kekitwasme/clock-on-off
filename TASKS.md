# MK ClockOn — Feature Task List

> Generated from feature requests in priority order.
> Implement tasks sequentially unless marked as parallelizable.

---

## Task 1: Add `observer` role to staff table and backend

**Scope**: Database migration + RPC function updates to support a third role: `observer`.

**Files to change**:
- `supabase/migrations/` — new migration file (e.g. `20260511_01_add_observer_role.sql`)
- `supabase/schema/staff.sql` — update schema reference comments

**Implementation details**:
1. Alter the `staff.role` CHECK constraint from `IN ('staff', 'admin')` to `IN ('staff', 'admin', 'observer')`:
   ```sql
   ALTER TABLE staff DROP CONSTRAINT staff_role_check;
   ALTER TABLE staff ADD CONSTRAINT staff_role_check CHECK (role IN ('staff', 'admin', 'observer'));
   ```
2. Update `create_staff_with_pin` to accept `'observer'` as a valid `p_role`:
   - Change `p_role NOT IN ('staff', 'admin')` check to `p_role NOT IN ('staff', 'admin', 'observer')`.
3. Update `update_staff_with_pin` similarly — allow `p_role = 'observer'`.
4. Add `is_observer_from_session()` function (mirrors `is_admin_from_session`):
   ```sql
   CREATE OR REPLACE FUNCTION is_observer_from_session()
   RETURNS BOOLEAN AS $$
   DECLARE
       v_staff_id UUID;
   BEGIN
       v_staff_id := get_session_staff_id();
       IF v_staff_id IS NULL THEN RETURN false; END IF;
       RETURN EXISTS (
           SELECT 1 FROM staff
           WHERE id = v_staff_id AND role = 'observer' AND active = true
       );
   END;
   $$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
   ```
5. Add `is_admin_or_observer_from_session()` convenience function:
   ```sql
   CREATE OR REPLACE FUNCTION is_admin_or_observer_from_session()
   RETURNS BOOLEAN AS $$
   BEGIN
       RETURN is_admin_from_session() OR is_observer_from_session();
   END;
   $$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
   ```
6. Update `authenticate_staff` return to include the `role` (it already does — just verify `'observer'` flows through).
7. Update schema reference `staff.sql` comments to document the `observer` role.

**Dependencies**: None — this is the foundation for all other tasks.

---

## Task 2: RLS policies for observer role

**Scope**: Update Row Level Security policies so observers can view (but not modify) roster data and see the admin roster tab, but cannot access timesheet/staff/audit data.

**Files to change**:
- `supabase/migrations/` — new migration file (e.g. `20260511_02_observer_rls.sql`)

**Implementation details**:
1. **Rosters — SELECT**: Update `rosters_select` policy to allow observers:
   ```sql
   -- Replace existing rosters_select policy
   CREATE OR REPLACE POLICY rosters_select ON rosters
     FOR SELECT
     USING (
       staff_id = get_session_staff_id()
       OR is_admin_from_session()
       OR is_observer_from_session()
     );
   ```
2. **Rosters — INSERT/UPDATE/DELETE**: Keep admin-only. Observers must NOT be able to create, edit, or delete roster entries. No changes needed to existing policies.
3. **Staff — SELECT**: Observers need to read staff names for the roster grid. Update `staff_select` policy:
   ```sql
   -- Update staff_select to allow observers
   CREATE OR REPLACE POLICY staff_select ON staff
     FOR SELECT
     USING (
       id = get_session_staff_id()
       OR is_admin_from_session()
       OR is_observer_from_session()
     );
   ```
4. **Shifts — SELECT**: Observers should NOT see timesheet data. Keep existing policy (self or admin only). No change.
5. **Audit log — SELECT**: Keep admin-only. No change.
6. Update `get_roster_for_week` function to allow observers (currently checks `v_is_admin OR r.staff_id = v_staff_id`):
   ```sql
   -- Add is_observer_from_session() check
   v_is_admin := is_admin_from_session();
   v_is_observer := is_observer_from_session();
   -- In WHERE clause:
   AND (v_is_admin OR v_is_observer OR r.staff_id = v_staff_id)
   ```
   Need to declare `v_is_observer BOOLEAN;` in the function.
7. `get_my_roster` — no change needed (it uses session staff_id, observers won't have roster entries of their own, but if they did it would still work).

**Dependencies**: Task 1 (needs `is_observer_from_session()` to exist).

---

## Task 3: Admins start in admin panel by default

**Scope**: When an admin logs in, they should land on the admin panel instead of the regular staff screen. They can still navigate back to the staff view if they want.

**Files to change**:
- `auth.js` — modify `completeLogin()` and `loadSession()` to redirect admins to admin screen

**Implementation details**:
1. In `completeLogin()` (around line 291), after `showScreen('app')`:
   - Change the logic so that if `staffData.role === 'admin'`, it calls `showScreen('admin')` instead of `showScreen('app')`.
   - If `staffData.role === 'observer'`, also call `showScreen('admin')` (observers go to admin panel too — they see only the roster tab, but the landing screen is the same).
   - Regular staff (`role === 'staff'`) still goes to `showScreen('app')`.
   ```js
   // Replace: showScreen('app');
   if (staffData.role === 'admin' || staffData.role === 'observer') {
     showScreen('admin');
   } else {
     showScreen('app');
   }
   ```
2. In `loadSession()` (around line 355-358), the same pattern:
   ```js
   // After restoring currentSession, show appropriate screen
   if (currentSession.role === 'admin' || currentSession.role === 'observer') {
     showScreen('admin');
   } else {
     showScreen('app');
   }
   ```
3. Ensure the "Back" button in the admin panel (`admin-back-btn`) still works — it should take admins back to `app-screen` so they can use the staff clock-on/off features.
4. No change to the `admin-panel-btn` visibility — it stays visible only for admins (and now observers, handled in Task 4).

**Dependencies**: None (can be done in parallel with Task 1/2, but testing requires Task 1).

---

## Task 4: Observer role UI — read-only roster tab access

**Scope**: Observers can see the admin panel's roster tab only. They cannot create/edit/delete roster entries, import CSV, or see timesheet/staff/audit tabs.

**Files to change**:
- `index.html` — admin tabs section
- `admin.js` — tab initialization and access control
- `admin-roster.js` — read-only mode for observers
- `auth.js` — add `isObserver()` function, update `isAdmin()` usage for button visibility

**Implementation details**:

### 4a. `auth.js` — Add observer detection
1. Add `isObserver()` function (mirrors `isAdmin()`):
   ```js
   function isObserver() {
     return !!(currentSession && currentSession.role === 'observer');
   }
   ```
2. Add `isAdminOrObserver()` function:
   ```js
   function isAdminOrObserver() {
     return !!(currentSession && (currentSession.role === 'admin' || currentSession.role === 'observer'));
   }
   ```
3. Update admin panel button visibility (around lines 283 and 355):
   - Change `staffData.role === 'admin'` checks to `isAdminOrObserver()` logic.
   - In `completeLogin()`: `if (staffData.role === 'admin' || staffData.role === 'observer')`
   - In `loadSession()`: same pattern
4. Expose in the public API:
   ```js
   isObserver: isObserver,
   isAdminOrObserver: isAdminOrObserver,
   ```

### 4b. `index.html` — Admin tabs visibility
1. Add a `data-require` attribute to each admin tab button for access control:
   ```html
   <button class="admin-tab ..." data-tab="staff" data-require="admin">Staff</button>
   <button class="admin-tab ..." data-tab="timesheets" data-require="admin">Timesheets</button>
   <button class="admin-tab ..." data-tab="roster" data-require="admin_or_observer">Roster</button>
   <button class="admin-tab ..." data-tab="audit" data-require="admin">Audit Log</button>
   ```
2. Update tab click handlers in `admin.js` to filter tabs based on role:
   - Hide tabs the observer shouldn't see.
   - If the user is an observer, auto-select the roster tab on load.

### 4c. `admin.js` — Tab access control
1. In `initAdmin()` or the tab setup, after checking auth:
   ```js
   var role = window.ClockAuth.getSession().role;
   document.querySelectorAll('.admin-tab').forEach(function(tab) {
     var require = tab.getAttribute('data-require');
     if (require === 'admin' && role !== 'admin') {
       tab.classList.add('hidden');
     }
   });
   ```
2. If the user is an observer, default to showing the roster tab:
   ```js
   if (role === 'observer') {
     // Show roster tab content, hide others
     showAdminTab('roster');
   }
   ```

### 4d. `admin-roster.js` — Read-only mode for observers
1. Add a `isReadOnly` flag at module level:
   ```js
   var isReadOnly = false;
   ```
2. In `initControls()`, check if the current user is an observer:
   ```js
   var session = window.ClockAuth.getSession();
   isReadOnly = session && session.role === 'observer';
   ```
3. When `isReadOnly` is true:
   - **Hide** the "Add Entry" button / make roster cells non-clickable (no `openRosterModal` on click).
   - **Hide** the CSV import button.
   - **Hide** the delete button in the roster modal.
   - Show roster entries as read-only (time display only, no click-to-edit).
4. In `buildShiftCell()`, if `isReadOnly`, don't add the click listener:
   ```js
   if (!isReadOnly) {
     cell.addEventListener('click', function() {
       openRosterModal(staff, dateKey, shiftType, entry);
     });
   }
   ```
5. Hide the CSV import UI elements when observer:
   ```js
   var importBtn = document.getElementById('roster-import-btn');
   if (importBtn && isReadOnly) importBtn.classList.add('hidden');
   ```

**Dependencies**: Task 1 (needs observer role in DB), Task 2 (needs RLS policies for observers to read rosters).

---

## Task 5: Admins and observers don't appear on the roster table

**Scope**: Staff members with role `admin` or `observer` should not appear as rows in the roster grid. They're managers, not rostered staff.

**Files to change**:
- `admin-roster.js` — filter the staff list before building cards
- `db.js` — optionally add a `getActiveRosterableStaff()` function, OR filter client-side

**Implementation details**:
1. In `admin-roster.js`, in the `load()` function (around line 52), after fetching `staffList`:
   ```js
   var staffList = await window.ClockDB.getAllStaff();
   // Filter out admins and observers — they don't appear on the roster
   staffList = staffList.filter(function(s) {
     return s.role === 'staff';
   });
   ```
2. This is the simplest approach — filter client-side. Since `getAllStaff()` already returns the role field, no DB changes needed.
3. The roster entries themselves are still keyed by `staff_id`, so admin/observer entries that somehow exist in the rosters table won't display (since there's no matching staff card row). This is acceptable — admin/observer roster entries are edge cases that can be cleaned up manually.
4. Consider: should we also filter in `get_roster_for_week` on the server? Not required for MVP — the RPC already joins staff, and the UI just won't render cards for non-staff roles.

**Dependencies**: Task 1 (needs observer role to exist for the filter to make sense).

**Parallelizable**: Can be done in parallel with Tasks 3 and 4.

---

## Task 6: "Bring over last week" button for admin roster view

**Scope**: Add a button in the admin roster section that copies roster entries from the previous week into the current week, skipping conflicts (existing entries for that staff/day/shift_type).

**Files to change**:
- `index.html` — add the button in the roster controls area
- `admin-roster.js` — add the copy logic and UI handler
- `db.js` — add a `copyRosterFromWeek()` function
- `supabase/migrations/` — add a new RPC `copy_roster_from_previous_week`

**Implementation details**:

### 6a. Database — `copy_roster_from_previous_week` RPC
Create a new SECURITY DEFINER function:
```sql
CREATE OR REPLACE FUNCTION copy_roster_from_previous_week(
    p_target_week_start DATE
)
RETURNS JSON AS $$
DECLARE
    v_admin_id UUID;
    v_source_start DATE;
    v_copied INT := 0;
    v_skipped INT := 0;
    v_entry RECORD;
BEGIN
    v_admin_id := get_session_staff_id();
    IF v_admin_id IS NULL OR NOT is_admin_from_session() THEN
        RAISE EXCEPTION 'Admin role required.' USING ERRCODE = '42501';
    END IF;

    v_source_start := p_target_week_start - INTERVAL '7 days';

    FOR v_entry IN
        SELECT r.staff_id, r.roster_date, r.start_time, r.end_time, r.notes, r.shift_type
        FROM rosters r
        JOIN staff s ON s.id = r.staff_id AND s.role = 'staff' AND s.active = true
        WHERE r.roster_date BETWEEN v_source_start AND v_source_start + 6
    LOOP
        -- Check if entry already exists for this staff/date/shift_type in target week
        IF NOT EXISTS (
            SELECT 1 FROM rosters
            WHERE staff_id = v_entry.staff_id
              AND roster_date = v_entry.roster_date + INTERVAL '7 days'
              AND shift_type = v_entry.shift_type
        ) THEN
            INSERT INTO rosters (staff_id, roster_date, start_time, end_time, notes, shift_type)
            VALUES (
                v_entry.staff_id,
                v_entry.roster_date + INTERVAL '7 days',
                v_entry.start_time,
                v_entry.end_time,
                v_entry.notes,
                v_entry.shift_type
            );
            v_copied := v_copied + 1;
        ELSE
            v_skipped := v_skipped + 1;
        END IF;
    END LOOP;

    RETURN json_build_object(
        'copied', v_copied,
        'skipped', v_skipped
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

Key points:
- Only copies entries for staff with `role = 'staff'` and `active = true` (admins/observers excluded per Task 5).
- Shifts dates by exactly 7 days.
- Skips any entry where a conflict exists (same staff, date, shift_type already present).
- Returns counts of copied and skipped entries for user feedback.

### 6b. `db.js` — Add `copyRosterFromPreviousWeek` function
```js
async function copyRosterFromPreviousWeek(weekStartDate) {
  var client = getClient();
  var result = await client.rpc('copy_roster_from_previous_week', {
    p_target_week_start: weekStartDate
  });
  if (result.error) {
    throw new Error('Failed to copy roster: ' + result.error.message);
  }
  return result.data;
}
```
Add to exports.

### 6c. `index.html` — Add button
In the roster controls area (near the week navigation), add:
```html
<button id="roster-copy-prev-week-btn" class="bg-blue-600 text-white px-3 py-2 rounded text-sm hover:bg-blue-700 ml-2">
  Bring over last week
</button>
```
Place it next to the week nav buttons (Prev / Today / Next).

### 6d. `admin-roster.js` — Wire up the button
1. In `initControls()`, add event listener for `roster-copy-prev-week-btn`:
   ```js
   var copyBtn = document.getElementById('roster-copy-prev-week-btn');
   if (copyBtn) {
     copyBtn.addEventListener('click', handleCopyPreviousWeek);
   }
   ```
2. Add `handleCopyPreviousWeek()`:
   ```js
   async function handleCopyPreviousWeek() {
     if (!currentWeekStart) return;
     if (!window.confirm('Copy roster entries from the previous week? Existing entries will be kept.')) return;
     
     try {
       var result = await window.ClockDB.copyRosterFromPreviousWeek(formatDateKey(currentWeekStart));
       showToast('Copied ' + result.copied + ' entries' +
                 (result.skipped > 0 ? ', skipped ' + result.skipped + ' conflicts' : '') + '.',
                 'success');
       load();
     } catch (err) {
       console.error('Failed to copy previous week:', err);
       showToast(err.message || 'Failed to copy roster entries.', 'error');
     }
   }
   ```
3. Hide the button for observers (read-only):
   ```js
   if (isReadOnly && copyBtn) copyBtn.classList.add('hidden');
   ```

**Dependencies**: Task 1 (needs role filter), Task 4 (needs observer read-only logic), Task 5 (needs admin/observer filter in roster display).

---

## Task 7: Change default shift times

**Scope**: Update the default start/finish times when creating roster entries:
- Lunch: 10:30 AM → 3:00 PM (was 11:00 → 15:00)
- Dinner: 5:00 PM → 9:00 PM (was 17:00 → 22:00)

**Files to change**:
- `admin-roster.js` — update default time values in `openRosterModal()`

**Implementation details**:
1. In `openRosterModal()` (around line 248-249), change the defaults:
   ```js
   // Before:
   startInput.value = entry ? entry.start_time.slice(0, 5) : (shiftType === 'lunch' ? '11:00' : '17:00');
   endInput.value = entry ? entry.end_time.slice(0, 5) : (shiftType === 'lunch' ? '15:00' : '22:00');
   
   // After:
   startInput.value = entry ? entry.start_time.slice(0, 5) : (shiftType === 'lunch' ? '10:30' : '17:00');
   endInput.value = entry ? entry.end_time.slice(0, 5) : (shiftType === 'lunch' ? '15:00' : '21:00');
   ```

2. Also update the shift time validation in `submitRosterForm()` (around line 289-300). The lunch shift currently requires `startHour < 12`. With a 10:30 start, this still works (`10 < 12`). The dinner shift requires `startHour >= 12`. With `17:00` start, this still works. No validation logic changes needed — just the default values.

3. **Important**: The DB has no constraint on shift times matching lunch/dinner categories. The defaults are purely UI concerns. The validation rules (lunch = AM start, dinner = PM start) remain correct.

**Dependencies**: None — can be done in parallel with any other task.

---

## Task Summary & Ordering

| # | Task | Depends On | Parallelizable |
|---|------|-----------|----------------|
| 1 | Add observer role to DB + RPCs | — | No (foundation) |
| 2 | RLS policies for observer role | 1 | No |
| 3 | Admins start in admin panel | 1 | Yes (but test with 1) |
| 4 | Observer UI — read-only roster tab | 1, 2 | No |
| 5 | Filter admins/observers from roster grid | 1 | Yes |
| 6 | "Bring over last week" button | 1, 4, 5 | No |
| 7 | Change default shift times | — | Yes |

**Recommended implementation order**: 7 → 1 → 2 → 3 → 5 → 4 → 6

(Task 7 is independent and quick. Task 1 must come first as it's the foundation. Then 2 and 3 can proceed. Task 5 is a simple filter. Task 4 depends on 1+2. Task 6 depends on 4+5.)

---

## Checklist

- [ ] Task 1: Add `observer` role to staff table and backend
- [ ] Task 2: RLS policies for observer role
- [ ] Task 3: Admins start in admin panel by default
- [ ] Task 4: Observer role UI — read-only roster tab access
- [ ] Task 5: Admins and observers don't appear on the roster table
- [ ] Task 6: "Bring over last week" button for admin roster view
- [ ] Task 7: Change default shift times