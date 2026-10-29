// Life Game web app. No framework, no inline styles/handlers (the server sends a strict CSP).

const root = document.getElementById('app');

/* ---------- small helpers ---------- */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const raw = (s) => new Raw(s);
const fmt = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(fmt).join('') : v == null || v === false ? '' : esc(v));
// Values are escaped unless they come from html`` or raw(); html`` returns a Raw so templates nest safely.
const html = (strings, ...vals) => new Raw(strings.reduce((out, s, i) => out + s + (i < vals.length ? fmt(vals[i]) : ''), ''));

const icons = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 11h18"/></svg>',
  timers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/></svg>',
  plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/></svg>',
  history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>',
};

const state = {
  authed: null, // null = unknown, then true/false
  view: 'today',
  data: null,
  profile: null,
  history: null,
  pauses: null,
  preview: null,
  range: 'today',
  report: null,
  freelance: null,
  baseline: null,
  devices: null,
  newToken: null,
  recent: null,
  toast: null,
  error: null,
  offset: 0, // server time minus device time, ms
};

/* ---------- API ---------- */
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (res.status === 401) {
    state.authed = false;
    render();
    throw new Error('unauthorized');
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const err = new Error((data && (data.message || data.error)) || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
function safeJson(t) { try { return JSON.parse(t); } catch { return null; } }

let toastTimer;
function toast(msg) {
  state.toast = msg;
  render();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { state.toast = null; render(); }, 3500);
}
const run = async (fn) => {
  try { await fn(); } catch (e) { if (e.message !== 'unauthorized') toast(e.message); }
};

/* ---------- time formatting ---------- */
const tz = () => state.data?.settings?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
const clock = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: tz(), hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const dayDate = (ymd) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${ymd}T00:00:00Z`));
const pad = (n) => String(n).padStart(2, '0');
function hms(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
const nowMs = () => Date.now() + state.offset;
const minutesLabel = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim() : `${m} min`);

/* ---------- data loading ---------- */
async function refresh({ quiet = false } = {}) {
  try {
    const data = await api('GET', '/api/state');
    state.offset = Date.parse(data.now) - Date.now();
    state.data = data;
    state.authed = true;
    state.error = null;
  } catch (e) {
    if (e.message === 'unauthorized') return;
    state.error = e.message;
  }
  if (!quiet) render();
}
async function loadProfile() { state.profile = (await api('GET', '/api/profile')).settings; }
async function loadHistory() { state.recent = (await api('GET', '/api/history?days=14')).days; }
async function loadReport() { state.report = await api('GET', `/api/reports?range=${state.range}`); }
async function loadFreelance() { state.freelance = await api('GET', '/api/freelance'); }
async function loadBaseline() { state.baseline = await api('GET', '/api/baseline'); }
async function loadDevices() { state.devices = (await api('GET', '/api/devices')).devices; }
async function loadPauses() { state.pauses = (await api('GET', '/api/pause')).pauses; }

/* ---------- views ---------- */
function loginView() {
  return html`<main class="center"><form class="card login stack" data-form="login">
    <div><h1>Life Game</h1><p class="muted">Sign in to continue.</p></div>
    <div><label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" required autofocus></div>
    ${state.error ? html`<p class="notice error" role="alert">${state.error}</p>` : ''}
    <button class="btn primary" type="submit">Sign in</button>
  </form></main>`;
}

function todayView() {
  const d = state.data;
  if (!d) return html`<main class="page"><p class="muted">${state.error || 'Loading…'}</p></main>`;
  const paused = d.day.status === 'paused';
  const required = d.tasks.filter((t) => t.required);
  const optional = d.tasks.filter((t) => !t.required);
  const level = d.player;
  const msLeft = Date.parse(d.day.endsAt) - nowMs();
  const taskRow = (t) => html`<div class="task ${t.status === 'done' ? 'done' : ''}">
    <button class="check" data-action="${t.status === 'done' ? 'undo' : 'complete'}" data-id="${t.id}"
      aria-pressed="${t.status === 'done'}" aria-label="${t.status === 'done' ? 'Undo' : 'Mark done'}: ${t.title}" ${paused ? 'disabled' : ''}>${raw(t.status === 'done' ? icons.check : '')}</button>
    <div class="grow"><div class="title">${t.title}</div>
      <div class="meta">${[t.plannedMinutes ? `${t.plannedMinutes} min` : null, `+${t.xp} XP`, t.rewardMinutes ? `+${t.rewardMinutes} min play` : null, t.required ? null : 'optional'].filter(Boolean).join(' · ')}</div>
      ${t.status !== 'done' && t.markers?.length && !paused ? html`<div class="hint">Activity found: ${t.markers.map((m) => m.ref).join(', ')} <button class="btn small" data-action="complete" data-id="${t.id}">Mark done</button></div>` : ''}</div>
  </div>`;
  return html`<main class="page stack">
    ${!d.onboarded ? html`<div class="notice">First time here? <button class="btn small" data-action="goto" data-view="plan">Set up your profile and goal</button></div>` : ''}
    ${d.baseline?.active ? html`<div class="notice">Baseline week, day ${d.baseline.dayNumber} of ${d.baseline.totalDays}. Everything is tracked, nothing counts. <button class="btn small" data-action="baseline-end" data-skip="true">End early</button></div>`
      : paused ? html`<div class="notice">Day off. Nothing counts against you today. <button class="btn small" data-action="resume-day">Resume</button></div>` : ''}
    <section class="card hero">
      <div class="label">${d.day.success ? 'Required tasks done' : 'Day ends in'}</div>
      <div class="countdown ${msLeft < 1800000 ? 'critical' : msLeft < 7200000 ? 'low' : ''}" data-countdown="${d.day.endsAt}">${hms(msLeft)}</div>
      <p class="muted small">${dayDate(d.day.localDate)} · ends ${clock(d.day.endsAt)}</p>
      <progress class="${d.day.success ? 'good' : ''}" max="${Math.max(1, d.day.tasksRequired)}" value="${d.day.requiredDone}" aria-label="Required tasks done"></progress>
      <p class="small">${d.day.requiredDone} of ${d.day.tasksRequired} required tasks</p>
    </section>

    <section class="card" aria-labelledby="tasks-h">
      <h2 id="tasks-h">Today's tasks</h2>
      ${optional.filter((t) => t.templateId === 'kickoff').map(taskRow)}
      ${required.map(taskRow)}
      ${optional.filter((t) => t.templateId !== 'kickoff').map(taskRow)}
      <form class="row" data-form="bonus"><input name="title" placeholder="Add an extra task" maxlength="120" aria-label="Extra task" ${paused ? 'disabled' : ''}><button class="btn small" type="submit" ${paused ? 'disabled' : ''}>Add</button></form>
    </section>

    <section class="card" aria-labelledby="budget-h">
      <h2 id="budget-h">Game time</h2>
      <div class="row between"><span><strong>${minutesLabel(d.budget.remainingMinutes)}</strong> left to play</span><span class="muted small">earned ${d.budget.earnedMinutes} · used ${d.budget.usedMinutes} · cap ${d.budget.capMinutes} min</span></div>
      <progress max="${Math.max(1, d.budget.capMinutes)}" value="${Math.min(d.budget.usedMinutes, d.budget.capMinutes)}" aria-label="Game time used"></progress>
      ${d.budget.usedMinutes > d.budget.earnedMinutes ? html`<p class="notice error" role="status">You are ${d.budget.usedMinutes - d.budget.earnedMinutes} min over what you earned.</p>` : ''}
    </section>

    <section class="card" aria-labelledby="wake-h">
      <h2 id="wake-h">Wake-up</h2>
      ${d.wake.today
        ? html`<p>Up at <strong>${clock(d.wake.today)}</strong> <span class="muted">(goal: before ${d.wake.goal})</span></p>`
        : html`<div class="row between"><span class="muted">Goal: before ${d.wake.goal}</span><button class="btn primary" data-action="wake">I'm up</button></div>`}
    </section>

    <section class="card" aria-labelledby="player-h">
      <h2 id="player-h">${level.rank} · Level ${level.level}</h2>
      <progress max="${level.xpForLevel}" value="${level.xpIntoLevel}" aria-label="XP to next level"></progress>
      <div class="stats mt12">
        <div class="stat"><div class="num">${level.streak}</div><div class="label">Day streak</div></div>
        <div class="stat"><div class="num">${level.reputation}</div><div class="label">Crew opinion</div></div>
        <div class="stat"><div class="num">${level.tasksPerDay}</div><div class="label">Tasks / day</div></div>
      </div>
    </section>

    ${d.crew.length ? html`<section class="card" aria-labelledby="crew-h"><h2 id="crew-h">Crew</h2><div class="crew">${d.crew.map((m) => html`<div class="msg"><span class="who">${m.from}</span><span>${m.text}</span></div>`)}</div></section>` : ''}
  </main>`;
}

const TIMER_LABELS = { wash: 'Wash', bath: 'Bath', lunch: 'Lunch', dinner: 'Dinner', sleep: 'Sleep', out: 'Out', reading: 'Reading', gaming: 'Gaming', work: 'Work', other: 'Other' };

function timersView() {
  const d = state.data;
  if (!d) return html`<main class="page"><p class="muted">Loading…</p></main>`;
  const running = d.timer;
  return html`<main class="page stack">
    <section class="card hero">
      <div class="label">${running ? `${TIMER_LABELS[running.kind]} running` : 'No timer running'}</div>
      <div class="countdown" data-elapsed="${running ? running.startedAt : ''}">${running ? hms(nowMs() - Date.parse(running.startedAt)) : '00:00:00'}</div>
      ${running ? html`<button class="btn primary" data-action="timer-stop">Stop</button>` : html`<p class="muted small">Pick one below. Starting a new one stops the current one.</p>`}
    </section>
    <section class="card"><h2>Start a timer</h2>
      <div class="grid-buttons">${Object.entries(TIMER_LABELS).map(([k, label]) => html`<button class="btn" data-action="timer-start" data-kind="${k}" aria-pressed="${running?.kind === k}">${label}</button>`)}</div>
      <p class="muted small mt10">Gaming time counts against your game time. Meals, wash and bath are neutral and never hurt you.</p>
    </section>
    <section class="card"><h2>This cycle</h2>
      ${d.timers.length ? d.timers.map((t) => html`<div class="list-row"><span>${TIMER_LABELS[t.kind] || t.kind}</span><span class="muted small">${clock(t.startedAt)} – ${t.stoppedAt ? clock(t.stoppedAt) : 'now'}${t.stoppedAt ? ` · ${Math.max(1, Math.round((Date.parse(t.stoppedAt) - Date.parse(t.startedAt)) / 60000))} min` : ''}</span></div>`) : html`<p class="muted">Nothing logged yet.</p>`}
    </section>
  </main>`;
}

const BLOCKERS = {
  dont_open_it: "I don't even open it",
  drift: 'I start, then drift to something else',
  overwhelmed: 'I feel overwhelmed',
  stall: 'I stall at the hard part',
  fear_of_rejection: 'Fear of rejection or being judged',
};
const TEMPLATES = { get_job: 'Get a job', learn_skill: 'Learn a skill', freelance: 'Freelance income', health: 'Health or sleep', project: 'Project', custom: 'Something else' };

function field(label, name, value, attrs = '', hint = '') {
  return html`<div><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" value="${value ?? ''}" ${raw(attrs)}>${hint ? html`<span class="muted small">${hint}</span>` : ''}</div>`;
}
function selectField(label, name, options, value) {
  return html`<div><label for="f-${name}">${label}</label><select id="f-${name}" name="${name}">${Object.entries(options).map(([k, v]) => html`<option value="${k}" ${k === value ? 'selected' : ''}>${v}</option>`)}</select></div>`;
}

