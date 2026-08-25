/**
 * shared.js
 *
 * Code shared between register.html (attendance capture) and
 * pre-register.html (session pre-registration), so both tools read/
 * write the same device profile and use one copy of the Supabase
 * config, session-table constants, and identity/date helpers.
 *
 * Load this BEFORE each file's own inline <script> block:
 *   <script src="shared.js"></script>
 *   <script> ...page-specific code... </script>
 *
 * Note: top-level `const`/`let` declared in one classic <script> tag
 * ARE visible to later <script> tags in the same HTML document (this
 * is standard browser behaviour, not a module system) — so anything
 * declared here is just directly usable by name in the page's own
 * script block afterwards. Don't redeclare any of these names there.
 */

const { useState, useEffect, useMemo, useRef } = React;
const e = React.createElement;

// ============================================================
// SUPABASE CONFIG — same project as the My PD app
// ============================================================
const SUPABASE_URL = 'https://cftpufjzwpmhgzdcgpjb.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_b1H_5DJYLQSrr83T_dvz6A_2UAqOVg4';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// ============================================================
// SESSIONS TABLE — used by both the Session ID Key lookup
// (register.html) and the upcoming-sessions list (pre-register.html)
// ============================================================
const SESSIONS_TABLE_NAME = 'sessions';
const SESSIONS_COLUMNS = 'id_key, session_title, hosting_unit, hosting_coordinator, session_date, session_start_time, facilitator, session_delivery_mode';

// Reads a query-string parameter from the current URL, e.g.
// register.html?idkey=1234 -> getQueryParam('idkey') === '1234'
function getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name) || '';
}

// South Africa is UTC+2 year-round (no DST), so the offset is
// always fixed. Rather than fight the browser's local timezone,
// we shift the current UTC epoch by +2h and then read it back
// out with the UTC getters — that gives us SAST wall-clock
// values regardless of where the device itself is set to.
function getSASTNowParts() {
    const sastMs = Date.now() + 2 * 60 * 60 * 1000;
    const d = new Date(sastMs);
    const dateString = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    return { dateString, epochMsShiftedToSAST: sastMs };
}

// Strips everything except letters/digits and uppercases, so
// formatting differences (spaces, dashes, case) between two
// submissions of the SAME actual ID number don't produce two
// different dedup keys for the same person.
function normalizeIdForDedup(value) {
    return (value || '').toString().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

// Deterministic per-(person, session) ID: PERSAL if provided,
// otherwise ID/Passport number (same priority the rest of the app
// already uses — see the "grouped by PERSAL number first…" note on
// the profile form), combined with a Session ID Key. The SAME person
// + SAME session always produces the SAME id, regardless of device,
// browser, or page reload — used both for register.html's attendance
// dedup (Apps Script side) and pre-register.html's pre_registrations
// primary key (Postgres side).
//
// TRADE-OFF: this means a genuine second submission by the same
// person for the same session is ALWAYS treated as a duplicate too,
// even if intended as a correction. If something genuinely needs to
// be corrected, that has to be done by editing the record directly,
// not by resubmitting.
function makeSubmissionId(profile, sessionKey) {
    const personId = normalizeIdForDedup(profile.persal) || normalizeIdForDedup(profile.idNumber);
    return `${personId}-${(sessionKey || '').trim()}`;
}

// ============================================================
// LOCAL "DEVICE PROFILE" STORAGE
// Not authentication — just remembers who last used this device so
// they don't have to retype their details every time. Supports more
// than one saved profile per device. Shared across every tool on
// this origin (register.html, pre-register.html, …) since
// localStorage is scoped per-origin, not per-file.
// ============================================================
const PROFILES_KEY = 'iat_profiles';
const ACTIVE_PROFILE_KEY = 'iat_active_profile_id';

function loadProfiles() {
    try {
        const raw = localStorage.getItem(PROFILES_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (err) {
        console.error('Could not read saved profiles', err);
        return [];
    }
}

function saveProfiles(profiles) {
    try {
        localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
    } catch (err) {
        console.error('Could not save profiles', err);
    }
}

function getActiveProfileId() {
    return localStorage.getItem(ACTIVE_PROFILE_KEY);
}

function setActiveProfileId(id) {
    localStorage.setItem(ACTIVE_PROFILE_KEY, id);
}

function clearActiveProfileId() {
    localStorage.removeItem(ACTIVE_PROFILE_KEY);
}

// Convenience: the currently active saved profile on this device, or
// null if none is set / it no longer exists in the saved list.
function getActiveProfile() {
    const profiles = loadProfiles();
    const activeId = getActiveProfileId();
    return profiles.find(p => p.id === activeId) || null;
}

function fullNameOf(p) {
    return `${p.firstName || ''} ${p.surname || ''}`.trim();
}
