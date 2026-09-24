/* ============================================================
   CjayBudgets — app.js
   Single-file logic. Loaded via <script src="app.js">.
   ============================================================ */
(function(){
'use strict';
/* ============================================================
   CONSTANTS
   ============================================================ */
const STORAGE_KEY  = 'cjay_budgets_v1';
const DRIVE_FOLDER = 'CjayBudgets';
const CLIENT_KEY   = 'cjay_gdrive_client_id';

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
const CURRENCY = '₦';

/* ============================================================
   STATE
   ============================================================ */
let state = {
  entries: [],
  savings: [],
  budget: {
    enabled: false,
    total: 0,
    envelopes: []
  },
  goal: {
    enabled: false,
    label: '',
    target: 0
  }
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
  visibleBudgetLimit: 3,
  visibleSavingsLimit: 8,
  search: '',
  typeFilter: '',                // for budget: 'Income' | 'Expense'
  categoryFilter: '',
  savingsTypeFilter: '',         // 'deposit' | 'withdrawal'
    viewOnly: false,
  editingId: null,
  budgetCollapsed: false,
  menuOpen: false
};

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
              // Monthly budget (new)
      if(p.budget && typeof p.budget === 'object'){
        state.budget = {
          enabled: !!p.budget.enabled,
          total: Number(p.budget.total) || 0,
          envelopes: Array.isArray(p.budget.envelopes) ? p.budget.envelopes : []
        };
      }

      // Savings goal (new)
      if(p.goal && typeof p.goal === 'object'){
        state.goal = {
          enabled: !!p.goal.enabled,
          label: String(p.goal.label || ''),
          target: Number(p.goal.target) || 0
        };
      }
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
      budget: state.budget,
      goal: state.goal,
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
  const next = isDark ? 'light' : 'dark';
  document.body.dataset.theme = next;
  try{ localStorage.setItem('cjay_budgets_theme', next); }catch(e){}
  applyTheme();
}

function switchTab(tab){
  const prev = ui.activeTab;
  if(prev === tab) return;

  ui.activeTab = tab;
  document.body.dataset.tab = tab;

  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));

  const budgetEl = document.getElementById('budgetTab');
  const savingsEl = document.getElementById('savingsTab');

  // Determine slide direction: budget -> savings = from right, savings -> budget = from left
  const fromRight = prev === 'budget' && tab === 'savings';
  const dirClass = fromRight ? 'slide-from-right' : 'slide-from-left';

  // Reset animation classes
  [budgetEl, savingsEl].forEach(el => {
    el.classList.remove('slide-from-right', 'slide-from-left');
  });

  budgetEl.classList.toggle('active', tab === 'budget');
  savingsEl.classList.toggle('active', tab === 'savings');

  // Apply animation to the newly active tab
  const newActive = tab === 'budget' ? budgetEl : savingsEl;
  // Force reflow so animation restarts even when the same class toggles
  void newActive.offsetWidth;
  newActive.classList.add(dirClass);

  document.getElementById('brandLogo').innerHTML = tab === 'budget'
    ? '<i class="fas fa-wallet"></i>'
    : '<i class="fas fa-piggy-bank"></i>';

     // Show tab-specific menu items
  const goalBtn = document.getElementById('goalBtn');
  if(goalBtn){
    goalBtn.classList.toggle('hidden', tab !== 'savings');
  }

  const budgetBtn = document.getElementById('budgetBtn');
  if(budgetBtn){
    budgetBtn.classList.toggle('hidden', tab !== 'budget');
  }

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

    renderWeeklySnapshot();
  renderEntryList();
  renderBudgetTracker();
}

/* ============================================================
   WEEKLY SPENDING SNAPSHOT
   ============================================================ */
function renderWeeklySnapshot(){
  const card = document.getElementById('weeklySnapshotCard');
  const content = document.getElementById('weeklySnapshotContent');
  if(!card || !content) return;

  // Helper — get expenses for a date range
  const expensesInRange = (from, to) => state.entries.filter(e => {
    if(e.type !== 'Expense') return false;
    const d = parseDate(e.date);
    return d && d >= from && d <= to;
  });

  // Current week (Mon–Sun)
  const now = new Date();
  const dayOfWeek = now.getDay();              // 0=Sun, 1=Mon, ...
  const daysFromMon = (dayOfWeek + 6) % 7;     // 0 if Mon, 6 if Sun
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysFromMon);
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6); weekEnd.setHours(23, 59, 59);

  // Last week
  const lastWeekStart = new Date(weekStart); lastWeekStart.setDate(weekStart.getDate() - 7);
  const lastWeekEnd = new Date(lastWeekStart); lastWeekEnd.setDate(lastWeekStart.getDate() + 6); lastWeekEnd.setHours(23, 59, 59);

  const thisWeekExpenses = expensesInRange(weekStart, weekEnd);
  const lastWeekExpenses = expensesInRange(lastWeekStart, lastWeekEnd);

  const thisWeekTotal = thisWeekExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const lastWeekTotal = lastWeekExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);

  // Hide entirely if nothing to show
  if(thisWeekTotal === 0 && lastWeekTotal === 0){
    card.classList.add('hidden');
    return;
  }
  card.classList.remove('hidden');

  // Empty-ish state: no spending this week yet
  if(thisWeekTotal === 0){
    content.innerHTML = `
      <div class="ws-empty">No spending yet this week.</div>
      ${lastWeekTotal > 0 ? `<div class="ws-highest" style="margin-top:8px;margin-bottom:0">Last week: <strong>${fmtNaira(lastWeekTotal)}</strong></div>` : ''}
    `;
    return;
  }

  // Category info
  const totals = {};
  thisWeekExpenses.forEach(e => {
    const k = (e.category || 'Uncategorized').trim();
    totals[k] = (totals[k] || 0) + (Number(e.amount) || 0);
  });
  const sorted = Object.entries(totals).sort((a,b)=>b[1]-a[1]);
  const catCount = sorted.length;
  const topCat = sorted[0];

  // Comparison
  let compareHtml = '';
  if(lastWeekTotal > 0){
    const diff = thisWeekTotal - lastWeekTotal;
    const pct = Math.round((Math.abs(diff) / lastWeekTotal) * 100);
    const barWidth = Math.min((thisWeekTotal / lastWeekTotal) * 100, 100);
    const isUp = diff > 0;
    const cls = isUp ? 'up' : 'down';
    const arrow = isUp ? '↑' : '↓';
    const word = isUp ? 'higher' : 'lower';

    compareHtml = `
      <div class="ws-compare-bar">
        <div class="ws-compare-fill ${cls}" style="width:${barWidth}%"></div>
      </div>
      <div class="ws-compare-text ${cls}">
        ${arrow} <strong>${pct}%</strong> ${word} than last week
      </div>
    `;
  }

  content.innerHTML = `
    <div class="ws-total">${fmtNaira(thisWeekTotal)}<small>${catCount} categor${catCount===1?'y':'ies'}</small></div>
    <div class="ws-highest">Highest: <strong>${esc(topCat[0])} ${fmtNaira(topCat[1])}</strong></div>
    ${compareHtml}
  `;
}
/* ============================================================
   MONTHLY BUDGET TRACKER
   ============================================================ */

