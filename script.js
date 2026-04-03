// ===== Multi-Provider Temp Email Engine =====
// Providers: Mail.tm, Mail.gw (+ paginated), 1secmail
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

function generateRandomString(len) {
    const c = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let r = '';
    for (let i = 0; i < len; i++) r += c[Math.floor(Math.random() * c.length)];
    return r;
}

// ===== DOM Elements =====
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
// Compose
const composeOverlay   = document.getElementById('composeOverlay');
const composeClose     = document.getElementById('composeClose');
const composeFrom      = document.getElementById('composeFrom');
const composeTo        = document.getElementById('composeTo');
const composeSubject   = document.getElementById('composeSubject');
const composeBody      = document.getElementById('composeBody');
const composeSendBtn   = document.getElementById('composeSendBtn');
const composeCancelBtn = document.getElementById('composeCancelBtn');

// ==========================================================
//  PROVIDER: Mail.tm / Mail.gw  (JWT auth, same API shape)
// ==========================================================
async function mailtm_fetchDomains(base) {
    try {
        const res = await fetch(`${base}/domains?page=1`, {
            headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) return [];
        const data = await res.json();
        const list = data['hydra:member'] || data || [];
        return list.map(d => d.domain);
    } catch { return []; }
}

// Fetch page 2 as well for extra domains
async function mailtm_fetchDomainsPage2(base) {
    try {
        const res = await fetch(`${base}/domains?page=2`, {
            headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) return [];
        const data = await res.json();
        const list = data['hydra:member'] || data || [];
        return list.map(d => d.domain);
    } catch { return []; }
}

async function mailtm_createAccount(base, address, password) {
    const res = await fetch(`${base}/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, password }),
    });
    if (!res.ok) throw new Error(`Account creation failed (${res.status})`);
    const acc = await res.json();

    const tokRes = await fetch(`${base}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, password }),
    });
    if (!tokRes.ok) throw new Error(`Token failed (${tokRes.status})`);
    const tok = await tokRes.json();

    return { id: acc.id, token: tok.token };
}

