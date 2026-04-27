// ===== Multi-Provider Temp Email Engine =====
// Providers: Mail.tm, Mail.gw
const MAX_ACCOUNTS = 5;

let accounts = [];
let activeIndex = -1;
let pollingInterval = null;
let allDomains = [];
let isPremium = false;
let notificationPermission = 'default';
let notifSoundEnabled = true;
let currentOpenMessage = null; // for export

// ===== Random US & European Person Names =====
const FIRST_NAMES = [
    'james','john','robert','michael','david','william','richard','joseph','thomas','christopher',
    'emma','olivia','sophia','isabella','charlotte','amelia','harper','evelyn','abigail','emily',
    'alexander','benjamin','daniel','matthew','andrew','lucas','henry','sebastian','jack','owen',
    'hans','klaus','dieter','friedrich','karl','stefan','wolfgang','franz','helmut','rainer',
    'pierre','jean','louis','francois','henri','antoine','nicolas','philippe','marc','olivier',
    'marco','luca','matteo','alessandro','lorenzo','giovanni','andrea','francesco','paolo','stefano',
    'elena','clara','sofia','anna','maria','laura','sara','giulia','martina','valentina',
    'erik','lars','magnus','olof','sven','nils','anders','johan','axel','viktor',
    'katarina','ingrid','astrid','freya','helga','greta','marta','rosa','ilse','liesel',
];
const LAST_NAMES = [
    'smith','johnson','williams','brown','jones','garcia','miller','davis','rodriguez','martinez',
    'wilson','anderson','taylor','thomas','jackson','white','harris','martin','thompson','moore',
    'clark','lewis','walker','hall','allen','young','king','wright','scott','green',
    'mueller','schmidt','schneider','fischer','weber','meyer','wagner','becker','hoffmann','richter',
    'dupont','moreau','laurent','bernard','lefevre','fournier','girard','bonnet','mercier','blanc',
    'rossi','russo','ferrari','esposito','bianchi','romano','colombo','ricci','marino','greco',
    'berg','lindqvist','johansson','nilsson','eriksson','larsson','olsson','persson','svensson','karlsson',
    'kowalski','nowak','mazur','krawczyk','patel','sharma','campbell','stewart','murphy','byrne',
];
function getRandomName() {
    const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
    const last  = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
    return `${first}_${last}`;
}
function rnd(len) {
    const c = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let r = '';
    for (let i = 0; i < len; i++) r += c[Math.floor(Math.random() * c.length)];
    return r;
}

// ===== DOM =====
const emailText        = document.getElementById('emailText');
const emailDisplay     = document.getElementById('emailDisplay');
const copyBtn          = document.getElementById('copyBtn');
const generateBtn      = document.getElementById('generateBtn');
const refreshBtn       = document.getElementById('refreshBtn');
const refreshIcon      = document.getElementById('refreshIcon');
const autoRefreshBadge = document.getElementById('autoRefreshBadge');
const statusRow        = document.getElementById('statusRow');
const notifCountEl     = document.getElementById('notifCount');
const inboxSection     = document.getElementById('inboxSection');
const inboxList        = document.getElementById('inboxList');
const emptyInbox       = document.getElementById('emptyInbox');
const messageCount     = document.getElementById('messageCount');
const modalOverlay     = document.getElementById('modalOverlay');
const modalSubject     = document.getElementById('modalSubject');
const modalFrom        = document.getElementById('modalFrom');
const modalDate        = document.getElementById('modalDate');
const modalBody        = document.getElementById('modalBody');
const modalClose       = document.getElementById('modalClose');
const toast            = document.getElementById('toast');
const premiumToggle    = document.getElementById('premiumToggle');
const domainSelector   = document.getElementById('domainSelector');
const domainSelect     = document.getElementById('domainSelect');
const domainCount      = document.getElementById('domainCount');
const accountTabs      = document.getElementById('accountTabs');
const accountCounter   = document.getElementById('accountCounter');
const shareBtn         = document.getElementById('shareBtn');

