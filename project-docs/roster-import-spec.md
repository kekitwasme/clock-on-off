The user wants to import roster data from Google Sheets into the clock-on-off app. This is a great feature for a restaurant owner like Admin.

Key considerations:
1. Google Sheets API requires OAuth2 authentication - complex to implement in a static GitHub Pages app
2. Manual sync (CSV export/import) is much simpler and more reliable
3. The roster table already exists with: staff_id, roster_date, start_time, end_time, notes
4. Need to match staff by name (since Google Sheets would have names, not UUIDs)
5. Need to handle duplicate entries (same staff + date = update, not insert)
6. Need validation: start_time < end_time, staff exists and is active

Best approach:
- Add a "Import from CSV" button in the Admin Panel Roster view
- CSV format: Name, Date (YYYY-MM-DD), Start Time (HH:MM), End Time (HH:MM), Notes (optional)
- Parse CSV in browser
- Match staff names to staff IDs
- Batch insert/update via existing `create_roster_entry` and `update_roster_entry` RPCs
- Show preview before import
- Show success/error summary

For Google Sheets integration:
- Could use Google Sheets API with a service account, but that's complex
- Simpler: Provide a Google Sheets template + instructions, user copies data and pastes as CSV
- Even simpler: Direct CSV upload from Google Sheets export

I'll implement:
1. CSV import feature in admin.js
2. Update index.html with import UI
3. Update styles.css for import modal
4. Provide a Google Sheets template link

This is straightforward frontend work. I'll do it myself efficiently.
