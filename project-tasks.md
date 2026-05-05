# Clock-On/Clock-Off Web App Development Tasks

## Specification Summary
**Original Requirements**:
- Simple, mobile-friendly web app for restaurant staff to record start/finish work times
- Staff can clock on and clock off separately using current time
- Grace window of ±10 minutes from app launch for time adjustments
- Clear visual state showing clocked on/off status
- PIN-based authentication (4-6 digit PIN)
- Supabase free tier for PostgreSQL database with REST API and row-level security
- GitHub Pages hosting (static site, no build step)
- Vanilla JS + Tailwind CSS (CDN)
- Admin can manage staff, view all timesheets, export data, adjust times with audit log

**Technical Stack**: Vanilla JavaScript, Tailwind CSS (CDN), Supabase (free tier), GitHub Pages
**Target Timeline**: Not specified in spec — small restaurant app, iterative development expected

---

## Development Tasks

### Phase 1: Setup

#### [ ] Task 1.1: Project Repository & Structure
**Description**: Initialize GitHub repository and create basic file structure
**Acceptance Criteria**:
- GitHub repository created with README
- All expected files created (index.html, app.js, auth.js, db.js, admin.js, styles.css)
- Directory structure includes /supabase folder for SQL migrations
- Repository ready for GitHub Pages deployment

**Files to Create**:
- /index.html
- /app.js
- /auth.js
- /db.js
- /admin.js
- /styles.css
- /supabase/001-initial-schema.sql
- /supabase/002-rls-policies.sql
- /README.md

**Reference**: File Structure section of specification

---

#### [ ] Task 1.2: Supabase Project Setup
**Description**: Create Supabase project and configure database
**Acceptance Criteria**:
- Supabase project created on free tier
- Database connection credentials obtained
- Environment variables documented (not committed to repo)
- Supabase client library reference added to project

**Files to Create/Edit**:
- .env.example (document required env vars: SUPABASE_URL, SUPABASE_ANON_KEY)
- README.md (setup instructions)

**Reference**: Data Storage section, Supabase Schema draft

---

#### [ ] Task 1.3: HTML Shell & Tailwind Integration
**Description**: Create main SPA shell with Tailwind CSS via CDN
**Acceptance Criteria**:
- index.html loads without errors
- Tailwind CSS loaded via CDN
- Basic mobile-first responsive layout in place
- Viewport meta tag configured for mobile
- App container ready for dynamic content

**Files to Create/Edit**:
- index.html (main structure with app container, navigation placeholder)

**Reference**: Technical Decisions table, Hosting requirements

---

### Phase 2: Database

#### [ ] Task 2.1: Supabase Schema Migration — Staff Table
**Description**: Create staff table with required fields
**Acceptance Criteria**:
- Staff table created with: id (uuid), name (text), pin (text, unique), role (text), active (boolean), created_at (timestamptz)
- PIN field will store hashed values (note in migration)
- Migration file saved to /supabase/001-initial-schema.sql
- Migration tested in Supabase SQL editor

**Files to Create/Edit**:
- /supabase/001-initial-schema.sql

**Reference**: Supabase Schema section

---

#### [ ] Task 2.2: Supabase Schema Migration — Shifts Table
**Description**: Create shifts table with clock-in/clock-out tracking
**Acceptance Criteria**:
- Shifts table created with: id, staff_id (FK), clock_in, clock_out (nullable), clock_in_adjusted (boolean), clock_out_adjusted (boolean), notes, created_at
- Foreign key to staff table configured
- Migration file updated

**Files to Create/Edit**:
- /supabase/001-initial-schema.sql (append shifts table)

**Reference**: Supabase Schema section

---

#### [ ] Task 2.3: Supabase Schema Migration — Audit Log Table
**Description**: Create audit_log table for admin adjustments tracking
**Acceptance Criteria**:
- Audit log table created with: id, admin_id (FK), target_staff_id (FK), shift_id (FK), action (text), old_value (jsonb), new_value (jsonb), created_at
- All foreign keys configured
- Migration file complete

