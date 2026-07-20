const APP_VERSION = '3';

const oldVer = localStorage.getItem('kurator_ver');
if (oldVer && oldVer !== APP_VERSION) {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('kurator_ver', APP_VERSION);
  location.reload();
} else if (!oldVer) {
  localStorage.setItem('kurator_ver', APP_VERSION);
}

const SUPABASE_URL = 'https://pqngmvixfcsrvsvrtbfj.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBxbmdtdml4ZmNzcnZzdnJ0YmZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzNzY0NDcsImV4cCI6MjA5OTk1MjQ0N30.nbO6rSANWaWRRxnRvrwlrawkBT2DP0VZ1GuyR6C2nHE';
const API = SUPABASE_URL + '/rest/v1/notes';

const $ = s => document.querySelector(s);
const RU_MONTHS = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
const RU_DAYS = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];
const RU_MONTHS_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];

let USER_ID = '';
let headers = {};
let selectedDate = todayStr();
let calYear, calMonth;
let dateCounts = {};
let allNotes = [];
let allGroups = {};
let suggestTimer = null;
let countsCache = null;
let countsCacheMonth = '';
let isLoading = true;

function todayStr() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function setKey(key) {
  USER_ID = key;
  headers = { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Prefer': 'return=representation', 'x-user-id': USER_ID };
  localStorage.setItem('kurator_key', USER_ID);
}

function lockApp() {
  localStorage.removeItem('kurator_key');
  location.reload();
}

function initLock() {
  const saved = localStorage.getItem('kurator_key');
  if (saved) { setKey(saved); startApp(); return; }
  const overlay = $('#lockOverlay');
  const input = $('#lockInput');
  const btn = $('#lockBtn');
  const err = $('#lockErr');
  overlay.style.display = 'flex';
  input.focus();
  function submit() {
    const v = input.value.trim();
    if (!v) { err.style.display = 'block'; return; }
    setKey(v.toLowerCase());
    overlay.style.display = 'none';
    startApp();
  }
  btn.addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
}

function startApp() {
  $('#appLayout').style.display = 'flex';
  $('#keyInfo').textContent = USER_ID;
  showSkeleton();
  claimPublicNotes().then(() => { initCalendar(); renderDayTitle(); loadNotes(); loadYesterdaySummary(); });
}

async function api(method, path, body) {
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(API + path, opts);
  if (!r.ok) throw new Error(r.status);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

window.addEventListener('offline', () => {
  toastEl.textContent = 'Нет интернета';
  toastEl.className = 'toast show offline';
  $('#syncDot').classList.add('offline');
});
window.addEventListener('online', () => {
  toastEl.textContent = 'Синхронизация...';
  toastEl.className = 'toast show';
  $('#syncDot').classList.remove('offline');
  loadNotes();
  setTimeout(() => { toastEl.className = 'toast'; }, 2000);
});

function tokenize(text) { return text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(t => t.length > 1); }

function tfidfVectors(corpus) {
  const tokenized = corpus.map(tokenize);
  const n = corpus.length;
  const df = {};
  tokenized.forEach(tokens => [...new Set(tokens)].forEach(t => { df[t] = (df[t] || 0) + 1; }));
  return tokenized.map(tokens => {
    const tf = {};
    tokens.forEach(t => { tf[t] = (tf[t] || 0) + 1; });
    const vec = {};
    for (const [w, c] of Object.entries(tf)) vec[w] = c * (Math.log((n + 1) / (df[w] + 1)) + 1);
    return vec;
  });
}

function cosineSim(a, b) {
  const keys = Object.keys(a).filter(k => k in b);
  if (!keys.length) return 0;
  const dot = keys.reduce((s, k) => s + a[k] * b[k], 0);
  const na = Math.sqrt(Object.values(a).reduce((s, v) => s + v*v, 0));
  const nb = Math.sqrt(Object.values(b).reduce((s, v) => s + v*v, 0));
  return na && nb ? dot / (na * nb) : 0;
}

function clusterNotes(notes, threshold = 0.12) {
  if (notes.length <= 1) return notes.length ? { 'Все заметки': notes } : {};
  const vectors = tfidfVectors(notes.map(n => n.content));
  const n = notes.length;
  const parent = Array.from({length: n}, (_, i) => i);
  function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
  function union(a, b) { parent[find(a)] = find(b); }
  for (let i = 0; i < n; i++) for (let j = i+1; j < n; j++) if (cosineSim(vectors[i], vectors[j]) >= threshold) union(i, j);
  const groups = {};
  notes.forEach((note, i) => { const r = find(i); (groups[r] = groups[r] || []).push(note); });
  const named = {};
  for (const [, items] of Object.entries(groups)) {
    let title;
    if (items.length === 1) { const w = items[0].content.slice(0, 40).split(' ').slice(0, 4).join(' '); title = w + (items[0].content.length > 40 ? '...' : ''); }
    else { const centroid = {}; items.forEach(n => tokenize(n.content).forEach(t => { centroid[t] = (centroid[t] || 0) + 1; })); const top = Object.entries(centroid).sort((a,b) => b[1]-a[1]).slice(0, 3).map(e => e[0]); title = top.slice(0, 2).join(' / ').replace(/^\w/, c => c.toUpperCase()); }
    named[title] = items;
  }
  return Object.fromEntries(Object.entries(named).sort((a, b) => b[1].length - a[1].length));
}

function findSimilar(query, notes, topK = 2) {
  if (!notes.length) return [];
  const vectors = tfidfVectors([query, ...notes.map(n => n.content)]);
  const q = vectors[0];
  return notes.map((n, i) => ({ id: n.id, content: n.content, score: cosineSim(q, vectors[i+1]) }))
    .filter(r => r.score > 0.05).sort((a, b) => b.score - a.score).slice(0, topK);
}

function initCalendar() { const now = new Date(); calYear = now.getFullYear(); calMonth = now.getMonth(); renderCalendar(); }

function renderCalendar() {
  $('#calMonth').textContent = RU_MONTHS[calMonth] + ' ' + calYear;
  const first = new Date(calYear, calMonth, 1);
  const last = new Date(calYear, calMonth + 1, 0);
  let startDay = first.getDay() - 1; if (startDay < 0) startDay = 6;
  let html = '';
  for (let i = 0; i < startDay; i++) { const d = new Date(calYear, calMonth, -startDay+i+1); html += '<div class="cal-day other">' + d.getDate() + '</div>'; }
  for (let d = 1; d <= last.getDate(); d++) {
    const ds = calYear + '-' + String(calMonth+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    const cls = ['cal-day'];
    if (ds === todayStr()) cls.push('today');
    if (ds === selectedDate) cls.push('selected');
    if (dateCounts[ds] > 0) cls.push('has-notes');
    html += '<div class="' + cls.join(' ') + '" data-date="' + ds + '">' + d + '</div>';
  }
  const rem = 7 - ((startDay + last.getDate()) % 7);
  if (rem < 7) for (let i = 1; i <= rem; i++) html += '<div class="cal-day other">' + i + '</div>';
  $('#calDays').innerHTML = html;
  renderCalCounts();
}

function renderCalCounts() {
  const counts = Object.entries(dateCounts).sort((a,b) => b[0].localeCompare(a[0])).slice(0, 5);
  if (!counts.length) { $('#calCounts').innerHTML = ''; return; }
  $('#calCounts').innerHTML = counts.map(([date, cnt]) => {
    const d = new Date(date + 'T12:00:00');
    return '<div class="cal-stat"><span>' + d.getDate() + ' ' + RU_MONTHS_GEN[d.getMonth()] + '</span><span>' + cnt + '</span></div>';
  }).join('');
}

function calNav(dir) { calMonth += dir; if (calMonth > 11) { calMonth = 0; calYear++; } if (calMonth < 0) { calMonth = 11; calYear--; } countsCache = null; renderCalendar(); loadDateCounts(); }
function selectDate(ds) { selectedDate = ds; renderCalendar(); renderDayTitle(); loadNotes(); }
function goToday() { selectedDate = todayStr(); const n = new Date(); calYear = n.getFullYear(); calMonth = n.getMonth(); countsCache = null; renderCalendar(); renderDayTitle(); loadNotes(); }

function renderDayTitle() {
  const d = new Date(selectedDate + 'T12:00:00');
  const today = selectedDate === todayStr();
  $('#dayTitle').textContent = today ? 'Сегодня' : d.getDate() + ' ' + RU_MONTHS_GEN[d.getMonth()];
  $('#daySubtitle').textContent = RU_DAYS[d.getDay()] + (today ? '' : ', ' + d.getFullYear());
  $('#btnToday').classList.toggle('active', today);
}

const input = $('#noteInput'), saveBtn = $('#saveBtn'), charCount = $('#charCount'), searchInput = $('#searchInput'), groupsEl = $('#groups'), statsEl = $('#stats'), emptyEl = $('#emptyState'), toastEl = $('#toast');

function autoResize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 200) + 'px'; }

input.addEventListener('input', () => {
  autoResize(); charCount.textContent = input.value.length;
  clearTimeout(suggestTimer);
  const val = input.value.trim();
  if (val.length >= 6) suggestTimer = setTimeout(() => checkSimilar(val), 400);
  else hideSuggest();
});
input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveNote(); } });
saveBtn.addEventListener('click', saveNote);
searchInput.addEventListener('input', renderGroups);