// ==========================================================
//  PROVIDER: Mail.tm / Mail.gw
// ==========================================================
async function mailtm_fetchDomains(base) {
    try {
        const r1 = await fetch(`${base}/domains?page=1`, { headers: { 'Content-Type': 'application/json' } });
        if (!r1.ok) return [];
        const d1 = await r1.json();
        const list = (d1['hydra:member'] || d1 || []).map(d => d.domain);
        try {
            const r2 = await fetch(`${base}/domains?page=2`, { headers: { 'Content-Type': 'application/json' } });
            if (r2.ok) { const d2 = await r2.json(); (d2['hydra:member'] || []).forEach(d => list.push(d.domain)); }
        } catch {}
        return list;
    } catch { return []; }
}
async function mailtm_createAccount(base, address, password) {
    const res = await fetch(`${base}/accounts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address, password }) });
    if (!res.ok) throw new Error(`Account creation failed (${res.status})`);
    const acc = await res.json();
    const tokRes = await fetch(`${base}/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address, password }) });
    if (!tokRes.ok) throw new Error(`Token failed (${tokRes.status})`);
    const tok = await tokRes.json();
    return { id: acc.id, token: tok.token };
}
async function mailtm_fetchMessages(base, token) {
    const res = await fetch(`${base}/messages`, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data['hydra:member'] || data || []).map(m => ({
        id: m.id, from: m.from, subject: m.subject, intro: m.intro, seen: m.seen, createdAt: m.createdAt,
    }));
}
async function mailtm_fetchMessage(base, token, id) {
    const res = await fetch(`${base}/messages/${id}`, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` } });
    if (!res.ok) throw new Error('Failed to load message');
    return res.json();
}

// ==========================================================
//  PROVIDER: Guerrilla Mail (additional free provider)
// ==========================================================
const GUERRILLA_DOMAINS = ['guerrillamailblock.com'];
const GUERRILLA_BASE_URL = 'https://api.guerrillamail.com/ajax.php';
const GUERRILLA_PROXY_CHAIN = [
    null,
    'https://corsproxy.io/?',
    'https://api.allorigins.win/raw?url=',
    'https://api.codetabs.com/v1/proxy?quest='
];

async function guerrilla_request(params) {
    const url = GUERRILLA_BASE_URL + '?' + new URLSearchParams(params).toString();
    let lastErr;
    for (const proxy of GUERRILLA_PROXY_CHAIN) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout per attempt
        try {
            const fullUrl = proxy ? proxy + encodeURIComponent(url) : url;
            const res = await fetch(fullUrl, {
                headers: { 'Accept': 'application/json' },
                signal: controller.signal,
                credentials: 'omit'
            });
            clearTimeout(timeoutId);
            if (!res.ok) { lastErr = new Error('HTTP ' + res.status); continue; }
            const text = await res.text();
            try {
                return JSON.parse(text);
            } catch {
                lastErr = new Error('Invalid JSON response');
                continue;
            }
        } catch (e) {
            clearTimeout(timeoutId);
            lastErr = e;
        }
    }
    throw lastErr || new Error('Guerrilla Mail unavailable');
}

async function guerrilla_createAccount(domain, username) {
    const init = await guerrilla_request({ f: 'get_email_address', ip: '127.0.0.1', agent: 'Mozilla', site: domain, lang: 'en' });
    let sid = init.sid_token;
    let address = init.email_addr;
    try {
        const set = await guerrilla_request({ f: 'set_email_user', email_user: username, sid_token: sid, lang: 'en', site: domain });
        if (set && set.email_addr) {
            sid = set.sid_token || sid;
            address = set.email_addr;
        }
    } catch {}
    return { sid_token: sid, address };
}

async function guerrilla_fetchMessages(sid_token) {
    const r = await guerrilla_request({ f: 'check_email', seq: 0, sid_token });
    return (r.list || []).map(m => ({
        id: String(m.mail_id),
        from: { address: m.mail_from || '', name: '' },
        subject: m.mail_subject || '(no subject)',
        intro: (m.mail_excerpt || '').slice(0, 200),
        seen: m.mail_read === 1 || m.mail_read === '1',
        createdAt: m.mail_timestamp ? new Date(parseInt(m.mail_timestamp) * 1000).toISOString() : new Date().toISOString(),
    }));
}

async function guerrilla_fetchMessage(sid_token, email_id) {
    const r = await guerrilla_request({ f: 'fetch_email', email_id, sid_token });
    const body = r.mail_body || '';
    const isHtml = /<[a-z][\s\S]*>/i.test(body);
    return {
        id: String(r.mail_id),
        from: { address: r.mail_from || '', name: '' },
        subject: r.mail_subject || '',
        text: isHtml ? body.replace(/<[^>]+>/g, '') : body,
        html: isHtml ? [body] : [body.replace(/\n/g, '<br>')],
        createdAt: r.mail_timestamp ? new Date(parseInt(r.mail_timestamp) * 1000).toISOString() : new Date().toISOString(),
        attachments: []
    };
}

// ==========================================================
//  DOMAIN FETCHING
// ==========================================================
// Persisted domain cache — keeps all domains we've ever seen so user gets more options
// even when Mail.tm/Mail.gw temporarily reduce their live list.
const DOMAIN_CACHE_KEY = 'tempemail_domain_cache';
const CACHE_MAX_AGE_DAYS = 30;

function loadDomainCache() {
    try {
        const raw = localStorage.getItem(DOMAIN_CACHE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        const cutoff = Date.now() - CACHE_MAX_AGE_DAYS * 24 * 3600 * 1000;
        return (parsed || []).filter(d => d.lastSeen > cutoff);
    } catch { return []; }
}

function saveDomainCache(cache) {
    try { localStorage.setItem(DOMAIN_CACHE_KEY, JSON.stringify(cache)); } catch {}
}

function updateDomainCache(liveDomains) {
    const cache = loadDomainCache();
    const map = new Map(cache.map(d => [d.domain, d]));
    const now = Date.now();
    liveDomains.forEach(d => {
        const existing = map.get(d.domain);
        if (existing) { existing.lastSeen = now; existing.base = d.base; existing.provider = d.provider || existing.provider || 'mailtm'; }
        else { map.set(d.domain, { domain: d.domain, base: d.base, provider: d.provider || 'mailtm', firstSeen: now, lastSeen: now }); }
    });
    const arr = [...map.values()];
    saveDomainCache(arr);
    return arr;
}

let lastDomainRefresh = 0;
async function fetchAllDomains() {
    domainSelect.innerHTML = '<option>Loading domains...</option>';
    const results = await Promise.allSettled([
        mailtm_fetchDomains('https://api.mail.tm'),
        mailtm_fetchDomains('https://api.mail.gw'),
    ]);
    const liveDomains = [];
    const liveSet = new Set();
    function addLive(domains, base) {
        domains.forEach(d => { if (!liveSet.has(d)) { liveDomains.push({ domain: d, provider: 'mailtm', base }); liveSet.add(d); } });
    }
    addLive(results[0].status === 'fulfilled' ? results[0].value : [], 'https://api.mail.tm');
    addLive(results[1].status === 'fulfilled' ? results[1].value : [], 'https://api.mail.gw');

    // Add Guerrilla Mail domains
    GUERRILLA_DOMAINS.forEach(d => {
        if (!liveSet.has(d)) {
            liveDomains.push({ domain: d, provider: 'guerrilla', base: 'guerrilla' });
            liveSet.add(d);
        }
    });

    // Update cache with currently-live domains
    const cache = updateDomainCache(liveDomains);

    // Build merged list: live first, then cached-only
    allDomains = liveDomains.map(d => ({ ...d, isLive: true }));
    cache.forEach(c => {
        if (!liveSet.has(c.domain)) {
            allDomains.push({ domain: c.domain, provider: c.provider || 'mailtm', base: c.base, isLive: false, lastSeen: c.lastSeen });
        }
    });

    lastDomainRefresh = Date.now();
    const liveCount = liveDomains.length;
    const totalCount = allDomains.length;
    console.log(`Loaded ${liveCount} live + ${totalCount - liveCount} cached = ${totalCount} total domains`);
    domainCount.textContent = liveCount === totalCount ? `${totalCount} domains` : `${liveCount} live, ${totalCount - liveCount} recent`;
    populateDomainDropdown();
}

// Auto-refresh domains every 30 seconds
setInterval(() => { fetchAllDomains(); }, 30000);

// ==========================================================
//  DROPDOWN
// ==========================================================
const CHEMICAL_LABELS = {
    'oakon.com':              'Oakon Chemicals',
    'teihu.com':              'Teihu Polymers',
    'sharebot.net':           'Sharebot Synthetics',
    'questtechsystems.com':   'QuestTech Systems',
    'raleigh-construction.com': 'Raleigh Industrial',
    'pastryofistanbul.com':   'Pastry of Istanbul',
};

function populateDomainDropdown() {
    domainSelect.innerHTML = '';
    if (allDomains.length === 0) { domainSelect.innerHTML = '<option>No domains available</option>'; return; }

    const mailtmLive    = allDomains.filter(d => d.isLive && d.provider !== 'guerrilla');
    const guerrillaLive = allDomains.filter(d => d.isLive && d.provider === 'guerrilla');
    const cachedDomains = allDomains.filter(d => !d.isLive);
    const labeledMailtm = mailtmLive.filter(d => CHEMICAL_LABELS[d.domain]);
    const plainMailtm   = mailtmLive.filter(d => !CHEMICAL_LABELS[d.domain]);

    function makeOpt(d, prefix, cached) {
        const opt = document.createElement('option');
        opt.value = JSON.stringify({ provider: d.provider || 'mailtm', domain: d.domain, base: d.base, cached: !!cached });
        opt.textContent = prefix + ' @' + d.domain;
        return opt;
    }

    if (labeledMailtm.length > 0) {
        const grp = document.createElement('optgroup');
        grp.label = `\u2697 Chemical & Industrial  (${labeledMailtm.length})`;
        labeledMailtm.forEach(d => {
            const opt = makeOpt(d, '\ud83d\udfe2');
            opt.textContent = `\ud83d\udfe2 ${CHEMICAL_LABELS[d.domain]}  \u2014  @${d.domain}`;
            grp.appendChild(opt);
        });
        domainSelect.appendChild(grp);
    }

    if (plainMailtm.length > 0) {
        const grp = document.createElement('optgroup');
        grp.label = `Mail.tm / Mail.gw  (${plainMailtm.length})`;
        plainMailtm.forEach(d => grp.appendChild(makeOpt(d, '\ud83d\udfe2')));
        domainSelect.appendChild(grp);
    }

    if (guerrillaLive.length > 0) {
        const grp = document.createElement('optgroup');
        grp.label = `Guerrilla Mail  (${guerrillaLive.length})`;
        guerrillaLive.forEach(d => grp.appendChild(makeOpt(d, '\ud83e\udd88')));
        domainSelect.appendChild(grp);
    }

    if (cachedDomains.length > 0) {
        const grp = document.createElement('optgroup');
        grp.label = `Recently Available  (${cachedDomains.length})`;
        cachedDomains.forEach(d => grp.appendChild(makeOpt(d, '\ud83d\udfe1', true)));
        domainSelect.appendChild(grp);
    }
}

// ==========================================================
//  CREATE ACCOUNT
// ==========================================================
async function createAccount(selection) {
    const username = `${getRandomName()}${rnd(2)}`;
    let domainInfo;
    if (selection) { domainInfo = JSON.parse(selection); }
    else { domainInfo = allDomains[0]; if (!domainInfo) throw new Error('No domains loaded.'); }
    const isCached = !!domainInfo.cached;

    async function tryCreateMailtm(d) {
        const address = `${username}@${d.domain}`;
        const password = rnd(16);
        const { id, token } = await mailtm_createAccount(d.base, address, password);
        return { provider: 'mailtm', base: d.base, id, address, token, knownMessageIds: new Set(), readMessageIds: new Set(), messages: [] };
    }

    async function tryCreateGuerrilla(d) {
        const { sid_token, address } = await guerrilla_createAccount(d.domain, username);
        return { provider: 'guerrilla', sid_token, address, knownMessageIds: new Set(), readMessageIds: new Set(), messages: [] };
    }

    try {
        if (domainInfo.provider === 'guerrilla') return await tryCreateGuerrilla(domainInfo);
        return await tryCreateMailtm(domainInfo);
    } catch (err) {
        if (isCached) {
            const liveDomain = allDomains.find(d => d.isLive);
            if (liveDomain) {
                showToast(`@${domainInfo.domain} no longer available, using @${liveDomain.domain} instead`);
                if (liveDomain.provider === 'guerrilla') return await tryCreateGuerrilla(liveDomain);
                return await tryCreateMailtm(liveDomain);
            }
        }
        throw err;
    }
}

// ==========================================================
//  FETCH MESSAGES
// ==========================================================
async function fetchMessagesForAccount(acc) {
    if (acc.provider === 'mailtm')    return mailtm_fetchMessages(acc.base, acc.token);
    if (acc.provider === 'guerrilla') return guerrilla_fetchMessages(acc.sid_token);
    return [];
}
async function fetchMessageForAccount(acc, msgId) {
    if (acc.provider === 'mailtm')    return mailtm_fetchMessage(acc.base, acc.token, msgId);
    if (acc.provider === 'guerrilla') return guerrilla_fetchMessage(acc.sid_token, msgId);
    throw new Error('Unknown provider');
}

// ==========================================================
//  UI HELPERS
// ==========================================================
function showToast(text) { toast.textContent = text; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2500); }
function formatTime(ds) {
    const d = new Date(ds), now = new Date(), diff = now - d;
    if (diff < 60000) return 'Just now'; if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function formatFullDate(ds) { return new Date(ds).toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function getInitial(s) { return s?.address ? s.address.charAt(0).toUpperCase() : '?'; }
function getSenderName(f) { return f?.name || f?.address || 'Unknown'; }
function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

// ==========================================================
//  BROWSER NOTIFICATIONS
// ==========================================================
function requestNotificationPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
        Notification.requestPermission().then(p => { notificationPermission = p; });
    } else {
        notificationPermission = Notification.permission;
    }
}

function sendNewEmailNotification(sender, subject) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
        new Notification('New Email Received', {
            body: `From: ${sender}\n${subject}`,
            icon: 'logo.png',
            tag: 'new-email',
        });
    } catch (e) { console.warn('Notification failed:', e); }
}

// ===== Notification Count (unread emails) =====
function getUnreadCount() {
    if (activeIndex < 0 || !accounts[activeIndex]) return 0;
    const acc = accounts[activeIndex];
    return acc.messages.filter(m => !acc.readMessageIds.has(m.id)).length;
}
function updateNotifCount() {
    const unread = getUnreadCount();
    if (notifCountEl) {
        if (unread > 0) {
            notifCountEl.textContent = unread;
            notifCountEl.style.display = '';
        } else {
            notifCountEl.style.display = 'none';
        }
    }
}

// ===== Notification Sound (Web Audio API) =====
let audioCtx = null;
function getAudioContext() {
    if (!audioCtx || audioCtx.state === 'closed') {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
}
// Pre-init audio context on first user click so sound works later
document.addEventListener('click', () => { try { getAudioContext(); } catch {} }, { once: true });

function playNotificationSound() {
    if (!notifSoundEnabled) return;
    try {
        const ctx = getAudioContext();
        // First tone
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(830, ctx.currentTime);
        gain1.gain.setValueAtTime(0.3, ctx.currentTime);
        gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(ctx.currentTime);
        osc1.stop(ctx.currentTime + 0.3);
        // Second tone (higher)
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(1100, ctx.currentTime + 0.15);
        gain2.gain.setValueAtTime(0.3, ctx.currentTime + 0.15);
        gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(ctx.currentTime + 0.15);
        osc2.stop(ctx.currentTime + 0.5);
        // Do NOT close the context — reuse it for subsequent sounds
    } catch (e) { console.warn('Audio play failed:', e); }
}

function ringBellIcon() {
    const bellIcon = document.getElementById('bellIcon');
    if (!bellIcon) return;
    bellIcon.classList.remove('ringing');
    void bellIcon.offsetWidth; // force reflow
    bellIcon.classList.add('ringing');
    setTimeout(() => bellIcon.classList.remove('ringing'), 700);
}

// Bell toggle button
(function initBellToggle() {
    const bellBtn = document.getElementById('notifBellBtn');
    const mutedLine = document.getElementById('bellMutedLine');
    if (!bellBtn) return;
    // Load saved preference
    const saved = localStorage.getItem('tempmail-notif-sound');
    if (saved === 'false') {
        notifSoundEnabled = false;
        bellBtn.classList.add('muted');
        mutedLine.style.display = '';
    }
    bellBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        notifSoundEnabled = !notifSoundEnabled;
        bellBtn.classList.toggle('muted', !notifSoundEnabled);
        mutedLine.style.display = notifSoundEnabled ? 'none' : '';
        localStorage.setItem('tempmail-notif-sound', notifSoundEnabled);
        showToast(notifSoundEnabled ? 'Notifications unmuted' : 'Notifications muted');
    });
})();

// ==========================================================
//  ACCOUNT COUNTER / TABS
// ==========================================================
function updateAccountCounter() {
    accountCounter.textContent = `${accounts.length} / ${MAX_ACCOUNTS}`;
    accountCounter.classList.toggle('at-limit', accounts.length >= MAX_ACCOUNTS);
}
function renderAccountTabs() {
    accountTabs.innerHTML = '';
    if (!accounts.length) { accountTabs.style.display = 'none'; return; }
    accountTabs.style.display = 'flex';
    accounts.forEach((acc, idx) => {
        const tab = document.createElement('div');
        tab.className = `account-tab${idx === activeIndex ? ' active' : ''}`;
        const dot = document.createElement('span'); dot.className = 'tab-dot';
        const addr = document.createElement('span'); addr.className = 'tab-address'; addr.textContent = acc.address;
        const del = document.createElement('button'); del.className = 'tab-delete'; del.title = 'Remove'; del.innerHTML = '&times;';
        del.onclick = e => { e.stopPropagation(); removeAccount(idx); };
        tab.append(dot, addr, del);
        tab.onclick = () => switchToAccount(idx);
        accountTabs.appendChild(tab);
    });
}
function updateInboxLabel() {
    const label = document.getElementById('inboxEmailLabel');
    if (label && activeIndex >= 0 && accounts[activeIndex]) {
        label.textContent = accounts[activeIndex].address;
    }
}

function switchToAccount(idx) {
    if (idx < 0 || idx >= accounts.length) return;
    activeIndex = idx;
    const acc = accounts[idx];
    emailText.textContent = acc.address;
    emailText.className = 'email-text generated';
    emailDisplay.classList.add('active');
    copyBtn.style.display = 'flex';
    shareBtn.style.display = '';
    updateInboxLabel();
    renderAccountTabs();
    renderMessages(acc.messages);
}
function removeAccount(idx) {
    accounts.splice(idx, 1); updateAccountCounter();
    if (!accounts.length) {
        activeIndex = -1; emailText.textContent = 'Click generate to get started'; emailText.className = 'email-text placeholder';
        emailDisplay.classList.remove('active'); copyBtn.style.display = 'none';
        refreshBtn.style.display = 'none'; document.getElementById('changeBtn').style.display = 'none';
        document.getElementById('deleteBtn').style.display = 'none'; shareBtn.style.display = 'none';
        statusRow.style.display = 'none'; inboxSection.style.display = 'none'; accountTabs.style.display = 'none';
        if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
        updateGenerateButton(); renderAccountTabs(); return;
    }
    if (activeIndex >= accounts.length) activeIndex = accounts.length - 1;
    else if (idx < activeIndex) activeIndex--;
    else if (idx === activeIndex) activeIndex = Math.min(idx, accounts.length - 1);
    switchToAccount(activeIndex); updateGenerateButton(); showToast('Email removed');
}

// ==========================================================
//  RENDER MESSAGES (with staggered animation)
// ==========================================================
function renderMessages(messages) {
    const count = messages.length;
    messageCount.textContent = `${count} message${count !== 1 ? 's' : ''}`;
    if (!count) {
        inboxList.innerHTML = ''; inboxList.appendChild(emptyInbox); emptyInbox.style.display = '';
        updateNotifCount();
        return;
    }
    emptyInbox.style.display = 'none';
    messages.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const acc = accounts[activeIndex], frag = document.createDocumentFragment();
    messages.forEach((msg, index) => {
        const isNew = !acc.knownMessageIds.has(msg.id);
        if (isNew) {
            acc.knownMessageIds.add(msg.id);
            // Send browser notification for each new email
            const senderName = getSenderName(msg.from);
            sendNewEmailNotification(senderName, msg.subject || '(No Subject)');
            // Play notification sound and animate bell for each new email
            setTimeout(() => { playNotificationSound(); ringBellIcon(); }, index * 300);
        }
        const isRead = acc.readMessageIds.has(msg.id);
        const sender = msg.from || {};
        const item = document.createElement('div');
        const staggerClass = index < 10 ? ` stagger-${index + 1}` : '';
        item.className = `email-item${!isRead ? ' unread' : ' read'}${isNew ? ' new-email' : ''}${staggerClass}`;
        item.onclick = () => openEmail(msg.id);
        item.innerHTML = `<div class="email-avatar" style="${isRead ? 'opacity:0.6' : ''}">${getInitial(sender)}</div><div class="email-item-content"><div class="email-item-top"><span class="email-item-sender">${escapeHtml(getSenderName(sender))}</span><span class="email-item-time">${formatTime(msg.createdAt)}</span></div><div class="email-item-subject">${escapeHtml(msg.subject || '(No Subject)')}</div><div class="email-item-preview">${escapeHtml(msg.intro || '')}</div></div>`;
        frag.appendChild(item);
    });
    inboxList.innerHTML = ''; inboxList.appendChild(frag);
    updateNotifCount();
}

// ==========================================================
//  FETCH ATTACHMENT AS DATA URL (for images)
// ==========================================================
async function fetchAttachmentAsDataUrl(base, messageId, attachmentId, token, contentType) {
    try {
        const url = `${base}/messages/${messageId}/attachment/${attachmentId}`;
        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return null;
        const blob = await res.blob();
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.warn('Failed to fetch attachment:', e);
        return null;
    }
}

async function replaceEmailImages(html, msg, acc) {
    const attachments = msg.attachments || [];
    if (attachments.length === 0) return html;

    // Build a map of attachment IDs/filenames to data URLs for image attachments
    const imageAttachments = attachments.filter(att =>
        att.contentType && att.contentType.startsWith('image/')
    );

    if (imageAttachments.length === 0) return html;

    // Fetch all image attachments in parallel
    const fetches = imageAttachments.map(async (att) => {
        const dataUrl = await fetchAttachmentAsDataUrl(acc.base, msg.id, att.id, acc.token, att.contentType);
        return { att, dataUrl };
    });

    const results = await Promise.allSettled(fetches);
    let processedHtml = html;

    results.forEach(result => {
        if (result.status !== 'fulfilled' || !result.value.dataUrl) return;
        const { att, dataUrl } = result.value;

        // Replace any src that references this attachment by ID
        // Pattern: .../messages/{msgId}/attachment/{attId}
        const attUrlPattern = new RegExp(
            `(src=["'])([^"']*\\/messages\\/[^"']*\\/attachment\\/${att.id})([^"']*)(["'])`,
            'gi'
        );
        processedHtml = processedHtml.replace(attUrlPattern, `$1${dataUrl}$4`);

        // Also replace CID references (content-id based inline images)
        // CID format: cid:filename or cid:content-id
        if (att.filename) {
            const cidPatterns = [
                new RegExp(`(src=["'])cid:${att.filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(["'])`, 'gi'),
                new RegExp(`(src=["'])cid:${att.id}(["'])`, 'gi'),
            ];
            cidPatterns.forEach(pattern => {
                processedHtml = processedHtml.replace(pattern, `$1${dataUrl}$2`);
            });
        }

        // Replace any src referencing mail.tm or mail.gw attachment URLs generically
        const genericPattern = new RegExp(
            `(src=["'])(https?:\\/\\/api\\.mail\\.(tm|gw)\\/messages\\/[^"']*\\/attachment\\/${att.id})(["'])`,
            'gi'
        );
        processedHtml = processedHtml.replace(genericPattern, `$1${dataUrl}$4`);

        // Replace src that references just the filename (e.g. src="logo.png")
        if (att.filename) {
            const fnEscaped = att.filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const filenamePattern = new RegExp(
                `(src=["'])(?:cid:)?${fnEscaped}(["'])`,
                'gi'
            );
            processedHtml = processedHtml.replace(filenamePattern, `$1${dataUrl}$2`);
        }
    });

    return processedHtml;
}