**Files to Create/Edit**:
- /supabase/001-initial-schema.sql (append audit_log table)

**Reference**: Supabase Schema section, Admin adjustments requirement

---

#### [ ] Task 2.4: Supabase Row-Level Security (RLS) Policies
**Description**: Implement RLS policies so staff can only see/edit their own records
**Acceptance Criteria**:
- RLS enabled on staff, shifts, and audit_log tables
- Staff can SELECT/INSERT only their own shifts
- Admin role can access all records
- Policies documented in migration file
- RLS tested with different user roles

**Files to Create/Edit**:
- /supabase/002-rls-policies.sql

**Reference**: Authentication & Security section, Supabase RLS requirement

---

#### [ ] Task 2.5: Supabase RPC Function — Time Window Enforcement
**Description**: Create server-side function to enforce ±10 minute adjustment window
**Acceptance Criteria**:
- PostgreSQL function created that validates submitted times are within ±10 minutes of now()
- Function rejects times outside window (prevents API bypass)
- Function returns appropriate error messages
- Function tested with valid and invalid time inputs

**Files to Create/Edit**:
- /supabase/003-time-window-function.sql

**Reference**: Time Window Enforcement section, Constraints section

---

### Phase 3: Authentication

#### [ ] Task 3.1: PIN Entry UI Component
**Description**: Build PIN entry screen for staff authentication
**Acceptance Criteria**:
- Clean, mobile-friendly PIN entry interface
- 4-6 digit PIN input with numeric keypad
- Visual feedback for each digit entered
- Submit button enabled when PIN length valid
- Error state for invalid PIN attempts

**Files to Create/Edit**:
- index.html (PIN entry section)
- styles.css (PIN input styling)
- auth.js (PIN UI logic)

**Reference**: User Flow step 1, Authentication & Security section

---

#### [ ] Task 3.2: PIN Authentication Logic
**Description**: Implement PIN validation against Supabase staff table
**Acceptance Criteria**:
- auth.js handles PIN submission to Supabase
- Staff record retrieved and validated
- Session state stored (staff ID, name, role, active status)
- Invalid PIN shows clear error message
- Successful auth transitions to main app screen

**Files to Create/Edit**:
- auth.js (PIN validation, session management)
- db.js (staff lookup query)

**Reference**: User Flow step 2, Simple PIN + Supabase RLS requirement

---

#### [ ] Task 3.3: Session Management
**Description**: Handle authenticated session state and logout
**Acceptance Criteria**:
- Session persists across page refresh (localStorage/sessionStorage)
- Session expiry or logout clears state
- Return to PIN screen on logout
- Staff name displayed in authenticated state

**Files to Create/Edit**:
- auth.js (session storage, logout function)
- index.html (logout button, staff name display)

**Reference**: User Flow, mobile browser compatibility requirement

---

### Phase 4: Core Feature — Clock On/Off

#### [ ] Task 4.1: Clock Status Display Component
**Description**: Show clear visual state of whether staff is clocked on or off
**Acceptance Criteria**:
- Prominent status indicator (e.g., green "Clocked On" / red "Clocked Off")
- If clocked on: show current shift duration (time elapsed since clock-in)
- Status updates immediately after clock action
- Clear visual hierarchy on mobile screen

**Files to Create/Edit**:
- index.html (status display section)
- app.js (status rendering logic)
- styles.css (status styling)

**Reference**: Core Requirements — Clock-On/Clock-Off, User Flow steps 3-5

---

#### [ ] Task 4.2: Current Shift Detection
**Description**: Query Supabase to find staff's active (open) shift
**Acceptance Criteria**:
- On auth, query shifts table for record with staff_id and NULL clock_out
- If found: user is "clocked on", show clock-off option
- If not found: user is "clocked off", show clock-on option
- Handle edge case of multiple open shifts (should not happen, but log warning)

**Files to Create/Edit**:
- app.js (shift status query)
- db.js (get active shift function)

**Reference**: Time Recording section — "shift shows as open/active until they clock off"

---