// Palette used for envelope dots (matches spend chart)
const ENV_COLORS = ['#2e7dd1','#0e7a5a','#e0a526','#d3453f','#8b5cf6',
                    '#06b6d4','#f97316','#ec4899','#84cc16','#6366f1'];

// Get all expenses in the current period, grouped by category
function expensesByCategoryInPeriod(){
  const period = entriesInPeriod().filter(e => e.type === 'Expense');
  const totals = {};
  period.forEach(e => {
    const k = (e.category || 'Uncategorized').trim();
    totals[k] = (totals[k] || 0) + (Number(e.amount) || 0);
  });
  return totals;
}

// Get total expenses in the current period
function totalExpensesInPeriod(){
  return entriesInPeriod()
    .filter(e => e.type === 'Expense')
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);
}

function renderBudgetTracker(){
  const card = document.getElementById('budgetTrackerCard');
  const content = document.getElementById('budgetTrackerContent');
  if(!card || !content) return;

  // Hide if budget is disabled
    if(!state.budget.enabled || state.budget.total <= 0){
    card.classList.add('hidden');
    return;
  }
  card.classList.remove('hidden');

  // Apply collapse state
  card.classList.toggle('collapsed', ui.budgetCollapsed);
  const collapseBtn = document.getElementById('budgetCollapseBtn');
  if(collapseBtn){
    collapseBtn.setAttribute('aria-expanded', String(!ui.budgetCollapsed));
  }

  // Overall progress
  const spent = totalExpensesInPeriod();
  const total = state.budget.total;
  const remaining = total - spent;
  const pctRaw = (spent / total) * 100;
  const pct = Math.min(Math.round(pctRaw), 999);
  const barWidth = Math.min(pctRaw, 100);

  // Color state for the overall bar
  let stateClass = '';
  if(spent > total) stateClass = 'over';
  else if(pctRaw >= 90) stateClass = 'over';
  else if(pctRaw >= 70) stateClass = 'warn';

  const remainingLabel = remaining >= 0
    ? `<strong>${fmtNaira(remaining)}</strong> remaining`
    : `<strong>${fmtNaira(Math.abs(remaining))}</strong> over budget`;

  let html = `
    <div class="budget-overall">
      <div class="budget-overall-top">
        <div class="budget-overall-spent">
          ${fmtNaira(spent)}<small>of ${fmtNaira(total)}</small>
        </div>
        <div class="budget-overall-pct ${stateClass}">${pct}%</div>
      </div>
      <div class="budget-bar">
        <div class="budget-bar-fill ${stateClass}" style="width:${barWidth}%"></div>
      </div>
      <div class="budget-remaining ${stateClass === 'over' ? 'over' : ''}">
        ${remainingLabel}
      </div>
    </div>
  `;

  // Envelopes
  if(state.budget.envelopes.length > 0){
    const byCat = expensesByCategoryInPeriod();

    const envelopeRows = state.budget.envelopes.map((env, i) => {
      const envSpent = byCat[env.category] || 0;
      const envTotal = Number(env.amount) || 0;
      if(envTotal <= 0) return '';

      const envPctRaw = (envSpent / envTotal) * 100;
      const envBarWidth = Math.min(envPctRaw, 100);

      let envState = '';
      if(envSpent > envTotal) envState = 'over';
      else if(envPctRaw >= 90) envState = 'over';
      else if(envPctRaw >= 70) envState = 'warn';

      const color = ENV_COLORS[i % ENV_COLORS.length];
      const overBadge = envSpent > envTotal
        ? `<i class="fas fa-exclamation-triangle envelope-warn over" title="Over budget"></i>`
        : (envPctRaw >= 90 ? `<i class="fas fa-exclamation-triangle envelope-warn" title="Almost at limit"></i>` : '');

      return `
        <div class="envelope-row">
          <div class="envelope-top">
            <span class="envelope-dot" style="background:${color}"></span>
            <span class="envelope-name">${esc(env.category)}</span>
            ${overBadge}
            <span class="envelope-amount">${fmtNaira(envSpent)} / ${fmtNaira(envTotal)}</span>
          </div>
          <div class="envelope-bar">
            <div class="envelope-bar-fill ${envState}" style="width:${envBarWidth}%;background:${envState ? (envState === 'over' ? 'var(--red)' : 'var(--gold)') : color}"></div>
          </div>
        </div>
      `;
    }).filter(Boolean).join('');

    if(envelopeRows){
      html += `<div class="budget-envelopes">${envelopeRows}</div>`;
    }
  }

    content.innerHTML = html;

  // Re-bind gear icon every render (so it never goes stale)
  const gear = document.getElementById('budgetEditBtn');
  if(gear){
    gear.onclick = openBudgetSettingsModal;
  }
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

  renderSavingsSummary();
  renderGoalCard();
  renderLedger();
}