// ==========================================================
//  EMAIL VIEWER MODAL (with attachments + export)
// ==========================================================
async function openEmail(id) {
    const acc = accounts[activeIndex];
    // Mark as read immediately and update UI
    acc.readMessageIds.add(id);
    updateNotifCount();
    renderMessages(acc.messages);

    modalOverlay.classList.add('active');
    modalSubject.textContent = 'Loading...'; modalFrom.textContent = ''; modalDate.textContent = '';
    modalBody.innerHTML = '<div class="skeleton" style="height:200px;"></div>';
    document.getElementById('modalAttachments').style.display = 'none';
    currentOpenMessage = null;
    try {
        const msg = await fetchMessageForAccount(acc, id);
        currentOpenMessage = msg;
        const sender = msg.from || {};
        modalSubject.textContent = msg.subject || '(No Subject)';
        modalFrom.textContent = getSenderName(sender);
        modalDate.textContent = formatFullDate(msg.createdAt);
        if (msg.html && msg.html.length > 0) {
            const iframe = document.createElement('iframe');
            iframe.sandbox = 'allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox';
            Object.assign(iframe.style, { width: '100%', minHeight: '250px', border: 'none', borderRadius: '8px', background: 'white' });
            modalBody.innerHTML = ''; modalBody.appendChild(iframe);
            let html = msg.html.join ? msg.html.join('') : msg.html;

            // Fix images: fetch attachments referenced in email HTML with bearer token
            try {
                html = await replaceEmailImages(html, msg, acc);
            } catch (e) { console.warn('Image replacement failed:', e); }

            iframe.srcdoc = `<html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.6;color:#333;padding:16px;margin:0;word-wrap:break-word}img{max-width:100%;height:auto}a{color:#6c5ce7;cursor:pointer}</style></head><body>${html}<script>document.querySelectorAll('a[href]').forEach(function(a){var h=a.getAttribute('href');if(!h||h==='#')return;if(!h.match(/^(https?:\\/\\/|mailto:|tel:)/i)){h='https://'+h;}a.removeAttribute('href');a.style.cursor='pointer';a.style.textDecoration='underline';a.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();window.open(h,'_blank');});});<\/script></body></html>`;
            iframe.onload = () => { try { iframe.style.height = Math.min(iframe.contentDocument.body.scrollHeight + 32, 600) + 'px'; } catch {} };
        } else {
            modalBody.innerHTML = `<pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(msg.text || 'No content')}</pre>`;
        }

        // Render attachments (with image previews)
        renderAttachments(msg, acc);

        refreshInbox();
    } catch (err) { modalBody.innerHTML = `<p style="color:var(--danger);">Failed: ${escapeHtml(err.message)}</p>`; }
}