function planView() {
  const p = state.profile;
  const goals = state.data?.goals || [];
  return html`<main class="page stack">
    <section class="card"><h2>Your goals</h2>
      ${goals.length ? goals.map((g) => html`<div class="list-row"><div class="grow"><div class="title">${g.outcome}</div>
        <div class="meta">${TEMPLATES[g.template]} · week ${Math.min(g.week, g.totalWeeks)} of ${g.totalWeeks}${g.phase ? ` · ${g.phase}` : ''}${g.target ? ` · ${g.done}/${g.target.target} ${g.target.unit}` : ''}</div>
        ${g.target ? html`<progress class="good" max="${g.target.target}" value="${Math.min(g.done, g.target.target)}" aria-label="Goal progress"></progress>` : ''}</div>
        <button class="btn small danger" data-action="goal-delete" data-id="${g.id}">Remove</button></div>`) : html`<p class="muted">No goal yet. Add one below and the app will break it into small daily tasks.</p>`}
    </section>

    <form class="card stack" data-form="goal"><h2>Add a goal</h2>
      <div class="form-grid">
        ${selectField('What kind of goal?', 'template', TEMPLATES, 'get_job')}
        <div class="full">${field('Outcome, in one sentence', 'outcome', '', 'required maxlength="200" placeholder="e.g. Get an Android engineering role"')}</div>
        ${field('Weeks to do it (blank = no deadline)', 'deadlineWeeks', '', 'type="number" min="1" max="104" inputmode="numeric"')}
        ${field('Hours per week you can honestly give', 'hoursPerWeek', '5', 'type="number" min="0.5" max="80" step="0.5" required inputmode="decimal"', 'Choose lower if unsure.')}
        ${field('Done when: what are you counting?', 'doneUnit', '', 'maxlength="40" placeholder="e.g. applications"')}
        ${field('How many?', 'doneTarget', '', 'type="number" min="1" inputmode="numeric"')}
        ${selectField('Where are you now?', 'startState', { nothing: 'Nothing started', some_prep: 'Some preparation done', ready: 'Ready to act' }, 'nothing')}
        ${selectField('What usually stops you?', 'startBlocker', BLOCKERS, 'dont_open_it')}
      </div>
      <div class="row"><button class="btn" type="button" data-action="goal-preview">Preview plan</button><button class="btn primary" type="submit">Save goal</button></div>
      ${state.preview ? html`<div class="stack">
        <h3>Plan: ${state.preview.totalWeeks} weeks, ${state.preview.taskMinutes}-minute tasks</h3>
        ${state.preview.phases.map((ph) => html`<div class="list-row"><div><div class="title">${ph.title}</div><div class="meta">${ph.taskTypes.map((t) => t.title).join(' · ')}</div></div><span class="muted small">${ph.startWeek === ph.endWeek ? `week ${ph.startWeek}` : `weeks ${ph.startWeek}–${ph.endWeek}`}</span></div>`)}
        ${state.preview.warnings.map((w) => html`<p class="notice" role="status">${w}</p>`)}
      </div>` : ''}
    </form>

    <form class="card stack" data-form="profile"><h2>Your rules</h2>
      ${p ? html`<div class="form-grid">
        ${field('Day ends at', 'dayEndsAt', p.dayEndsAt, 'type="time" required', 'Your 24-hour deadline each day.')}
        ${field('Time zone', 'timezone', p.timezone, 'required')}
        ${field('Tasks per day to start', 'startTasksPerDay', p.startTasksPerDay, 'type="number" min="0" max="8" required')}
        ${field('Most tasks per day', 'maxTasksPerDay', p.maxTasksPerDay, 'type="number" min="1" max="8" required')}
        ${field('Daily game time cap (min)', 'dailyCapMinutes', p.dailyCapMinutes, 'type="number" min="0" max="1440" required')}
        ${field('Most minutes per task', 'perTaskMaxMinutes', p.perTaskMaxMinutes, 'type="number" min="0" max="600" required', 'Shrinks as tasks per day grow.')}
        ${selectField('If you miss a day', 'lossPenalty', { none: 'Nothing happens', halve_next_day: 'Halve tomorrow\'s game time', zero_next_day: 'No game time tomorrow' }, p.lossPenalty)}
        ${selectField('Pressure', 'pressure', { data_only: 'Just show me data', gentle: 'Gentle', gradual: 'Gradual', harsh: 'Harsh' }, p.pressure)}
        ${field('Forgiven misses per week', 'graceDaysPerWeek', p.graceDaysPerWeek, 'type="number" min="0" max="3" required')}
        ${selectField('How is your wake-up recorded?', 'wakeSource', { manual: 'I tap "I\'m up"', phone: 'First phone use after a quiet night (Android app)' }, p.wakeSource)}
        ${field('Wake-up goal (before)', 'wakeGoalBefore', p.wakeGoalBefore, 'type="time" required')}
        ${field('Where the wake goal ends up', 'wakeGoalFinal', p.wakeGoalFinal, 'type="time" required')}
        ${field('Move the wake goal earlier by (min per week)', 'wakeRampMinutesPerWeek', p.wakeRampMinutesPerWeek, 'type="number" min="0" max="180" required', '0 keeps it fixed. Go slowly.')}
        ${field('Sleep goal (by)', 'sleepGoalBy', p.sleepGoalBy, 'type="time" required')}
        ${field('Add a task after this many good days of 7', 'raiseAfterDaysMet', p.raiseAfterDaysMet, 'type="number" min="1" max="7" required')}
      </div><button class="btn primary" type="submit">Save rules</button>` : html`<p class="muted">Loading…</p>`}
    </form>
  </main>`;
}