async function mailtm_fetchMessages(base, token) {
    const res = await fetch(`${base}/messages`, {
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data['hydra:member'] || data || []).map(m => ({
        id: m.id, from: m.from, subject: m.subject, intro: m.intro,
        seen: m.seen, createdAt: m.createdAt, _provider: 'mailtm',
    }));
}

async function mailtm_fetchMessage(base, token, id) {
    const res = await fetch(`${base}/messages/${id}`, {
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Failed to load message');
    return res.json();
}

// SEND email via Mail.tm / Mail.gw
async function mailtm_sendMessage(base, token, to, subject, text) {
    const res = await fetch(`${base}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ to: [{ address: to }], subject, text }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Send failed (${res.status}): ${err}`);
    }
    return res.json();
}

// ==========================================================
//  PROVIDER: 1secmail  (no auth, simple REST)
// ==========================================================
const SEC_BASE = 'https://www.1secmail.com/api/v1/';

async function secmail_fetchDomains() {
    try {
        const res = await fetch(`${SEC_BASE}?action=getDomainList`);
        if (!res.ok) return [];
        return res.json();
    } catch { return []; }
}

async function secmail_fetchMessages(login, domain) {
    try {
        const res = await fetch(`${SEC_BASE}?action=getMessages&login=${encodeURIComponent(login)}&domain=${encodeURIComponent(domain)}`);
        if (!res.ok) return [];
        const data = await res.json();
        return data.map(m => ({
            id: m.id, from: { address: m.from, name: m.from.split('@')[0] },
            subject: m.subject, intro: '', seen: false, createdAt: m.date, _provider: '1secmail',
        }));
    } catch { return []; }
}

async function secmail_fetchMessage(login, domain, id) {
    const res = await fetch(`${SEC_BASE}?action=readMessage&login=${encodeURIComponent(login)}&domain=${encodeURIComponent(domain)}&id=${id}`);
    if (!res.ok) throw new Error('Failed to load message');
    const m = await res.json();
    return {
        id: m.id, from: { address: m.from, name: m.from.split('@')[0] },
        subject: m.subject, text: m.textBody || '', html: m.htmlBody ? [m.htmlBody] : [], createdAt: m.date,
    };
}

// ==========================================================
//  DOMAIN FETCHING — all providers, paginated
// ==========================================================
async function fetchAllDomains() {
    domainSelect.innerHTML = '<option>Loading domains...</option>';

    const results = await Promise.allSettled([
        mailtm_fetchDomains('https://api.mail.tm'),
        mailtm_fetchDomainsPage2('https://api.mail.tm'),
        mailtm_fetchDomains('https://api.mail.gw'),
        mailtm_fetchDomainsPage2('https://api.mail.gw'),
        secmail_fetchDomains(),
    ]);

    allDomains = [];
    const existing = new Set();

    function addDomains(domains, provider, base) {
        domains.forEach(d => {
            if (!existing.has(d)) {
                allDomains.push({ domain: d, provider, base });
                existing.add(d);
            }
        });
    }

    // Mail.tm page 1 + 2
    addDomains(results[0].status === 'fulfilled' ? results[0].value : [], 'mailtm', 'https://api.mail.tm');
    addDomains(results[1].status === 'fulfilled' ? results[1].value : [], 'mailtm', 'https://api.mail.tm');

    // Mail.gw page 1 + 2
    addDomains(results[2].status === 'fulfilled' ? results[2].value : [], 'mailtm', 'https://api.mail.gw');
    addDomains(results[3].status === 'fulfilled' ? results[3].value : [], 'mailtm', 'https://api.mail.gw');

    // 1secmail — use API result or hardcoded fallback (CORS blocks 1secmail in some envs)
    let secDomains = results[4].status === 'fulfilled' ? results[4].value : [];
    if (secDomains.length === 0) {
        secDomains = [
            '1secmail.com','1secmail.org','1secmail.net',
            'esiix.com','wwjmp.com','kzccv.com',
            'dpptd.com','txcct.com','rteet.com','dcctb.com',
        ];
    }
    secDomains.forEach(d => {
        if (!existing.has(d)) {
            allDomains.push({ domain: d, provider: '1secmail' });
            existing.add(d);
        }
    });

    console.log(`Loaded ${allDomains.length} total domains`);
    domainCount.textContent = `${allDomains.length} domains`;
    populateDomainDropdown();
}

// ==========================================================
//  DROPDOWN POPULATION
// ==========================================================
function populateDomainDropdown() {
    domainSelect.innerHTML = '';

    if (allDomains.length === 0) {
        domainSelect.innerHTML = '<option>No domains available</option>';
        return;
    }

    const mailtmDomains  = allDomains.filter(d => d.provider === 'mailtm');
    const secmailDomains = allDomains.filter(d => d.provider === '1secmail');

    if (mailtmDomains.length > 0) {
        const grp = document.createElement('optgroup');
        grp.label = `Mail.tm / Mail.gw  (${mailtmDomains.length})  \u2014  Send + Receive`;
        mailtmDomains.forEach(d => {
            const opt = document.createElement('option');
            opt.value = JSON.stringify({ provider: 'mailtm', domain: d.domain, base: d.base });
            opt.textContent = `@${d.domain}`;
            grp.appendChild(opt);
        });
        domainSelect.appendChild(grp);
    }

    if (secmailDomains.length > 0) {
        const grp = document.createElement('optgroup');
        grp.label = `1secMail  (${secmailDomains.length})  \u2014  Receive Only`;
        secmailDomains.forEach(d => {
            const opt = document.createElement('option');
            opt.value = JSON.stringify({ provider: '1secmail', domain: d.domain });
            opt.textContent = `@${d.domain}`;
            grp.appendChild(opt);
        });
        domainSelect.appendChild(grp);
    }
}

// ==========================================================
//  CREATE ACCOUNT (multi-provider)
// ==========================================================
async function createAccount(selection) {
    const person = getRandomName();
    const suffix = generateRandomString(2);
    const username = `${person.full}${suffix}`;

    let domainInfo;
    if (selection) {
        domainInfo = JSON.parse(selection);
    } else {
        domainInfo = allDomains[0];
        if (!domainInfo) throw new Error('No domains loaded. Refresh the page.');
    }

    const address = `${username}@${domainInfo.domain}`;

    if (domainInfo.provider === 'mailtm') {
        const password = generateRandomString(16);
        const { id, token } = await mailtm_createAccount(domainInfo.base, address, password);
        return {
            provider: 'mailtm', base: domainInfo.base,
            id, address, token, canSend: true,
            knownMessageIds: new Set(), messages: [],
        };
    }

    if (domainInfo.provider === '1secmail') {
        return {
            provider: '1secmail', address,
            login: username, domain: domainInfo.domain, canSend: false,
            knownMessageIds: new Set(), messages: [],
        };
    }

    throw new Error('Unknown provider');
}

// ==========================================================
//  FETCH MESSAGES (multi-provider)
// ==========================================================
async function fetchMessagesForAccount(acc) {
    if (acc.provider === 'mailtm')  return mailtm_fetchMessages(acc.base, acc.token);
    if (acc.provider === '1secmail') return secmail_fetchMessages(acc.login, acc.domain);
    return [];
}

async function fetchMessageForAccount(acc, msgId) {
    if (acc.provider === 'mailtm')  return mailtm_fetchMessage(acc.base, acc.token, msgId);
    if (acc.provider === '1secmail') return secmail_fetchMessage(acc.login, acc.domain, msgId);
    throw new Error('Unknown provider');
}

// ==========================================================
//  SEND EMAIL
// ==========================================================
async function sendEmail(to, subject, text) {
    const acc = accounts[activeIndex];
    if (!acc || acc.provider !== 'mailtm') {
        throw new Error('Send is only supported for Mail.tm / Mail.gw accounts');
    }
    return mailtm_sendMessage(acc.base, acc.token, to, subject, text);
}

// ==========================================================
//  UI HELPERS
// ==========================================================
function showToast(text) {
    toast.textContent = text;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
}

function formatTime(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    if (diff < 60000)    return 'Just now';
    if (diff < 3600000)  return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatFullDate(dateString) {
    return new Date(dateString).toLocaleString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
}

function getInitial(sender) {
    if (!sender || !sender.address) return '?';
    return sender.address.charAt(0).toUpperCase();
}

function getSenderName(from) {
    if (!from) return 'Unknown';
    return from.name || from.address || 'Unknown';
}

function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
}

// ==========================================================
//  ACCOUNT COUNTER / TABS / SWITCHING
// ==========================================================
function updateAccountCounter() {
    accountCounter.textContent = `${accounts.length} / ${MAX_ACCOUNTS}`;
    accountCounter.classList.toggle('at-limit', accounts.length >= MAX_ACCOUNTS);
}

function renderAccountTabs() {
    accountTabs.innerHTML = '';
    if (accounts.length === 0) { accountTabs.style.display = 'none'; return; }
    accountTabs.style.display = 'flex';

    accounts.forEach((acc, idx) => {
        const tab = document.createElement('div');
        tab.className = `account-tab${idx === activeIndex ? ' active' : ''}`;

        const dot  = document.createElement('span'); dot.className = 'tab-dot';
        const addr = document.createElement('span'); addr.className = 'tab-address';
        addr.textContent = acc.address;
        const del  = document.createElement('button'); del.className = 'tab-delete';
        del.title = 'Remove'; del.innerHTML = '&times;';
        del.onclick = e => { e.stopPropagation(); removeAccount(idx); };

        tab.append(dot, addr, del);
        tab.addEventListener('click', () => switchToAccount(idx));
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
    // Show/hide compose based on provider
    composeBtn.style.display = acc.canSend ? 'inline-flex' : 'none';
    renderAccountTabs();
    renderMessages(acc.messages);
}

function removeAccount(idx) {
    accounts.splice(idx, 1);
    updateAccountCounter();

    if (accounts.length === 0) {
        activeIndex = -1;
        emailText.textContent = 'Click generate to create a new email';
        emailText.className = 'email-placeholder';
        emailDisplay.classList.remove('active');
        copyBtn.style.display = 'none';
        composeBtn.style.display = 'none';
        refreshBtn.style.display = 'none';
        autoRefreshBadge.style.display = 'none';
        inboxSection.style.display = 'none';
        accountTabs.style.display = 'none';
        if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
        updateGenerateButton();
        renderAccountTabs();
        return;
    }

    if (activeIndex >= accounts.length) activeIndex = accounts.length - 1;
    else if (idx < activeIndex) activeIndex--;
    else if (idx === activeIndex) activeIndex = Math.min(idx, accounts.length - 1);

    switchToAccount(activeIndex);
    updateGenerateButton();
    showToast('Email removed');
}

// ==========================================================
//  RENDER MESSAGES
// ==========================================================
function renderMessages(messages) {
    const count = messages.length;
    messageCount.textContent = `${count} message${count !== 1 ? 's' : ''}`;

    if (count === 0) {
        inboxList.innerHTML = '';
        inboxList.appendChild(emptyInbox);
        emptyInbox.style.display = '';
        return;
    }

    emptyInbox.style.display = 'none';
    messages.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const acc = accounts[activeIndex];
    const fragment = document.createDocumentFragment();

    messages.forEach(msg => {
        const isNew = !acc.knownMessageIds.has(msg.id);
        acc.knownMessageIds.add(msg.id);
        const sender = msg.from || {};

        const item = document.createElement('div');
        item.className = `email-item${!msg.seen ? ' unread' : ''}${isNew ? ' new-email' : ''}`;
        item.onclick = () => openEmail(msg.id);

        item.innerHTML = `
            <div class="email-avatar">${getInitial(sender)}</div>
            <div class="email-item-content">
                <div class="email-item-top">
                    <span class="email-item-sender">${escapeHtml(getSenderName(sender))}</span>
                    <span class="email-item-time">${formatTime(msg.createdAt)}</span>
                </div>
                <div class="email-item-subject">${escapeHtml(msg.subject || '(No Subject)')}</div>
                <div class="email-item-preview">${escapeHtml(msg.intro || '')}</div>
            </div>
        `;
        fragment.appendChild(item);
    });

    inboxList.innerHTML = '';
    inboxList.appendChild(fragment);
}

// ==========================================================
//  OPEN / CLOSE EMAIL MODAL
// ==========================================================
async function openEmail(id) {
    const acc = accounts[activeIndex];
    modalOverlay.classList.add('active');
    modalSubject.textContent = 'Loading...';
    modalFrom.textContent = '';
    modalDate.textContent = '';
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
            Object.assign(iframe.style, { width: '100%', minHeight: '300px', border: 'none', borderRadius: '8px', background: 'white' });
            modalBody.innerHTML = '';
            modalBody.appendChild(iframe);
            const htmlContent = msg.html.join ? msg.html.join('') : msg.html;
            iframe.srcdoc = `<html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.6;color:#333;padding:16px;margin:0;word-wrap:break-word}img{max-width:100%;height:auto}a{color:#6c5ce7}pre{overflow-x:auto}</style></head><body>${htmlContent}</body></html>`;
            iframe.onload = () => { try { iframe.style.height = Math.min(iframe.contentDocument.body.scrollHeight + 32, 600) + 'px'; } catch {} };
        } else {
            modalBody.innerHTML = `<pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(msg.text || 'No content')}</pre>`;
        }

        refreshInbox();
    } catch (err) {
        modalBody.innerHTML = `<p style="color:var(--danger);">Failed to load: ${escapeHtml(err.message)}</p>`;
    }
}

function closeModal()   { modalOverlay.classList.remove('active'); }
function closeCompose()  { composeOverlay.classList.remove('active'); }

modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
composeClose.addEventListener('click', closeCompose);
composeCancelBtn.addEventListener('click', closeCompose);
composeOverlay.addEventListener('click', e => { if (e.target === composeOverlay) closeCompose(); });
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeModal(); closeCompose(); }
});

