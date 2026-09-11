/* ============================================================
   CjayBudgets — app.js
   Single-file logic. Loaded via <script src="app.js">.
   ============================================================ */
(function(){
'use strict';

/* ============================================================
   CONSTANTS
   ============================================================ */
const STORAGE_KEY   = 'cjay_budgets_v1';
const DRIVE_FOLDER  = 'CjayBudgets';
const DRIVE_BUDGET  = 'budget/cjay-budget.json';
const DRIVE_SAVINGS = 'savings/cjay-savings.json';
const CLIENT_KEY    = 'cjay_gdrive_client_id';
const LASTSYNC_KEY  = 'cjay_budgets_lastsync';

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
const CURRENCY = '₦';

/* ============================================================
   STATE
   ============================================================ */
let state = {
  entries: [],
  savings: []
};

let settings = {
  lastBudgetSync: null,
  lastSavingsSync: null,
  plum: false
};

let ui = {
  activeTab: 'budget',
  viewPeriod: 'month',           // 'month' | 'week' | 'day'
  year: new Date().getFullYear(),
  month: new Date().getMonth(),
  dayAnchor: new Date(),
  weekAnchor: new Date(),
  visibleBudgetLimit: 8,
  visibleSavingsLimit: 8,
  search: '',
  typeFilter: '',                // for budget: 'Income' | 'Expense'
  categoryFilter: '',
  savingsTypeFilter: '',         // 'deposit' | 'withdrawal'
  viewOnly: false,
  editingId: null
};

let pendingUndo = null;   // { action, payload, timeout }
let tokenClient = null;
let accessToken = null;
let gapiReady = false;
let tokenResolvers = [];

/* ============================================================
   HELPERS
   ============================================================ */
function uid(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2,8);
}

function todayISO(d){
  d = d || new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth()+1).padStart(2,'0') + '-' +
    String(d.getDate()).padStart(2,'0');
}

function esc(s){
  if(s == null) return '';
  return String(s).replace(/[&<>"']/g, c => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
  ));
}

function fmtNaira(n){
  const num = Number(n) || 0;
  const sign = num < 0 ? '-' : '';
  return sign + CURRENCY + Math.abs(num).toLocaleString('en-NG', {maximumFractionDigits:0});
}

function fmtNairaCents(n){
  const num = Number(n) || 0;
  const sign = num < 0 ? '-' : '';
  return sign + CURRENCY + Math.abs(num).toLocaleString('en-NG', {minimumFractionDigits:0, maximumFractionDigits:2});
}

function parseDate(s){
  if(!s) return null;
  const d = new Date(s + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}

function niceDate(iso){
  const d = parseDate(iso);
  if(!d) return '—';
  return d.toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short', year:'numeric'});
}

function shortDate(iso){
  const d = parseDate(iso);
  if(!d) return '—';
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const yest = new Date(); yest.setDate(today.getDate()-1);
  const isYest = d.toDateString() === yest.toDateString();
  if(isToday) return 'Today';
  if(isYest) return 'Yesterday';
  return d.toLocaleDateString('en-GB', {day:'numeric', month:'short'});
}

function startOfWeek(d){
  const c = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  c.setDate(c.getDate() - c.getDay());
  return c;
}

function currentAnchorDate(){
  if(ui.viewPeriod === 'day') return new Date(ui.dayAnchor);
  if(ui.viewPeriod === 'week') return new Date(ui.weekAnchor);
  return new Date(ui.year, ui.month, Math.min(new Date().getDate(), 28));
}

function periodLabelText(){
  if(ui.viewPeriod === 'month') return MONTHS[ui.month] + ' ' + ui.year;
  if(ui.viewPeriod === 'week'){
    const start = startOfWeek(ui.weekAnchor);
    const end = new Date(start); end.setDate(start.getDate()+6);
    return start.toLocaleDateString('en-GB',{day:'numeric',month:'short'}) +
      ' – ' + end.toLocaleDateString('en-GB',{day:'numeric',month:'short'});
  }
  return ui.dayAnchor.toLocaleDateString('en-GB', {weekday:'short',day:'numeric',month:'short'});
}

/* ============================================================
   LOCAL STORAGE
   ============================================================ */
function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){
      const p = JSON.parse(raw);
      state.entries = Array.isArray(p.entries) ? p.entries : [];
      state.savings = Array.isArray(p.savings) ? p.savings : [];
      settings.lastBudgetSync  = p.lastBudgetSync  || null;
      settings.lastSavingsSync = p.lastSavingsSync || null;
      settings.plum = !!p.plum;
    }
  }catch(e){ console.warn('Load failed', e); }
}

function saveState(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      entries: state.entries,
      savings: state.savings,
      lastBudgetSync: settings.lastBudgetSync,
      lastSavingsSync: settings.lastSavingsSync,
      plum: settings.plum
    }));
  }catch(e){ console.warn('Save failed', e); }
}

/* ============================================================
   THEME + TAB
   ============================================================ */
function applyTheme(){
  const isDark = document.body.dataset.theme === 'dark';
  document.querySelector('#themeBtn i').className = isDark ? 'fas fa-sun' : 'fas fa-moon';
  document.body.dataset.plum = settings.plum ? 'true' : 'false';
}

function toggleTheme(){
  const isDark = document.body.dataset.theme === 'dark';
  document.body.dataset.theme = isDark ? 'light' : 'dark';
  applyTheme();
}

function switchTab(tab){
  ui.activeTab = tab;
  document.body.dataset.tab = tab;
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('budgetTab').classList.toggle('active', tab === 'budget');
  document.getElementById('savingsTab').classList.toggle('active', tab === 'savings');
  document.getElementById('brandLogo').innerHTML = tab === 'budget'
    ? '<i class="fas fa-wallet"></i>'
    : '<i class="fas fa-piggy-bank"></i>';
  updateFab();
  window.scrollTo({top:0, behavior:'smooth'});
}

function updateFab(){
  const fab = document.getElementById('fabBtn');
  if(ui.viewOnly){ fab.classList.add('hidden'); return; }
  fab.classList.remove('hidden');
}

/* ============================================================
   PERIOD FILTERING
   ============================================================ */
function entryInPeriod(e){
  if(!e.date) return false;
  const d = parseDate(e.date);
  if(!d) return false;

  if(ui.viewPeriod === 'month'){
    return d.getFullYear() === ui.year && d.getMonth() === ui.month;
  }
  if(ui.viewPeriod === 'week'){
    const start = startOfWeek(ui.weekAnchor);
    const end = new Date(start); end.setDate(start.getDate()+6);
    return d >= start && d <= end;
  }
  return e.date === todayISO(ui.dayAnchor);
}

function entriesInPeriod(){
  return state.entries.filter(entryInPeriod);
}

function filteredEntries(){
  return entriesInPeriod().filter(e => {
    if(ui.typeFilter && e.type !== ui.typeFilter) return false;
    if(ui.categoryFilter && e.category !== ui.categoryFilter) return false;
    if(ui.search){
      const hay = ((e.description||'') + ' ' + (e.category||'')).toLowerCase();
      if(!hay.includes(ui.search.toLowerCase())) return false;
    }
    return true;
  });
}

function filteredSavings(){
  return state.savings.filter(s => {
    if(ui.savingsTypeFilter && s.type !== ui.savingsTypeFilter) return false;
    if(ui.search){
      const hay = ((s.note||'') + ' ' + (s.type||'')).toLowerCase();
      if(!hay.includes(ui.search.toLowerCase())) return false;
    }
    return true;
  });
}

