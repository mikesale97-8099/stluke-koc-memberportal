/*
 * Member Center sign-in pass, kept on this device.
 * - "Keep me signed in" stores it in localStorage (survives closing the browser);
 *   otherwise sessionStorage (ends when the browser closes).
 * - The pass is signed by the Apps Script. Pages read who is signed in from it;
 *   every change is checked by the Apps Script, which only trusts its own signature.
 * - Remembered passes are renewed at most once a day, which restarts the 90 days.
 */
const MC_ENDPOINT = KOC_CONFIG.endpoint;   // set in config.js
const MC_KEY = 'mcSession';
const MC_TOOLS_KEY = 'mcAdminTools';

/* ?admin=on / ?admin=off switches admin tools on this device, then tidies the address.
   This only changes what's shown; admin rights come from the signed-in email. */
(function () {
    const params = new URLSearchParams(window.location.search);
    const v = (params.get('admin') || '').toLowerCase();
    if (v !== 'on' && v !== 'off') return;
    try { v === 'on' ? localStorage.setItem(MC_TOOLS_KEY, 'on') : localStorage.removeItem(MC_TOOLS_KEY); } catch (e) {}
    params.delete('admin');
    const q = params.toString();
    history.replaceState(null, '', window.location.pathname + (q ? '?' + q : '') + window.location.hash);
})();

const Session = {
    _store(kind) {
        try { return kind === 'local' ? window.localStorage : window.sessionStorage; } catch (e) { return null; }
    },
    _payload(token) {
        try {
            const p = String(token).split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
            return JSON.parse(atob(p));
        } catch (e) { return null; }
    },
    read() {
        for (const kind of ['local', 'session']) {
            const store = this._store(kind);
            const raw = store && store.getItem(MC_KEY);
            if (!raw) continue;
            try {
                const s = JSON.parse(raw);
                const p = this._payload(s.token);
                if (p && p.exp > Date.now()) return s;
            } catch (e) { /* fall through and clear */ }
            store.removeItem(MC_KEY);
        }
        return null;
    },
    save(reply) {
        const s = {
            token: reply.token, memberNumber: reply.memberNumber, firstName: reply.firstName || '',
            admin: !!reply.admin, remember: !!reply.remember, renewedAt: Date.now()
        };
        this.clear();
        const store = this._store(s.remember ? 'local' : 'session');
        if (store) store.setItem(MC_KEY, JSON.stringify(s));
        return s;
    },
    clear() {
        ['local', 'session'].forEach(k => { const st = this._store(k); if (st) st.removeItem(MC_KEY); });
    },
    token() { const s = this.read(); return s ? s.token : ''; },
    isAdmin() { const s = this.read(); return !!(s && s.admin); },
    /** Admin tools show only for an admin who has switched them on for this device (?admin=on). */
    adminTools() {
        if (!this.isAdmin()) return false;
        try { return localStorage.getItem(MC_TOOLS_KEY) === 'on'; } catch (e) { return false; }
    },
    /** The member this page should show: the signed-in member, or (admin only) the one in ?member= */
    pageMember() {
        const s = this.read();
        if (!s) return null;
        const asked = new URLSearchParams(window.location.search).get('member');
        return (this.adminTools() && asked) ? asked : s.memberNumber;
    },
    /** Ask the Apps Script to confirm and renew a remembered pass (at most once a day). */
    async renew(force) {
        const s = this.read();
        if (!s || !s.remember) return s;
        if (!force && Date.now() - (s.renewedAt || 0) < 864e5) return s;
        try {
            const res = await fetch(MC_ENDPOINT, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'session', token: s.token })
            });
            const data = await res.json();
            if (data && data.success) return this.save(data);
            if (data && data.error === 'not_signed_in') { this.clear(); return null; }
        } catch (e) { /* offline or slow: keep the current pass */ }
        return s;
    },
    signOut() {
        this.clear();
        try { localStorage.removeItem(MC_TOOLS_KEY); } catch (e) {}
        try { localStorage.removeItem('mcLastEmail'); } catch (e) {}
        window.location.href = 'landing.html';
    }
};

/* Every "Sign out" link forgets this device. */
document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a.signout');
    if (a) { e.preventDefault(); Session.signOut(); }
});