// ==========================================================
//  COMPOSE / SEND
// ==========================================================
composeBtn.addEventListener('click', () => {
    if (activeIndex < 0) return;
    const acc = accounts[activeIndex];
    if (!acc.canSend) {
        showToast('Send is only available for Mail.tm / Mail.gw accounts');
        return;
    }
    composeFrom.textContent = `Sending as: ${acc.address}`;
    composeTo.value = '';
    composeSubject.value = '';
    composeBody.value = '';
    composeOverlay.classList.add('active');
    composeTo.focus();
});

composeSendBtn.addEventListener('click', async () => {
    const to      = composeTo.value.trim();
    const subject = composeSubject.value.trim();
    const body    = composeBody.value.trim();

    if (!to) { showToast('Please enter a recipient email'); composeTo.focus(); return; }
    if (!subject) { showToast('Please enter a subject'); composeSubject.focus(); return; }

    composeSendBtn.disabled = true;
    composeSendBtn.innerHTML = `<svg class="refresh-icon spinning" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg> Sending...`;

    try {
        await sendEmail(to, subject, body || '(empty)');
        closeCompose();
        showToast('Email sent successfully!');
    } catch (err) {
        console.error('Send failed:', err);
        showToast('Send failed: ' + err.message);
    } finally {
        composeSendBtn.disabled = false;
        composeSendBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Send Email`;
    }
});

// ==========================================================
//  REFRESH / POLLING
// ==========================================================
async function refreshInbox() {
    if (activeIndex < 0 || !accounts[activeIndex]) return;
    try {
        refreshIcon.classList.add('spinning');
        const acc = accounts[activeIndex];
        acc.messages = await fetchMessagesForAccount(acc);
        renderMessages(acc.messages);
    } catch (err) {
        console.error('Refresh failed:', err);
    } finally {
        refreshIcon.classList.remove('spinning');
    }
}

function startPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(refreshInbox, 5000);
}

// ==========================================================
//  GENERATE BUTTON STATE
// ==========================================================
function updateGenerateButton() {
    const atLimit = accounts.length >= MAX_ACCOUNTS;
    generateBtn.disabled = atLimit;

    if (atLimit) {
        generateBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> Limit Reached (5/5)`;
    } else if (accounts.length > 0) {
        generateBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Email (${accounts.length}/${MAX_ACCOUNTS})`;
    } else {
        generateBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg> Generate Email`;
    }
}

// ==========================================================
//  EVENT LISTENERS
// ==========================================================
copyBtn.addEventListener('click', async () => {
    if (activeIndex < 0) return;
    const addr = accounts[activeIndex].address;
    try { await navigator.clipboard.writeText(addr); }
    catch { const t = document.createElement('textarea'); t.value = addr; document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t); }
    showToast('Copied to clipboard!');
});

