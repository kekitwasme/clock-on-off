# Clock-On / Clock-Off Web App — Project Specification

## Overview
A simple, mobile-friendly web app for small restaurant staff to record their start and finish work times. Hosted on GitHub Pages with data stored in a free remote database.

## Core Requirements

### Clock-On / Clock-Off
- Staff can **clock on** (record start time) and **clock off** (record finish time) **separately**
- When clocking on or off, the **current time is used** — staff cannot freely pick a time
- A **grace window of ±10 minutes** from app launch: staff may adjust the recorded time only within 10 minutes before or after the moment they open the app (prevents gaming, allows for "I forgot to clock in right away")
- Clear visual state: show whether staff are currently "clocked on" or "clocked off"

### Time Recording
- Each record stores: staff name/ID, clock-on timestamp, clock-off timestamp
- If staff forget to clock off, the shift shows as "open/active" until they do
- Staff can view their own recent shifts (last 7 days minimum)

### Data Storage — Free & Reliable
- Use **Supabase** (free tier): PostgreSQL database, REST API, row-level security
- Free tier: 500MB storage, 50K rows, plenty for a small restaurant
- Alternative considered: Firebase (free tier 1GB, but Firestore has query limitations)
- **Supabase chosen** for: SQL flexibility, row-level security, generous free tier, easy REST API

### Authentication & Security
- Simple PIN-based auth for staff (4-6 digit PIN per staff member)
- Manager/admin can view all staff records
- Supabase Row-Level Security (RLS): staff can only see/edit their own records
- No Google/Firebase auth complexity — keep it dead simple for restaurant staff

### Hosting
- Static site on **GitHub Pages** (free, reliable, HTTPS by default)
- Single Page Application (SPA) — all logic client-side
- Mobile-first responsive design (staff will use phones)

### Staff Management (Admin)
- Admin can add/remove staff, set PINs
- Admin can view all timesheets, export data
- Admin can manually adjust times if needed (with audit log)

## Technical Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Frontend | Vanilla JS + Tailwind CSS (CDN) | No build step needed for GitHub Pages, fast load |
| Database | Supabase (free tier) | Free, reliable, SQL, REST API, RLS |
| Auth | Simple PIN + Supabase RLS | Easy for staff, secure enough for timesheets |
| Hosting | GitHub Pages | Free, HTTPS, reliable |
| Build | None — pure static files | Zero complexity, deploy by git push |

## Constraints
- Must work on mobile browsers (Safari, Chrome on iOS/Android)
- No app store needed — web app only
- All data in Supabase free tier limits (500MB, 50K MAU)
- Staff should be able to use it in under 10 seconds
- ±10 minute adjustment window strictly enforced server-side (Supabase function)

## Out of Scope
- Payroll calculations
- Schedule/roster management
- Photo/geo verification
- Multi-location support
- Email notifications

## File Structure (Expected)
```
/index.html          — Main SPA shell
/app.js              — Core app logic (clock on/off, time window enforcement)
/auth.js             — PIN login, session management
/db.js               — Supabase client, queries
/admin.js            — Admin panel logic
/styles.css          — Custom styles (Tailwind via CDN for utility classes)
/supabase/           — SQL migrations & RLS policies (reference, not deployed as static)
```

## Supabase Schema (Draft)
```sql
-- Staff table
staff (
  id uuid PK DEFAULT gen_random_uuid(),
  name text NOT NULL,
  pin text NOT NULL UNIQUE,  -- hashed
  role text DEFAULT 'staff',  -- 'staff' | 'admin'
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Shifts table
shifts (
  id uuid PK DEFAULT gen_random_uuid(),
  staff_id uuid REFERENCES staff(id),
  clock_in timestamptz NOT NULL,
  clock_out timestamptz,
  clock_in_adjusted boolean DEFAULT false,  -- was the time manually adjusted within window?
  clock_out_adjusted boolean DEFAULT false,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Audit log for admin adjustments
audit_log (
  id uuid PK DEFAULT gen_random_uuid(),
  admin_id uuid REFERENCES staff(id),
  target_staff_id uuid REFERENCES staff(id),
  shift_id uuid REFERENCES shifts(id),
  action text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz DEFAULT now()
);
```

## Time Window Enforcement
- When staff opens app and taps "Clock On" or "Clock Off":
  - Default time = `now()` (server time from Supabase)
  - Staff can adjust the time picker, but:
    - Minimum = `now() - 10 minutes`
    - Maximum = `now() + 10 minutes`
  - UI enforces this client-side
  - **Supabase RPC function** enforces this server-side (prevents API bypass)
  - If submitted time outside window → rejected by server

## User Flow
1. Staff opens app → PIN entry screen
2. Enter PIN → authenticated, see current status (clocked on/off)
3. If clocked off → "Clock On" button prominent, time picker (default now, ±10min)
4. If clocked on → "Clock Off" button prominent, shows shift duration, time picker
5. After action → confirmation, updated status
6. Staff can tap "My Shifts" to see recent records
7. Admin PIN → sees admin panel (all staff, all shifts, export)

## Success Criteria
- Staff can clock on/off in under 10 seconds
- Times cannot be manipulated beyond ±10 minute window
- Data persists reliably in Supabase
- Works on any mobile browser
- Deployed to GitHub Pages with no build step