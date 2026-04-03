// ===== Multi-Provider Temp Email Engine =====
// Providers: Mail.tm, Mail.gw
const MAX_ACCOUNTS = 5;

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
//  DOMAIN FETCHING
// ==========================================================
async function fetchAllDomains() {
    domainSelect.innerHTML = '<option>Loading domains...</option>';
    const results = await Promise.allSettled([
        mailtm_fetchDomains('https://api.mail.tm'),
        mailtm_fetchDomains('https://api.mail.gw'),
    ]);
    allDomains = [];
    const existing = new Set();
    function add(domains, base) {
        domains.forEach(d => { if (!existing.has(d)) { allDomains.push({ domain: d, provider: 'mailtm', base }); existing.add(d); } });
    }
    add(results[0].status === 'fulfilled' ? results[0].value : [], 'https://api.mail.tm');
    add(results[1].status === 'fulfilled' ? results[1].value : [], 'https://api.mail.gw');
    console.log(`Loaded ${allDomains.length} total domains`);
    domainCount.textContent = `${allDomains.length} domains`;
    populateDomainDropdown();
}

// ==========================================================
//  DROPDOWN
// ==========================================================
// Chemical/industrial branding for domains that have that look
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

    // Split: domains with chemical/industrial labels vs plain
    const labeledDomains = allDomains.filter(d => CHEMICAL_LABELS[d.domain]);
    const plainDomains   = allDomains.filter(d => !CHEMICAL_LABELS[d.domain]);

    // Chemical & Industrial group first
    if (labeledDomains.length > 0) {
        const grp = document.createElement('optgroup');
        grp.label = `\u2697 Chemical & Industrial  (${labeledDomains.length})`;
        labeledDomains.forEach(d => {
            const opt = document.createElement('option');
            opt.value = JSON.stringify({ provider: 'mailtm', domain: d.domain, base: d.base });
            opt.textContent = `${CHEMICAL_LABELS[d.domain]}  \u2014  @${d.domain}`;
            grp.appendChild(opt);
        });
        domainSelect.appendChild(grp);
    }

    // Other domains
    if (plainDomains.length > 0) {
        const grp = document.createElement('optgroup');
        grp.label = `Other Domains  (${plainDomains.length})`;
        plainDomains.forEach(d => {
            const opt = document.createElement('option');
            opt.value = JSON.stringify({ provider: 'mailtm', domain: d.domain, base: d.base });
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
    const username = `${getRandomName()}${rnd(2)}`;
    let domainInfo;
    if (selection) { domainInfo = JSON.parse(selection); }
    else { domainInfo = allDomains[0]; if (!domainInfo) throw new Error('No domains loaded.'); }
    const address = `${username}@${domainInfo.domain}`;
    if (domainInfo.provider === 'mailtm') {
        const password = rnd(16);
        const { id, token } = await mailtm_createAccount(domainInfo.base, address, password);
        return { provider: 'mailtm', base: domainInfo.base, id, address, token, knownMessageIds: new Set(), messages: [] };
    }
    throw new Error('Unknown provider');
}

// ==========================================================
//  FETCH MESSAGES
// ==========================================================
async function fetchMessagesForAccount(acc) {
    if (acc.provider === 'mailtm')   return mailtm_fetchMessages(acc.base, acc.token);
    return [];
}
async function fetchMessageForAccount(acc, msgId) {
    if (acc.provider === 'mailtm')   return mailtm_fetchMessage(acc.base, acc.token, msgId);
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
    renderAccountTabs();
    renderMessages(acc.messages);
}
function removeAccount(idx) {
    accounts.splice(idx, 1); updateAccountCounter();
    if (!accounts.length) {
        activeIndex = -1; emailText.textContent = 'Click generate to create a new email'; emailText.className = 'email-placeholder';
        emailDisplay.classList.remove('active'); copyBtn.style.display = 'none';
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
            iframe.sandbox = 'allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox';
            Object.assign(iframe.style, { width: '100%', minHeight: '250px', border: 'none', borderRadius: '8px', background: 'white' });
            modalBody.innerHTML = ''; modalBody.appendChild(iframe);
            const html = msg.html.join ? msg.html.join('') : msg.html;
            iframe.srcdoc = `<html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.6;color:#333;padding:16px;margin:0;word-wrap:break-word}img{max-width:100%;height:auto}a{color:#6c5ce7;cursor:pointer}</style></head><body>${html}<script>document.querySelectorAll('a[href]').forEach(function(a){var h=a.getAttribute('href');if(!h||h==='#')return;if(!h.match(/^(https?:\\/\\/|mailto:|tel:)/i)){h='https://'+h;}a.removeAttribute('href');a.style.cursor='pointer';a.style.textDecoration='underline';a.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();window.open(h,'_blank');});});<\/script></body></html>`;
            iframe.onload = () => { try { iframe.style.height = Math.min(iframe.contentDocument.body.scrollHeight + 32, 600) + 'px'; } catch {} };
        } else {
            modalBody.innerHTML = `<pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(msg.text || 'No content')}</pre>`;
        }
        refreshInbox();
    } catch (err) { modalBody.innerHTML = `<p style="color:var(--danger);">Failed: ${escapeHtml(err.message)}</p>`; }
}

function closeModal() { modalOverlay.classList.remove('active'); }
modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

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
        refreshBtn.style.display = 'inline-flex'; autoRefreshBadge.style.display = 'inline-flex'; inboxSection.style.display = '';
        renderMessages([]); renderAccountTabs(); updateAccountCounter(); updateGenerateButton();
        startPolling();
        showToast('Email generated successfully!');
    } catch (err) { console.error('Generate failed:', err); showToast('Error: ' + err.message); generateBtn.innerHTML = prev; }
    finally { generateBtn.disabled = accounts.length >= MAX_ACCOUNTS; }
});