async function saveNote() {
  const content = input.value.trim();
  if (!content) return;
  saveBtn.textContent = '...'; saveBtn.disabled = true;
  try {
    await api('POST', '', { content, note_date: selectedDate, user_id: USER_ID });
    input.value = ''; autoResize(); charCount.textContent = '0';
    toast('Сохранено');
    $('#syncDot').style.background = '#4caf50';
    countsCache = null;
    await loadNotes();
  } catch (e) {
    if (!navigator.onLine) { toastEl.textContent = 'Нет интернета'; toastEl.className = 'toast show offline'; }
    else toast('Ошибка');
    $('#syncDot').style.background = '#e05555';
  }
  saveBtn.textContent = 'СОХРАНИТЬ'; saveBtn.disabled = false;
}

async function deleteNote(id) {
  const safeId = parseInt(id, 10);
  if (isNaN(safeId)) return;
  try {
    await api('DELETE', '?id=eq.' + safeId + '&user_id=eq.' + USER_ID);
    toast('Удалено');
    countsCache = null;
    await loadNotes();
  } catch (e) { toast('Ошибка'); }
}

async function loadNotes() {
  if (isLoading) showSkeleton();
  try {
    const data = await api('GET', '?user_id=eq.' + USER_ID + '&note_date=eq.' + selectedDate + '&order=created_at.desc');
    allNotes = Array.isArray(data) ? data : [];
    allGroups = clusterNotes(allNotes);
    await loadDateCounts();
    renderCalendar();
    renderGroups();
    try { sessionStorage.setItem('notes_' + USER_ID + '_' + selectedDate, JSON.stringify(allNotes)); } catch(e) {}
  } catch (e) {
    if (!navigator.onLine) {
      const cached = sessionStorage.getItem('notes_' + USER_ID + '_' + selectedDate);
      if (cached) { try { allNotes = JSON.parse(cached); allGroups = clusterNotes(allNotes); renderGroups(); } catch(e) {} }
    }
  }
  isLoading = false;
}

