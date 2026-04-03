// ===== Multi-Provider Temp Email Engine =====
// Providers: Mail.tm, Mail.gw, 1secmail, Guerrilla Mail (send capable)
const MAX_ACCOUNTS = 5;

// State
let accounts = [];
let activeIndex = -1;
let pollingInterval = null;
let allDomains = [];
let isPremium = false;

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
    return { first, last, full: `${first}_${last}` };
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
const composeBtn       = document.getElementById('composeBtn');
const refreshBtn       = document.getElementById('refreshBtn');
const refreshIcon      = document.getElementById('refreshIcon');
const autoRefreshBadge = document.getElementById('autoRefreshBadge');
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
const composeOverlay   = document.getElementById('composeOverlay');
const composeClose     = document.getElementById('composeClose');
const composeFrom      = document.getElementById('composeFrom');
const composeTo        = document.getElementById('composeTo');
const composeSubject   = document.getElementById('composeSubject');
const composeBody      = document.getElementById('composeBody');
const composeSendBtn   = document.getElementById('composeSendBtn');
const composeCancelBtn = document.getElementById('composeCancelBtn');

// ==========================================================
//  PROVIDER: Mail.tm / Mail.gw
// ==========================================================
async function mailtm_fetchDomains(base) {
    try {
        const r1 = await fetch(`${base}/domains?page=1`, { headers: { 'Content-Type': 'application/json' } });
        if (!r1.ok) return [];
        const d1 = await r1.json();
        const list = (d1['hydra:member'] || d1 || []).map(d => d.domain);
        // Try page 2
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
//  PROVIDER: 1secmail
// ==========================================================
const SEC_BASE = 'https://www.1secmail.com/api/v1/';
async function secmail_fetchDomains() {
    try { const r = await fetch(`${SEC_BASE}?action=getDomainList`); if (!r.ok) return []; return r.json(); } catch { return []; }
}
async function secmail_fetchMessages(login, domain) {
    try {
        const r = await fetch(`${SEC_BASE}?action=getMessages&login=${encodeURIComponent(login)}&domain=${encodeURIComponent(domain)}`);
        if (!r.ok) return [];
        return (await r.json()).map(m => ({ id: m.id, from: { address: m.from, name: m.from.split('@')[0] }, subject: m.subject, intro: '', seen: false, createdAt: m.date }));
    } catch { return []; }
}
async function secmail_fetchMessage(login, domain, id) {
    const r = await fetch(`${SEC_BASE}?action=readMessage&login=${encodeURIComponent(login)}&domain=${encodeURIComponent(domain)}&id=${id}`);
    if (!r.ok) throw new Error('Failed to load');
    const m = await r.json();
    return { id: m.id, from: { address: m.from, name: m.from.split('@')[0] }, subject: m.subject, text: m.textBody || '', html: m.htmlBody ? [m.htmlBody] : [], createdAt: m.date };
}

// ==========================================================
//  PROVIDER: Guerrilla Mail  (SEND + RECEIVE)
// ==========================================================
const GM_BASE = 'https://api.guerrillamail.com/ajax.php';

async function gm_getAddress() {
    const res = await fetch(`${GM_BASE}?f=get_email_address&lang=en`, {});
    if (!res.ok) throw new Error('Guerrilla Mail unavailable');
    const data = await res.json();
    return { address: data.email_addr, sid: data.sid_token, alias: data.alias };
}

async function gm_setAddress(sid, username) {
    const res = await fetch(`${GM_BASE}?f=set_email_user&email_user=${encodeURIComponent(username)}&lang=en&sid_token=${encodeURIComponent(sid)}`, {});
    if (!res.ok) throw new Error('Failed to set address');
    const data = await res.json();
    return { address: data.email_addr, sid: data.sid_token };
}

async function gm_fetchMessages(sid) {
    try {
        const res = await fetch(`${GM_BASE}?f=check_email&sid_token=${encodeURIComponent(sid)}&seq=0`, {});
        if (!res.ok) return [];
        const data = await res.json();
        return (data.list || []).map(m => ({
            id: m.mail_id, from: { address: m.mail_from, name: m.mail_from.split('@')[0] },
            subject: m.mail_subject, intro: m.mail_excerpt || '', seen: m.mail_read === '1',
            createdAt: new Date(parseInt(m.mail_timestamp) * 1000).toISOString(),
        }));
    } catch { return []; }
}

async function gm_fetchMessage(sid, id) {
    const res = await fetch(`${GM_BASE}?f=fetch_email&sid_token=${encodeURIComponent(sid)}&email_id=${id}`, {});
    if (!res.ok) throw new Error('Failed to load');
    const m = await res.json();
    return {
        id: m.mail_id, from: { address: m.mail_from, name: m.mail_from.split('@')[0] },
        subject: m.mail_subject, text: m.mail_body || '',
        html: m.mail_body ? [m.mail_body] : [], createdAt: new Date(parseInt(m.mail_timestamp) * 1000).toISOString(),
    };
}

// Send email via hidden form POST (bypasses CORS — form submissions are exempt)
function gm_sendEmail(sid, to, subject, body) {
    return new Promise((resolve, reject) => {
        // Create hidden iframe to receive the form response
        const iframeName = 'gm_send_frame_' + Date.now();
        const iframe = document.createElement('iframe');
        iframe.name = iframeName;
        iframe.style.display = 'none';
        document.body.appendChild(iframe);

        // Create hidden form targeting the iframe
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = GM_BASE;
        form.target = iframeName;
        form.style.display = 'none';

        const fields = {
            f: 'send_email',
            sid_token: sid,
            email_to: to,
            subject: subject,
            body: body,
        };

        Object.entries(fields).forEach(([name, value]) => {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = name;
            input.value = value;
            form.appendChild(input);
        });

        document.body.appendChild(form);

        // Listen for iframe load (form submission complete)
        let resolved = false;
        iframe.onload = () => {
            if (!resolved) {
                resolved = true;
                // Clean up
                setTimeout(() => {
                    document.body.removeChild(form);
                    document.body.removeChild(iframe);
                }, 500);
                resolve({ success: true });
            }
        };

        // Timeout after 10s
        setTimeout(() => {
            if (!resolved) {
                resolved = true;
                try { document.body.removeChild(form); document.body.removeChild(iframe); } catch {}
                reject(new Error('Send timed out. Please try again.'));
            }
        }, 10000);

        // Submit the form
        form.submit();
    });
}

// Guerrilla Mail domains
const GM_DOMAINS = [
    'guerrillamail.com', 'guerrillamailblock.com', 'guerrillamail.net',
    'grr.la', 'guerrillamail.org', 'guerrillamail.de',
    'sharklasers.com', 'spam4.me',
];

// ==========================================================
//  DOMAIN FETCHING — all providers
// ==========================================================
async function fetchAllDomains() {
    domainSelect.innerHTML = '<option>Loading domains...</option>';

    const results = await Promise.allSettled([
        mailtm_fetchDomains('https://api.mail.tm'),
        mailtm_fetchDomains('https://api.mail.gw'),
        secmail_fetchDomains(),
    ]);

    allDomains = [];
    const existing = new Set();

    function add(domains, provider, base) {
        domains.forEach(d => { if (!existing.has(d)) { allDomains.push({ domain: d, provider, base }); existing.add(d); } });
    }

    add(results[0].status === 'fulfilled' ? results[0].value : [], 'mailtm', 'https://api.mail.tm');
    add(results[1].status === 'fulfilled' ? results[1].value : [], 'mailtm', 'https://api.mail.gw');

    // 1secmail with fallback
    let secDomains = results[2].status === 'fulfilled' ? results[2].value : [];
    if (secDomains.length === 0) secDomains = ['1secmail.com','1secmail.org','1secmail.net','esiix.com','wwjmp.com','kzccv.com','dpptd.com','txcct.com','rteet.com','dcctb.com'];
    secDomains.forEach(d => { if (!existing.has(d)) { allDomains.push({ domain: d, provider: '1secmail' }); existing.add(d); } });

    // Guerrilla Mail
    GM_DOMAINS.forEach(d => { if (!existing.has(d)) { allDomains.push({ domain: d, provider: 'guerrilla', canSend: true }); existing.add(d); } });

    console.log(`Loaded ${allDomains.length} total domains`);
    domainCount.textContent = `${allDomains.length} domains`;
    populateDomainDropdown();
}

// ==========================================================
//  DROPDOWN
// ==========================================================
function populateDomainDropdown() {
    domainSelect.innerHTML = '';
    if (allDomains.length === 0) { domainSelect.innerHTML = '<option>No domains available</option>'; return; }

    const groups = {
        guerrilla: { label: 'Send + Receive', items: [] },
        mailtm:    { label: 'Receive Only', items: [] },
        '1secmail': { label: 'Receive Only', items: [] },
    };

    allDomains.forEach(d => {
        if (groups[d.provider]) groups[d.provider].items.push(d);
    });

    // Guerrilla first (send capable)
    if (groups.guerrilla.items.length > 0) {
        const grp = document.createElement('optgroup');
        grp.label = `Guerrilla Mail (${groups.guerrilla.items.length}) \u2014 Send + Receive`;
        groups.guerrilla.items.forEach(d => {
            const opt = document.createElement('option');
            opt.value = JSON.stringify({ provider: 'guerrilla', domain: d.domain });
            opt.textContent = `\u2709 @${d.domain}`;
            grp.appendChild(opt);
        });
        domainSelect.appendChild(grp);
    }

    if (groups.mailtm.items.length > 0) {
        const grp = document.createElement('optgroup');
        grp.label = `Mail.tm / Mail.gw (${groups.mailtm.items.length}) \u2014 Receive Only`;
        groups.mailtm.items.forEach(d => {
            const opt = document.createElement('option');
            opt.value = JSON.stringify({ provider: 'mailtm', domain: d.domain, base: d.base });
            opt.textContent = `@${d.domain}`;
            grp.appendChild(opt);
        });
        domainSelect.appendChild(grp);
    }

    if (groups['1secmail'].items.length > 0) {
        const grp = document.createElement('optgroup');
        grp.label = `1secMail (${groups['1secmail'].items.length}) \u2014 Receive Only`;
        groups['1secmail'].items.forEach(d => {
            const opt = document.createElement('option');
            opt.value = JSON.stringify({ provider: '1secmail', domain: d.domain });
            opt.textContent = `@${d.domain}`;
            grp.appendChild(opt);
        });
        domainSelect.appendChild(grp);
    }
}

// ==========================================================
//  CREATE ACCOUNT
// ==========================================================
async function createAccount(selection) {
    const person = getRandomName();
    const suffix = rnd(2);
    const username = `${person.full}${suffix}`;

    let domainInfo;
    if (selection) { domainInfo = JSON.parse(selection); }
    else { domainInfo = allDomains[0]; if (!domainInfo) throw new Error('No domains loaded.'); }

    if (domainInfo.provider === 'mailtm') {
        const address = `${username}@${domainInfo.domain}`;
        const password = rnd(16);
        const { id, token } = await mailtm_createAccount(domainInfo.base, address, password);
        return { provider: 'mailtm', base: domainInfo.base, id, address, token, canSend: false, knownMessageIds: new Set(), messages: [] };
    }

    if (domainInfo.provider === '1secmail') {
        return { provider: '1secmail', address: `${username}@${domainInfo.domain}`, login: username, domain: domainInfo.domain, canSend: false, knownMessageIds: new Set(), messages: [] };
    }

    if (domainInfo.provider === 'guerrilla') {
        // Create guerrilla mail account with custom username
        const { sid } = await gm_getAddress();
        const { address } = await gm_setAddress(sid, username);
        return { provider: 'guerrilla', address, sid, canSend: true, knownMessageIds: new Set(), messages: [] };
    }

    throw new Error('Unknown provider');
}

// ==========================================================
//  FETCH MESSAGES
// ==========================================================
async function fetchMessagesForAccount(acc) {
    if (acc.provider === 'mailtm')    return mailtm_fetchMessages(acc.base, acc.token);
    if (acc.provider === '1secmail')  return secmail_fetchMessages(acc.login, acc.domain);
    if (acc.provider === 'guerrilla') return gm_fetchMessages(acc.sid);
    return [];
}
async function fetchMessageForAccount(acc, msgId) {
    if (acc.provider === 'mailtm')    return mailtm_fetchMessage(acc.base, acc.token, msgId);
    if (acc.provider === '1secmail')  return secmail_fetchMessage(acc.login, acc.domain, msgId);
    if (acc.provider === 'guerrilla') return gm_fetchMessage(acc.sid, msgId);
    throw new Error('Unknown provider');
}

// ==========================================================
//  SEND EMAIL (Guerrilla Mail only — real send from temp address)
// ==========================================================
async function sendEmail(to, subject, body) {
    const acc = accounts[activeIndex];
    if (!acc) throw new Error('No active account');
    if (acc.provider === 'guerrilla') {
        return gm_sendEmail(acc.sid, to, subject, body);
    }
    throw new Error('Send is only available for Guerrilla Mail accounts. Pick a Guerrilla Mail domain to send emails.');
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
function switchToAccount(idx) {
    if (idx < 0 || idx >= accounts.length) return;
    activeIndex = idx;
    const acc = accounts[idx];
    emailText.textContent = acc.address;
    emailText.className = 'email-address';
    emailDisplay.classList.add('active');
    copyBtn.style.display = 'flex';
    composeBtn.style.display = 'inline-flex';
    // Update compose button label based on send capability
    if (acc.canSend) {
        composeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Compose`;
        composeBtn.className = 'btn-send';
    } else {
        composeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Compose`;
        composeBtn.className = 'btn-secondary';
    }
    renderAccountTabs();
    renderMessages(acc.messages);
}
function removeAccount(idx) {
    accounts.splice(idx, 1); updateAccountCounter();
    if (!accounts.length) {
        activeIndex = -1; emailText.textContent = 'Click generate to create a new email'; emailText.className = 'email-placeholder';
        emailDisplay.classList.remove('active'); copyBtn.style.display = 'none'; composeBtn.style.display = 'none';
        refreshBtn.style.display = 'none'; autoRefreshBadge.style.display = 'none'; inboxSection.style.display = 'none'; accountTabs.style.display = 'none';
        if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
        updateGenerateButton(); renderAccountTabs(); return;
    }
    if (activeIndex >= accounts.length) activeIndex = accounts.length - 1;
    else if (idx < activeIndex) activeIndex--;
    else if (idx === activeIndex) activeIndex = Math.min(idx, accounts.length - 1);
    switchToAccount(activeIndex); updateGenerateButton(); showToast('Email removed');
}

// ==========================================================
//  RENDER MESSAGES
// ==========================================================
function renderMessages(messages) {
    const count = messages.length;
    messageCount.textContent = `${count} message${count !== 1 ? 's' : ''}`;
    if (!count) { inboxList.innerHTML = ''; inboxList.appendChild(emptyInbox); emptyInbox.style.display = ''; return; }
    emptyInbox.style.display = 'none';
    messages.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const acc = accounts[activeIndex], frag = document.createDocumentFragment();
    messages.forEach(msg => {
        const isNew = !acc.knownMessageIds.has(msg.id); acc.knownMessageIds.add(msg.id);
        const sender = msg.from || {};
        const item = document.createElement('div');
        item.className = `email-item${!msg.seen ? ' unread' : ''}${isNew ? ' new-email' : ''}`;
        item.onclick = () => openEmail(msg.id);
        item.innerHTML = `<div class="email-avatar">${getInitial(sender)}</div><div class="email-item-content"><div class="email-item-top"><span class="email-item-sender">${escapeHtml(getSenderName(sender))}</span><span class="email-item-time">${formatTime(msg.createdAt)}</span></div><div class="email-item-subject">${escapeHtml(msg.subject || '(No Subject)')}</div><div class="email-item-preview">${escapeHtml(msg.intro || '')}</div></div>`;
        frag.appendChild(item);
    });
    inboxList.innerHTML = ''; inboxList.appendChild(frag);
}

// ==========================================================
//  EMAIL VIEWER MODAL
// ==========================================================
async function openEmail(id) {
    const acc = accounts[activeIndex];
    modalOverlay.classList.add('active');
    modalSubject.textContent = 'Loading...'; modalFrom.textContent = ''; modalDate.textContent = '';
    modalBody.innerHTML = '<div class="skeleton" style="height:200px;"></div>';
    try {
        const msg = await fetchMessageForAccount(acc, id);
        const sender = msg.from || {};
        modalSubject.textContent = msg.subject || '(No Subject)';
        modalFrom.textContent = getSenderName(sender);
        modalDate.textContent = formatFullDate(msg.createdAt);
        if (msg.html && msg.html.length > 0) {
            const iframe = document.createElement('iframe');
            iframe.sandbox = 'allow-same-origin';
            Object.assign(iframe.style, { width: '100%', minHeight: '250px', border: 'none', borderRadius: '8px', background: 'white' });
            modalBody.innerHTML = ''; modalBody.appendChild(iframe);
            const html = msg.html.join ? msg.html.join('') : msg.html;
            iframe.srcdoc = `<html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.6;color:#333;padding:16px;margin:0;word-wrap:break-word}img{max-width:100%;height:auto}a{color:#6c5ce7}</style></head><body>${html}</body></html>`;
            iframe.onload = () => { try { iframe.style.height = Math.min(iframe.contentDocument.body.scrollHeight + 32, 600) + 'px'; } catch {} };
        } else {
            modalBody.innerHTML = `<pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(msg.text || 'No content')}</pre>`;
        }
        refreshInbox();
    } catch (err) { modalBody.innerHTML = `<p style="color:var(--danger);">Failed: ${escapeHtml(err.message)}</p>`; }
}

function closeModal()  { modalOverlay.classList.remove('active'); }
function closeCompose() { composeOverlay.classList.remove('active'); }
modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
composeClose.addEventListener('click', closeCompose);
composeCancelBtn.addEventListener('click', closeCompose);
composeOverlay.addEventListener('click', e => { if (e.target === composeOverlay) closeCompose(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeCompose(); } });

// ==========================================================
//  COMPOSE / SEND
// ==========================================================
composeBtn.addEventListener('click', () => {
    if (activeIndex < 0) return;
    const acc = accounts[activeIndex];
    composeFrom.textContent = `From: ${acc.address}`;
    if (!acc.canSend) {
        composeFrom.textContent = `From: ${acc.address}  (receive-only \u2014 use Guerrilla Mail domain to send)`;
    }
    composeTo.value = ''; composeSubject.value = ''; composeBody.value = '';
    composeSendBtn.disabled = !acc.canSend;
    composeSendBtn.title = acc.canSend ? '' : 'Switch to a Guerrilla Mail account to send';
    composeOverlay.classList.add('active');
    composeTo.focus();
});

composeSendBtn.addEventListener('click', async () => {
    const acc = accounts[activeIndex];
    if (!acc?.canSend) { showToast('Pick a Guerrilla Mail domain to send emails'); return; }

    const to = composeTo.value.trim();
    const subject = composeSubject.value.trim();
    const body = composeBody.value.trim();
    if (!to) { showToast('Enter a recipient email'); composeTo.focus(); return; }
    if (!subject) { showToast('Enter a subject'); composeSubject.focus(); return; }

    composeSendBtn.disabled = true;
    const prevHTML = composeSendBtn.innerHTML;
    composeSendBtn.innerHTML = `<svg class="refresh-icon spinning" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg> Sending...`;

    try {
        await sendEmail(to, subject, body || '(empty)');
        closeCompose();
        showToast('Email sent! Check recipient inbox (or spam folder)');
    } catch (err) {
        console.error('Send failed:', err);
        showToast('Send failed: ' + err.message);
    } finally {
        composeSendBtn.disabled = false;
        composeSendBtn.innerHTML = prevHTML;
    }
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
    const at = accounts.length >= MAX_ACCOUNTS; generateBtn.disabled = at;
    if (at) generateBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> Limit (5/5)`;
    else if (accounts.length > 0) generateBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Email (${accounts.length}/${MAX_ACCOUNTS})`;
    else generateBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg> Generate Email`;
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
        emailText.textContent = account.address; emailText.className = 'email-address';
        emailDisplay.classList.add('active'); copyBtn.style.display = 'flex';
        composeBtn.style.display = 'inline-flex';
        refreshBtn.style.display = 'inline-flex'; autoRefreshBadge.style.display = 'inline-flex'; inboxSection.style.display = '';
        renderMessages([]); renderAccountTabs(); updateAccountCounter(); updateGenerateButton();
        switchToAccount(activeIndex);
        startPolling();
        showToast(account.canSend ? 'Email ready \u2014 Send + Receive!' : 'Email ready \u2014 Receive only');
    } catch (err) { console.error('Generate failed:', err); showToast('Error: ' + err.message); generateBtn.innerHTML = prev; }
    finally { generateBtn.disabled = accounts.length >= MAX_ACCOUNTS; }
});

refreshBtn.addEventListener('click', refreshInbox);

// ==========================================================
//  INIT
// ==========================================================
updateAccountCounter(); updateGenerateButton(); fetchAllDomains();