function renderAttachments(msg, acc) {
    const container = document.getElementById('modalAttachments');
    const list = document.getElementById('attachmentsList');
    const attachments = msg.attachments || [];
    if (attachments.length === 0) { container.style.display = 'none'; return; }
    container.style.display = '';
    list.innerHTML = '';
    attachments.forEach(att => {
        const ext = att.filename ? att.filename.split('.').pop().toUpperCase() : 'FILE';
        const size = att.size ? (att.size > 1024 ? `${(att.size / 1024).toFixed(1)} KB` : `${att.size} B`) : '';
        const downloadUrl = `${acc.base}/messages/${msg.id}/attachment/${att.id}`;
        const div = document.createElement('div');
        div.className = 'attachment-item';
        div.innerHTML = `
            <div class="attachment-icon">${ext.substring(0, 3)}</div>
            <div class="attachment-info">
                <div class="attachment-name">${escapeHtml(att.filename || 'attachment')}</div>
                ${size ? `<div class="attachment-size">${size}</div>` : ''}
            </div>
            <button class="attachment-download" data-url="${escapeHtml(downloadUrl)}" data-filename="${escapeHtml(att.filename || 'attachment')}" data-token="${acc.token}">Download</button>
        `;
        list.appendChild(div);
    });

    list.querySelectorAll('.attachment-download').forEach(btn => {
        btn.addEventListener('click', async () => {
            try {
                const res = await fetch(btn.dataset.url, {
                    headers: { 'Authorization': `Bearer ${btn.dataset.token}` }
                });
                if (!res.ok) throw new Error('Download failed');
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = btn.dataset.filename;
                document.body.appendChild(a); a.click(); document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } catch (err) {
                showToast('Download failed: ' + err.message);
            }
        });
    });
}

function closeModal() { modalOverlay.classList.remove('active'); }
modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ==========================================================
//  EXPORT EMAIL AS TXT / PDF
// ==========================================================
document.getElementById('modalExportTxt').addEventListener('click', () => {
    if (!currentOpenMessage) return;
    const msg = currentOpenMessage;
    const sender = getSenderName(msg.from);
    const date = formatFullDate(msg.createdAt);
    const subject = msg.subject || '(No Subject)';
    const body = msg.text || '(No content)';
    const content = `From: ${sender}\nDate: ${date}\nSubject: ${subject}\n\n${body}`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `email-${subject.replace(/[^a-z0-9]/gi, '_').substring(0, 30)}.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('TXT exported!');
});

document.getElementById('modalExportPdf').addEventListener('click', () => {
    if (!currentOpenMessage) return;
    if (typeof jspdf === 'undefined' && typeof window.jspdf === 'undefined') {
        showToast('PDF library not loaded'); return;
    }
    const msg = currentOpenMessage;
    const sender = getSenderName(msg.from);
    const date = formatFullDate(msg.createdAt);
    const subject = msg.subject || '(No Subject)';
    const body = msg.text || '(No content)';

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;
    const maxWidth = pageWidth - margin * 2;
    let y = 20;

    doc.setFontSize(16);
    doc.setFont(undefined, 'bold');
    const subjectLines = doc.splitTextToSize(subject, maxWidth);
    doc.text(subjectLines, margin, y);
    y += subjectLines.length * 8 + 6;

    doc.setFontSize(11);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(100);
    doc.text(`From: ${sender}`, margin, y); y += 6;
    doc.text(`Date: ${date}`, margin, y); y += 10;

    doc.setDrawColor(200);
    doc.line(margin, y, pageWidth - margin, y); y += 8;

    doc.setTextColor(40);
    doc.setFontSize(12);
    const bodyLines = doc.splitTextToSize(body, maxWidth);
    bodyLines.forEach(line => {
        if (y > 280) { doc.addPage(); y = 20; }
        doc.text(line, margin, y); y += 6;
    });

    doc.save(`email-${subject.replace(/[^a-z0-9]/gi, '_').substring(0, 30)}.pdf`);
    showToast('PDF exported!');
});

// ==========================================================
//  REFRESH / POLLING
// ==========================================================
async function refreshInbox() {
    if (activeIndex < 0 || !accounts[activeIndex]) return;
    try { refreshIcon.classList.add('spinning'); const acc = accounts[activeIndex]; acc.messages = await fetchMessagesForAccount(acc); renderMessages(acc.messages); }
    catch (err) { console.error('Refresh failed:', err); }
    finally { refreshIcon.classList.remove('spinning'); }
}
function startPolling() { if (pollingInterval) clearInterval(pollingInterval); pollingInterval = setInterval(refreshInbox, 5000); }

// ==========================================================
//  GENERATE BUTTON
// ==========================================================
function updateGenerateButton() {
    const emailIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>`;
    const at = accounts.length >= MAX_ACCOUNTS; generateBtn.disabled = at;
    if (at) generateBtn.innerHTML = `${emailIcon} Limit Reached`;
    else if (accounts.length > 0) generateBtn.innerHTML = `${emailIcon} Add Email`;
    else generateBtn.innerHTML = `${emailIcon} Generate Email`;
}

// ==========================================================
//  EVENT LISTENERS
// ==========================================================
copyBtn.addEventListener('click', async () => {
    if (activeIndex < 0) return;
    const a = accounts[activeIndex].address;
    try { await navigator.clipboard.writeText(a); } catch { const t = document.createElement('textarea'); t.value = a; document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t); }
    showToast('Copied!');
});