refreshBtn.addEventListener('click', refreshInbox);

// ==========================================================
//  TAB SWITCHING (Email / Phone)
// ==========================================================
const tabEmail = document.getElementById('tabEmail');
const tabPhone = document.getElementById('tabPhone');
const emailTabContent = document.getElementById('emailTab');
const phoneTabContent = document.getElementById('phoneTab');

tabEmail.addEventListener('click', () => {
    tabEmail.classList.add('active'); tabPhone.classList.remove('active');
    emailTabContent.style.display = ''; phoneTabContent.style.display = 'none';
});
tabPhone.addEventListener('click', () => {
    tabPhone.classList.add('active'); tabEmail.classList.remove('active');
    phoneTabContent.style.display = ''; emailTabContent.style.display = 'none';
    renderPhoneNumbers();
});

// ==========================================================
//  TEMPORARY PHONE NUMBERS — curated from public services
// ==========================================================
const TEMP_PHONES = [
    // USA
    { country: 'US', flag: '\uD83C\uDDFA\uD83C\uDDF8', number: '+1 (380) 260-3245', raw: '13802603245', service: 'receive-smss.com', smsUrl: 'https://receive-smss.com/sms/13802603245/' },
    { country: 'US', flag: '\uD83C\uDDFA\uD83C\uDDF8', number: '+1 (970) 784-0507', raw: '19707840507', service: 'receive-smss.com', smsUrl: 'https://receive-smss.com/sms/19707840507/' },
    { country: 'US', flag: '\uD83C\uDDFA\uD83C\uDDF8', number: '+1 (347) 392-9868', raw: '13473929868', service: 'receive-smss.com', smsUrl: 'https://receive-smss.com/sms/13473929868/' },
    { country: 'US', flag: '\uD83C\uDDFA\uD83C\uDDF8', number: '+1 (281) 216-6971', raw: '12812166971', service: 'receive-smss.com', smsUrl: 'https://receive-smss.com/sms/12812166971/' },
    { country: 'US', flag: '\uD83C\uDDFA\uD83C\uDDF8', number: '+1 (929) 836-4242', raw: '19298364242', service: 'receive-smss.com', smsUrl: 'https://receive-smss.com/sms/19298364242/' },
    // India
    { country: 'IN', flag: '\uD83C\uDDEE\uD83C\uDDF3', number: '+91 74287 30894', raw: '917428730894', service: 'receive-smss.com', smsUrl: 'https://receive-smss.com/sms/917428730894/' },
    { country: 'IN', flag: '\uD83C\uDDEE\uD83C\uDDF3', number: '+91 74287 23247', raw: '917428723247', service: 'receive-smss.com', smsUrl: 'https://receive-smss.com/sms/917428723247/' },
    { country: 'IN', flag: '\uD83C\uDDEE\uD83C\uDDF3', number: '+91 Numbers', raw: '', service: 'quackr.io', smsUrl: 'https://quackr.io/temporary-numbers/india' },
    // China
    { country: 'CN', flag: '\uD83C\uDDE8\uD83C\uDDF3', number: '+86 Numbers', raw: '', service: 'quackr.io', smsUrl: 'https://quackr.io/temporary-numbers/china' },
    { country: 'CN', flag: '\uD83C\uDDE8\uD83C\uDDF3', number: '+86 Numbers', raw: '', service: 'temp-number.com', smsUrl: 'https://temp-number.com/countries/china' },
    { country: 'CN', flag: '\uD83C\uDDE8\uD83C\uDDF3', number: '+86 Numbers', raw: '', service: 'mytempsms.com', smsUrl: 'https://mytempsms.com/country/china' },
    // Germany
    { country: 'DE', flag: '\uD83C\uDDE9\uD83C\uDDEA', number: '+49 1521 094 7617', raw: '4915210947617', service: 'receive-smss.com', smsUrl: 'https://receive-smss.com/sms/4915210947617/' },
    { country: 'DE', flag: '\uD83C\uDDE9\uD83C\uDDEA', number: '+49 1521 109 4215', raw: '4915211094215', service: 'receive-smss.com', smsUrl: 'https://receive-smss.com/sms/4915211094215/' },
    { country: 'DE', flag: '\uD83C\uDDE9\uD83C\uDDEA', number: '+49 1521 089 9596', raw: '4915210899596', service: 'receive-smss.com', smsUrl: 'https://receive-smss.com/sms/4915210899596/' },
    { country: 'DE', flag: '\uD83C\uDDE9\uD83C\uDDEA', number: '+49 Numbers', raw: '', service: 'quackr.io', smsUrl: 'https://quackr.io/temporary-numbers/germany' },
    // UK
    { country: 'GB', flag: '\uD83C\uDDEC\uD83C\uDDE7', number: '+44 7538 299689', raw: '447538299689', service: 'receive-smss.com', smsUrl: 'https://receive-smss.com/sms/447538299689/' },
    { country: 'GB', flag: '\uD83C\uDDEC\uD83C\uDDE7', number: '+44 Numbers', raw: '', service: 'quackr.io', smsUrl: 'https://quackr.io/temporary-numbers/united-kingdom' },
    // Canada
    { country: 'CA', flag: '\uD83C\uDDE8\uD83C\uDDE6', number: '+1 (281) 352-4309', raw: '12813524309', service: 'receive-smss.com', smsUrl: 'https://receive-smss.com/sms/12813524309/' },
    { country: 'CA', flag: '\uD83C\uDDE8\uD83C\uDDE6', number: '+1 Numbers', raw: '', service: 'quackr.io', smsUrl: 'https://quackr.io/temporary-numbers/canada' },
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
            <span class="phone-flag">${p.flag}</span>
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

    // Attach events
    phoneGrid.querySelectorAll('.phone-copy-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const num = '+' + btn.dataset.number;
            try { await navigator.clipboard.writeText(num); } catch { const t = document.createElement('textarea'); t.value = num; document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t); }
            showToast('Number copied!');
        });
    });

    phoneGrid.querySelectorAll('.phone-sms-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            window.open(btn.dataset.url, '_blank');
        });
    });
}

// Country filter buttons
document.querySelectorAll('.country-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.country-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeCountry = btn.dataset.country;
        renderPhoneNumbers();
    });
});

// ===== INIT =====
updateAccountCounter(); updateGenerateButton(); fetchAllDomains();
