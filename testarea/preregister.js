/*
 * ============================================================
 * preregister.js — shared Pre-Registration widget
 * ============================================================
 * Drop this file into any React (CDN/no-build) page that already
 * loads React, ReactDOM, and the Supabase JS client, e.g.:
 *
 *   <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
 *   <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="preregister.js"></script>
 *
 * USAGE
 * -----
 * 1. Mount the Provider ONCE, anywhere in your React tree:
 *
 *      e(window.PreRegisterWidget.Provider)
 *
 *    It renders (only when relevant): a slim "who you're
 *    pre-registering as" bar fixed to the top of the viewport,
 *    the confirm/temp-profile modals, and a floating toast.
 *
 * 2. Wire up any "Pre-Register" button to call:
 *
 *      window.PreRegisterWidget.trigger({ idKey: '0472', title: 'Session name' })
 *
 *    idKey  -> the Session ID Key (required, written to Supabase)
 *    title  -> human-readable session name, used only in the
 *              confirmation toast copy (optional)
 *
 * WHAT IT DOES
 * ------------
 *  - Looks for an existing on-device profile (the same
 *    localStorage profile the Register page creates —
 *    'iat_profiles' / 'iat_active_profile_id'). Read-only: this
 *    file never edits or creates a permanent device profile.
 *  - If found, asks the teacher to confirm Name / Email / School
 *    are accurate.
 *  - If not accurate (or no device profile exists at all), shows
 *    a small 3-field form (Name, Email, District > School) to
 *    create a TEMPORARY profile, used for pre-registration only.
 *  - Either way, once a profile is loaded for this pre-
 *    registration session it's remembered for the rest of the
 *    browser tab (sessionStorage) — further Pre-Register clicks
 *    just fire off the Supabase write and show a confirmation
 *    toast, no re-asking.
 *  - Writes { id_key, name, email, school } to the
 *    `session_pre_registrations` Supabase table.
 *
 * REQUIRED SUPABASE TABLE (create this once — kept intentionally
 * minimal; a future phase may add a way for a profile to look up
 * which sessions it has pre-registered for, at which point an
 * index on `email` will help):
 *
 *   create table session_pre_registrations (
 *     id         bigint generated always as identity primary key,
 *     id_key     text not null,
 *     name       text not null,
 *     email      text not null,
 *     school     text not null,
 *     created_at timestamptz not null default now(),
 *     unique (id_key, email)
 *   );
 *
 * The unique constraint is what lets this file safely "always
 * insert" — a duplicate click/session just gets rejected by
 * Postgres (error code 23505) and is treated as an already-
 * registered success rather than a fresh error.
 * ============================================================
 */