/* ============================================================
   SAVINGS SUMMARY (weekly / monthly momentum)
   ============================================================ */
function renderSavingsSummary(){
  const el = document.getElementById('savingsSummary');
  if(!el) return;

  if(!state.savings.length){
    el.classList.add('hidden');
    return;
  }

  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

  const sumNet = (from, to) => state.savings
    .filter(s => {
      const d = parseDate(s.date);
      return d && d >= from && d <= to;
    })
    .reduce((sum, s) => sum + (s.type === 'deposit' ? 1 : -1) * (Number(s.amount) || 0), 0);

  const thisMonth = sumNet(thisMonthStart, now);
  const lastMonth = sumNet(lastMonthStart, lastMonthEnd);

  let text = '';
  let iconClass = 'fas fa-chart-line';

  if(lastMonth === 0 && thisMonth === 0){
    el.classList.add('hidden');
    return;
  }

  if(lastMonth === 0){
    text = `You've saved <strong>${fmtNaira(thisMonth)}</strong> this month`;
    iconClass = 'fas fa-seedling';
  } else {
    const change = lastMonth > 0
      ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100)
      : 0;
    const sign = change >= 0 ? '+' : '';
    const cls = change >= 0 ? 'up' : 'down';
    const arrow = change >= 0 ? '↑' : '↓';
    text = `You saved <strong>${fmtNaira(thisMonth)}</strong> this month · <span class="${cls}">${arrow} ${sign}${change}%</span> vs last month`;
    iconClass = change >= 0 ? 'fas fa-arrow-trend-up' : 'fas fa-arrow-trend-down';
  }

  el.innerHTML = `<i class="${iconClass}"></i><span>${text}</span>`;
  el.classList.remove('hidden');
}

/* ============================================================
   SAVINGS GOAL CARD
   ============================================================ */
function renderGoalCard(){
  const card = document.getElementById('goalCard');
  const content = document.getElementById('goalContent');
  if(!card || !content) return;

  if(!state.goal.enabled || state.goal.target <= 0){
    card.classList.add('hidden');
    return;
  }
  card.classList.remove('hidden');

  const totalDeposit = state.savings
    .filter(s => s.type === 'deposit')
    .reduce((sum, s) => sum + (Number(s.amount)||0), 0);
  const totalWithdraw = state.savings
    .filter(s => s.type === 'withdrawal')
    .reduce((sum, s) => sum + (Number(s.amount)||0), 0);
  const current = totalDeposit - totalWithdraw;

  const target = state.goal.target;
  const pctRaw = (current / target) * 100;
  const pct = Math.round(pctRaw);
  const barWidth = Math.min(Math.max(pctRaw, 0), 100);
  const remaining = target - current;
  const complete = current >= target;

  const labelHtml = state.goal.label
    ? `<div class="goal-label"><i class="fas fa-tag"></i>${esc(state.goal.label)}</div>`
    : '';

  const remainingHtml = complete
    ? `<div class="goal-complete-badge"><i class="fas fa-check-circle"></i> Goal reached!</div>`
    : `<div class="goal-remaining"><strong>${fmtNaira(remaining)}</strong> to go</div>`;

  content.innerHTML = `
    ${labelHtml}
    <div class="goal-progress">
      <div class="goal-progress-bar">
        <div class="goal-progress-fill" style="width:${barWidth}%"></div>
      </div>
      <div class="goal-numbers">
        <div class="goal-amount">
          ${fmtNaira(current)}<small>of ${fmtNaira(target)}</small>
        </div>
        <div class="goal-pct ${complete ? 'complete' : ''}">${pct}%</div>
      </div>
    </div>
    ${remainingHtml}
  `;

  // Rebind gear
  const gear = document.getElementById('goalEditBtn');
  if(gear){
    gear.onclick = openGoalSettingsModal;
  }
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

    const tagHtml = (!isDep && s.tag)
      ? `<span class="ledger-tag tag-${s.tag.toLowerCase()}">${esc(s.tag)}</span>`
      : '';

    return `<div class="ledger-row ${isDep?'deposit':'withdrawal'}" data-id="${s.id}">
      <div class="lr-icon"><i class="fas fa-arrow-${isDep?'down':'up'}"></i></div>
      <div class="lr-main">
        ${noteHtml}
        <div class="lr-sub">${shortDate(s.date)}${tagHtml}</div>
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
  let selectedTag = null;
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

    ${isDep ? `
      <div class="quick-add-row">
        <button type="button" class="quick-add-chip" data-quick="1000">₦1k</button>
        <button type="button" class="quick-add-chip" data-quick="5000">₦5k</button>
        <button type="button" class="quick-add-chip" data-quick="10000">₦10k</button>
        <button type="button" class="quick-add-chip" data-quick="20000">₦20k</button>
      </div>
    ` : ''}

    <div class="form-group">
      <label>Note <span style="text-transform:none;font-weight:500;color:var(--muted)">(optional)</span></label>
      <input type="text" id="sNote" placeholder="${isDep ? 'e.g. Monthly savings' : 'What did you use it for?'}" maxlength="120">
    </div>

    ${!isDep ? `
      <div class="form-group">
        <label>Reason <span style="text-transform:none;font-weight:500;color:var(--muted)">(optional)</span></label>
        <div class="tag-picker" id="tagPicker">
          <button type="button" class="tag-pick" data-tag="Emergency"><i class="fas fa-bolt"></i> Emergency</button>
          <button type="button" class="tag-pick" data-tag="Planned"><i class="fas fa-calendar-check"></i> Planned</button>
          <button type="button" class="tag-pick" data-tag="Temptation"><i class="fas fa-candy-cane"></i> Temptation</button>
          <button type="button" class="tag-pick" data-tag="Other"><i class="fas fa-circle"></i> Other</button>
        </div>
      </div>
    ` : ''}

    <div class="form-group">
      <label>Date</label>
      <input type="date" id="sDate" value="${todayISO()}">
    </div>

    <button type="button" class="btn btn-primary" id="sSaveBtn">
      ${isDep ? 'Add Deposit' : 'Record Withdrawal'}
    </button>
  `);

  // Quick-add chips (deposit only)
  modal.querySelectorAll('[data-quick]').forEach(chip => {
    chip.onclick = () => {
      const amtInput = document.getElementById('sAmount');
      const v = chip.dataset.quick;
      amtInput.value = v;
      amtInput.focus();
    };
  });

  // Tag picker (withdrawal only)
  modal.querySelectorAll('.tag-pick').forEach(btn => {
    btn.onclick = () => {
      const tag = btn.dataset.tag;
      if(selectedTag === tag){
        selectedTag = null;
        btn.classList.remove('active');
      } else {
        selectedTag = tag;
        modal.querySelectorAll('.tag-pick').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      }
    };
  });

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
    // Attach tag if withdrawal and picked
    if(!isDep && selectedTag){
      data.tag = selectedTag;
    }
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
    ${(!isDep && s.tag) ? `<div class="detail-kv"><span class="kv-label">Reason</span><span class="kv-val"><span class="ledger-tag tag-${s.tag.toLowerCase()}">${esc(s.tag)}</span></span></div>` : ''}

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
   ENVELOPE EDITOR MODAL
   ============================================================ */