const CATS = ['Productive', 'Neutral', 'Waste', 'Gaming', 'Leisure', 'Unlabeled'];
const CAT_NAME = { Productive: 'Productive', Neutral: 'Neutral', Waste: 'Waste', Gaming: 'Gaming', Leisure: 'Leisure', Unlabeled: 'Not labelled yet', Away: 'Away from computer' };
const LABELS = ['Productive', 'Neutral', 'Waste', 'Gaming', 'Leisure'];
const RANGES = { today: 'Today', week: 'Week', month: 'Month', '6months': '6 months' };

function dur(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${pad(m % 60)} min`;
}
const hhmm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const money = (n, cur) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur || 'INR', maximumFractionDigits: 0 }).format(n);

function axisLabel(date, i, series, range) {
  const d = new Date(`${date}T00:00:00Z`);
  if (range === 'week') return new Intl.DateTimeFormat('en-GB', { weekday: 'narrow', timeZone: 'UTC' }).format(d);
  if (range === 'month') return d.getUTCDate() % 5 === 0 || i === 0 ? String(d.getUTCDate()) : '';
  const prev = i > 0 ? new Date(`${series[i - 1].date}T00:00:00Z`) : null;
  return !prev || prev.getUTCMonth() !== d.getUTCMonth() ? new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(d) : '';
}

function chart(series, range) {
  const W = 320, H = 150, labelH = 16, pad2 = 4;
  const sum = (t) => CATS.reduce((a, c) => a + (t[c] || 0), 0);
  const max = Math.max(1, ...series.map((x) => sum(x.totals)));
  const bw = (W - pad2 * 2) / series.length;
  const gap = Math.min(4, bw * 0.25);
  const base = H - labelH;
  const bars = series.map((x, i) => {
    let y = base;
    const rects = CATS.map((c) => {
      const h = ((x.totals[c] || 0) / max) * (base - pad2);
      if (h < 0.5) return '';
      y -= h;
      return `<rect class="c-${c}" x="${(pad2 + i * bw + gap / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, bw - gap).toFixed(1)}" height="${h.toFixed(1)}"/>`;
    }).join('');
    const label = axisLabel(x.date, i, series, range);
    return `<g>${rects}${label ? `<text class="axis" x="${(pad2 + i * bw + bw / 2).toFixed(1)}" y="${H - 3}" text-anchor="middle">${esc(label)}</text>` : ''}</g>`;
  }).join('');
  const total = series.reduce((a, x) => a + sum(x.totals), 0);
  return raw(`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Time per ${range === '6months' ? 'week' : 'day'}, ${dur(total)} in total"><line class="baseline" x1="0" y1="${base}" x2="${W}" y2="${base}"/>${bars}</svg>`);
}