(function () {
    const { useState, useEffect, useMemo, useRef, useCallback } = React;
    const e = React.createElement;

    // ------------------------------------------------------------
    // SUPABASE CONFIG — same project as Register / My PD app
    // ------------------------------------------------------------
    const SUPABASE_URL = 'https://cftpufjzwpmhgzdcgpjb.supabase.co';
    const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_b1H_5DJYLQSrr83T_dvz6A_2UAqOVg4';
    const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

    const PREREG_TABLE = 'session_pre_registrations';
    const UNIQUE_VIOLATION = '23505';

    // ------------------------------------------------------------
    // Device profile (read-only) — same storage keys/shape as the
    // Register page. This file never writes to these keys.
    // ------------------------------------------------------------
    const DEVICE_PROFILES_KEY = 'iat_profiles';
    const DEVICE_ACTIVE_PROFILE_KEY = 'iat_active_profile_id';

    // Pre-registration's own (temporary, tab-scoped) profile.
    const SESSION_PROFILE_KEY = 'iat_prereg_session_profile';

    function readDeviceProfile() {
        try {
            const raw = localStorage.getItem(DEVICE_PROFILES_KEY);
            const profiles = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(profiles) || profiles.length === 0) return null;
            const activeId = localStorage.getItem(DEVICE_ACTIVE_PROFILE_KEY);
            const found = profiles.find(p => p.id === activeId) || profiles[0];
            if (!found || !found.email || !found.school) return null;
            return {
                firstName: found.firstName || '',
                surname: found.surname || '',
                email: found.email || '',
                school: found.school || ''
            };
        } catch (err) {
            console.error('preregister.js: could not read device profile', err);
            return null;
        }
    }

    function loadSessionProfile() {
        try {
            const raw = sessionStorage.getItem(SESSION_PROFILE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (err) {
            console.error('preregister.js: could not read session profile', err);
            return null;
        }
    }

    function saveSessionProfile(profile) {
        try {
            sessionStorage.setItem(SESSION_PROFILE_KEY, JSON.stringify(profile));
        } catch (err) {
            console.error('preregister.js: could not save session profile', err);
        }
    }

    function clearSessionProfile() {
        try {
            sessionStorage.removeItem(SESSION_PROFILE_KEY);
        } catch (err) {
            console.error('preregister.js: could not clear session profile', err);
        }
    }

    function isValidEmail(value) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((value || '').trim());
    }

    // ------------------------------------------------------------
    // Schools (District > School cascade) — same table/columns as
    // the Register page, fetched lazily only when the temp-profile
    // form is actually opened.
    // ------------------------------------------------------------
    const SCHOOLS_TABLE_NAME = 'schools';
    const SCHOOL_NAME_COLUMN = 'School_Name';
    const DISTRICT_COLUMN = 'Education_District';
    const STATIC_DISTRICT_OPTIONS = ['HEAD OFFICE', 'NOT APPLICABLE'];
    const NON_SCHOOL_OPTIONS = ['Not Applicable', 'School not in list'];

    async function fetchAllRows(table, columns, pageSize = 1000) {
        let all = [];
        let from = 0;
        while (true) {
            const { data, error } = await supabaseClient
                .from(table)
                .select(columns)
                .range(from, from + pageSize - 1);
            if (error) throw error;
            if (!data || data.length === 0) break;
            all = all.concat(data);
            if (data.length < pageSize) break;
            from += pageSize;
        }
        return all;
    }

    // ------------------------------------------------------------
    // Small UI primitives (kept local to this file so it has no
    // dependency on whatever form components the host page uses)
    // ------------------------------------------------------------
    function Modal({ onClose, children }) {
        return e('div', {
            className: 'fixed inset-0 bg-black/50 flex items-center justify-center px-4 z-[10000]',
            onClick: onClose
        },
            e('div', {
                className: 'bg-white rounded-2xl shadow-xl p-6 sm:p-7 max-w-sm w-full',
                onClick: (ev) => ev.stopPropagation()
            }, children)
        );
    }

    function TextField({ label, value, onChange, placeholder, type = 'text', required = false, error }) {
        const hasError = !!error;
        return e('div', { className: 'mb-4' },
            e('label', { className: 'block text-sm font-semibold text-gray-700 mb-1' }, label, required ? e('span', { className: 'text-[#BA0C2F]' }, ' *') : null),
            e('input', {
                type, value, placeholder,
                onChange: (ev) => onChange(ev.target.value),
                className: `w-full px-3.5 py-2.5 rounded-lg border-2 focus:outline-none text-sm transition-colors ${hasError ? 'border-[#BA0C2F]' : 'border-gray-200 focus:border-[#007DBA]'}`
            }),
            hasError ? e('p', { className: 'text-xs text-[#BA0C2F] mt-1 font-medium' }, error) : null
        );
    }

    function SelectField({ label, value, onChange, options, required = false, placeholder = 'Select…', disabled = false, error }) {
        const hasError = !!error;
        return e('div', { className: 'mb-4' },
            e('label', { className: 'block text-sm font-semibold text-gray-700 mb-1' }, label, required ? e('span', { className: 'text-[#BA0C2F]' }, ' *') : null),
            e('select', {
                value, disabled,
                onChange: (ev) => onChange(ev.target.value),
                className: `w-full px-3.5 py-2.5 rounded-lg border-2 focus:outline-none text-sm bg-white transition-colors disabled:bg-gray-100 ${hasError ? 'border-[#BA0C2F]' : 'border-gray-200 focus:border-[#007DBA]'}`
            },
                e('option', { value: '' }, placeholder),
                options.map(opt => e('option', { key: opt, value: opt }, opt))
            ),
            hasError ? e('p', { className: 'text-xs text-[#BA0C2F] mt-1 font-medium' }, error) : null
        );
    }

    // Lightweight type-to-search select for the School field.
    function SearchableSelect({ label, options, loading, error, value, onChange, required = false, disabledMessage = 'Select a district first', validationError }) {
        const [query, setQuery] = useState('');
        const [open, setOpen] = useState(false);
        const wrapperRef = useRef(null);

        useEffect(() => {
            function handleClickOutside(ev) {
                if (wrapperRef.current && !wrapperRef.current.contains(ev.target)) setOpen(false);
            }
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }, []);

        const filtered = useMemo(() => {
            if (!query) return options.slice(0, 100);
            return options.filter(o => o.toLowerCase().includes(query.toLowerCase())).slice(0, 100);
        }, [options, query]);

        const disabled = loading || !!error || options.length === 0;
        const hasValidationError = !!validationError;

        return e('div', { className: 'mb-4 relative', ref: wrapperRef },
            e('label', { className: 'block text-sm font-semibold text-gray-700 mb-1' }, label, required ? e('span', { className: 'text-[#BA0C2F]' }, ' *') : null),
            e('input', {
                type: 'text',
                value: open ? query : (value || ''),
                placeholder: loading ? 'Loading…' : (disabled ? disabledMessage : 'Start typing to search…'),
                disabled,
                onFocus: () => { setQuery(''); setOpen(true); },
                onChange: (ev) => setQuery(ev.target.value),
                className: `w-full px-3.5 py-2.5 rounded-lg border-2 focus:outline-none text-sm disabled:bg-gray-100 transition-colors ${hasValidationError ? 'border-[#BA0C2F]' : 'border-gray-200 focus:border-[#007DBA]'}`
            }),
            error ? e('p', { className: 'text-xs text-[#BA0C2F] mt-1' }, error)
                : (hasValidationError ? e('p', { className: 'text-xs text-[#BA0C2F] mt-1 font-medium' }, validationError) : null),
            open && !disabled ? e('div', { className: 'absolute z-10 mt-1 w-full max-h-48 overflow-y-auto bg-white border-2 border-gray-200 rounded-lg shadow-lg' },
                filtered.length === 0
                    ? e('div', { className: 'px-3.5 py-2.5 text-sm text-gray-400' }, 'No matching options')
                    : filtered.map((o, idx) => e('button', {
                        key: idx, type: 'button',
                        onClick: () => { onChange(o); setOpen(false); },
                        className: 'block w-full text-left px-3.5 py-2 text-sm hover:bg-blue-50 border-b border-gray-100 last:border-b-0'
                    }, o))
            ) : null
        );
    }

    // ------------------------------------------------------------
    // Confirmation modal: "is this you?"
    // ------------------------------------------------------------
    function ConfirmModal({ profile, onConfirm, onReject }) {
        const fullName = `${profile.firstName} ${profile.surname}`.trim();
        return e(Modal, { onClose: onReject },
            e('h3', { className: 'text-lg font-bold text-gray-900 mb-1' }, 'Confirm your details'),
            e('p', { className: 'text-sm text-gray-500 mb-4' }, "We'll use this to pre-register you for the session."),
            e('dl', { className: 'text-sm text-gray-700 space-y-2 mb-6' },
                e('div', null, e('dt', { className: 'text-xs font-semibold uppercase tracking-wide text-gray-400' }, 'Name'), e('dd', { className: 'font-medium text-gray-900' }, fullName || '—')),
                e('div', null, e('dt', { className: 'text-xs font-semibold uppercase tracking-wide text-gray-400' }, 'Email'), e('dd', { className: 'font-medium text-gray-900' }, profile.email || '—')),
                e('div', null, e('dt', { className: 'text-xs font-semibold uppercase tracking-wide text-gray-400' }, 'School'), e('dd', { className: 'font-medium text-gray-900' }, profile.school || '—'))
            ),
            e('div', { className: 'flex gap-3' },
                e('button', {
                    type: 'button', onClick: onReject,
                    className: 'flex-1 px-3 py-2.5 rounded-lg font-semibold text-sm border-2 border-gray-300 text-gray-600 hover:border-gray-400 transition-colors'
                }, "That's not right"),
                e('button', {
                    type: 'button', onClick: onConfirm,
                    className: 'flex-1 px-3 py-2.5 rounded-lg font-bold text-sm text-white bg-[#8FAD15] hover:brightness-95 transition-colors'
                }, "Yes, that's me")
            )
        );
    }

    // ------------------------------------------------------------
    // Temporary profile form: Name, Email, District > School
    // ------------------------------------------------------------
    function TempProfileModal({ schools, schoolsLoading, schoolsError, onSubmit, onClose }) {
        const [firstName, setFirstName] = useState('');
        const [surname, setSurname] = useState('');
        const [email, setEmail] = useState('');
        const [district, setDistrict] = useState('');
        const [school, setSchool] = useState('');
        const [attempted, setAttempted] = useState(false);

        const districtOptions = useMemo(() => {
            const real = Array.from(new Set(schools.map(s => s.district).filter(Boolean))).sort((a, b) => a.localeCompare(b));
            return [...real, ...STATIC_DISTRICT_OPTIONS];
        }, [schools]);

        const schoolOptions = useMemo(() => {
            if (!district) return [];
            if (district === 'HEAD OFFICE' || district === 'NOT APPLICABLE') return NON_SCHOOL_OPTIONS;
            const inDistrict = schools.filter(s => s.district === district).map(s => s.name).filter(Boolean).sort((a, b) => a.localeCompare(b));
            return ['District Officials', ...inDistrict, 'School not in list'];
        }, [district, schools]);

        const errors = {
            firstName: !firstName.trim() ? 'First name is required' : undefined,
            surname: !surname.trim() ? 'Surname is required' : undefined,
            email: !email.trim() ? 'Email is required' : (!isValidEmail(email) ? 'Enter a valid email address' : undefined),
            district: !district ? 'Please select a district' : undefined,
            school: !school ? 'Please select a school' : undefined
        };
        const hasErrors = Object.values(errors).some(Boolean);

        const handleSubmit = () => {
            setAttempted(true);
            if (hasErrors) return;
            onSubmit({ firstName, surname, email, school });
        };

        return e(Modal, { onClose },
            e('h3', { className: 'text-lg font-bold text-gray-900 mb-1' }, 'Quick pre-registration'),
            e('p', { className: 'text-sm text-gray-500 mb-4' }, "Just this once — these details won't be saved as a device profile."),
            e('div', { className: 'grid grid-cols-1 sm:grid-cols-2 gap-x-3' },
                e(TextField, { label: 'First Name', value: firstName, onChange: setFirstName, required: true, error: attempted ? errors.firstName : undefined }),
                e(TextField, { label: 'Surname', value: surname, onChange: setSurname, required: true, error: attempted ? errors.surname : undefined })
            ),
            e(TextField, { label: 'Email Address', value: email, onChange: setEmail, type: 'email', required: true, placeholder: 'name@example.com', error: attempted ? errors.email : undefined }),
            e(SelectField, {
                label: 'District', value: district, onChange: (v) => { setDistrict(v); setSchool(''); },
                options: districtOptions, required: true,
                placeholder: schoolsLoading ? 'Loading districts…' : 'Select district…',
                error: attempted ? errors.district : undefined
            }),
            e(SearchableSelect, {
                label: 'School', options: schoolOptions, loading: schoolsLoading, error: schoolsError,
                value: school, onChange: setSchool, required: true,
                disabledMessage: district ? 'No schools found for this district' : 'Select a district first',
                validationError: attempted ? errors.school : undefined
            }),
            e('div', { className: 'flex gap-3 mt-2' },
                e('button', {
                    type: 'button', onClick: onClose,
                    className: 'flex-1 px-3 py-2.5 rounded-lg font-semibold text-sm border-2 border-gray-300 text-gray-600 hover:border-gray-400 transition-colors'
                }, 'Cancel'),
                e('button', {
                    type: 'button', onClick: handleSubmit,
                    className: 'flex-1 px-3 py-2.5 rounded-lg font-bold text-sm text-white bg-[#001489] hover:brightness-110 transition-colors'
                }, 'Pre-Register')
            )
        );
    }

    // ------------------------------------------------------------
    // Top banner — shows the loaded (real or temp) profile
    // ------------------------------------------------------------
    function Banner({ profile, onSwitch }) {
        return e('div', { className: 'fixed top-0 inset-x-0 z-[9998] bg-[#001489] text-white text-xs sm:text-sm shadow-md' },
            e('div', { className: 'max-w-5xl mx-auto px-4 py-2 flex items-center gap-2 flex-wrap' },
                e('svg', { xmlns: 'http://www.w3.org/2000/svg', width: '14', height: '14', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2.5', strokeLinecap: 'round', strokeLinejoin: 'round', className: 'flex-shrink-0' },
                    e('path', { d: 'M20 6 9 17l-5-5' })
                ),
                e('span', null,
                    'Pre-registering as ',
                    e('strong', null, profile.name),
                    profile.school ? e(React.Fragment, null, ' · ', profile.school) : null
                ),
                e('button', {
                    type: 'button', onClick: onSwitch,
                    className: 'ml-auto underline underline-offset-2 hover:text-blue-200 transition-colors font-medium'
                }, 'Not you? Switch')
            )
        );
    }

    // ------------------------------------------------------------
    // Floating toast (success / error)
    // ------------------------------------------------------------
    function Toast({ toast }) {
        if (!toast) return null;
        const isError = toast.kind === 'error';
        return e('div', {
            className: `fixed bottom-6 left-1/2 -translate-x-1/2 z-[10001] px-4 py-3 rounded-xl shadow-lg text-sm font-semibold flex items-center gap-2 max-w-[90vw] ${isError ? 'bg-[#BA0C2F] text-white' : 'bg-[#8FAD15] text-white'}`
        },
            e('svg', { xmlns: 'http://www.w3.org/2000/svg', width: '18', height: '18', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2.5', strokeLinecap: 'round', strokeLinejoin: 'round', className: 'flex-shrink-0' },
                isError ? e('circle', { cx: '12', cy: '12', r: '10' }) : e('path', { d: 'M20 6 9 17l-5-5' }),
                isError ? e('line', { x1: '12', y1: '8', x2: '12', y2: '12' }) : null,
                isError ? e('line', { x1: '12', y1: '16', x2: '12.01', y2: '16' }) : null
            ),
            e('span', null, toast.text)
        );
    }

    // ------------------------------------------------------------
    // Provider — mount once. Holds all state, exposes `trigger`.
    // ------------------------------------------------------------
    let triggerImpl = null;

    function Provider() {
        const [profile, setProfile] = useState(() => loadSessionProfile());
        const [modal, setModal] = useState(null); // null | 'confirm' | 'tempForm'
        const [candidateDeviceProfile, setCandidateDeviceProfile] = useState(null);
        const [pendingSession, setPendingSession] = useState(null);
        const [toast, setToast] = useState(null);

        const [schools, setSchools] = useState([]);
        const [schoolsLoading, setSchoolsLoading] = useState(false);
        const [schoolsError, setSchoolsError] = useState(null);
        const schoolsFetchedRef = useRef(false);

        const toastTimerRef = useRef(null);
        const showToast = useCallback((kind, text) => {
            if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
            setToast({ kind, text });
            toastTimerRef.current = setTimeout(() => setToast(null), 3500);
        }, []);

        async function ensureSchoolsLoaded() {
            if (schoolsFetchedRef.current) return;
            schoolsFetchedRef.current = true;
            setSchoolsLoading(true);
            setSchoolsError(null);
            try {
                const rows = await fetchAllRows(SCHOOLS_TABLE_NAME, `${SCHOOL_NAME_COLUMN}, ${DISTRICT_COLUMN}`);
                const cleaned = rows.map(row => ({ name: row[SCHOOL_NAME_COLUMN], district: row[DISTRICT_COLUMN] })).filter(row => !!row.name);
                setSchools(cleaned);
            } catch (err) {
                console.error('preregister.js: error fetching schools', err);
                setSchoolsError('Could not load the school list. Please try again shortly.');
                schoolsFetchedRef.current = false;
            } finally {
                setSchoolsLoading(false);
            }
        }

        const performRegister = useCallback(async (activeProfile, session) => {
            try {
                const { error } = await supabaseClient.from(PREREG_TABLE).insert({
                    id_key: (session.idKey || '').toString().trim(),
                    name: activeProfile.name,
                    email: activeProfile.email,
                    school: activeProfile.school
                });
                if (error) {
                    if (error.code === UNIQUE_VIOLATION) {
                        showToast('success', `You're already pre-registered for ${session.title || 'this session'}.`);
                        return;
                    }
                    throw error;
                }
                showToast('success', `You're pre-registered for ${session.title || 'this session'}!`);
            } catch (err) {
                console.error('preregister.js: registration failed', err);
                showToast('error', 'Something went wrong. Please try again.');
            }
        }, [showToast]);

        const handleTrigger = useCallback((session) => {
            if (!session || !session.idKey) {
                console.error('preregister.js: trigger() called without a session idKey');
                return;
            }
            if (profile) {
                performRegister(profile, session);
                return;
            }
            const device = readDeviceProfile();
            setPendingSession(session);
            if (device) {
                setCandidateDeviceProfile(device);
                setModal('confirm');
            } else {
                ensureSchoolsLoaded();
                setModal('tempForm');
            }
        }, [profile, performRegister]);

        useEffect(() => {
            triggerImpl = handleTrigger;
            return () => { if (triggerImpl === handleTrigger) triggerImpl = null; };
        }, [handleTrigger]);

        const handleConfirmYes = () => {
            const p = {
                source: 'device',
                name: `${candidateDeviceProfile.firstName} ${candidateDeviceProfile.surname}`.trim(),
                email: candidateDeviceProfile.email,
                school: candidateDeviceProfile.school
            };
            setProfile(p);
            saveSessionProfile(p);
            setModal(null);
            performRegister(p, pendingSession);
        };

        const handleConfirmNo = () => {
            ensureSchoolsLoaded();
            setModal('tempForm');
        };

        const handleTempFormSubmit = (fields) => {
            const p = {
                source: 'temp',
                name: `${fields.firstName.trim()} ${fields.surname.trim()}`.trim(),
                email: fields.email.trim(),
                school: fields.school
            };
            setProfile(p);
            saveSessionProfile(p);
            setModal(null);
            performRegister(p, pendingSession);
        };

        const handleSwitch = () => {
            setProfile(null);
            clearSessionProfile();
        };

        return e(React.Fragment, null,
            profile ? e(Banner, { profile, onSwitch: handleSwitch }) : null,
            modal === 'confirm' && candidateDeviceProfile ? e(ConfirmModal, {
                profile: candidateDeviceProfile,
                onConfirm: handleConfirmYes,
                onReject: handleConfirmNo
            }) : null,
            modal === 'tempForm' ? e(TempProfileModal, {
                schools, schoolsLoading, schoolsError,
                onSubmit: handleTempFormSubmit,
                onClose: () => setModal(null)
            }) : null,
            e(Toast, { toast })
        );
    }

    window.PreRegisterWidget = {
        Provider,
        trigger: (session) => {
            if (triggerImpl) {
                triggerImpl(session);
            } else {
                console.warn('preregister.js: trigger() called before <PreRegisterWidget.Provider> mounted');
            }
        }
    };
})();