premiumToggle.addEventListener('change', () => {
    isPremium = premiumToggle.checked;
    domainSelector.style.display = isPremium ? '' : 'none';
});

generateBtn.addEventListener('click', async () => {
    if (accounts.length >= MAX_ACCOUNTS) {
        showToast('Maximum 5 emails reached. Remove one first.');
        return;
    }

    generateBtn.disabled = true;
    const prevHTML = generateBtn.innerHTML;
    generateBtn.innerHTML = `<svg class="refresh-icon spinning" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg> Generating...`;

    try {
        const selection = isPremium ? domainSelect.value : null;
        const account = await createAccount(selection);

        accounts.push(account);
        activeIndex = accounts.length - 1;

        emailText.textContent = account.address;
        emailText.className = 'email-address';
        emailDisplay.classList.add('active');
        copyBtn.style.display = 'flex';
        composeBtn.style.display = account.canSend ? 'inline-flex' : 'none';
        refreshBtn.style.display = 'inline-flex';
        autoRefreshBadge.style.display = 'inline-flex';
        inboxSection.style.display = '';

        renderMessages([]);
        renderAccountTabs();
        updateAccountCounter();
        updateGenerateButton();
        startPolling();
        showToast('Email generated successfully!');
    } catch (err) {
        console.error('Generate failed:', err);
        showToast('Error: ' + err.message);
        generateBtn.innerHTML = prevHTML;
    } finally {
        generateBtn.disabled = accounts.length >= MAX_ACCOUNTS;
    }
});

refreshBtn.addEventListener('click', refreshInbox);

// ==========================================================
//  INIT
// ==========================================================
updateAccountCounter();
updateGenerateButton();
fetchAllDomains();