function dayBar(totals) {
  const sum = CATS.reduce((a, c) => a + (totals[c] || 0), 0);
  if (!sum) return raw('');
  let x = 0;
  const rects = CATS.map((c) => {
    const w = ((totals[c] || 0) / sum) * 320;
    const r = w > 0.3 ? `<rect class="c-${c}" x="${x.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="22" rx="3"/>` : '';
    x += w;
    return r;
  }).join('');
  return raw(`<svg viewBox="0 0 320 22" role="img" aria-label="Split of tracked time">${rects}</svg>`);
}

function labelSelect(kind, value, current) {
  return html`<select class="label-select" data-change="label" data-kind="${kind}" data-value="${value}" aria-label="Label ${value}">
    ${current ? '' : html`<option value="" selected>Choose…</option>`}${LABELS.map((l) => html`<option value="${l}" ${l === current ? 'selected' : ''}>${l}</option>`)}</select>`;
}

function insightsView() {
  const r = state.report;
  const fl = state.freelance;
  const bl = state.baseline;
  const tabs = html`<div class="segmented" role="tablist" aria-label="Time range">${Object.entries(RANGES).map(([k, v]) => html`<button role="tab" class="seg" data-action="range" data-range="${k}" aria-selected="${state.range === k}">${v}</button>`)}</div>`;
  if (!r) return html`<main class="page stack">${tabs}<p class="muted">Loading…</p></main>`;
  const tracked = CATS.reduce((a, c) => a + (r.totals[c] || 0), 0);
  const empty = r.daysWithData === 0;
  const med = r.wake.length ? (() => { const v = r.wake.map((w) => w.wokeAt).map((iso) => { const [h, m] = clock(iso).split(':').map(Number); return h * 60 + m; }).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; })() : null;
  return html`<main class="page stack">
    ${tabs}
    ${empty ? html`<section class="card"><h2>No tracked time yet</h2><p class="muted">Connect your Mac in More and the app starts showing where your time goes. Timers you start by hand also appear here.</p></section>` : ''}
    <section class="card stack" aria-labelledby="ov-h"><h2 id="ov-h">${RANGES[state.range]}</h2>
      <div class="stats">
        <div class="stat"><div class="num">${r.productivePct === null ? '–' : `${r.productivePct}%`}</div><div class="label">Productive</div></div>
        <div class="stat"><div class="num">${dur(tracked)}</div><div class="label">Tracked</div></div>
        <div class="stat"><div class="num">${r.longestFocusMin ? dur(r.longestFocusMin * 60) : '–'}</div><div class="label">Longest focus</div></div>
      </div>
      ${state.range === 'today' ? dayBar(r.totals) : chart(r.series, state.range)}
      <div class="legend">${[...CATS, 'Away'].filter((c) => r.totals[c] > 0).map((c) => html`<div class="legend-row"><span class="dot c-${c}"></span><span class="grow">${CAT_NAME[c]}</span><span>${dur(r.totals[c])}</span></div>`)}</div>
      <p class="muted small">Productive % counts productive time against waste, gaming and leisure. Neutral time and time away from the computer are left out.</p>
    </section>
    ${r.unlabeled.length ? html`<section class="card"><h2>Label these</h2><p class="muted small">Tell the app what each one is, and every past day is re-sorted.</p>
      ${r.unlabeled.map((i) => html`<div class="list-row"><div class="grow"><div class="title">${i.key}</div><div class="meta">${i.kind === 'domain' ? 'site' : 'app'} · ${dur(i.seconds)}</div></div>${labelSelect(i.kind, i.key, '')}</div>`)}</section>` : ''}
    ${r.topItems.length ? html`<section class="card"><h2>Where the time went</h2>
      ${r.topItems.slice(0, 10).map((i) => html`<div class="list-row"><div class="grow"><div class="title">${i.key}</div><div class="meta"><span class="chip cat-${i.category}">${i.category}</span> ${dur(i.seconds)}</div></div>${i.kind === 'manual' ? '' : labelSelect(i.kind, i.key, i.category)}</div>`)}</section>` : ''}
    ${fl && (fl.configured || fl.clients.length) ? html`<section class="card stack"><div class="row between"><h2>Freelance, ${fl.month}</h2>${fl.configured ? html`<button class="btn small" data-action="sync-freelance">Sync now</button>` : ''}</div>
      ${!fl.configured ? html`<p class="muted small">Not connected to your time tracker. Set TIMETRACKER_API_URL and TIMETRACKER_API_TOKEN in .env to see hours and money here.</p>` : ''}
      ${fl.clients.map((c) => html`<div><div class="row between"><strong>${c.name}</strong><span class="small">${c.hours} h of ${c.capHours} h</span></div>
        <progress class="good" max="${Math.max(1, c.cap)}" value="${Math.min(c.earned, c.cap)}" aria-label="${c.name} earned of cap"></progress>
        <div class="meta">${money(c.earned, fl.currency)} of ${money(c.cap, fl.currency)} · ${c.remainingHours} h left this month</div></div>`)}
      ${fl.clients.length ? html`<div class="row between"><strong>Total</strong><span>${fl.totals.hours} h · ${money(fl.totals.earned, fl.currency)}</span></div>` : ''}
      ${fl.unmatched.length ? html`<p class="muted small">Not matched to a client in your config: ${fl.unmatched.map((u) => `${u.name} (${u.hours} h)`).join(', ')}</p>` : ''}
    </section>` : ''}
    ${bl?.summary ? html`<section class="card stack"><h2>Your baseline${bl.baseline?.active ? ` (day ${bl.baseline.dayNumber} of ${bl.baseline.totalDays})` : ''}</h2>
      <div class="stats">
        <div class="stat"><div class="num">${bl.summary.wake.medianMinutes === null ? '–' : hhmm(bl.summary.wake.medianMinutes)}</div><div class="label">Typical wake</div></div>
        <div class="stat"><div class="num">${bl.summary.productivePct === null ? '–' : `${bl.summary.productivePct}%`}</div><div class="label">Productive</div></div>
        <div class="stat"><div class="num">${bl.summary.longestFocusMedianMin ? `${bl.summary.longestFocusMedianMin} min` : '–'}</div><div class="label">Usual focus</div></div>
      </div>
      <p class="small">${bl.summary.wake.spreadMinutes !== null ? `Your wake time varies by ${dur(bl.summary.wake.spreadMinutes * 60)} across ${bl.summary.wake.loggedDays} logged days. ` : 'Log "I\'m up" each day to see your wake pattern. '}${bl.summary.gamingStartMedianMinutes !== null ? `You usually start gaming around ${hhmm(bl.summary.gamingStartMedianMinutes)}. ` : ''}${bl.summary.suggestedTaskMinutes ? `Tasks of about ${bl.summary.suggestedTaskMinutes} minutes should fit your focus span.` : ''}</p>
    </section>` : ''}
    <section class="card"><h2>Habits</h2>
      <div class="list-row"><span>Typical wake-up</span><strong>${med === null ? 'not logged' : hhmm(med)}</strong></div>
      <div class="list-row"><span>Days won / missed / paused</span><strong>${r.tasks.won} / ${r.tasks.missed} / ${r.tasks.paused}</strong></div>
      <div class="list-row"><span>Tasks completed</span><strong>${r.tasks.completed}</strong></div>
    </section>
    <section class="card"><h2>Recent days</h2>
      ${!state.recent ? html`<p class="muted">Loading…</p>` : state.recent.length ? state.recent.map((x) => html`<div class="list-row"><div><div class="title">${dayDate(x.localDate)}</div>
        <div class="meta">${x.requiredDone}/${x.tasksRequired} tasks${x.wokeAt ? ` · up ${clock(x.wokeAt)}` : ''}${x.earnedMinutes ? ` · ${x.earnedMinutes} min earned` : ''}</div></div>
        <span class="chip ${x.status}">${x.status === 'open' ? 'today' : x.status}</span></div>`) : html`<p class="muted">Your first day will show up here.</p>`}
    </section>
  </main>`;
}