#### [ ] Task 4.3: Clock-On Action with Time Picker
**Description**: Implement clock-on functionality with ±10 minute time picker
**Acceptance Criteria**:
- "Clock On" button prominent when staff is clocked off
- Time picker defaults to current time (server time from Supabase)
- Time picker enforces minimum = now() - 10 minutes, maximum = now() + 10 minutes
- UI prevents selection outside window
- On submit: create new shift record with clock_in timestamp
- clock_in_adjusted flag set to true if time differs from now()
- Confirmation shown after successful clock-on
- Status updates to "Clocked On"

**Files to Create/Edit**:
- index.html (clock-on button, time picker modal/section)
- app.js (clock-on logic, time window validation)
- db.js (create shift record function)

**Reference**: Core Requirements, Time Window Enforcement section, User Flow step 3

---

#### [ ] Task 4.4: Clock-Off Action with Time Picker
**Description**: Implement clock-off functionality with ±10 minute time picker
**Acceptance Criteria**:
- "Clock Off" button prominent when staff is clocked on
- Shows current shift duration before clocking off
- Time picker with same ±10 minute enforcement as clock-on
- On submit: update shift record with clock_out timestamp
- clock_out_adjusted flag set if time differs from now()
- Confirmation shown with total shift duration
- Status updates to "Clocked Off"

**Files to Create/Edit**:
- index.html (clock-off button, time picker, duration display)
- app.js (clock-off logic, duration calculation)
- db.js (update shift with clock_out function)

**Reference**: Core Requirements, Time Window Enforcement section, User Flow step 4

---

#### [ ] Task 4.5: Server Time Synchronization
**Description**: Get current server time from Supabase for accurate time recording
**Acceptance Criteria**:
- Function to fetch current server timestamp from Supabase (SELECT now())
- Server time used as default for time pickers (not client time)
- Prevents staff from manipulating client clock
- Cached on app load, refreshed on clock action

**Files to Create/Edit**:
- db.js (get server time function)
- app.js (use server time for time picker defaults)

**Reference**: Time Window Enforcement — "Default time = now() (server time from Supabase)"

---

### Phase 5: Staff Shift History

#### [ ] Task 5.1: My Shifts View UI
**Description**: Build interface for staff to view their recent shifts
**Acceptance Criteria**:
- "My Shifts" button/link accessible from main screen
- List shows last 7 days minimum of shifts
- Each row shows: date, clock-in time, clock-out time (or "Active" if open), duration
- Sorted by most recent first
- Mobile-friendly table or card layout

**Files to Create/Edit**:
- index.html (My Shifts section/modal)
- app.js (render shift history)
- styles.css (shift list styling)

**Reference**: Time Recording — "Staff can view their own recent shifts (last 7 days minimum)"

---

#### [ ] Task 5.2: Shift History Query & Pagination
**Description**: Fetch staff's shift history from Supabase with proper ordering
**Acceptance Criteria**:
- Query shifts table filtered by staff_id
- Ordered by created_at DESC (most recent first)
- Limit to last 30 shifts (covers 7+ days for most staff)
- Handle shifts with NULL clock_out (show "Active" or "Open")
- Calculate and display duration for completed shifts

**Files to Create/Edit**:
- db.js (get staff shifts function)
- app.js (duration calculation, formatting)

**Reference**: Time Recording section, Supabase REST API usage

---

### Phase 6: Admin Panel

#### [ ] Task 6.1: Admin Role Detection
**Description**: Detect and gate admin panel access by staff role
**Acceptance Criteria**:
- On auth, check staff.role === 'admin'
- If admin: show "Admin Panel" button/link
- If not admin: admin features completely hidden
- Admin PIN entry same as staff (no separate login)

**Files to Create/Edit**:
- auth.js (role check after auth)
- index.html (admin panel link, conditionally shown)
- admin.js (admin panel container)

**Reference**: Admin section — "Admin PIN → sees admin panel"

---