premiumToggle.addEventListener('change', () => { isPremium = premiumToggle.checked; domainSelector.style.display = isPremium ? '' : 'none'; });

generateBtn.addEventListener('click', async () => {
    if (accounts.length >= MAX_ACCOUNTS) { showToast('Max 5 reached. Remove one first.'); return; }
    generateBtn.disabled = true;
    const prev = generateBtn.innerHTML;
    generateBtn.innerHTML = `<svg class="refresh-icon spinning" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg> Generating...`;
    try {
        const sel = isPremium ? domainSelect.value : null;
        const account = await createAccount(sel);
        accounts.push(account); activeIndex = accounts.length - 1;
        emailText.textContent = account.address; emailText.className = 'email-text generated';
        emailDisplay.classList.add('active'); copyBtn.style.display = 'flex';
        refreshBtn.style.display = ''; document.getElementById('changeBtn').style.display = '';
        document.getElementById('deleteBtn').style.display = ''; shareBtn.style.display = '';
        statusRow.style.display = 'flex'; inboxSection.style.display = '';
        renderMessages([]); renderAccountTabs(); updateAccountCounter(); updateGenerateButton(); updateInboxLabel();

        startPolling();
        requestNotificationPermission();
        showToast('Email generated successfully!');
        if (typeof trackEvent === 'function') trackEvent('email_generated', { address: acc.address });
    } catch (err) { console.error('Generate failed:', err); showToast('Error: ' + err.message); generateBtn.innerHTML = prev; }
    finally { generateBtn.disabled = accounts.length >= MAX_ACCOUNTS; }
});

refreshBtn.addEventListener('click', refreshInbox);

// ==========================================================
//  SHARE BUTTON
// ==========================================================
shareBtn.addEventListener('click', async () => {
    if (activeIndex < 0 || !accounts[activeIndex]) return;
    const address = accounts[activeIndex].address;
    if (navigator.share) {
        try {
            await navigator.share({ title: 'Temporary Email', text: address });
        } catch (e) {
            if (e.name !== 'AbortError') {
                // Fallback to copy
                try { await navigator.clipboard.writeText(address); } catch {}
                showToast('Email copied to clipboard!');
            }
        }
    } else {
        try { await navigator.clipboard.writeText(address); } catch {
            const t = document.createElement('textarea'); t.value = address;
            document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t);
        }
        showToast('Email copied to clipboard!');
    }
});

// ==========================================================
//  GENERIC TAB SWITCHING (5 tabs)
// ==========================================================
document.querySelectorAll('.tab-switcher .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tabName = btn.dataset.tab;
        // Deactivate all tab buttons
        document.querySelectorAll('.tab-switcher .tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // Hide all tab content, show the selected one
        document.querySelectorAll('.tab-content').forEach(tc => tc.style.display = 'none');
        const target = document.getElementById(`tab-${tabName}`);
        if (target) target.style.display = '';
        // Special init for phone tab
        if (tabName === 'phone') renderPhoneNumbers();
    });
});

// ==========================================================
//  TEMPORARY PHONE NUMBERS -- curated from public services
// ==========================================================
function flagImg(code) {
    return `<img src="https://flagcdn.com/w40/${code.toLowerCase()}.png" alt="${code}" class="phone-flag-img">`;
}

const TEMP_PHONES = [
    // USA
    { country: 'US', number: '+1 (380) 260-3245', raw: '13802603245', service: 'receive-smss.com', smsUrl: 'https://receive-smss.com/sms/13802603245/' },
    { country: 'US', number: '+1 (970) 784-0507', raw: '19707840507', service: 'receive-smss.com', smsUrl: 'https://receive-smss.com/sms/19707840507/' },
    { country: 'US', number: '+1 (347) 392-9868', raw: '13473929868', service: 'receive-smss.com', smsUrl: 'https://receive-smss.com/sms/13473929868/' },
    { country: 'US', number: '+1 (281) 216-6971', raw: '12812166971', service: 'receive-smss.com', smsUrl: 'https://receive-smss.com/sms/12812166971/' },
    { country: 'US', number: '+1 (929) 836-4242', raw: '19298364242', service: 'receive-smss.com', smsUrl: 'https://receive-smss.com/sms/19298364242/' },
    // India
    { country: 'IN', number: '+91 74287 30894', raw: '917428730894', service: 'receive-smss.com', smsUrl: 'https://receive-smss.com/sms/917428730894/' },
    { country: 'IN', number: '+91 74287 23247', raw: '917428723247', service: 'receive-smss.com', smsUrl: 'https://receive-smss.com/sms/917428723247/' },
    { country: 'IN', number: '+91 Numbers', raw: '', service: 'quackr.io', smsUrl: 'https://quackr.io/temporary-numbers/india' },
    // China
    { country: 'CN', number: '+86 Numbers', raw: '', service: 'quackr.io', smsUrl: 'https://quackr.io/temporary-numbers/china' },
    { country: 'CN', number: '+86 Numbers', raw: '', service: 'temp-number.com', smsUrl: 'https://temp-number.com/countries/china' },
    { country: 'CN', number: '+86 Numbers', raw: '', service: 'mytempsms.com', smsUrl: 'https://mytempsms.com/country/china' },
    // Germany
    { country: 'DE', number: '+49 1521 094 7617', raw: '4915210947617', service: 'receive-smss.com', smsUrl: 'https://receive-smss.com/sms/4915210947617/' },
    { country: 'DE', number: '+49 1521 109 4215', raw: '4915211094215', service: 'receive-smss.com', smsUrl: 'https://receive-smss.com/sms/4915211094215/' },
    { country: 'DE', number: '+49 1521 089 9596', raw: '4915210899596', service: 'receive-smss.com', smsUrl: 'https://receive-smss.com/sms/4915210899596/' },
    { country: 'DE', number: '+49 Numbers', raw: '', service: 'quackr.io', smsUrl: 'https://quackr.io/temporary-numbers/germany' },
    // UK
    { country: 'GB', number: '+44 7538 299689', raw: '447538299689', service: 'receive-smss.com', smsUrl: 'https://receive-smss.com/sms/447538299689/' },
    { country: 'GB', number: '+44 Numbers', raw: '', service: 'quackr.io', smsUrl: 'https://quackr.io/temporary-numbers/united-kingdom' },
    // Canada
    { country: 'CA', number: '+1 (281) 352-4309', raw: '12813524309', service: 'receive-smss.com', smsUrl: 'https://receive-smss.com/sms/12813524309/' },
    { country: 'CA', number: '+1 Numbers', raw: '', service: 'quackr.io', smsUrl: 'https://quackr.io/temporary-numbers/canada' },
    // France
    { country: 'FR', number: '+33 Numbers', raw: '', service: 'receive-smss.com', smsUrl: 'https://receive-smss.com/sms/france/' },
    { country: 'FR', number: '+33 Numbers', raw: '', service: 'quackr.io', smsUrl: 'https://quackr.io/temporary-numbers/france' },
    // Australia
    { country: 'AU', number: '+61 Numbers', raw: '', service: 'receive-smss.com', smsUrl: 'https://receive-smss.com/sms/australia/' },
    { country: 'AU', number: '+61 Numbers', raw: '', service: 'quackr.io', smsUrl: 'https://quackr.io/temporary-numbers/australia' },
    // Brazil
    { country: 'BR', number: '+55 Numbers', raw: '', service: 'receive-smss.com', smsUrl: 'https://receive-smss.com/sms/brazil/' },
    { country: 'BR', number: '+55 Numbers', raw: '', service: 'quackr.io', smsUrl: 'https://quackr.io/temporary-numbers/brazil' },
    // Japan
    { country: 'JP', number: '+81 Numbers', raw: '', service: 'receive-smss.com', smsUrl: 'https://receive-smss.com/sms/japan/' },
    { country: 'JP', number: '+81 Numbers', raw: '', service: 'quackr.io', smsUrl: 'https://quackr.io/temporary-numbers/japan' },
];