/* ============================================================
   RENDER — BUDGET
   ============================================================ */
function renderBudget(){
   document.getElementById('periodLabel').innerHTML =
    esc(periodLabelText().toUpperCase()) + ' <i class="fas fa-chevron-down"></i>';

  const period = entriesInPeriod();
  const income  = period.filter(e=>e.type==='Income').reduce((s,e)=>s+(Number(e.amount)||0),0);
  const expense = period.filter(e=>e.type==='Expense').reduce((s,e)=>s+(Number(e.amount)||0),0);
  const net     = income - expense;

  document.getElementById('sumIncome').textContent  = fmtNaira(income);
  document.getElementById('sumExpense').textContent = fmtNaira(expense);
  document.getElementById('sumNet').textContent     = fmtNaira(net);

  // Subtitle labels depend on view period
  const periodWord = ui.viewPeriod === 'month' ? 'this month'
    : ui.viewPeriod === 'week' ? 'this week' : 'today';
  document.getElementById('subIncome').textContent  = periodWord;
  document.getElementById('subExpense').textContent = periodWord;
  const subNet = document.getElementById('subNet');
  if(net > 0) subNet.textContent = 'surplus';
  else if(net < 0) subNet.textContent = 'deficit';
  else subNet.textContent = 'balanced';

  // Net card color flips to red if negative
  document.getElementById('sumNetCard').classList.toggle('negative', net < 0);

  renderSpend(period);
  renderEntryList();
}

function renderSpend(period){
  const wrap = document.getElementById('spendContent');
  const expenses = period.filter(e=>e.type==='Expense');
  if(!expenses.length){
    wrap.innerHTML = '<div class="spend-empty">No expenses logged this period yet.</div>';
    return;
  }
  const totals = {};
  expenses.forEach(e => {
    const k = e.category || 'Uncategorized';
    totals[k] = (totals[k]||0) + (Number(e.amount)||0);
  });
  const sorted = Object.entries(totals).sort((a,b)=>b[1]-a[1]);
  const total = sorted.reduce((s,[,v])=>s+v,0);

  const COLORS = ['#2e7dd1','#0e7a5a','#e0a526','#d3453f','#8b5cf6',
                  '#06b6d4','#f97316','#ec4899','#84cc16','#6366f1'];

  const R = 60, C = 2 * Math.PI * R;
  let offset = 0;
  const arcs = sorted.map(([cat, amt], i) => {
    const frac = amt / total;
    const len = C * frac;
    const seg = `<circle cx="70" cy="70" r="${R}"
        fill="none" stroke="${COLORS[i % COLORS.length]}" stroke-width="18"
        stroke-dasharray="${len.toFixed(2)} ${(C-len).toFixed(2)}"
        stroke-dashoffset="${(-offset).toFixed(2)}"/>`;
    offset += len;
    return seg;
  }).join('');

  const donut = `
    <div class="donut-wrap">
      <svg viewBox="0 0 140 140">${arcs}</svg>
      <div class="donut-center">
        <div class="dc-label">Total spent</div>
        <div class="dc-val num">${fmtNaira(total)}</div>
      </div>
    </div>`;

  const bars = sorted.slice(0,6).map(([cat, amt], i) => `
    <div class="spend-row">
      <span class="spend-dot" style="background:${COLORS[i % COLORS.length]}"></span>
      <span class="spend-name">${esc(cat)}</span>
      <span class="spend-amt num">${fmtNaira(amt)}</span>
    </div>`).join('');

  wrap.innerHTML = `<div class="spend-grid">${donut}<div class="spend-bars">${bars}</div></div>`;
}