#### [ ] Task 6.2: Admin — Staff Management UI
**Description**: Build admin interface to add/remove staff and set PINs
**Acceptance Criteria**:
- List all staff with name, role, active status
- "Add Staff" button opens form (name, PIN, role dropdown)
- Edit button for existing staff (change name, PIN, role, active status)
- Deactivate (not delete) staff to preserve historical data
- PIN must be 4-6 digits, validated client-side
- Success/error feedback on all actions

**Files to Create/Edit**:
- admin.js (staff CRUD logic)
- index.html (staff management section)
- db.js (staff CRUD functions)

**Reference**: Staff Management (Admin) section

---

#### [ ] Task 6.3: Admin — All Timesheets View
**Description**: Admin view of all staff timesheets
**Acceptance Criteria**:
- Filterable by staff member and date range
- Shows all shifts with: staff name, date, clock-in, clock-out, duration, adjusted flags
- Sorted by date DESC
- Mobile-responsive table or list
- Quick filter for "Active shifts" (no clock-out)

**Files to Create/Edit**:
- admin.js (fetch and render all shifts)
- index.html (timesheets view with filters)
- db.js (get all shifts with staff join)

**Reference**: Staff Management — "Admin can view all timesheets"

---

#### [ ] Task 6.4: Admin — Timesheet Export
**Description**: Export timesheet data to CSV
**Acceptance Criteria**:
- "Export CSV" button in timesheets view
- Exports current filtered view (or all if no filter)
- CSV columns: staff_name, date, clock_in, clock_out, duration, clock_in_adjusted, clock_out_adjusted, notes
- Downloaded as .csv file with timestamp in filename
- Works on mobile browsers

**Files to Create/Edit**:
- admin.js (CSV generation and download)
- index.html (export button)

**Reference**: Staff Management — "export data"

---

#### [ ] Task 6.5: Admin — Manual Time Adjustment with Audit
**Description**: Allow admin to manually adjust shift times with audit logging
**Acceptance Criteria**:
- Edit button on individual shift records in timesheets view
- Admin can change clock_in and/or clock_out times
- Time adjustments still subject to reasonable limits (document in UI)
- On save: update shift record AND create audit_log entry
- Audit log captures: admin_id, target_staff_id, shift_id, action, old_value, new_value
- Audit trail visible to admin (separate view or in timesheet detail)

**Files to Create/Edit**:
- admin.js (adjustment form, audit log creation)
- db.js (update shift + insert audit_log transaction)
- index.html (adjustment modal, audit log view)

**Reference**: Staff Management — "Admin can manually adjust times if needed (with audit log)"

---

### Phase 7: UI/Polish

#### [ ] Task 7.1: Mobile-First Responsive Design
**Description**: Ensure app works flawlessly on mobile browsers
**Acceptance Criteria**:
- All touch targets minimum 44px (iOS guideline)
- No horizontal scrolling on any screen
- Forms and buttons usable on small screens (320px width)
- Tested on iOS Safari and Android Chrome
- Font sizes readable without zooming

**Files to Create/Edit**:
- styles.css (mobile-first media queries)
- index.html (viewport, responsive structure)

**Reference**: Constraints — "Must work on mobile browsers", "Mobile-first responsive design"

---

#### [ ] Task 7.2: Loading States & Error Handling
**Description**: Add user feedback for async operations and errors
**Acceptance Criteria**:
- Loading spinners/disabled states during Supabase queries
- Clear error messages for: network errors, auth failures, validation errors
- Retry option for transient failures
- Graceful degradation if Supabase unavailable

**Files to Create/Edit**:
- app.js, auth.js, admin.js (error handling, loading states)
- styles.css (loading spinner, error message styling)
- index.html (error message containers)

**Reference**: User experience — "Staff should be able to use it in under 10 seconds"

---

#### [ ] Task 7.3: Confirmation Messages & Feedback
**Description**: Add clear confirmations after user actions
**Acceptance Criteria**:
- Toast or banner confirmation after: clock on, clock off, admin actions
- Confirmations include relevant details (e.g., "Clocked on at 9:03 AM", "Shift duration: 8h 23m")
- Auto-dismiss after 3-5 seconds
- Accessible (not just visual — consider screen readers)