let activeCountry = 'all';
const phoneGrid = document.getElementById('phoneGrid');

function renderPhoneNumbers() {
    const filtered = activeCountry === 'all' ? TEMP_PHONES : TEMP_PHONES.filter(p => p.country === activeCountry);
    phoneGrid.innerHTML = '';

    if (filtered.length === 0) {
        phoneGrid.innerHTML = '<div class="phone-empty">No numbers available for this country</div>';
        return;
    }

    filtered.forEach(p => {
        const item = document.createElement('div');
        item.className = 'phone-item';
        item.innerHTML = `
            <span class="phone-flag">${flagImg(p.country)}</span>
            <div class="phone-info">
                <div class="phone-number">${escapeHtml(p.number)}</div>
                <div class="phone-service">via ${escapeHtml(p.service)}</div>
            </div>
            <div class="phone-actions">
                ${p.raw ? `<button class="phone-copy-btn" data-number="${escapeHtml(p.raw)}" title="Copy number">Copy</button>` : ''}
                <button class="phone-sms-btn" data-url="${escapeHtml(p.smsUrl)}">View SMS</button>
            </div>
        `;
        phoneGrid.appendChild(item);
    });

    phoneGrid.querySelectorAll('.phone-copy-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const num = '+' + btn.dataset.number;
            try { await navigator.clipboard.writeText(num); } catch { const t = document.createElement('textarea'); t.value = num; document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t); }
            showToast('Number copied!');
        });
    });

    phoneGrid.querySelectorAll('.phone-sms-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const item = btn.closest('.phone-item');
            const label = item?.querySelector('.phone-number')?.textContent || 'Phone';
            openSmsViewer(btn.dataset.url, label);
        });
    });
}

// ==========================================================
//  SMS VIEWER -- fetch, parse & render messages inline
// ==========================================================
const CORS_PROXIES = [
    'https://api.codetabs.com/v1/proxy?quest=',
    'https://corsproxy.io/?',
    'https://api.allorigins.win/raw?url=',
];
const smsViewer = document.getElementById('smsViewer');
const smsList = document.getElementById('smsList');
const smsViewerTitle = document.getElementById('smsViewerTitle');
const smsViewerClose = document.getElementById('smsViewerClose');
const smsRefreshBtn = document.getElementById('smsRefreshBtn');
const smsRefreshIcon = document.getElementById('smsRefreshIcon');
let currentSmsUrl = '';

function openSmsViewer(url, numberLabel) {
    currentSmsUrl = url;
    smsViewerTitle.textContent = `SMS Inbox \u2014 ${numberLabel}`;
    smsList.innerHTML = '<div class="sms-loading"><div class="skeleton" style="height:120px;border-radius:8px;"></div></div>';
    smsViewer.style.display = '';
    smsViewer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    fetchAndRenderSms(url);
    startSmsAutoRefresh();
}

function closeSmsViewer() {
    smsViewer.style.display = 'none';
    smsList.innerHTML = '';
    currentSmsUrl = '';
    stopSmsAutoRefresh();
}

async function fetchViaProxy(url) {
    const cacheBuster = url.includes('?') ? `&_t=${Date.now()}` : `?_t=${Date.now()}`;
    const targetUrl = url + cacheBuster;
    for (const proxy of CORS_PROXIES) {
        try {
            const proxyUrl = proxy + encodeURIComponent(targetUrl);
            const res = await fetch(proxyUrl, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
            if (!res.ok) continue;
            const text = await res.text();
            if (text.length > 500 && text.includes('message_details')) return text;
        } catch { /* try next proxy */ }
    }
    throw new Error('All proxies failed');
}

async function fetchAndRenderSms(url) {
    try {
        smsRefreshIcon.classList.add('spinning');
        const html = await fetchViaProxy(url);

        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const rows = doc.querySelectorAll('.message_details');
        const messages = [];

        rows.forEach(row => {
            const cols = row.querySelectorAll('[class*=col]');
            const texts = [...cols].map(c => c.textContent.trim());
            if (texts.length >= 2) {
                let message = texts[0] || '';
                let sender = texts[1] || '';
                let time = texts[2] || '';
                message = message.replace(/^Message\s*/i, '');
                sender = sender.replace(/^Sender\s*/i, '');
                time = time.replace(/^Time\s*/i, '');
                if (message) {
                    messages.push({ message, sender, time });
                }
            }
        });

        if (messages.length === 0) {
            const trs = doc.querySelectorAll('table tr, .sms-row, .message-row');
            trs.forEach(tr => {
                const cells = tr.querySelectorAll('td, .cell');
                if (cells.length >= 2) {
                    messages.push({
                        sender: cells[0]?.textContent?.trim() || 'Unknown',
                        message: cells[1]?.textContent?.trim() || '',
                        time: cells[2]?.textContent?.trim() || '',
                    });
                }
            });
        }

        renderSmsMessages(messages);
    } catch (err) {
        console.error('SMS fetch failed:', err);
        smsList.innerHTML = `
            <div class="sms-empty">
                <p>Could not load messages inline.</p>
                <button class="phone-sms-btn" style="margin-top:10px;" onclick="window.open('${escapeHtml(url)}','_blank')">Open in New Tab</button>
            </div>
        `;
    } finally {
        smsRefreshIcon.classList.remove('spinning');
    }
}

function highlightCodes(text) {
    // Highlight numeric codes (4-8 digits) that look like verification codes, with copy button
    return escapeHtml(text).replace(/\b(\d{4,8})\b/g, '<span class="sms-code">$1</span><button class="otp-copy-btn" data-otp="$1">Copy</button>');
}

function renderSmsMessages(messages) {
    smsList.innerHTML = '';
    if (messages.length === 0) {
        smsList.innerHTML = '<div class="sms-empty">No messages found for this number</div>';
        return;
    }

    messages.forEach(msg => {
        const initial = msg.sender ? msg.sender.charAt(0).toUpperCase() : '?';
        const div = document.createElement('div');
        div.className = 'sms-msg';
        div.innerHTML = `
            <div class="sms-msg-icon">${escapeHtml(initial)}</div>
            <div class="sms-msg-content">
                <div class="sms-msg-top">
                    <span class="sms-msg-sender">${escapeHtml(msg.sender || 'Unknown')}</span>
                    <span class="sms-msg-time">${escapeHtml(msg.time || '')}</span>
                </div>
                <div class="sms-msg-text">${highlightCodes(msg.message)}</div>
            </div>
        `;
        smsList.appendChild(div);
    });

    // Attach OTP copy handlers
    smsList.querySelectorAll('.otp-copy-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const otp = btn.dataset.otp;
            try { await navigator.clipboard.writeText(otp); } catch {
                const t = document.createElement('textarea'); t.value = otp;
                document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t);
            }
            showToast(`OTP ${otp} copied!`);
        });
    });
}

smsViewerClose.addEventListener('click', closeSmsViewer);
smsRefreshBtn.addEventListener('click', () => {
    if (currentSmsUrl) fetchAndRenderSms(currentSmsUrl);
});

// Auto-refresh SMS every 10 seconds
const smsAutoRefresh = document.getElementById('smsAutoRefresh');
const smsCountdown = document.getElementById('smsCountdown');
const smsManualRefresh = document.getElementById('smsManualRefresh');
let smsRefreshInterval = null;
let smsCountdownInterval = null;
let smsCountdownValue = 10;

function startSmsAutoRefresh() {
    stopSmsAutoRefresh();
    smsCountdownValue = 10;
    smsCountdown.textContent = smsCountdownValue;

    smsCountdownInterval = setInterval(() => {
        smsCountdownValue--;
        if (smsCountdownValue <= 0) smsCountdownValue = 10;
        smsCountdown.textContent = smsCountdownValue;
    }, 1000);

    smsRefreshInterval = setInterval(() => {
        if (currentSmsUrl) fetchAndRenderSms(currentSmsUrl);
        smsCountdownValue = 10;
    }, 10000);
}

function stopSmsAutoRefresh() {
    if (smsRefreshInterval) { clearInterval(smsRefreshInterval); smsRefreshInterval = null; }
    if (smsCountdownInterval) { clearInterval(smsCountdownInterval); smsCountdownInterval = null; }
}

smsManualRefresh.addEventListener('click', () => {
    if (currentSmsUrl) {
        fetchAndRenderSms(currentSmsUrl);
        smsCountdownValue = 10;
        smsCountdown.textContent = smsCountdownValue;
        stopSmsAutoRefresh();
        startSmsAutoRefresh();
    }
});