function renderEntryList(){
  const list = document.getElementById('entryList');
  const empty = document.getElementById('entriesEmpty');
  const all = filteredEntries().sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const items = all.slice(0, ui.visibleBudgetLimit);

  if(!all.length){
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  list.innerHTML = items.map(e => {
    const isIncome = e.type === 'Income';
    return `<div class="entry-row ${isIncome?'income':'expense'}" data-id="${e.id}">
      <div class="er-icon"><i class="fas fa-${isIncome?'arrow-down':'arrow-up'}"></i></div>
      <div class="er-main">
        <div class="er-desc">${esc(e.description || (isIncome?'Income':'Expense'))}</div>
        <div class="er-cat">
          ${esc(e.category || 'Uncategorized')}
          ${e.recurring ? '<span class="recur-dot"></span>Recurring' : ''}
        </div>
      </div>
      <div class="er-amt num">${isIncome?'+':'-'}${fmtNaira(e.amount)}</div>
    </div>`;
  }).join('');

  if(all.length > ui.visibleBudgetLimit){
    const btn = document.createElement('button');
    btn.className = 'show-more-btn';
    btn.textContent = `Show more (${all.length - ui.visibleBudgetLimit} remaining)`;
    btn.onclick = () => { ui.visibleBudgetLimit += 8; renderEntryList(); };
    list.appendChild(btn);
  }

  list.querySelectorAll('.entry-row').forEach(row => {
    row.onclick = () => openEntryDetail(row.dataset.id);
  });
}

/* ============================================================
   RENDER — SAVINGS
   ============================================================ */
function renderSavings(){
  const totalDeposit = state.savings
    .filter(s => s.type === 'deposit')
    .reduce((sum, s) => sum + (Number(s.amount)||0), 0);
  const totalWithdraw = state.savings
    .filter(s => s.type === 'withdrawal')
    .reduce((sum, s) => sum + (Number(s.amount)||0), 0);
  const total = totalDeposit - totalWithdraw;

  document.getElementById('savingsTotal').textContent = fmtNaira(total);

  const sub = document.getElementById('savingsSub');
  if(!state.savings.length){
    sub.textContent = '— no activity yet';
    sub.className = 'sh-sub';
  } else {
    const net = totalDeposit - totalWithdraw;
    sub.textContent = (net >= 0 ? '↑ ' : '↓ ') + fmtNaira(Math.abs(net)) + ' net activity';
    sub.className = 'sh-sub ' + (net >= 0 ? 'up' : 'down');
  }

  renderLedger();
}

function renderLedger(){
  const list = document.getElementById('ledgerList');
  const empty = document.getElementById('ledgerEmpty');
  const all = filteredSavings().sort((a,b)=>
    (b.date||'').localeCompare(a.date||'') || (b.id||'').localeCompare(a.id||''));
  const items = all.slice(0, ui.visibleSavingsLimit);

  if(!all.length){
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  list.innerHTML = items.map(s => {
    const isDep = s.type === 'deposit';
    const noteHtml = s.note
      ? `<div class="lr-note">${esc(s.note)}</div>`
      : `<div class="lr-note empty">No note</div>`;
    return `<div class="ledger-row ${isDep?'deposit':'withdrawal'}" data-id="${s.id}">
      <div class="lr-icon"><i class="fas fa-arrow-${isDep?'down':'up'}"></i></div>
      <div class="lr-main">
        ${noteHtml}
        <div class="lr-sub">${shortDate(s.date)}</div>
      </div>
      <div class="lr-amt num">${isDep?'+':'-'}${fmtNaira(s.amount)}</div>
    </div>`;
  }).join('');

  if(all.length > ui.visibleSavingsLimit){
    const btn = document.createElement('button');
    btn.className = 'show-more-btn';
    btn.textContent = `Show more (${all.length - ui.visibleSavingsLimit} remaining)`;
    btn.onclick = () => { ui.visibleSavingsLimit += 8; renderLedger(); };
    list.appendChild(btn);
  }

  list.querySelectorAll('.ledger-row').forEach(row => {
    row.onclick = () => openLedgerDetail(row.dataset.id);
  });
}

/* ============================================================
   RENDER — MASTER
   ============================================================ */
function render(){
  applyTheme();
  updateFab();
  if(ui.activeTab === 'budget') renderBudget();
  else renderSavings();
}

/* ============================================================
   MODAL SYSTEM
   ============================================================ */
const overlay = document.getElementById('modalOverlay');
const modal = document.getElementById('modalContent');

function openModal(html){
  modal.innerHTML = html;
  overlay.classList.add('active');
  const close = modal.querySelector('.close-x');
  if(close) close.onclick = closeModal;
}
function closeModal(){
  overlay.classList.remove('active');
  modal.innerHTML = '';
}
overlay.addEventListener('click', (e) => { if(e.target === overlay) closeModal(); });

/* ============================================================
   TOAST + UNDO
   ============================================================ */
let toastTimer = null;
function toast(msg, actionLabel, actionFn){
  const el = document.getElementById('toast');
  el.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = msg;
  el.appendChild(span);
  if(actionLabel && actionFn){
    const btn = document.createElement('button');
    btn.textContent = actionLabel;
    btn.onclick = () => { actionFn(); el.classList.remove('show'); };
    el.appendChild(btn);
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

/* ============================================================
   ADD / EDIT ENTRY MODAL
   ============================================================ */
function openEntryModal(entry){
  const editing = !!entry;
  const e = entry || {
    id: uid(),
    date: todayISO(currentAnchorDate()),
    type: 'Expense',
    category: '',
    description: '',
    amount: '',
    recurring: false
  };

  const categories = Array.from(new Set(
    state.entries.map(x => x.category).filter(Boolean)
  )).sort();

  const recurringTemplates = Array.from(new Set(
    state.entries.filter(x => x.recurring).map(x => x.category+'|'+x.description+'|'+x.amount+'|'+x.type)
  )).map(k => {
    const [category, description, amount, type] = k.split('|');
    return { category, description, amount: Number(amount), type };
  });

  const chipsHtml = recurringTemplates.length
    ? `<div class="form-group">
         <label>Recurring templates</label>
         <div class="chip-row">
           ${recurringTemplates.map((t,i) => `
             <button type="button" class="chip" data-chip="${i}">
               ${esc(t.category || t.description || 'Entry')}
               <span class="chip-amt">${fmtNaira(t.amount)}</span>
             </button>`).join('')}
         </div>
       </div>`
    : '';

  openModal(`
    <div class="modal-header">
      <h2>${editing ? 'Edit Entry' : 'Add Entry'}</h2>
      <button class="close-x">&times;</button>
    </div>

    ${chipsHtml}

    <div class="seg-control" id="entryTypeControl">
      <button type="button" data-type="Expense" class="${e.type==='Expense'?'active seg-expense':''}">Expense</button>
      <button type="button" data-type="Income"  class="${e.type==='Income'?'active seg-income':''}">Income</button>
    </div>

    <div class="form-group">
      <label>Amount</label>
      <div class="amount-wrap">
        <span>${CURRENCY}</span>
        <input type="number" id="eAmount" inputmode="decimal" placeholder="0" value="${e.amount||''}">
      </div>
    </div>

    <div class="form-group">
      <label>Category</label>
      <input type="text" id="eCategory" list="catList" placeholder="e.g. Food" value="${esc(e.category)}" maxlength="40">
      <datalist id="catList">${categories.map(c=>`<option value="${esc(c)}">`).join('')}</datalist>
    </div>

    <div class="form-group">
      <label>Description <span style="text-transform:none;font-weight:500;color:var(--muted)">(optional)</span></label>
      <input type="text" id="eDescription" placeholder="What was this for?" value="${esc(e.description)}" maxlength="120">
    </div>

    <div class="form-group">
      <label>Date</label>
      <input type="date" id="eDate" value="${e.date}">
    </div>

    <div class="form-group" style="flex-direction:row;align-items:center;gap:12px;margin-top:4px">
      <label style="padding:0;text-transform:none;font-size:.88rem;font-weight:600;color:var(--text);letter-spacing:0">
        Recurring template
      </label>
      <input type="checkbox" id="eRecurring" ${e.recurring?'checked':''} style="width:20px;height:20px;accent-color:var(--accent);margin-left:auto">
    </div>

    <button type="button" class="btn btn-primary" id="eSaveBtn">
      ${editing ? 'Save Changes' : 'Add Entry'}
    </button>
    ${editing ? `<button type="button" class="btn btn-danger" id="eDeleteBtn">Delete Entry</button>` : ''}
  `);

  // Chips prefill
  modal.querySelectorAll('.chip').forEach(chip => {
    chip.onclick = () => {
      const t = recurringTemplates[Number(chip.dataset.chip)];
      document.getElementById('eAmount').value = t.amount;
      document.getElementById('eCategory').value = t.category;
      document.getElementById('eDescription').value = t.description;
      setEntryType(t.type);
    };
  });

  // Segmented control
  function setEntryType(type){
    e.type = type;
    modal.querySelectorAll('#entryTypeControl button').forEach(b =>
      b.classList.toggle('active', b.dataset.type === type));
    modal.querySelectorAll('#entryTypeControl button').forEach(b => {
      b.classList.remove('seg-income','seg-expense');
      if(b.classList.contains('active')) b.classList.add(type==='Income'?'seg-income':'seg-expense');
    });
  }
  modal.querySelectorAll('#entryTypeControl button').forEach(b => {
    b.onclick = () => setEntryType(b.dataset.type);
  });

  // Save
  document.getElementById('eSaveBtn').onclick = () => {
    const amount = Number(document.getElementById('eAmount').value);
    if(!amount || amount <= 0){ toast('Enter an amount'); return; }
    const data = {
      id: e.id,
      date: document.getElementById('eDate').value || todayISO(),
      type: e.type,
      category: document.getElementById('eCategory').value.trim(),
      description: document.getElementById('eDescription').value.trim(),
      amount: amount,
      recurring: document.getElementById('eRecurring').checked
    };
    if(editing){
      const idx = state.entries.findIndex(x => x.id === e.id);
      if(idx >= 0) state.entries[idx] = data;
    } else {
      state.entries.unshift(data);
    }
    saveState();
    closeModal();
    render();
    toast(editing ? 'Entry updated' : 'Entry added');
  };

  if(editing){
    document.getElementById('eDeleteBtn').onclick = () => {
      deleteEntry(e.id);
      closeModal();
    };
  }
}

function openEntryDetail(id){
  const e = state.entries.find(x => x.id === id);
  if(!e) return;

  openModal(`
    <div class="modal-header">
      <h2>${esc(e.description || e.category || (e.type==='Income'?'Income':'Expense'))}</h2>
      <button class="close-x">&times;</button>
    </div>

    <div class="detail-kv"><span class="kv-label">Type</span><span class="kv-val">${esc(e.type)}</span></div>
    <div class="detail-kv"><span class="kv-label">Amount</span><span class="kv-val num" style="color:${e.type==='Income'?'var(--green)':'var(--red)'}">${e.type==='Income'?'+':'-'}${fmtNairaCents(e.amount)}</span></div>
    <div class="detail-kv"><span class="kv-label">Date</span><span class="kv-val">${niceDate(e.date)}</span></div>
    ${e.category ? `<div class="detail-kv"><span class="kv-label">Category</span><span class="kv-val">${esc(e.category)}</span></div>` : ''}
    ${e.description ? `<div class="detail-kv"><span class="kv-label">Description</span><span class="kv-val">${esc(e.description)}</span></div>` : ''}
    <div class="detail-kv"><span class="kv-label">Recurring</span><span class="kv-val">${e.recurring?'Yes':'No'}</span></div>

    ${ui.viewOnly ? '' : `
      <button type="button" class="btn btn-primary" id="dEditBtn" style="margin-top:16px">Edit</button>
      <button type="button" class="btn btn-danger" id="dDeleteBtn">Delete</button>
    `}
  `);

  if(!ui.viewOnly){
    document.getElementById('dEditBtn').onclick = () => {
      closeModal();
      openEntryModal(e);
    };
    document.getElementById('dDeleteBtn').onclick = () => {
      deleteEntry(e.id);
      closeModal();
    };
  }
}

function deleteEntry(id){
  const idx = state.entries.findIndex(x => x.id === id);
  if(idx < 0) return;
  const removed = state.entries[idx];
  state.entries.splice(idx, 1);
  saveState();
  render();
  toast('Entry deleted', 'Undo', () => {
    state.entries.splice(idx, 0, removed);
    saveState();
    render();
  });
}

/* ============================================================
   ADD SAVINGS MODAL (deposit / withdraw)
   ============================================================ */
function openSavingsModal(type){
  const isDep = type === 'deposit';
  openModal(`
    <div class="modal-header">
      <h2>${isDep ? 'Add Deposit' : 'Record Withdrawal'}</h2>
      <button class="close-x">&times;</button>
    </div>

    <div class="form-group">
      <label>Amount</label>
      <div class="amount-wrap">
        <span>${CURRENCY}</span>
        <input type="number" id="sAmount" inputmode="decimal" placeholder="0">
      </div>
    </div>

    <div class="form-group">
      <label>Note <span style="text-transform:none;font-weight:500;color:var(--muted)">(optional)</span></label>
      <input type="text" id="sNote" placeholder="${isDep ? 'e.g. Monthly savings' : 'What did you use it for?'}" maxlength="120">
    </div>

    <div class="form-group">
      <label>Date</label>
      <input type="date" id="sDate" value="${todayISO()}">
    </div>

    <button type="button" class="btn btn-primary" id="sSaveBtn">
      ${isDep ? 'Add Deposit' : 'Record Withdrawal'}
    </button>
  `);

  document.getElementById('sSaveBtn').onclick = () => {
    const amount = Number(document.getElementById('sAmount').value);
    if(!amount || amount <= 0){ toast('Enter an amount'); return; }
    const data = {
      id: uid(),
      date: document.getElementById('sDate').value || todayISO(),
      type: isDep ? 'deposit' : 'withdrawal',
      amount: amount,
      note: document.getElementById('sNote').value.trim()
    };
    state.savings.unshift(data);
    saveState();
    closeModal();
    render();
    toast(isDep ? 'Deposit added' : 'Withdrawal recorded');
  };
}

function openLedgerDetail(id){
  const s = state.savings.find(x => x.id === id);
  if(!s) return;
  const isDep = s.type === 'deposit';

  openModal(`
    <div class="modal-header">
      <h2>${isDep ? 'Deposit' : 'Withdrawal'}</h2>
      <button class="close-x">&times;</button>
    </div>

    <div class="detail-kv"><span class="kv-label">Amount</span><span class="kv-val num" style="color:${isDep?'var(--emerald)':'var(--red)'}">${isDep?'+':'-'}${fmtNairaCents(s.amount)}</span></div>
    <div class="detail-kv"><span class="kv-label">Date</span><span class="kv-val">${niceDate(s.date)}</span></div>
    <div class="detail-kv"><span class="kv-label">Note</span><span class="kv-val">${esc(s.note || '—')}</span></div>

    ${ui.viewOnly ? '' : `
      <button type="button" class="btn btn-danger" id="ldDeleteBtn" style="margin-top:16px">Delete</button>
    `}
  `);

  if(!ui.viewOnly){
    document.getElementById('ldDeleteBtn').onclick = () => {
      const idx = state.savings.findIndex(x => x.id === id);
      if(idx < 0) return;
      const removed = state.savings[idx];
      state.savings.splice(idx, 1);
      saveState();
      closeModal();
      render();
      toast('Savings entry deleted', 'Undo', () => {
        state.savings.splice(idx, 0, removed);
        saveState();
        render();
      });
    };
  }
}

/* ============================================================
   RECURRING MANAGER
   ============================================================ */
function openRecurringModal(){
  const templates = Array.from(new Set(
    state.entries.filter(x => x.recurring).map(x => x.category+'|'+x.description+'|'+x.amount+'|'+x.type)
  )).map(k => {
    const [category, description, amount, type] = k.split('|');
    return { category, description, amount: Number(amount), type };
  });

  const inPeriod = entriesInPeriod();
  const addedKeys = new Set(inPeriod.filter(x => x.recurring).map(x => x.category+'|'+x.description+'|'+x.amount+'|'+x.type));
  const pending = templates.filter(t => !addedKeys.has(t.category+'|'+t.description+'|'+t.amount+'|'+t.type));

  openModal(`
    <div class="modal-header">
      <h2>Recurring</h2>
      <button class="close-x">&times;</button>
    </div>

    ${templates.length === 0 ? `
      <div class="spend-empty">No recurring templates yet. When you add an entry, toggle "Recurring template" to save it here.</div>
    ` : `
      <div class="form-group">
        <label>Ready to add this period</label>
        ${pending.length === 0
          ? `<div class="spend-empty">All recurring entries already added ✓</div>`
          : `<div class="chip-row">
              ${pending.map((t,i) => `
                <button type="button" class="chip" data-add="${i}">
                  ${esc(t.category || t.description || 'Entry')}
                  <span class="chip-amt">${fmtNaira(t.amount)}</span>
                  <i class="fas fa-plus" style="margin-left:2px"></i>
                </button>`).join('')}
            </div>`}
      </div>

      <div class="form-group" style="margin-top:20px">
        <label>All recurring templates</label>
        ${templates.map((t,i) => `
          <div class="detail-kv" style="padding:10px 0">
            <span class="kv-label">${esc(t.category || '—')} · ${esc(t.description || t.type)}</span>
            <span class="kv-val num">${fmtNaira(t.amount)}</span>
          </div>`).join('')}
      </div>
    `}
  `);

  modal.querySelectorAll('[data-add]').forEach(chip => {
    chip.onclick = () => {
      const t = pending[Number(chip.dataset.add)];
      const anchor = currentAnchorDate();
      const data = {
        id: uid(),
        date: todayISO(anchor),
        type: t.type,
        category: t.category,
        description: t.description,
        amount: t.amount,
        recurring: true
      };
      state.entries.unshift(data);
      saveState();
      closeModal();
      render();
      toast('Added from recurring');
    };
  });
}

/* ============================================================
   SEARCH & FILTER MODAL
   ============================================================ */
function openSearchModal(){
  const isSavings = ui.activeTab === 'savings';

  if(isSavings){
    openModal(`
      <div class="modal-header">
        <h2>Search Savings</h2>
        <button class="close-x">&times;</button>
      </div>
      <div class="form-group">
        <label>Search</label>
        <input type="text" id="fq" placeholder="Search notes…" value="${esc(ui.search)}">
      </div>
      <div class="form-group">
        <label>Type</label>
        <select id="fs">
          <option value="">All</option>
          <option value="deposit" ${ui.savingsTypeFilter==='deposit'?'selected':''}>Deposits</option>
          <option value="withdrawal" ${ui.savingsTypeFilter==='withdrawal'?'selected':''}>Withdrawals</option>
        </select>
      </div>
      <button type="button" class="btn btn-primary" id="applyF">Apply</button>
      <button type="button" class="btn btn-secondary" id="resetF">Reset</button>
    `);
    document.getElementById('applyF').onclick = () => {
      ui.search = document.getElementById('fq').value.trim();
      ui.savingsTypeFilter = document.getElementById('fs').value;
      closeModal(); renderSavings();
    };
    document.getElementById('resetF').onclick = () => {
      ui.search = ''; ui.savingsTypeFilter = '';
      closeModal(); renderSavings();
    };
    return;
  }

  // Budget search
  const categories = Array.from(new Set(
    state.entries.map(x => x.category).filter(Boolean)
  )).sort();

  openModal(`
    <div class="modal-header">
      <h2>Search Entries</h2>
      <button class="close-x">&times;</button>
    </div>
    <div class="form-group">
      <label>Search</label>
      <input type="text" id="fq" placeholder="Search description or category…" value="${esc(ui.search)}">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Type</label>
        <select id="ft">
          <option value="">All</option>
          <option value="Income" ${ui.typeFilter==='Income'?'selected':''}>Income</option>
          <option value="Expense" ${ui.typeFilter==='Expense'?'selected':''}>Expense</option>
        </select>
      </div>
      <div class="form-group">
        <label>Category</label>
        <select id="fc">
          <option value="">All</option>
          ${categories.map(c => `<option value="${esc(c)}" ${ui.categoryFilter===c?'selected':''}>${esc(c)}</option>`).join('')}
        </select>
      </div>
    </div>
    <button type="button" class="btn btn-primary" id="applyF">Apply</button>
    <button type="button" class="btn btn-secondary" id="resetF">Reset</button>
  `);
  document.getElementById('applyF').onclick = () => {
    ui.search = document.getElementById('fq').value.trim();
    ui.typeFilter = document.getElementById('ft').value;
    ui.categoryFilter = document.getElementById('fc').value;
    closeModal(); renderBudget();
  };
  document.getElementById('resetF').onclick = () => {
    ui.search = ''; ui.typeFilter = ''; ui.categoryFilter = '';
    closeModal(); renderBudget();
  };
}

/* ============================================================
   PERIOD PICKER (bottom sheet)
   ============================================================ */
function openPeriodPicker(){
  openModal(`
    <div class="modal-header">
      <h2>View Period</h2>
      <button class="close-x">&times;</button>
    </div>

    <div class="seg-control" id="periodControl">
      <button type="button" data-v="month" class="${ui.viewPeriod==='month'?'active':''}">Month</button>
      <button type="button" data-v="week"  class="${ui.viewPeriod==='week'?'active':''}">Week</button>
      <button type="button" data-v="day"   class="${ui.viewPeriod==='day'?'active':''}">Day</button>
    </div>

    <div id="periodJump"></div>
  `);

  function renderJump(){
    const box = document.getElementById('periodJump');
    if(ui.viewPeriod === 'month'){
      box.innerHTML = `
        <div class="form-group" style="text-align:center;margin:16px 0 6px">
          <div style="display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:14px">
            <button type="button" class="nav-btn" id="pkPrev" style="width:36px;height:36px;border-radius:12px;border:none;background:var(--card-2)">‹</button>
            <strong style="font-family:Sora;font-size:1.05rem">${ui.year}</strong>
            <button type="button" class="nav-btn" id="pkNext" style="width:36px;height:36px;border-radius:12px;border:none;background:var(--card-2)">›</button>
          </div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
            ${MONTHS.map((m,i) => `
              <button type="button" class="sort-chip ${i===ui.month?'active':''}" data-jm="${i}"
                style="border:1px solid var(--line);background:var(--card);padding:12px 0;border-radius:12px;font-weight:700;font-size:.8rem;color:${i===ui.month?'#fff':'var(--text)'};${i===ui.month?'background:var(--accent);border-color:var(--accent);':''}">
                ${m.slice(0,3)}
              </button>
            `).join('')}
          </div>
        </div>`;
      document.getElementById('pkPrev').onclick = () => { ui.year--; renderJump(); };
      document.getElementById('pkNext').onclick = () => { ui.year++; renderJump(); };
      box.querySelectorAll('[data-jm]').forEach(b => {
        b.onclick = () => {
          ui.month = Number(b.dataset.jm);
          closeModal();
          render();
        };
      });
    } else if(ui.viewPeriod === 'week'){
      const start = startOfWeek(ui.weekAnchor);
      const end = new Date(start); end.setDate(start.getDate()+6);
      box.innerHTML = `
        <div class="form-group" style="text-align:center;margin:16px 0">
          <div style="font-family:Sora;font-weight:700;font-size:1rem;margin-bottom:12px">
            ${start.toLocaleDateString('en-GB',{day:'numeric',month:'short'})} – ${end.toLocaleDateString('en-GB',{day:'numeric',month:'short', year:'numeric'})}
          </div>
          <div style="display:flex;gap:10px;justify-content:center">
            <button type="button" class="btn btn-secondary" id="wkPrev" style="width:auto;padding:10px 22px;margin:0">‹ Prev week</button>
            <button type="button" class="btn btn-secondary" id="wkNext" style="width:auto;padding:10px 22px;margin:0">Next week ›</button>
          </div>
        </div>`;
      document.getElementById('wkPrev').onclick = () => { ui.weekAnchor.setDate(ui.weekAnchor.getDate()-7); renderJump(); };
      document.getElementById('wkNext').onclick = () => { ui.weekAnchor.setDate(ui.weekAnchor.getDate()+7); renderJump(); };
    } else {
      const d = ui.dayAnchor;
      box.innerHTML = `
        <div class="form-group" style="text-align:center;margin:16px 0">
          <div style="font-family:Sora;font-weight:700;font-size:1rem;margin-bottom:12px">
            ${d.toLocaleDateString('en-GB',{weekday:'long', day:'numeric',month:'long', year:'numeric'})}
          </div>
          <div style="display:flex;gap:10px;justify-content:center">
            <button type="button" class="btn btn-secondary" id="dyPrev" style="width:auto;padding:10px 22px;margin:0">‹ Prev day</button>
            <button type="button" class="btn btn-secondary" id="dyNext" style="width:auto;padding:10px 22px;margin:0">Next day ›</button>
          </div>
        </div>`;
      document.getElementById('dyPrev').onclick = () => { ui.dayAnchor.setDate(ui.dayAnchor.getDate()-1); renderJump(); };
      document.getElementById('dyNext').onclick = () => { ui.dayAnchor.setDate(ui.dayAnchor.getDate()+1); renderJump(); };
    }
  }

  modal.querySelectorAll('#periodControl button').forEach(b => {
    b.onclick = () => {
      ui.viewPeriod = b.dataset.v;
      ui.visibleBudgetLimit = 8;
      modal.querySelectorAll('#periodControl button').forEach(x =>
        x.classList.toggle('active', x.dataset.v === ui.viewPeriod));
      renderJump();
    };
  });

  // Close = apply and rerender
  const close = modal.querySelector('.close-x');
  const orig = close.onclick;
  close.onclick = () => { orig(); render(); };

  renderJump();
}
  
/* ============================================================
   SETTINGS MODAL
   ============================================================ */
function openSettingsModal(){
  const lastB = settings.lastBudgetSync ? new Date(settings.lastBudgetSync).toLocaleString() : 'Never';
  const lastS = settings.lastSavingsSync ? new Date(settings.lastSavingsSync).toLocaleString() : 'Never';

  openModal(`
    <div class="modal-header">
      <h2>Settings</h2>
      <button class="close-x">&times;</button>
    </div>

    <!-- Drive: Budget -->
    <div class="settings-block">
      <h4><i class="fas fa-wallet" style="color:var(--blue);margin-right:6px"></i> Budget data</h4>
      <div class="blk-sub">Sync your entries to Google Drive</div>
      <div class="drive-actions">
        <button id="driveConnectB"><i class="fas fa-plug"></i>Connect</button>
        <button id="drivePushB"><i class="fas fa-cloud-upload-alt"></i>Push</button>
        <button id="drivePullB"><i class="fas fa-cloud-download-alt"></i>Pull</button>
      </div>
      <div class="sync-line"><i class="far fa-clock"></i> Last sync: ${esc(lastB)}</div>
    </div>

    <!-- Drive: Savings -->
    <div class="settings-block">
      <h4><i class="fas fa-piggy-bank" style="color:var(--emerald);margin-right:6px"></i> Savings data</h4>
      <div class="blk-sub">Sync your savings ledger to Google Drive</div>
      <div class="drive-actions">
        <button id="driveConnectS"><i class="fas fa-plug"></i>Connect</button>
        <button id="drivePushS"><i class="fas fa-cloud-upload-alt"></i>Push</button>
        <button id="drivePullS"><i class="fas fa-cloud-download-alt"></i>Pull</button>
      </div>
      <div class="sync-line"><i class="far fa-clock"></i> Last sync: ${esc(lastS)}</div>
    </div>

    <!-- Client ID -->
    <div class="settings-block">
      <h4>Google OAuth Client ID</h4>
      <div class="blk-sub">Reuses your CjayNotes client. Paste once per device.</div>
      <div class="form-group" style="margin-bottom:8px">
        <input type="text" id="clientIdInput" placeholder="xxxxx.apps.googleusercontent.com" value="${esc(localStorage.getItem(CLIENT_KEY)||'')}">
      </div>
      <button type="button" class="btn btn-secondary" id="saveClientBtn" style="margin-top:0">Save Client ID</button>
    </div>

       <!-- Theme -->
    <div class="settings-block">
      <h4>Savings theme</h4>
      <div class="blk-sub">Terracotta is default. Teal+Peach is a hidden surprise.</div>
      <div class="theme-picker">
        <button type="button" class="${!settings.plum?'active':''}" data-theme-pick="emerald">
          <span class="swatch emerald"></span>
          Terracotta
        </button>
        <button type="button" class="${settings.plum?'active':''}" data-theme-pick="plum">
          <span class="swatch plum"></span>
          Teal+Peach
        </button>
      </div>
    </div>

    <!-- Backup -->
    <div class="settings-block">
      <h4>Local backup</h4>
      <div class="blk-sub">Export a JSON file, or import from one</div>
      <div style="display:flex;gap:8px">
        <button type="button" class="btn btn-secondary" id="exportBtn" style="margin-top:0">
          <i class="fas fa-download"></i> Export
        </button>
        <button type="button" class="btn btn-secondary" id="importBtn" style="margin-top:0">
          <i class="fas fa-upload"></i> Import
        </button>
      </div>
      <input type="file" id="importFile" accept="application/json,.json" class="hidden">
    </div>

    <!-- Print -->
    <div class="settings-block">
      <h4>Statement</h4>
      <div class="blk-sub">Generate a monthly PDF statement</div>
      <button type="button" class="btn btn-secondary" id="printBtn" style="margin-top:0">
        <i class="fas fa-file-pdf"></i> Generate statement
      </button>
    </div>

    <!-- Danger zone -->
    <div class="danger-zone">
      <h4>Danger zone</h4>
      <div class="blk-sub">This cannot be undone</div>
      <button type="button" class="btn btn-danger" id="clearAllBtn" style="margin-top:0">
        Clear all data
      </button>
    </div>

    <div style="text-align:center;color:var(--muted);font-size:.72rem;margin-top:16px">
      CjayBudgets · v1.0
    </div>
  `);

  // Client ID
  document.getElementById('saveClientBtn').onclick = async () => {
    const v = document.getElementById('clientIdInput').value.trim();
    if(v) localStorage.setItem(CLIENT_KEY, v);
    else localStorage.removeItem(CLIENT_KEY);
    gapiReady = false; tokenClient = null; accessToken = null;
    toast('Client ID saved');
    initDrive();
  };

  // Drive buttons
  document.getElementById('driveConnectB').onclick = driveConnect;
  document.getElementById('driveConnectS').onclick = driveConnect;
  document.getElementById('drivePushB').onclick    = () => drivePush('budget');
  document.getElementById('drivePushS').onclick    = () => drivePush('savings');
  document.getElementById('drivePullB').onclick    = () => drivePull('budget');
  document.getElementById('drivePullS').onclick    = () => drivePull('savings');

  // Theme picker
  modal.querySelectorAll('[data-theme-pick]').forEach(btn => {
    btn.onclick = () => {
      settings.plum = btn.dataset.themePick === 'plum';
      saveState();
      applyTheme();
      modal.querySelectorAll('[data-theme-pick]').forEach(b =>
        b.classList.toggle('active', b.dataset.themePick === (settings.plum?'plum':'emerald')));
      toast(settings.plum ? 'Plum theme enabled' : 'Emerald theme enabled');
    };
  });

  // Export
  document.getElementById('exportBtn').onclick = () => {
    const blob = new Blob([JSON.stringify({
      entries: state.entries, savings: state.savings,
      exportedAt: new Date().toISOString()
    }, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cjay-budgets-backup-' + todayISO() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast('Backup downloaded');
  };

  // Import
  document.getElementById('importBtn').onclick = () => document.getElementById('importFile').click();
  document.getElementById('importFile').onchange = (e) => {
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try{
        const p = JSON.parse(reader.result);
        if(!p.entries && !p.savings) throw new Error('Bad file');
        if(confirm('Replace all local data with this backup?')){
          state.entries = Array.isArray(p.entries) ? p.entries : [];
          state.savings = Array.isArray(p.savings) ? p.savings : [];
          saveState(); closeModal(); render();
          toast('Backup imported');
        }
      }catch(err){ toast('Invalid backup file'); }
    };
    reader.readAsText(file);
  };

  // Print
  document.getElementById('printBtn').onclick = () => {
    closeModal();
    buildPrintView(ui.year, ui.month);
    setTimeout(() => window.print(), 300);
  };

  // Clear
  document.getElementById('clearAllBtn').onclick = () => {
    if(!confirm('Delete ALL entries and savings? This cannot be undone.')) return;
    state.entries = []; state.savings = [];
    saveState(); closeModal(); render();
    toast('All data cleared');
  };
}

/* ============================================================
   DRIVE — INIT + AUTH
   ============================================================ */
async function initDrive(){
  const clientId = localStorage.getItem(CLIENT_KEY);
  if(!clientId) return false;
  if(gapiReady) return true;
  if(typeof gapi === 'undefined' || typeof google === 'undefined'){
    setTimeout(initDrive, 600);
    return false;
  }
  try{
    await new Promise(res => gapi.load('client', res));
    await gapi.client.init({
      discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest']
    });
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/drive.file',
      callback: (resp) => {
        const resolvers = tokenResolvers; tokenResolvers = [];
        if(resp.access_token){
          accessToken = resp.access_token;
          gapi.client.setToken({ access_token: accessToken });
          resolvers.forEach(r => r(accessToken));
        } else {
          resolvers.forEach(r => r(null));
        }
      }
    });
    gapiReady = true;
    return true;
  }catch(e){
    console.warn('Drive init failed', e);
    return false;
  }
}

function ensureAccessToken(){
  if(accessToken) return Promise.resolve(accessToken);
  return new Promise(async (resolve, reject) => {
    if(!localStorage.getItem(CLIENT_KEY)){ reject(new Error('no client')); return; }
    if(!gapiReady){
      const ok = await initDrive();
      if(!ok){ reject(new Error('init failed')); return; }
    }
    tokenResolvers.push(tok => tok ? resolve(tok) : reject(new Error('auth failed')));
    tokenClient.requestAccessToken();
  });
}

async function driveConnect(){
  try{
    await ensureAccessToken();
    toast('Drive connected');
  }catch(e){ toast('Connection failed'); }
}

/* ============================================================
   DRIVE — FOLDER + FILE HELPERS
   ============================================================ */
async function getRootFolder(){
  const q = `mimeType='application/vnd.google-apps.folder' and name='${DRIVE_FOLDER}' and trashed=false`;
  const res = await gapi.client.drive.files.list({ q, fields:'files(id,name)', spaces:'drive' });
  if(res.result.files && res.result.files.length) return res.result.files[0].id;
  const created = await gapi.client.drive.files.create({
    resource: { name: DRIVE_FOLDER, mimeType: 'application/vnd.google-apps.folder' },
    fields: 'id'
  });
  return created.result.id;
}

async function getSubFolder(parentId, name){
  const q = `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and name='${name}' and trashed=false`;
  const res = await gapi.client.drive.files.list({ q, fields:'files(id,name)', spaces:'drive' });
  if(res.result.files && res.result.files.length) return res.result.files[0].id;
  const created = await gapi.client.drive.files.create({
    resource: { name, mimeType:'application/vnd.google-apps.folder', parents:[parentId] },
    fields: 'id'
  });
  return created.result.id;
}

async function findFile(parentId, name){
  const q = `'${parentId}' in parents and name='${name}' and trashed=false`;
  const res = await gapi.client.drive.files.list({ q, fields:'files(id,name,modifiedTime)', spaces:'drive' });
  return (res.result.files && res.result.files[0]) || null;
}

async function getFullPath(kind){
  const root = await getRootFolder();
  const sub = await getSubFolder(root, kind);   // 'budget' or 'savings'
  const fileName = kind === 'budget' ? 'cjay-budget.json' : 'cjay-savings.json';
  return { folderId: sub, fileName };
}

/* ============================================================
   DRIVE — PUSH
   ============================================================ */
async function drivePush(kind){
  try{
    await ensureAccessToken();
    const { folderId, fileName } = await getFullPath(kind);
    const existing = await findFile(folderId, fileName);

    const payload = kind === 'budget'
      ? { entries: state.entries }
      : { savings: state.savings };
    payload.pushedAt = new Date().toISOString();

    const body = JSON.stringify(payload);

    if(existing){
      await gapi.client.request({
        path: `/upload/drive/v3/files/${existing.id}`,
        method: 'PATCH',
        params: { uploadType: 'media' },
        body
      });
    } else {
      const form = new FormData();
      form.append('metadata', new Blob(
        [JSON.stringify({ name: fileName, mimeType:'application/json', parents:[folderId] })],
        {type:'application/json'}
      ));
      form.append('file', new Blob([body], {type:'application/json'}));
      await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + accessToken },
        body: form
      });
    }

    const stamp = new Date().toISOString();
    if(kind === 'budget') settings.lastBudgetSync = stamp;
    else settings.lastSavingsSync = stamp;
    saveState();
    toast(kind === 'budget' ? 'Budget pushed to Drive' : 'Savings pushed to Drive');
  }catch(e){
    console.warn(e);
    toast('Push failed');
  }
}

/* ============================================================
   DRIVE — PULL
   ============================================================ */
async function drivePull(kind){
  try{
    await ensureAccessToken();
    const { folderId, fileName } = await getFullPath(kind);
    const existing = await findFile(folderId, fileName);
    if(!existing){ toast('No backup found on Drive'); return; }

    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${existing.id}?alt=media`,
      { headers: { Authorization: 'Bearer ' + accessToken } }
    );
    if(!res.ok){ toast('Pull failed'); return; }
    let cloud;
    try{ cloud = await res.json(); }catch(e){ toast('Backup is corrupt'); return; }

    if(kind === 'budget' && !Array.isArray(cloud.entries)){ toast('No budget data found'); return; }
    if(kind === 'savings' && !Array.isArray(cloud.savings)){ toast('No savings data found'); return; }

    openRestoreModal(kind, cloud, existing.modifiedTime);
  }catch(e){
    console.warn(e);
    toast('Pull failed');
  }
}

function openRestoreModal(kind, cloud, modifiedTime){
  const isBudget = kind === 'budget';
  const cloudCount = isBudget ? cloud.entries.length : cloud.savings.length;
  const localCount = isBudget ? state.entries.length : state.savings.length;
  const when = modifiedTime ? new Date(modifiedTime).toLocaleString() : 'unknown';

  openModal(`
    <div class="modal-header">
      <h2>Restore ${isBudget ? 'Budget' : 'Savings'}</h2>
      <button class="close-x">&times;</button>
    </div>

    <div style="background:var(--card-2);border-radius:16px;padding:16px;margin-bottom:16px;font-size:.85rem;line-height:1.6;color:var(--text-soft)">
      <div style="margin-bottom:8px">Cloud backup from <strong>${esc(when)}</strong></div>
      <div><strong>${cloudCount}</strong> item${cloudCount!==1?'s':''} in cloud</div>
      <div><strong>${localCount}</strong> item${localCount!==1?'s':''} on this device</div>
    </div>

    <button type="button" class="btn btn-primary" id="mergeBtn" style="margin-bottom:8px">
      Merge
    </button>
    <button type="button" class="btn btn-danger" id="replaceBtn">Replace</button>
  `);

  document.getElementById('mergeBtn').onclick = () => {
    if(isBudget) mergeBudget(cloud.entries);
    else mergeSavings(cloud.savings);
    const stamp = new Date().toISOString();
    if(isBudget) settings.lastBudgetSync = stamp; else settings.lastSavingsSync = stamp;
    saveState(); closeModal(); render();
    toast('Merged from Drive');
  };
  document.getElementById('replaceBtn').onclick = () => {
    if(!confirm('Replace all local data with the cloud backup?')) return;
    if(isBudget) state.entries = cloud.entries;
    else state.savings = cloud.savings;
    const stamp = new Date().toISOString();
    if(isBudget) settings.lastBudgetSync = stamp; else settings.lastSavingsSync = stamp;
    saveState(); closeModal(); render();
    toast('Restored from Drive');
  };
}

function mergeBudget(cloudEntries){
  const ids = new Set(state.entries.map(e => e.id));
  cloudEntries.forEach(e => {
    if(e && e.id && !ids.has(e.id)) state.entries.push(e);
  });
}
function mergeSavings(cloudSavings){
  const ids = new Set(state.savings.map(s => s.id));
  cloudSavings.forEach(s => {
    if(s && s.id && !ids.has(s.id)) state.savings.push(s);
  });
}

/* ============================================================
   PRINT VIEW
   ============================================================ */
function buildPrintView(year, month){
  const monthEntries = state.entries.filter(e => {
    const d = parseDate(e.date);
    return d && d.getFullYear() === year && d.getMonth() === month;
  }).sort((a,b)=>(a.date||'').localeCompare(b.date||''));

  const monthSavings = state.savings.filter(s => {
    const d = parseDate(s.date);
    return d && d.getFullYear() === year && d.getMonth() === month;
  }).sort((a,b)=>(a.date||'').localeCompare(b.date||''));

  const income  = monthEntries.filter(e=>e.type==='Income').reduce((s,e)=>s+(Number(e.amount)||0),0);
  const expense = monthEntries.filter(e=>e.type==='Expense').reduce((s,e)=>s+(Number(e.amount)||0),0);
  const dep = monthSavings.filter(s=>s.type==='deposit').reduce((s,x)=>s+(Number(x.amount)||0),0);
  const wit = monthSavings.filter(s=>s.type==='withdrawal').reduce((s,x)=>s+(Number(x.amount)||0),0);

  const pv = document.getElementById('printView');
  pv.innerHTML = `
    <div class="pv-header">
      <h1>CjayBudgets — Statement</h1>
      <div class="pv-sub">${MONTHS[month]} ${year}</div>
    </div>

    <div class="pv-section">
      <h3>Summary</h3>
      <div class="pv-summary">
        <div class="pv-line"><span>Total Income</span><strong>${fmtNaira(income)}</strong></div>
        <div class="pv-line"><span>Total Expenses</span><strong>${fmtNaira(expense)}</strong></div>
        <div class="pv-line"><span>Net</span><strong>${fmtNaira(income-expense)}</strong></div>
        <div class="pv-line"><span>Savings Added</span><strong>${fmtNaira(dep)}</strong></div>
        <div class="pv-line"><span>Savings Withdrawn</span><strong>${fmtNaira(wit)}</strong></div>
        <div class="pv-line"><span>Net Savings</span><strong>${fmtNaira(dep-wit)}</strong></div>
      </div>
    </div>

    <div class="pv-section">
      <h3>Entries</h3>
      <table>
        <thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Description</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>
          ${monthEntries.length ? monthEntries.map(e => `
            <tr>
              <td>${esc(e.date)}</td>
              <td>${esc(e.type)}</td>
              <td>${esc(e.category||'—')}</td>
              <td>${esc(e.description||'—')}</td>
              <td class="amt">${e.type==='Income'?'+':'-'}${fmtNaira(e.amount)}</td>
            </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;color:#888">No entries</td></tr>'}
        </tbody>
      </table>
    </div>

    <div class="pv-section">
      <h3>Savings Ledger</h3>
      <table>
        <thead><tr><th>Date</th><th>Type</th><th>Note</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>
          ${monthSavings.length ? monthSavings.map(s => `
            <tr>
              <td>${esc(s.date)}</td>
              <td>${s.type==='deposit'?'Deposit':'Withdrawal'}</td>
              <td>${esc(s.note||'—')}</td>
              <td class="amt">${s.type==='deposit'?'+':'-'}${fmtNaira(s.amount)}</td>
            </tr>`).join('') : '<tr><td colspan="4" style="text-align:center;color:#888">No savings activity</td></tr>'}
        </tbody>
      </table>
    </div>

    <div class="pv-footer">
      Generated on ${new Date().toLocaleString()} · CjayBudgets
    </div>
  `;
}

/* ============================================================
   VIEW-ONLY MODE
   ============================================================ */
function enableViewOnly(){
  ui.viewOnly = true;
  document.getElementById('viewBadge').classList.remove('hidden');
  updateFab();
  // Seed sample data if empty
  if(!state.entries.length && !state.savings.length){
    state.entries = [
      { id:'d1', date:todayISO(), type:'Income', category:'Allowance', description:'Monthly allowance', amount:20000, recurring:true },
      { id:'d2', date:todayISO(), type:'Expense', category:'Food', description:'Groceries', amount:4500, recurring:false },
      { id:'d3', date:todayISO(), type:'Expense', category:'Transport', description:'Bus fare', amount:800, recurring:false }
    ];
    state.savings = [
      { id:'s1', date:todayISO(), type:'deposit', amount:5000, note:'Monthly savings' },
      { id:'s2', date:todayISO(), type:'withdrawal', amount:2000, note:'Bought shoes' }
    ];
  }
}

/* ============================================================
   EVENT LISTENERS
   ============================================================ */
function bindEvents(){
  // Tabs
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.onclick = () => switchTab(b.dataset.tab);
  });

  // Top bar
  document.getElementById('themeBtn').onclick = toggleTheme;
  document.getElementById('settingsBtn').onclick = openSettingsModal;
  document.getElementById('searchBtn').onclick = openSearchModal;

  // Period nav
  document.getElementById('prevPeriod').onclick = () => {
    ui.visibleBudgetLimit = 8;
    if(ui.viewPeriod === 'month'){
      ui.month--; if(ui.month < 0){ ui.month = 11; ui.year--; }
    } else if(ui.viewPeriod === 'week'){
      ui.weekAnchor.setDate(ui.weekAnchor.getDate() - 7);
    } else {
      ui.dayAnchor.setDate(ui.dayAnchor.getDate() - 1);
    }
    render();
  };
  document.getElementById('nextPeriod').onclick = () => {
    ui.visibleBudgetLimit = 8;
    if(ui.viewPeriod === 'month'){
      ui.month++; if(ui.month > 11){ ui.month = 0; ui.year++; }
    } else if(ui.viewPeriod === 'week'){
      ui.weekAnchor.setDate(ui.weekAnchor.getDate() + 7);
    } else {
      ui.dayAnchor.setDate(ui.dayAnchor.getDate() + 1);
    }
    render();
  };
  document.getElementById('periodLabel').onclick = openPeriodPicker;
  document.getElementById('recurringBtn').onclick = openRecurringModal;

  // Savings actions
  document.getElementById('depositBtn').onclick  = () => openSavingsModal('deposit');
  document.getElementById('withdrawBtn').onclick = () => openSavingsModal('withdrawal');

  // FAB
  document.getElementById('fabBtn').onclick = () => {
    if(ui.activeTab === 'budget') openEntryModal(null);
    else openSavingsModal('deposit');
  };
}

/* ============================================================
   BOOT
   ============================================================ */
function boot(){
  // Detect view-only mode via URL param ?view=1
  const params = new URLSearchParams(window.location.search);
  const viewOnly = params.get('view') === '1' || params.get('readonly') === '1';

  loadState();
  applyTheme();
  bindEvents();
  switchTab('budget');

  if(viewOnly) enableViewOnly();

  render();
  initDrive();

  // Hide loading screen
  setTimeout(() => {
    const ls = document.getElementById('loadingScreen');
    ls.classList.add('hidden');
    setTimeout(() => ls.remove(), 400);
  }, 200);
}

// Kick off when DOM is ready
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

})();