function openEnvelopeEditor(){
  // Existing categories from entries (to offer as suggestions)
  const existingCats = Array.from(new Set(
    state.entries
      .filter(e => e.type === 'Expense' && e.category)
      .map(e => e.category.trim())
  )).sort();

  // Working copy of envelopes
  let draft = state.budget.envelopes.map(e => ({ ...e }));
  if(draft.length === 0){
    draft = [{ id: uid(), category: '', amount: 0 }];
  }

  openModal(`
    <div class="modal-header">
      <h2>Category Envelopes</h2>
      <button class="close-x">&times;</button>
    </div>
    <div style="font-size:.82rem;color:var(--muted);line-height:1.55;margin-bottom:16px">
      Set a spending limit per category. Leave blank to skip.
    </div>
    <div id="envelopeEditorList"></div>
    <button type="button" class="envelope-add-btn" id="addEnvelopeBtn">
      <i class="fas fa-plus"></i> Add another category
    </button>

    ${existingCats.length ? `
      <div style="margin-top:16px;font-size:.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em">
        Suggestions
      </div>
      <div class="envelope-suggestions" id="envelopeSuggestions">
        ${existingCats.map(c => `<button type="button" class="envelope-suggestion" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}
      </div>
    ` : ''}

    <button type="button" class="btn btn-primary" id="saveEnvelopesBtn" style="margin-top:20px">
      Save envelopes
    </button>
  `);

  // Render the current draft list
  function renderEditorList(){
    const list = document.getElementById('envelopeEditorList');
    list.innerHTML = draft.map((env, i) => `
      <div class="envelope-edit-row" data-i="${i}">
        <input type="text" class="env-cat" placeholder="Category" value="${esc(env.category)}" maxlength="40">
        <div class="amount-wrap">
          <span>${CURRENCY}</span>
          <input type="number" class="env-amt" inputmode="decimal" placeholder="0" value="${env.amount || ''}">
        </div>
        <button type="button" class="envelope-remove-btn" data-remove="${i}" title="Remove">
          <i class="fas fa-times"></i>
        </button>
      </div>
    `).join('');

    // Bind inputs
    list.querySelectorAll('.envelope-edit-row').forEach(row => {
      const i = Number(row.dataset.i);
      const catInput = row.querySelector('.env-cat');
      const amtInput = row.querySelector('.env-amt');
      catInput.oninput = () => { draft[i].category = catInput.value; };
      amtInput.oninput = () => { draft[i].amount = Number(amtInput.value) || 0; };
    });

    // Bind remove
    list.querySelectorAll('[data-remove]').forEach(btn => {
      btn.onclick = () => {
        const i = Number(btn.dataset.remove);
        draft.splice(i, 1);
        if(draft.length === 0){
          draft.push({ id: uid(), category: '', amount: 0 });
        }
        renderEditorList();
      };
    });
  }

  renderEditorList();

  // Add row
  document.getElementById('addEnvelopeBtn').onclick = () => {
    draft.push({ id: uid(), category: '', amount: 0 });
    renderEditorList();
    // Focus the newest category input
    const rows = document.querySelectorAll('.envelope-edit-row');
    const last = rows[rows.length - 1];
    if(last) last.querySelector('.env-cat').focus();
  };

  // Suggestion chips — click to fill next empty slot
  const suggestions = document.getElementById('envelopeSuggestions');
  if(suggestions){
    suggestions.querySelectorAll('.envelope-suggestion').forEach(btn => {
      btn.onclick = () => {
        const cat = btn.dataset.cat;
        // Already present? skip
        if(draft.some(e => e.category === cat)) return;
        // Find first empty slot, or add a new one
        const emptyIdx = draft.findIndex(e => !e.category);
        if(emptyIdx >= 0){
          draft[emptyIdx].category = cat;
        } else {
          draft.push({ id: uid(), category: cat, amount: 0 });
        }
        renderEditorList();
      };
    });
  }

  // Save
  document.getElementById('saveEnvelopesBtn').onclick = () => {
    // Filter out empties
    const cleaned = draft
      .filter(e => e.category && e.category.trim() && Number(e.amount) > 0)
      .map(e => ({
        id: e.id || uid(),
        category: e.category.trim(),
        amount: Number(e.amount)
      }));
    state.budget.envelopes = cleaned;
    saveState();
    closeModal();
    render();
    toast('Envelopes saved');
  };
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
    
    <!-- Recurring templates -->
    <div class="settings-block">
      <h4>Recurring templates</h4>
      <div class="blk-sub">Manage saved recurring entries</div>
      <button type="button" class="btn btn-secondary" id="recurringSettingsBtn" style="margin-top:0">
        <i class="fas fa-sync-alt"></i> Open recurring manager
      </button>
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
      <h4>Statements</h4>
      <div class="blk-sub">Generate a PDF statement for the current month</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn btn-secondary" id="printBtn" style="margin-top:0;flex:1;min-width:140px">
          <i class="fas fa-file-pdf"></i> Budget statement
        </button>
        <button type="button" class="btn btn-secondary" id="printSavingsBtn" style="margin-top:0;flex:1;min-width:140px">
          <i class="fas fa-file-pdf"></i> Savings statement
        </button>
      </div>
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

  // Recurring templates
  const recurBtn = document.getElementById('recurringSettingsBtn');
  if(recurBtn){
    recurBtn.onclick = () => {
      closeModal();
      setTimeout(openRecurringModal, 100);
    };
  }
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
   
  // Print — budget statement
  document.getElementById('printBtn').onclick = () => {
    closeModal();
    const pv = document.getElementById('printView');
    pv.className = 'print-view';
    buildPrintView(ui.year, ui.month);
    setTimeout(() => window.print(), 300);
  };

  // Print — savings statement
  document.getElementById('printSavingsBtn').onclick = () => {
    closeModal();
    buildSavingsStatement(ui.year, ui.month);
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
   BUDGET SETTINGS MODAL (dedicated)
   ============================================================ */
function openBudgetSettingsModal(){
  const isOn = state.budget.enabled;
  const total = state.budget.total || '';
  const envelopeCount = state.budget.envelopes.length;

  openModal(`
    <div class="modal-header">
      <h2>Monthly Budget</h2>
      <button class="close-x">&times;</button>
    </div>

    <div style="font-size:.85rem;color:var(--muted);line-height:1.55;margin-bottom:20px">
      Set a total limit for the month, then optionally give each category its own envelope.
    </div>

    <!-- Master toggle -->
    <div class="budget-toggle-row" style="border:1px solid var(--line);border-radius:16px;padding:14px 16px;margin-bottom:16px">
      <div>
        <div class="label" style="font-size:.95rem">Enable budget tracking</div>
        <div class="sub">Shows a progress card on the Budget tab</div>
      </div>
      <label class="switch">
        <input type="checkbox" id="budgetEnabledToggle" ${isOn ? 'checked' : ''}>
        <span class="switch-track"></span>
      </label>
    </div>

      <!-- Body (hidden when off) -->
    <div id="budgetSettingsBody" class="${isOn ? '' : 'hidden'}">

      <div class="form-group">
        <label>Total monthly budget</label>
        <div class="amount-wrap">
          <span>${CURRENCY}</span>
          <input type="number" id="budgetTotalInput" inputmode="decimal" placeholder="0" value="${total}">
        </div>
      </div>

      <div class="form-group">
        <label>Category envelopes <span style="text-transform:none;font-weight:500;color:var(--muted)">(optional)</span></label>
        <button type="button" class="btn btn-secondary" id="manageEnvelopesBtn" style="margin-top:0">
          <i class="fas fa-layer-group"></i>
          ${envelopeCount > 0 ? `Manage ${envelopeCount} envelope${envelopeCount!==1?'s':''}` : 'Add category envelopes'}
        </button>
        <div class="budget-empty-note" style="margin-top:8px;padding:0">
          ${envelopeCount > 0
            ? 'Envelopes cap spending for individual categories.'
            : 'Example: Food ₦10,000 · Data ₦5,000 · Transport ₦3,000'}
        </div>
      </div>
    </div>

    <button type="button" class="btn btn-primary" id="saveBudgetBtn" style="margin-top:20px">
      Save budget
    </button>
  `);

   // Bind toggle — auto-saves immediately so it persists even if modal closes without Save
  const toggle = document.getElementById('budgetEnabledToggle');
  const body = document.getElementById('budgetSettingsBody');
  toggle.onchange = () => {
    state.budget.enabled = toggle.checked;
    saveState();
    body.classList.toggle('hidden', !toggle.checked);
    // Live-update the card behind the modal
    render();
  };

  // Bind envelope manager
  document.getElementById('manageEnvelopesBtn').onclick = () => {
    // Save current total before opening envelope editor
    const v = Number(document.getElementById('budgetTotalInput').value) || 0;
    state.budget.total = v > 0 ? v : 0;
    state.budget.enabled = toggle.checked;
    saveState();
    closeModal();
    setTimeout(openEnvelopeEditor, 100);
  };

  // Bind save
  document.getElementById('saveBudgetBtn').onclick = () => {
    const v = Number(document.getElementById('budgetTotalInput').value) || 0;
    state.budget.total = v > 0 ? v : 0;
    state.budget.enabled = toggle.checked;
    saveState();
    closeModal();
    render();
    toast('Budget saved');
  };
}

/* ============================================================
   SUMMARY DETAIL MODAL (Income / Expenses drill-down)
   ============================================================ */
function openSummaryDetailModal(type, scope){
  // type = 'Income' or 'Expense'
  // scope = 'period' (default) or 'week'
  const isIncome = type === 'Income';

  let sourceEntries;
  let periodLabel;

  if(scope === 'week'){
    // This week (Mon–Sun)
    const now = new Date();
    const dayOfWeek = now.getDay();
    const daysFromMon = (dayOfWeek + 6) % 7;
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysFromMon);
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6); weekEnd.setHours(23, 59, 59);

    sourceEntries = state.entries.filter(e => {
      const d = parseDate(e.date);
      return d && d >= weekStart && d <= weekEnd;
    });

    const startLabel = weekStart.toLocaleDateString('en-GB', {day:'numeric', month:'short'});
    const endLabel = weekEnd.toLocaleDateString('en-GB', {day:'numeric', month:'short'});
    periodLabel = `This Week · ${startLabel} – ${endLabel}`;
  } else {
    sourceEntries = entriesInPeriod();
    periodLabel = periodLabelText();
  }

  const items = sourceEntries
    .filter(e => e.type === type)
    .sort((a,b) => (b.date||'').localeCompare(a.date||''));
  const total = items.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  // Render each entry row (reuses the main list styles)
  const rowsHtml = items.length
    ? items.map(e => {
        const amtSign = isIncome ? '+' : '-';
        const cls = isIncome ? 'income' : 'expense';
        const icon = isIncome ? 'arrow-down' : 'arrow-up';
        return `<div class="entry-row ${cls}" data-detail-id="${e.id}">
          <div class="er-icon"><i class="fas fa-${icon}"></i></div>
          <div class="er-main">
            <div class="er-desc">${esc(e.description || (isIncome ? 'Income' : 'Expense'))}</div>
            <div class="er-cat">
              ${esc(e.category || 'Uncategorized')}
              ${e.recurring ? '<span class="recur-dot"></span>Recurring' : ''}
            </div>
          </div>
          <div class="er-amt num">${amtSign}${fmtNaira(e.amount)}</div>
        </div>`;
      }).join('')
    : `<div class="summary-modal-empty">No ${type.toLowerCase()} entries this period.</div>`;

  // For expenses, embed the spending breakdown
  let breakdownHtml = '';
  if(!isIncome && items.length){
    const totals = {};
    items.forEach(e => {
      const k = (e.category || 'Uncategorized').trim();
      totals[k] = (totals[k] || 0) + (Number(e.amount) || 0);
    });
    const sorted = Object.entries(totals).sort((a,b)=>b[1]-a[1]);
    const maxAmt = sorted[0][1];
    const COLORS = ['#2e7dd1','#0e7a5a','#e0a526','#d3453f','#8b5cf6',
                    '#06b6d4','#f97316','#ec4899','#84cc16','#6366f1'];

    const breakdownRows = sorted.map(([cat, amt], i) => {
      const pctWidth = (amt / maxAmt) * 100;
      const pctOfTotal = Math.round((amt / total) * 100);
      return `
        <div class="bar-row">
          <div class="bar-label">
            <span class="bar-name">${esc(cat)} · ${pctOfTotal}%</span>
            <span class="bar-amt num">${fmtNaira(amt)}</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${pctWidth}%;background:${COLORS[i % COLORS.length]}"></div>
          </div>
        </div>`;
    }).join('');

    breakdownHtml = `
      <button type="button" class="summary-breakdown-toggle" id="breakdownToggle">
        <i class="fas fa-chart-bar"></i> See spending breakdown
      </button>
      <div class="summary-breakdown-content" id="breakdownContent">
        <div class="spend-bars-view">${breakdownRows}</div>
      </div>
    `;
  }

  openModal(`
    <div class="modal-header">
      <h2>${type} · ${esc(periodLabel)}</h2>
      <button class="close-x">&times;</button>
    </div>

    <div class="summary-modal-total ${isIncome ? 'income' : 'expense'}">
      <span class="smt-label">Total</span>
      <span class="smt-value">${isIncome ? '+' : '-'}${fmtNaira(total)}</span>
    </div>

    <div class="summary-modal-section-label">Entries</div>
    <div class="summary-modal-entries">${rowsHtml}</div>

    ${breakdownHtml}
  `);

  // Tap an entry → open its detail modal
  modal.querySelectorAll('[data-detail-id]').forEach(row => {
    row.onclick = () => {
      const id = row.dataset.detailId;
      // Close this modal first, then open the entry detail
      closeModal();
      setTimeout(() => openEntryDetail(id), 100);
    };
  });

  // Breakdown toggle (expenses only)
  const breakdownBtn = document.getElementById('breakdownToggle');
  if(breakdownBtn){
    breakdownBtn.onclick = () => {
      const content = document.getElementById('breakdownContent');
      const expanded = content.classList.toggle('expanded');
      breakdownBtn.innerHTML = expanded
        ? '<i class="fas fa-chevron-up"></i> Hide breakdown'
        : '<i class="fas fa-chart-bar"></i> See spending breakdown';
    };
  }
}

/* ============================================================
   SAVINGS GOAL SETTINGS MODAL
   ============================================================ */
function openGoalSettingsModal(){
  const isOn = state.goal.enabled;
  const label = state.goal.label || '';
  const target = state.goal.target || '';

  openModal(`
    <div class="modal-header">
      <h2>Savings Goal</h2>
      <button class="close-x">&times;</button>
    </div>

    <div style="font-size:.85rem;color:var(--muted);line-height:1.55;margin-bottom:20px">
      Set a target amount and watch your progress fill up.
    </div>

    <div class="budget-toggle-row" style="border:1px solid var(--line);border-radius:16px;padding:14px 16px;margin-bottom:16px">
      <div>
        <div class="label" style="font-size:.95rem">Enable savings goal</div>
        <div class="sub">Shows a goal card on the Savings tab</div>
      </div>
      <label class="switch">
        <input type="checkbox" id="goalEnabledToggle" ${isOn ? 'checked' : ''}>
        <span class="switch-track"></span>
      </label>
    </div>

    <div id="goalSettingsBody" class="${isOn ? '' : 'hidden'}">

      <div class="form-group">
        <label>Goal name <span style="text-transform:none;font-weight:500;color:var(--muted)">(optional)</span></label>
        <input type="text" id="goalLabelInput" placeholder="e.g. New Laptop" maxlength="40" value="${esc(label)}">
      </div>

      <div class="form-group">
        <label>Target amount</label>
        <div class="amount-wrap">
          <span>${CURRENCY}</span>
          <input type="number" id="goalTargetInput" inputmode="decimal" placeholder="0" value="${target}">
        </div>
      </div>
    </div>

    <button type="button" class="btn btn-primary" id="saveGoalBtn" style="margin-top:20px">
      Save goal
    </button>
  `);

  const toggle = document.getElementById('goalEnabledToggle');
  const body = document.getElementById('goalSettingsBody');

  toggle.onchange = () => {
    state.goal.enabled = toggle.checked;
    saveState();
    body.classList.toggle('hidden', !toggle.checked);
    renderSavings();
  };

  document.getElementById('saveGoalBtn').onclick = () => {
    const labelVal = document.getElementById('goalLabelInput').value.trim();
    const targetVal = Number(document.getElementById('goalTargetInput').value) || 0;

    state.goal.enabled = toggle.checked;
    state.goal.label = labelVal;
    state.goal.target = targetVal;

    saveState();
    closeModal();
    render();
    toast('Goal saved');
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
   SAVINGS STATEMENT (bank-style PDF)
   ============================================================ */
function buildSavingsStatement(year, month){
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0, 23, 59, 59);

  // Filter the month's activity
  const monthSavings = state.savings.filter(s => {
    const d = parseDate(s.date);
    return d && d >= monthStart && d <= monthEnd;
  }).sort((a,b) => (a.date||'').localeCompare(b.date||''));

  const deposits = monthSavings.filter(s => s.type === 'deposit');
  const withdrawals = monthSavings.filter(s => s.type === 'withdrawal');

  const depositTotal = deposits.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  const withdrawalTotal = withdrawals.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  const netChange = depositTotal - withdrawalTotal;

  // Opening balance = everything before this month
  const openingBalance = state.savings
    .filter(s => {
      const d = parseDate(s.date);
      return d && d < monthStart;
    })
    .reduce((sum, s) => sum + (s.type === 'deposit' ? 1 : -1) * (Number(s.amount) || 0), 0);

  const closingBalance = openingBalance + netChange;

  // Tag breakdown for withdrawals
  const tagTotals = {};
  withdrawals.forEach(s => {
    const k = s.tag || 'Untagged';
    tagTotals[k] = (tagTotals[k] || 0) + (Number(s.amount) || 0);
  });
  const tagRows = Object.entries(tagTotals).sort((a,b) => b[1] - a[1]);

  const pv = document.getElementById('printView');
  pv.className = 'print-view pv-statement';
  pv.innerHTML = `
    <div class="pv-header">
      <div>
        <h1>CjayBudgets</h1>
        <div class="pv-sub">Savings Statement · ${MONTHS[month]} ${year}</div>
      </div>
      <div class="pv-meta">
        Generated<br>
        ${new Date().toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'})}
      </div>
    </div>

    <div class="pv-balance-box">
      <div>
        <div class="pbb-label">Opening Balance</div>
        <div class="pbb-value">${fmtNaira(openingBalance)}</div>
      </div>
      <div>
        <div class="pbb-label">Net Change</div>
        <div class="pbb-value ${netChange >= 0 ? 'positive' : 'negative'}">
          ${netChange >= 0 ? '+' : ''}${fmtNaira(netChange)}
        </div>
      </div>
      <div>
        <div class="pbb-label">Closing Balance</div>
        <div class="pbb-value">${fmtNaira(closingBalance)}</div>
      </div>
    </div>

    <div class="pv-section">
      <h3>Deposits</h3>
      <table>
        <thead>
          <tr>
            <th style="width:22%">Date</th>
            <th>Note</th>
            <th style="text-align:right;width:25%">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${deposits.length ? deposits.map(s => `
            <tr>
              <td>${esc(s.date)}</td>
              <td>${esc(s.note || '—')}</td>
              <td class="amt positive">+${fmtNaira(s.amount)}</td>
            </tr>
          `).join('') : '<tr><td colspan="3" style="text-align:center;color:#999;padding:20px">No deposits this month</td></tr>'}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="2">Total Deposits</td>
            <td class="amt positive">+${fmtNaira(depositTotal)}</td>
          </tr>
        </tfoot>
      </table>
    </div>

    <div class="pv-section">
      <h3>Withdrawals</h3>
      <table>
        <thead>
          <tr>
            <th style="width:22%">Date</th>
            <th>Note</th>
            <th style="width:20%">Reason</th>
            <th style="text-align:right;width:22%">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${withdrawals.length ? withdrawals.map(s => `
            <tr>
              <td>${esc(s.date)}</td>
              <td>${esc(s.note || '—')}</td>
              <td>${esc(s.tag || '—')}</td>
              <td class="amt negative">-${fmtNaira(s.amount)}</td>
            </tr>
          `).join('') : '<tr><td colspan="4" style="text-align:center;color:#999;padding:20px">No withdrawals this month</td></tr>'}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3">Total Withdrawals</td>
            <td class="amt negative">-${fmtNaira(withdrawalTotal)}</td>
          </tr>
        </tfoot>
      </table>
    </div>

    ${tagRows.length ? `
      <div class="pv-section">
        <h3>Withdrawal Breakdown</h3>
        <table>
          <thead>
            <tr>
              <th>Reason</th>
              <th style="text-align:right;width:30%">Total</th>
            </tr>
          </thead>
          <tbody>
            ${tagRows.map(([tag, amt]) => `
              <tr>
                <td>${esc(tag)}</td>
                <td class="amt negative">-${fmtNaira(amt)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : ''}

    <div class="pv-footer">
      CjayBudgets · Personal Finance Tracker
    </div>
  `;
}
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

   // Top bar — theme stays one-tap
  document.getElementById('themeBtn').onclick = toggleTheme;

  // Clickable summary cards (Income / Expenses)
  document.getElementById('sumIncomeCard').onclick = () => openSummaryDetailModal('Income');
  document.getElementById('sumExpenseCard').onclick = () => openSummaryDetailModal('Expense');

  // Weekly snapshot → opens Expenses drill-down scoped to this week
  document.getElementById('weeklySnapshotCard').onclick = () => {
    openSummaryDetailModal('Expense', 'week');
  };

  // Hamburger menu
  const menuBtn = document.getElementById('menuBtn');
  const menuDropdown = document.getElementById('menuDropdown');

  function openMenu(){
    ui.menuOpen = true;
    menuDropdown.classList.remove('hidden');
    menuBtn.setAttribute('aria-expanded', 'true');
  }
  function closeMenu(){
    ui.menuOpen = false;
    menuDropdown.classList.add('hidden');
    menuBtn.setAttribute('aria-expanded', 'false');
  }

  menuBtn.onclick = (e) => {
    e.stopPropagation();
    ui.menuOpen ? closeMenu() : openMenu();
  };

  // Close menu when clicking anywhere else
  document.addEventListener('click', (e) => {
    if(!ui.menuOpen) return;
    if(e.target.closest('.menu-wrap')) return;
    closeMenu();
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape' && ui.menuOpen) closeMenu();
  });

  // Menu items — open their respective modals, then close the menu
  document.getElementById('searchBtn').onclick = () => {
    closeMenu();
    openSearchModal();
  };
  document.getElementById('budgetBtn').onclick = () => {
    closeMenu();
    openBudgetSettingsModal();
  };
    document.getElementById('settingsBtn').onclick = () => {
    closeMenu();
    openSettingsModal();
  };
  document.getElementById('goalBtn').onclick = () => {
    closeMenu();
    openGoalSettingsModal();
  };

 // (Spend card collapse logic removed — the spend card no longer exists)

  // Budget card collapse toggle
  document.getElementById('budgetCollapseBtn').onclick = () => {
    ui.budgetCollapsed = !ui.budgetCollapsed;
    try{
      localStorage.setItem('cjay_budgets_budget_collapsed', String(ui.budgetCollapsed));
    }catch(e){}
    renderBudgetTracker();
  };
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
   OFFLINE / ONLINE HANDLING
   ============================================================ */
function createOfflineBanner(){
  if(document.getElementById('offlineBanner')) return;
  const el = document.createElement('div');
  el.className = 'offline-banner';
  el.id = 'offlineBanner';
  el.innerHTML = '<i class="fas fa-plane-slash"></i> You\'re offline — changes save locally and sync when you\'re back';
  document.body.appendChild(el);
}

function updateOnlineStatus(){
  const online = navigator.onLine;
  const banner = document.getElementById('offlineBanner');
  if(banner){
    banner.classList.toggle('show', !online);
  }
  document.body.classList.toggle('offline', !online);
}

/* ============================================================
   UPDATE AVAILABLE HANDLER
   ============================================================ */
let updateToastTimer = null;
let updateToastDismissed = false;

function showUpdateToast(){
  // Don't nag if already dismissed this session
  if(updateToastDismissed) return;

  const existing = document.getElementById('updateToast');
  if(existing) return;

  const el = document.createElement('div');
  el.className = 'update-toast';
  el.id = 'updateToast';
  el.innerHTML = `
    <span>✨ New version available</span>
    <button class="update-refresh" id="updateRefreshBtn">Refresh</button>
    <button class="update-dismiss" id="updateDismissBtn" aria-label="Dismiss">✕</button>
  `;
  document.body.appendChild(el);

  requestAnimationFrame(() => el.classList.add('show'));

  function hideToast(){
    el.classList.remove('show');
    clearTimeout(updateToastTimer);
    setTimeout(() => el.remove(), 300);
  }

  // Auto-hide after 15 seconds
  updateToastTimer = setTimeout(hideToast, 15000);

  // Refresh button
  document.getElementById('updateRefreshBtn').onclick = async () => {
    try{
      const reg = await navigator.serviceWorker.getRegistration();
      if(reg && reg.waiting){
        reg.waiting.postMessage({type:'SKIP_WAITING'});
      }
    }catch(e){}
    setTimeout(() => window.location.reload(), 200);
  };

  // Dismiss button — remembers for this session so it doesn't keep popping back
  document.getElementById('updateDismissBtn').onclick = () => {
    updateToastDismissed = true;
    hideToast();
  };
}

// Listen for the custom event fired by the registration script in index.html
window.addEventListener('sw-update-available', showUpdateToast);

// Also react to SW telling us directly
if('serviceWorker' in navigator){
  navigator.serviceWorker.addEventListener('message', (event) => {
    if(event.data && event.data.type === 'UPDATE_AVAILABLE'){
      showUpdateToast();
    }
  });
}

/* ============================================================
   BOOT
   ============================================================ */
function boot(){
  // Restore budget card collapse state
  const savedCollapsed = localStorage.getItem('cjay_budgets_budget_collapsed');
  if(savedCollapsed === 'true'){
    ui.budgetCollapsed = true;
  }
  createOfflineBanner();
  updateOnlineStatus();
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);

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