// Country filter buttons
document.querySelectorAll('.country-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.country-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeCountry = btn.dataset.country;
        renderPhoneNumbers();
    });
});

// ==========================================================
//  CHANGE / DELETE BUTTONS
// ==========================================================
document.getElementById('changeBtn').addEventListener('click', async () => {
    if (activeIndex >= 0) {
        accounts.splice(activeIndex, 1);
        if (activeIndex >= accounts.length) activeIndex = accounts.length - 1;
    }
    try {
        const sel = isPremium ? domainSelect.value : null;
        const account = await createAccount(sel);
        accounts.push(account);
        activeIndex = accounts.length - 1;
        emailText.textContent = account.address;
        emailText.className = 'email-text generated';
        emailDisplay.classList.add('active');
        copyBtn.style.display = 'flex';
        refreshBtn.style.display = '';
        document.getElementById('changeBtn').style.display = '';
        document.getElementById('deleteBtn').style.display = '';
        shareBtn.style.display = '';
        statusRow.style.display = 'flex';
        inboxSection.style.display = '';
        renderMessages([]);
        renderAccountTabs();
        updateAccountCounter();
        updateGenerateButton();
        updateInboxLabel();

        startPolling();
        showToast('Email changed!');
    } catch (err) {
        console.error('Change failed:', err);
        showToast('Error: ' + err.message);
    }
});

document.getElementById('deleteBtn').addEventListener('click', () => {
    if (activeIndex >= 0) removeAccount(activeIndex);
});

// ==========================================================
//  THEME TOGGLE (light/dark)
// ==========================================================
function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('tempmail-theme', theme);
}

document.getElementById('themeToggle').onclick = function() {
    var current = document.documentElement.getAttribute('data-theme') || 'dark';
    setTheme(current === 'dark' ? 'light' : 'dark');
};

var savedTheme = localStorage.getItem('tempmail-theme') || 'dark';
setTheme(savedTheme);

// ==========================================================
//  DISPOSABLE USERNAME GENERATOR TAB
// ==========================================================
const NAME_DATA = {
    US: {
        male: ['James','William','Ethan','Liam','Noah','Mason','Logan','Lucas','Aiden','Jackson'],
        female: ['Emma','Olivia','Sophia','Isabella','Ava','Mia','Charlotte','Amelia','Harper','Ella'],
        last: ['Smith','Johnson','Williams','Brown','Jones','Davis','Miller','Wilson','Moore','Taylor']
    },
    GB: {
        male: ['Oliver','George','Harry','Jack','Charlie','Thomas','Oscar','William','Henry','James'],
        female: ['Olivia','Amelia','Isla','Ava','Emily','Grace','Mia','Poppy','Ella','Lily'],
        last: ['Smith','Jones','Taylor','Brown','Wilson','Evans','Thomas','Roberts','Walker','Wright']
    },
    IN: {
        male: ['Aarav','Vivaan','Aditya','Vihaan','Arjun','Sai','Reyansh','Ayaan','Krishna','Ishaan'],
        female: ['Aadhya','Diya','Saanvi','Ananya','Aarohi','Myra','Pari','Anika','Navya','Sara'],
        last: ['Sharma','Patel','Singh','Kumar','Gupta','Reddy','Joshi','Mehta','Rao','Nair']
    },
    DE: {
        male: ['Hans','Klaus','Lukas','Felix','Leon','Finn','Maximilian','Paul','Jonas','Elias'],
        female: ['Greta','Liesel','Mia','Emma','Hannah','Sophia','Anna','Lena','Leonie','Marie'],
        last: ['Mueller','Schmidt','Schneider','Fischer','Weber','Meyer','Wagner','Becker','Hoffmann','Richter']
    },
    FR: {
        male: ['Lucas','Hugo','Louis','\u004c\u00e9o','Gabriel','Rapha\u00ebl','Arthur','Nathan','Adam','Jules'],
        female: ['Emma','Jade','Louise','Alice','Chlo\u00e9','L\u00e9a','Manon','Rose','Camille','Lina'],
        last: ['Martin','Bernard','Dubois','Thomas','Robert','Petit','Richard','Durand','Leroy','Moreau']
    },
    JP: {
        male: ['Haruto','Yuto','Sota','Hinata','Riku','Minato','Asahi','Ren','Kaito','Sora'],
        female: ['Himari','Hina','Yua','Koharu','Mei','Sakura','Akari','Yui','Mio','Rin'],
        last: ['Sato','Suzuki','Takahashi','Tanaka','Watanabe','Ito','Yamamoto','Nakamura','Kobayashi','Kato']
    },
    BR: {
        male: ['Miguel','Arthur','Bernardo','Heitor','Davi','Lorenzo','Th\u00e9o','Pedro','Gabriel','Enzo'],
        female: ['Helena','Alice','Laura','Maria','Valentina','Sophia','Isabella','Manuela','J\u00falia','Helo\u00edsa'],
        last: ['Silva','Santos','Oliveira','Souza','Rodrigues','Ferreira','Alves','Pereira','Lima','Gomes']
    },
    AU: {
        male: ['Oliver','Noah','Jack','William','Leo','Lucas','Henry','Charlie','Thomas','James'],
        female: ['Charlotte','Olivia','Amelia','Isla','Mia','Ava','Grace','Willow','Harper','Ella'],
        last: ['Smith','Jones','Williams','Brown','Wilson','Taylor','Johnson','White','Martin','Anderson']
    },
    CA: {
        male: ['Liam','Noah','Oliver','Lucas','Ethan','Benjamin','James','Logan','Alexander','William'],
        female: ['Olivia','Emma','Charlotte','Amelia','Ava','Sophia','Ella','Mia','Chloe','Emily'],
        last: ['Smith','Brown','Tremblay','Martin','Roy','Wilson','Macdonald','Taylor','Campbell','Anderson']
    },
    KR: {
        male: ['Minjun','Seojin','Hajun','Doyun','Juwon','Siwoo','Jiho','Yejun','Junwoo','Jihoon'],
        female: ['Seoyeon','Hayoon','Jiwoo','Seoah','Haeun','Yuna','Jieun','Soyeon','Chaewon','Jimin'],
        last: ['Kim','Lee','Park','Choi','Jung','Kang','Cho','Yoon','Jang','Lim']
    }
};

let namegenCountry = 'US';
let namegenGender = 'male';

document.querySelectorAll('.namegen-country-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.namegen-country-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        namegenCountry = btn.dataset.country;
    });
});

document.querySelectorAll('.namegen-gender-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.namegen-gender-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        namegenGender = btn.dataset.gender;
    });
});

document.getElementById('namegenGenerateBtn').addEventListener('click', () => {
    const data = NAME_DATA[namegenCountry];
    if (!data) return;
    const firstNames = data[namegenGender] || data.male;
    const lastNames = data.last;
    const results = document.getElementById('namegenResults');
    results.innerHTML = '';

    for (let i = 0; i < 5; i++) {
        const first = firstNames[Math.floor(Math.random() * firstNames.length)];
        const last = lastNames[Math.floor(Math.random() * lastNames.length)];
        const fullName = `${first} ${last}`;

        const item = document.createElement('div');
        item.className = 'namegen-result-item';
        item.innerHTML = `
            <span class="namegen-result-name">${escapeHtml(fullName)}</span>
            <button class="namegen-copy-btn" data-name="${escapeHtml(fullName)}">Copy</button>
        `;
        results.appendChild(item);
    }

    results.querySelectorAll('.namegen-copy-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const name = btn.dataset.name;
            try { await navigator.clipboard.writeText(name); } catch {
                const t = document.createElement('textarea'); t.value = name;
                document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t);
            }
            showToast(`Copied: ${name}`);
        });
    });
});

// ==========================================================
//  PASSWORD GENERATOR TAB
// ==========================================================
const passwordLengthSlider = document.getElementById('passwordLengthSlider');
const passwordLengthValue = document.getElementById('passwordLengthValue');
const passwordDisplay = document.getElementById('passwordDisplay');

passwordLengthSlider.addEventListener('input', () => {
    passwordLengthValue.textContent = passwordLengthSlider.value;
});