function ago(iso) {
  if (!iso) return 'never';
  const m = Math.round((nowMs() - Date.parse(iso)) / 60000);
  if (m < 2) return 'just now';
  if (m < 90) return `${m} min ago`;
  if (m < 2880) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
}

function moreView() {
  const d = state.data;
  const paused = d?.day.status === 'paused' && !d?.baseline?.active;
  const notif = 'Notification' in window ? Notification.permission : 'unsupported';
  const bl = state.baseline?.baseline;
  const origin = location.origin;
  return html`<main class="page stack">
    <section class="card stack"><h2>Connect a device</h2>
      <p class="muted small">The Mac agent and the Android app send what you do (apps, sites, work-folder activity) so you do not have to log it.</p>
      ${state.newToken ? html`<div class="notice ok" role="status"><p><strong>Token for ${state.newToken.name}.</strong> Shown once.</p>
        ${state.newToken.kind === 'android' ? html`<p class="small">In the Android app, enter this server address and the token below, then tap "Save and test connection".</p><pre class="code">${origin}
${state.newToken.token}</pre>
        <p class="small">Setup steps: docs/ANDROID.md.</p>` : html`<p class="small">Run this on that Mac:</p><pre class="code">mkdir -p ~/.life-game-agent &amp;&amp; printf '%s' '${state.newToken.token}' &gt; ~/.life-game-agent/token &amp;&amp; chmod 600 ~/.life-game-agent/token
export LIFE_GAME_URL=${origin}</pre>
        <p class="small">Then follow docs/AGENT.md to start the agent.</p>`}
        <button class="btn small" data-action="copy-token">Copy token</button> <button class="btn small" data-action="token-done">I saved it</button></div>` : ''}
      ${(state.devices || []).filter((x) => !x.revoked_at).map((x) => html`<div class="list-row"><div class="grow"><div class="title">${x.name}</div><div class="meta">${x.kind} · last data ${ago(x.last_event_at)} · ${x.event_count} events</div></div><button class="btn small danger" data-action="device-revoke" data-id="${x.id}">Revoke</button></div>`)}
      <form class="stack" data-form="device"><div class="form-grid">${field('Name', 'name', '', 'maxlength="80" required placeholder="e.g. My Mac or My phone"')}${selectField('Type', 'kind', { mac: 'Mac', android: 'Android phone' }, 'mac')}</div><button class="btn small primary" type="submit">Create a token</button></form>
    </section>

    <section class="card stack"><h2>Baseline week</h2>
      <p class="muted small">Seven days of just tracking: no tasks count and nothing is penalised. You get a picture of how your days really go, then the game is tuned to it.</p>
      ${bl?.active ? html`<p>Day ${bl.dayNumber} of ${bl.totalDays}, ends ${dayDate(bl.endsOn)}.</p><button class="btn" data-action="baseline-end" data-skip="true">End the baseline now</button>`
        : bl ? html`<p>Baseline ${bl.status === 'done' ? 'finished' : 'skipped'}. See the results under Insights.</p><button class="btn" data-action="baseline-start">Run it again</button>`
        : html`<button class="btn primary" data-action="baseline-start">Start a baseline week</button>`}
    </section>

    <section class="card stack"><h2>Take a day off</h2>
      <p class="muted small">Family, travel, a festival, illness. Nothing counts against you and your streak is kept.</p>
      ${paused ? html`<button class="btn" data-action="resume-day">Resume today</button>` : html`<form class="stack" data-form="pause">
        <div class="form-grid">${selectField('Why?', 'reason', { family: 'Family', travel: 'Travel', festival: 'Festival or event', illness: 'Illness', other: 'Something else' }, 'family')}
        ${field('Note (optional)', 'note', '', 'maxlength="200"')}</div>
        <button class="btn" type="submit">Pause today</button></form>`}
      ${state.pauses?.length ? html`<h3>Recent days off</h3>${state.pauses.slice(0, 8).map((p) => html`<div class="list-row"><span>${dayDate(p.localDate)} · ${p.reason}${p.note ? ` · ${p.note}` : ''}</span><button class="btn small" data-action="pause-delete" data-date="${p.localDate}">Remove</button></div>`)}` : ''}
    </section>
    <section class="card stack"><h2>Reminders</h2>
      <p class="muted small">Get a notification 6 hours, 2 hours and 30 minutes before the day ends while required tasks are left.</p>
      <p class="small">Status: <strong>${notif === 'granted' ? 'allowed on this device' : notif === 'denied' ? 'blocked in browser settings' : notif === 'unsupported' ? 'not supported here' : 'not enabled'}</strong></p>
      <div class="row"><button class="btn primary" data-action="push-enable" ${notif === 'unsupported' || notif === 'denied' ? 'disabled' : ''}>Enable on this device</button><button class="btn" data-action="push-test">Send a test</button></div>
    </section>
    <section class="card"><button class="btn danger" data-action="logout">Sign out</button></section>
  </main>`;
}