**Files to Create/Edit**:
- app.js (confirmation triggers)
- styles.css (toast/banner styling)
- index.html (confirmation container)

**Reference**: User Flow steps 4-5, mobile UX best practices

---

#### [ ] Task 7.4: App Performance Optimization
**Description**: Ensure fast load times on mobile networks
**Acceptance Criteria**:
- Tailwind CSS loaded via CDN (already in spec)
- No unnecessary JavaScript libraries
- Images (if any) optimized or from CDN
- Initial page load < 3 seconds on 3G
- Minimal layout shift on load

**Files to Create/Edit**:
- index.html (optimize script loading order)
- All JS files (remove unused code, minimize DOM manipulation)

**Reference**: Technical Decisions — "No build step needed, fast load"

---

### Phase 8: Deployment

#### [ ] Task 8.1: GitHub Pages Deployment Setup
**Description**: Configure repository for GitHub Pages hosting
**Acceptance Criteria**:
- GitHub repository settings configured for Pages
- Deploy branch set (main/master)
- HTTPS enabled (automatic with Pages)
- Custom domain optional (document if used)
- Deployment successful — site accessible via GitHub Pages URL

**Files to Create/Edit**:
- README.md (deployment instructions)
- GitHub repository settings (manual step)

**Reference**: Hosting section — "Static site on GitHub Pages"

---

#### [ ] Task 8.2: Environment Configuration Documentation
**Description**: Document Supabase credentials setup for deployment
**Acceptance Criteria**:
- .env.example file with SUPABASE_URL and SUPABASE_ANON_KEY
- README.md explains how to create .env.js or inline config
- Credentials NOT committed to repository
- Instructions for updating credentials in deployed site

**Files to Create/Edit**:
- .env.example
- README.md (configuration section)
- db.js (document where to insert credentials)

**Reference**: Supabase Project Setup, Security best practices

---

#### [ ] Task 8.3: Production Testing Checklist
**Description**: Verify all features work in deployed environment
**Acceptance Criteria**:
- [ ] PIN auth works on deployed site
- [ ] Clock on/off creates records in Supabase
- [ ] ±10 minute window enforced (test with time picker)
- [ ] Staff can only see their own shifts (RLS verified)
- [ ] Admin panel accessible only to admin role
- [ ] Export CSV downloads correctly
- [ ] Mobile browsers tested (iOS Safari, Android Chrome)
- [ ] No console errors in production

**Files to Create/Edit**:
- README.md (testing checklist)
- Manual testing (document results)

**Reference**: Success Criteria section

---

## Quality Requirements

- [ ] All time adjustments enforce ±10 minute window client-side AND server-side
- [ ] Supabase RLS policies prevent staff from accessing other staff's data
- [ ] No background processes — all client-side JavaScript
- [ ] Mobile responsive design required (test on actual devices)
- [ ] PIN authentication works reliably
- [ ] Audit log captures all admin adjustments
- [ ] GitHub Pages deployment with no build step
- [ ] Works on iOS Safari and Android Chrome

## Technical Notes

**Development Stack**: Vanilla JavaScript, Tailwind CSS (CDN), Supabase (PostgreSQL + REST API + RLS), GitHub Pages
**Special Instructions**:
- Time window enforcement must be server-side (Supabase RPC function) to prevent API bypass
- PINs should be hashed before storing (use Supabase pgcrypto or hash in JS before insert)
- No build step — pure static files deployed via git push
- Session persistence via localStorage for mobile convenience

**Timeline Expectations**: 
- Phase 1-2 (Setup + Database): 1-2 days
- Phase 3-4 (Auth + Core Feature): 2-3 days
- Phase 5-6 (History + Admin): 2-3 days
- Phase 7-8 (Polish + Deploy): 1-2 days
- **Total**: ~6-10 days for functional MVP, iterative improvements after

## Out of Scope (Do Not Implement)

- Payroll calculations
- Schedule/roster management
- Photo/geo verification
- Multi-location support
- Email notifications

**Reference**: Out of Scope section of specification