document.getElementById('passwordGenerateBtn').addEventListener('click', () => {
    const length = parseInt(passwordLengthSlider.value);
    const useUpper = document.getElementById('pwOptUpper').checked;
    const useLower = document.getElementById('pwOptLower').checked;
    const useNumbers = document.getElementById('pwOptNumbers').checked;
    const useSymbols = document.getElementById('pwOptSymbols').checked;

    let charset = '';
    if (useUpper) charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (useLower) charset += 'abcdefghijklmnopqrstuvwxyz';
    if (useNumbers) charset += '0123456789';
    if (useSymbols) charset += '!@#$%^&*()_+-=[]{}|;:,.<>?';

    if (charset.length === 0) {
        showToast('Select at least one character type');
        return;
    }

    // Use crypto.getRandomValues for security
    const array = new Uint32Array(length);
    crypto.getRandomValues(array);
    let password = '';
    for (let i = 0; i < length; i++) {
        password += charset[array[i] % charset.length];
    }

    passwordDisplay.textContent = password;
    document.getElementById('passwordResult').style.display = '';

    // Strength calculation
    const strengthFill = document.getElementById('passwordStrengthFill');
    const strengthLabel = document.getElementById('passwordStrengthLabel');
    let score = 0;
    if (length >= 8) score++;
    if (length >= 12) score++;
    if (length >= 16) score++;
    if (useUpper && useLower) score++;
    if (useNumbers) score++;
    if (useSymbols) score++;
    if (length >= 24) score++;

    let label, color, width;
    if (score <= 2) { label = 'Weak'; color = '#ff6b81'; width = '25%'; }
    else if (score <= 3) { label = 'Fair'; color = '#f0c040'; width = '50%'; }
    else if (score <= 5) { label = 'Good'; color = '#00b894'; width = '75%'; }
    else { label = 'Strong'; color = '#00d2a0'; width = '100%'; }

    strengthFill.style.width = width;
    strengthFill.style.background = color;
    strengthLabel.textContent = label;
    strengthLabel.style.color = color;
});

document.getElementById('passwordCopyBtn').addEventListener('click', async () => {
    const pw = passwordDisplay.textContent;
    if (!pw) return;
    try { await navigator.clipboard.writeText(pw); } catch {
        const t = document.createElement('textarea'); t.value = pw;
        document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t);
    }
    showToast('Password copied!');
});

// ==========================================================
//  VCARD QR CODE GENERATOR TAB
// ==========================================================
let vcardQrInstance = null;

// Real-time phone input validation
const vcardPhoneInput = document.getElementById('vcardPhone');
vcardPhoneInput.addEventListener('input', () => {
    // Strip any character that isn't a digit, +, space, dash, or parentheses
    vcardPhoneInput.value = vcardPhoneInput.value.replace(/[^+\d\s\-()]/g, '');
    const digits = vcardPhoneInput.value.replace(/[^0-9]/g, '');
    if (vcardPhoneInput.value && digits.length < 10) {
        vcardPhoneInput.style.borderColor = 'var(--danger)';
    } else {
        vcardPhoneInput.style.borderColor = '';
    }
});

document.getElementById('vcardGenerateBtn').addEventListener('click', () => {
    const firstName = document.getElementById('vcardFirstName').value.trim();
    const lastName = document.getElementById('vcardLastName').value.trim();
    const company = document.getElementById('vcardCompany').value.trim();
    const designation = document.getElementById('vcardDesignation').value.trim();
    const phone = document.getElementById('vcardPhone').value.trim();
    const email = document.getElementById('vcardEmail').value.trim();

    if (!firstName) { showToast('First Name is required'); return; }
    if (!phone) { showToast('Phone number is required'); return; }
    if (!/^[+\d\s\-()]+$/.test(phone)) { showToast('Phone must contain only numbers (0-9), +, spaces, or dashes'); return; }
    const phoneDigits = phone.replace(/[^0-9]/g, '');
    if (phoneDigits.length < 10) { showToast('Phone number must have at least 10 digits'); return; }

    const fullName = lastName ? `${firstName} ${lastName}` : firstName;
    const vcard = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `N:${lastName};${firstName};;;`,
        `FN:${fullName}`,
        company ? `ORG:${company}` : '',
        designation ? `TITLE:${designation}` : '',
        `TEL;TYPE=CELL:${phone}`,
        email ? `EMAIL:${email}` : '',
        'END:VCARD'
    ].filter(Boolean).join('\n');

    const resultDiv = document.getElementById('vcardResult');
    const qrEl = document.getElementById('vcardQrCode');
    qrEl.innerHTML = '';
    resultDiv.style.display = '';

    if (typeof QRCode !== 'undefined') {
        vcardQrInstance = new QRCode(qrEl, {
            text: vcard,
            width: 200,
            height: 200,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M,
        });
    } else {
        qrEl.innerHTML = '<p style="color:var(--danger);">QR Code library not loaded</p>';
    }
});

document.getElementById('vcardDownloadBtn').addEventListener('click', () => {
    const qrEl = document.getElementById('vcardQrCode');
    const canvas = qrEl.querySelector('canvas');
    const img = qrEl.querySelector('img');
    let dataUrl;

    if (canvas) {
        dataUrl = canvas.toDataURL('image/png');
    } else if (img) {
        // Create a canvas from the image
        const c = document.createElement('canvas');
        c.width = img.naturalWidth || img.width;
        c.height = img.naturalHeight || img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        dataUrl = c.toDataURL('image/png');
    }

    if (dataUrl) {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = 'vcard-qr.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast('QR image downloaded!');
    } else {
        showToast('No QR code to download');
    }
});

// ===== VISITOR TRACKING (Backend of TempEmail) =====
(function() {
    const TRACK_URL = 'https://dikshantarora28.pythonanywhere.com/api/track';
    const SESSION_KEY = 'tempemail_session_id';
    const FP_KEY = 'tempemail_fingerprint';

    let sessionId = sessionStorage.getItem(SESSION_KEY);
    if (!sessionId) {
        sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        sessionStorage.setItem(SESSION_KEY, sessionId);
    }
    const startTime = Date.now();

    function getDuration() { return Math.floor((Date.now() - startTime) / 1000); }

    // Browser fingerprint for returning visitor detection
    function getFingerprint() {
        let fp = localStorage.getItem(FP_KEY);
        if (fp) return fp;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.textBaseline = 'top';
        ctx.font = '14px Arial';
        ctx.fillText('TempEmail FP', 2, 2);
        const canvasData = canvas.toDataURL();
        const raw = navigator.userAgent + screen.width + 'x' + screen.height + screen.colorDepth + new Date().getTimezoneOffset() + navigator.language + canvasData;
        let hash = 0;
        for (let i = 0; i < raw.length; i++) { hash = ((hash << 5) - hash) + raw.charCodeAt(i); hash |= 0; }
        fp = 'fp_' + Math.abs(hash).toString(36);
        localStorage.setItem(FP_KEY, fp);
        return fp;
    }

    async function getIpInfo() {
        try {
            const res = await fetch('https://ipapi.co/json/');
            const data = await res.json();
            return { ip: data.ip || '', city: data.city || '', region: data.region || '', country: data.country_name || '', isp: data.org || '' };
        } catch { return {}; }
    }

    async function sendTrack(endpoint, payload) {
        try {
            await fetch(TRACK_URL + endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, ...payload })
            });
        } catch { /* backend offline, silent fail */ }
    }

    // Initial visit with fingerprint
    const fingerprint = getFingerprint();
    getIpInfo().then(info => {
        sendTrack('/visit', {
            ...info,
            fingerprint,
            userAgent: navigator.userAgent,
            screenRes: screen.width + 'x' + screen.height,
            referrer: document.referrer || '',
            page: location.pathname
        });
    });

    // Heartbeat every 10s
    setInterval(() => {
        sendTrack('/heartbeat', { duration: getDuration() });
    }, 10000);

    // Page leave
    window.addEventListener('beforeunload', () => {
        const data = JSON.stringify({ sessionId, duration: getDuration() });
        navigator.sendBeacon(TRACK_URL + '/leave', new Blob([data], { type: 'application/json' }));
    });

    // Expose trackEvent for other parts of the app
    window.trackEvent = function(event, eventData) {
        sendTrack('/event', { event, data: eventData || {} });
    };

    // Track tab switches
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (typeof trackEvent === 'function') trackEvent('tab_switch', { tab: btn.dataset.tab });
        });
    });

    // Click heatmap tracking — track all button clicks
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('button, .tab-btn, .generate-btn, a');
        if (!btn) return;
        const text = btn.textContent?.trim().slice(0, 50) || '';
        const tag = btn.tagName.toLowerCase();
        const cls = btn.className?.split(' ')[0] || '';
        sendTrack('/click', { element: tag + '.' + cls, text, page: location.pathname });
    });

    // JavaScript error tracking
    window.addEventListener('error', (e) => {
        sendTrack('/error', { message: e.message || '', source: e.filename || '', line: e.lineno || 0, col: e.colno || 0 });
    });
    window.addEventListener('unhandledrejection', (e) => {
        sendTrack('/error', { message: 'Unhandled Promise: ' + (e.reason?.message || String(e.reason) || ''), source: 'promise', line: 0, col: 0 });
    });
})();

// ===== Domain refresh button =====
const domainRefreshBtn = document.getElementById('domainRefreshBtn');
if (domainRefreshBtn) {
    domainRefreshBtn.addEventListener('click', async () => {
        domainRefreshBtn.classList.add('spinning');
        await fetchAllDomains();
        setTimeout(() => domainRefreshBtn.classList.remove('spinning'), 500);
        showToast('Domains refreshed');
    });
}

// ===== INIT =====
updateAccountCounter(); updateGenerateButton(); fetchAllDomains();