function navView() {
  const tabs = [['today', 'Today', icons.today], ['timers', 'Timers', icons.timers], ['insights', 'Insights', icons.history], ['plan', 'Plan', icons.plan], ['more', 'More', icons.more]];
  return html`<nav class="tabs" aria-label="Main"><div class="inner">${tabs.map(([id, label, icon]) => html`<button class="tab" data-action="goto" data-view="${id}" ${state.view === id ? raw('aria-current="page"') : ''}>${raw(icon)}<span>${label}</span></button>`)}</div></nav>`;
}

function render() {
  const active = document.activeElement;
  const typing = active && (active.tagName === 'INPUT' || active.tagName === 'SELECT') && root.contains(active);
  if (typing && !state.toast && state.authed) return; // don't clobber a form being edited
  if (state.authed === null) { root.innerHTML = ''; return; }
  if (!state.authed) { root.innerHTML = loginView(); return; }
  const views = { today: todayView, timers: timersView, insights: insightsView, plan: planView, more: moreView };
  const scrollY = window.scrollY;
  root.innerHTML = views[state.view]() + navView() + (state.toast ? html`<div class="toast" role="status">${state.toast}</div>` : '');
  window.scrollTo(0, scrollY);
}

/* ---------- live clocks (no re-render) ---------- */
setInterval(() => {
  document.querySelectorAll('[data-countdown]').forEach((el) => {
    const left = Date.parse(el.dataset.countdown) - nowMs();
    el.textContent = hms(left);
    el.classList.toggle('critical', left < 1800000);
    el.classList.toggle('low', left >= 1800000 && left < 7200000);
    if (left <= 0 && !state.refreshing) { state.refreshing = true; refresh().finally(() => { state.refreshing = false; }); }
  });
  document.querySelectorAll('[data-elapsed]').forEach((el) => {
    if (el.dataset.elapsed) el.textContent = hms(nowMs() - Date.parse(el.dataset.elapsed));
  });
}, 1000);