async function loadDateCounts() {
  const cacheKey = USER_ID + '_' + calYear + '_' + calMonth;
  if (countsCache && countsCacheMonth === cacheKey) return;
  try {
    const data = await api('GET', '?user_id=eq.' + USER_ID + '&select=note_date&order=note_date.desc');
    if (!Array.isArray(data)) return;
    dateCounts = {};
    data.forEach(n => { dateCounts[n.note_date] = (dateCounts[n.note_date] || 0) + 1; });
    countsCache = dateCounts;
    countsCacheMonth = cacheKey;
    try { sessionStorage.setItem('counts_' + cacheKey, JSON.stringify(dateCounts)); } catch(e) {}
  } catch (e) {}
}

function showSkeleton() {
  groupsEl.innerHTML = '<div class="skeleton"><div class="skel-card"><div class="skel-line w80"></div><div class="skel-line w60" style="margin-top:8px"></div><div class="skel-line w40" style="margin-top:8px"></div></div><div class="skel-card"><div class="skel-line w60"></div><div class="skel-line w80" style="margin-top:8px"></div></div><div class="skel-card"><div class="skel-line w40"></div><div class="skel-line w60" style="margin-top:8px"></div></div></div>';
}

function renderGroups() {
  const query = searchInput.value.trim().toLowerCase();
  let groups = allGroups, notes = allNotes;
  if (query) {
    notes = allNotes.filter(n => n.content.toLowerCase().includes(query));
    if (!notes.length) { groupsEl.innerHTML = ''; statsEl.textContent = ''; emptyEl.innerHTML = '<div class="icon">&#9671;</div><p>Ничего не найдено</p>'; emptyEl.style.display = 'block'; return; }
    const ids = new Set(notes.map(n => n.id));
    groups = {};
    for (const [t, items] of Object.entries(allGroups)) { const f = items.filter(n => ids.has(n.id)); if (f.length) groups[t] = f; }
    if (!Object.keys(groups).length) groups = { 'Результаты': notes };
  }
  if (!notes.length) { groupsEl.innerHTML = ''; statsEl.textContent = ''; emptyEl.innerHTML = '<div class="icon">&#9671;</div><p>' + (selectedDate === todayStr() ? 'Напиши первую заметку за сегодня' : 'Нет заметок за этот день') + '</p>'; emptyEl.style.display = 'block'; return; }
  emptyEl.style.display = 'none';
  const gc = Object.keys(groups).length;
  statsEl.textContent = notes.length + ' замет' + (notes.length === 1 ? 'ка' : notes.length < 5 ? 'ки' : 'ок') + '  \u00b7  ' + gc + ' групп' + (gc === 1 ? 'а' : '');
  let html = '';
  for (const [title, items] of Object.entries(groups)) {
    html += '<div class="group"><div class="group-header"><span class="group-title">' + esc(title) + '</span><span class="group-count">' + items.length + '</span><div class="group-line"></div></div><div class="notes-grid">';
    for (const note of items) {
      const t = new Date(note.created_at);
      const time = String(t.getHours()).padStart(2,'0') + ':' + String(t.getMinutes()).padStart(2,'0');
      const safeId = parseInt(note.id, 10);
      html += '<div class="note-card"><div class="note-content">' + esc(note.content) + '</div><div class="note-meta"><span class="note-date">' + time + '</span><button class="note-delete" data-id="' + safeId + '">&#10005;</button></div></div>';
    }
    html += '</div></div>';
  }
  groupsEl.innerHTML = html;
}