/* ---------- events ---------- */
const num = (v) => (v === '' || v == null ? null : Number(v));
const formData = (form) => Object.fromEntries(new FormData(form).entries());

function goalPayload(f) {
  return {
    template: f.template,
    outcome: f.outcome,
    deadlineWeeks: num(f.deadlineWeeks),
    doneWhen: f.doneUnit && f.doneTarget ? { unit: f.doneUnit, target: num(f.doneTarget) } : null,
    startState: f.startState,
    hoursPerWeek: num(f.hoursPerWeek),
    startBlocker: f.startBlocker,
  };
}

const actions = {
  async goto(el) {
    state.view = el.dataset.view;
    state.preview = null;
    render();
    if (state.view === 'plan') await run(async () => { await loadProfile(); render(); });
    if (state.view === 'insights') await run(async () => { await Promise.all([loadReport(), loadFreelance(), loadBaseline(), loadHistory()]); render(); });
    if (state.view === 'more') await run(async () => { await Promise.all([loadPauses(), loadDevices(), loadBaseline()]); render(); });
    window.scrollTo(0, 0);
  },
  complete: (el) => run(async () => { await api('POST', `/api/tasks/${el.dataset.id}/complete`); await refresh(); }),
  undo: (el) => run(async () => { await api('POST', `/api/tasks/${el.dataset.id}/undo`); await refresh(); }),
  wake: () => run(async () => {
    const r = await api('POST', '/api/wake');
    toast(r.alreadyLogged ? 'Already logged today.' : r.beforeGoal ? `Up before your goal. +${r.xp} XP` : `Logged. +${r.xp} XP`);
    await refresh();
  }),
  'timer-start': (el) => run(async () => {
    if (state.data?.timer?.kind === el.dataset.kind) await api('POST', '/api/timers/stop');
    else await api('POST', '/api/timers/start', { kind: el.dataset.kind });
    await refresh();
  }),
  'timer-stop': () => run(async () => { await api('POST', '/api/timers/stop'); await refresh(); }),
  'resume-day': () => run(async () => { await api('DELETE', `/api/pause/${state.data.day.localDate}`); await loadPauses(); await refresh(); }),
  'pause-delete': (el) => run(async () => { await api('DELETE', `/api/pause/${el.dataset.date}`); await loadPauses(); await refresh(); }),
  'goal-preview': (el) => run(async () => {
    const form = el.closest('form');
    if (!form.reportValidity()) return;
    state.preview = (await api('POST', '/api/goals/preview', goalPayload(formData(form)))).plan;
    const keep = formData(form);
    root.innerHTML = planView() + navView();
    const f = root.querySelector('form[data-form="goal"]');
    for (const [k, v] of Object.entries(keep)) { if (f.elements[k]) f.elements[k].value = v; }
  }),
  'goal-delete': (el) => run(async () => {
    if (!confirm('Remove this goal? Today\'s tasks are re-dealt if you have not finished any.')) return;
    await api('DELETE', `/api/goals/${el.dataset.id}`);
    await refresh();
  }),
  range: (el) => run(async () => { state.range = el.dataset.range; state.report = null; render(); await loadReport(); render(); }),
  'sync-freelance': () => run(async () => { state.freelance = await api('POST', '/api/freelance/sync'); toast('Synced with your time tracker.'); }),
  'baseline-start': () => run(async () => { await api('POST', '/api/baseline/start'); await Promise.all([loadBaseline(), refresh()]); toast('Baseline week started. Just live normally.'); }),
  'baseline-end': (el) => run(async () => {
    if (!confirm('End the baseline week now? Tasks start counting again.')) return;
    await api('POST', '/api/baseline/end', { skip: el.dataset.skip === 'true' });
    await Promise.all([loadBaseline(), refresh()]);
  }),
  'device-revoke': (el) => run(async () => {
    if (!confirm('Revoke this device? It stops sending data immediately.')) return;
    await api('DELETE', `/api/devices/${el.dataset.id}`);
    await loadDevices();
    render();
  }),
  'copy-token': () => run(async () => { await navigator.clipboard.writeText(state.newToken.token); toast('Token copied.'); }),
  'token-done': () => { state.newToken = null; render(); },
  'push-enable': () => run(enablePush),
  'push-test': () => run(async () => {
    const r = await api('POST', '/api/push/test');
    toast(r.sent ? 'Test sent.' : 'No device is subscribed yet.');
  }),
  logout: () => run(async () => { await api('POST', '/api/auth/logout'); state.authed = false; state.data = null; render(); }),
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) { e.preventDefault(); actions[el.dataset.action](el); }
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const f = formData(form);
  const kind = form.dataset.form;
  if (kind === 'login') {
    run(async () => {
      try { await api('POST', '/api/auth/login', { password: f.password }); state.error = null; document.activeElement?.blur?.(); await refresh(); }
      catch (err) { state.error = err.status === 429 ? 'Too many attempts. Wait a minute.' : err.status === 401 ? 'Wrong password.' : err.message; state.authed = false; render(); }
    });
  } else if (kind === 'bonus') {
    run(async () => { await api('POST', '/api/tasks', { title: f.title }); form.reset(); await refresh(); });
  } else if (kind === 'profile') {
    run(async () => {
      const numeric = ['startTasksPerDay', 'maxTasksPerDay', 'raiseAfterDaysMet', 'dailyCapMinutes', 'perTaskMaxMinutes', 'graceDaysPerWeek', 'wakeRampMinutesPerWeek'];
      const body = { ...f };
      for (const k of numeric) body[k] = Number(f[k]);
      state.profile = (await api('PUT', '/api/profile', body)).settings;
      toast('Saved.');
      await refresh();
    });
  } else if (kind === 'goal') {
    run(async () => {
      const r = await api('POST', '/api/goals', goalPayload(f));
      state.preview = null;
      await refresh();
      toast(r.appliesFrom === 'today' ? 'Goal saved. Today\'s tasks now come from it.' : 'Goal saved. You already started today, so it shapes tomorrow\'s tasks.');
    });
  } else if (kind === 'device') {
    run(async () => {
      const r = await api('POST', '/api/devices', { name: f.name, kind: f.kind === 'android' ? 'android' : 'mac' });
      state.newToken = { name: r.name, token: r.token, kind: r.kind };
      await loadDevices();
      render();
    });
  } else if (kind === 'pause') {
    run(async () => { await api('POST', '/api/pause', { reason: f.reason, note: f.note || null }); await loadPauses(); toast('Day off recorded.'); await refresh(); });
  }
});

document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change="label"]');
  if (!el || !el.value) return;
  const { kind, value } = el.dataset;
  const category = el.value;
  el.blur();
  run(async () => {
    await api('POST', '/api/labels', { kind, value, category });
    await Promise.all([loadReport(), loadBaseline()]);
    toast(`${value} is now ${category}.`);
  });
});

/* ---------- notifications ---------- */
const b64ToBytes = (s) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw64 = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw64, (c) => c.charCodeAt(0));
};
async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('This browser does not support notifications.');
  let key;
  try { key = (await api('GET', '/api/push/key')).publicKey; }
  catch (e) { throw new Error(e.status === 503 ? 'The server has no push keys yet. See docs/DEPLOY.md.' : e.message); }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications were not allowed.');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) }));
  await api('POST', '/api/push/subscribe', sub.toJSON());
  toast('Reminders are on for this device.');
  render();
}

/* ---------- boot ---------- */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
const formView = () => state.view === 'plan' || state.view === 'more';
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.authed) refresh({ quiet: formView() }); });
setInterval(() => { if (!document.hidden && state.authed) refresh({ quiet: formView() }); }, 60_000);
refresh().then(() => { if (state.authed === null) { state.authed = false; render(); } });