async function checkSimilar(text) {
  try {
    const data = await api('GET', '?user_id=eq.' + USER_ID + '&select=content&order=created_at.desc&limit=100');
    if (!Array.isArray(data)) return;
    const matches = findSimilar(text, data);
    if (matches.length) {
      const s = matches[0].content.length > 80 ? matches[0].content.slice(0, 80) + '...' : matches[0].content;
      showSuggest('похоже на: ' + esc(s));
    } else hideSuggest();
  } catch (e) {}
}

function hideSuggest() { const el = $('#suggest'); if (el) el.style.display = 'none'; }
function showSuggest(text) { const el = $('#suggest'); if (el) { el.textContent = text; el.style.display = 'block'; } }

async function loadYesterdaySummary() {
  const y = new Date(); y.setDate(y.getDate() - 1);
  const ys = y.getFullYear() + '-' + String(y.getMonth()+1).padStart(2,'0') + '-' + String(y.getDate()).padStart(2,'0');
  try {
    const data = await api('GET', '?user_id=eq.' + USER_ID + '&note_date=eq.' + ys);
    if (Array.isArray(data) && data.length) {
      const g = clusterNotes(data);
      showSuggest('вчера: ' + data.length + ' замет' + (data.length === 1 ? 'ка' : data.length < 5 ? 'ки' : 'ок') + ', ' + Object.keys(g).length + ' групп');
      setTimeout(hideSuggest, 5000);
    }
  } catch (e) {}
}

function toast(msg) { toastEl.textContent = msg; toastEl.className = 'toast show'; setTimeout(() => { toastEl.className = 'toast'; }, 2000); }

async function claimPublicNotes() {
  try {
    const check = await api('GET', '?user_id=eq.public&select=id&limit=1');
    if (!Array.isArray(check) || !check.length) return;
    const data = await api('GET', '?user_id=eq.public&select=id');
    if (Array.isArray(data)) {
      for (const note of data) {
        const safeId = parseInt(note.id, 10);
        if (!isNaN(safeId)) await api('PATCH', '?id=eq.' + safeId, { user_id: USER_ID });
      }
    }
  } catch (e) {}
}

document.addEventListener('click', e => {
  const day = e.target.closest('[data-date]');
  if (day) { selectDate(day.dataset.date); return; }
  const del = e.target.closest('[data-id]');
  if (del && del.classList.contains('note-delete')) { deleteNote(del.dataset.id); return; }
});

$('#btnToday').addEventListener('click', goToday);
$('#keyInfo').addEventListener('click', lockApp);
document.querySelectorAll('.cal-nav').forEach(el => {
  el.addEventListener('click', () => calNav(parseInt(el.dataset.dir, 10)));
});

initLock();
