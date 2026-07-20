// ═══════════════════════════════════════════════════════════════
//  КУРАТОР v4 — EUNOIA daily journal
// ═══════════════════════════════════════════════════════════════

;(function() {
'use strict';

// ─── Version ───────────────────────────────────────────────

const VERSION = '4';

(function migrate() {
  const v = localStorage.getItem('_kv');
  if (v && v !== VERSION) {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('_kv', VERSION);
    location.reload();
  } else if (!v) {
    localStorage.setItem('_kv', VERSION);
  }
})();

// ─── Config ─────────────────────────────────────────────────

const CFG = {
  supabase: {
    url: 'https://pqngmvixfcsrvsvrtbfj.supabase.co',
    key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBxbmdtdml4ZmNzcnZzdnJ0YmZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzNzY0NDcsImV4cCI6MjA5OTk1MjQ0N30.nbO6rSANWaWRRxnRvrwlrawkBT2DP0VZ1GuyR6C2nHE',
    api: 'https://pqngmvixfcsrvsvrtbfj.supabase.co/rest/v1/notes'
  },
  ai: {
    model: 'openai/gpt-4o-mini',
    url: 'https://openrouter.ai/api/v1/chat/completions'
  }
};

// ─── State ──────────────────────────────────────────────────

const S = {
  user: '',
  headers: {},
  date: '',
  calY: 0,
  calM: 0,
  counts: {},
  notes: [],
  groups: {},
  loading: true
};

// ─── Locale ─────────────────────────────────────────────────

const LOC = {
  months: ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'],
  monthsGen: ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'],
  days: ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота']
};

// ─── DOM ─────────────────────────────────────────────────────

const $ = (s, p) => (p || document).querySelector(s);
const $$ = (s, p) => (p || document).querySelectorAll(s);

const ID = {};
['lockOverlay','lockInput','lockBtn','lockErr','appLayout','syncDot','btnToday',
 'calMonth','calDays','calCounts','keyInfo','dayTitle','daySubtitle','noteInput',
 'charCount','saveBtn','suggest','searchInput','stats','groups','emptyState','toast',
 'aiStatus'].forEach(id => ID[id] = document.getElementById(id));

// ─── Utils ───────────────────────────────────────────────────

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function pad2(n) { return String(n).padStart(2,'0'); }

function plural(n, forms) {
  return forms[
    n % 10 === 1 && n % 100 !== 11 ? 0 :
    n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 1 : 2
  ];
}

// ─── Auth ────────────────────────────────────────────────────

function setKey(key) {
  S.user = key;
  S.headers = {
    'Content-Type': 'application/json',
    apikey: CFG.supabase.key,
    Authorization: 'Bearer ' + CFG.supabase.key,
    Prefer: 'return=representation',
    'x-user-id': S.user
  };
  localStorage.setItem('_key', S.user);
}

function lockApp() {
  localStorage.removeItem('_key');
  location.reload();
}

function initLock() {
  const saved = localStorage.getItem('_key');
  if (saved) { setKey(saved); startApp(); return; }
  ID.lockOverlay.classList.add('active');
  ID.lockInput.focus();
  function submit() {
    const v = ID.lockInput.value.trim();
    if (!v) { ID.lockErr.classList.add('show'); return; }
    ID.lockErr.classList.remove('show');
    setKey(v.toLowerCase());
    ID.lockOverlay.classList.remove('active');
    startApp();
  }
  ID.lockBtn.addEventListener('click', submit);
  ID.lockInput.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
}

// ─── API (Supabase) ──────────────────────────────────────────

async function api(method, path, body) {
  const opts = { method, headers: S.headers };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(CFG.supabase.api + path, opts);
  if (!r.ok) throw new Error(`API ${r.status}`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

function syncDot(state) {
  ID.syncDot.className = 'sync-dot ' + state;
}

// ─── AI (OpenRouter) ─────────────────────────────────────────

function aiKey() {
  return localStorage.getItem('_ai_key');
}

function setAiKey(key) {
  localStorage.setItem('_ai_key', key);
}

async function ai(prompt) {
  const key = aiKey();
  if (!key) return null;
  try {
    const r = await fetch(CFG.ai.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key,
        'HTTP-Referer': 'https://mdnow.github.io/kurator/'
      },
      body: JSON.stringify({
        model: CFG.ai.model,
        messages: [
          { role: 'system', content: 'Ты — ассистент для дневника. Отвечай кратко, 1-2 предложения. На русском.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 100,
        temperature: 0.7
      })
    });
    if (!r.ok) { localStorage.removeItem('_ai_key'); return null; }
    const data = await r.json();
    return data.choices?.[0]?.message?.content || null;
  } catch {
    return null;
  }
}

async function aiSuggest(text) {
  hideSuggest();
  const reply = await ai(
    `Вот запись из дневника. Предложи связанную мысль, вопрос или инсайт:\n\n${text}`
  );
  if (reply) showSuggest('💡 ' + reply);
}

// ─── Clustering (TF-IDF) ─────────────────────────────────────

function tokenize(text) {
  return text.toLowerCase().replace(/[^\w\s]/g,' ').split(/\s+/).filter(t => t.length > 1);
}

function tfidf(corpus) {
  const tok = corpus.map(tokenize);
  const n = corpus.length, df = {};
  tok.forEach(t => [...new Set(t)].forEach(w => df[w] = (df[w]||0)+1));
  return tok.map(t => {
    const tf = {};
    t.forEach(w => tf[w] = (tf[w]||0)+1);
    const v = {};
    for (const [w,c] of Object.entries(tf)) v[w] = c * (Math.log((n+1)/(df[w]+1)) + 1);
    return v;
  });
}

function cos(a, b) {
  const ks = Object.keys(a).filter(k => k in b);
  if (!ks.length) return 0;
  const dot = ks.reduce((s,k) => s + a[k]*b[k], 0);
  const na = Math.sqrt(Object.values(a).reduce((s,v) => s+v*v, 0));
  const nb = Math.sqrt(Object.values(b).reduce((s,v) => s+v*v, 0));
  return na && nb ? dot / (na*nb) : 0;
}

function cluster(notes, thresh = 0.12) {
  if (notes.length <= 1) return notes.length ? { 'Все заметки': notes } : {};
  const vecs = tfidf(notes.map(n => n.content));
  const n = notes.length, p = Array.from({length:n}, (_,i)=>i);
  function find(x) { while (p[x] !== x) { p[x] = p[p[x]]; x = p[x]; } return x; }
  function union(a,b) { p[find(a)] = find(b); }
  for (let i = 0; i < n; i++)
    for (let j = i+1; j < n; j++)
      if (cos(vecs[i], vecs[j]) >= thresh) union(i,j);
  const raw = {};
  notes.forEach((nt,i) => { const r = find(i); (raw[r] = raw[r] || []).push(nt); });
  const named = {};
  for (const items of Object.values(raw)) {
    let title;
    if (items.length === 1) {
      const w = items[0].content.slice(0,40).split(' ').slice(0,4).join(' ');
      title = w + (items[0].content.length > 40 ? '...' : '');
    } else {
      const cent = {};
      items.forEach(n => tokenize(n.content).forEach(t => cent[t] = (cent[t]||0)+1));
      title = Object.entries(cent).sort((a,b) => b[1]-a[1]).slice(0,2).map(e => e[0]).join(' / ').replace(/^\w/, c=>c.toUpperCase());
    }
    named[title] = items;
  }
  return Object.fromEntries(Object.entries(named).sort((a,b) => b[1].length - a[1].length));
}

// ─── Calendar ────────────────────────────────────────────────

function initCal() {
  const n = new Date();
  S.calY = n.getFullYear();
  S.calM = n.getMonth();
  S.date = today();
  renderCal();
}

function renderCal() {
  ID.calMonth.textContent = LOC.months[S.calM] + ' ' + S.calY;
  const first = new Date(S.calY, S.calM, 1);
  const last = new Date(S.calY, S.calM+1, 0);
  let start = first.getDay() - 1;
  if (start < 0) start = 6;
  let h = '';
  for (let i = 0; i < start; i++) {
    const d = new Date(S.calY, S.calM, -start+i+1);
    h += `<div class="cal-day other">${d.getDate()}</div>`;
  }
  for (let d = 1; d <= last.getDate(); d++) {
    const ds = `${S.calY}-${pad2(S.calM+1)}-${pad2(d)}`;
    const cls = ['cal-day'];
    if (ds === today()) cls.push('today');
    if (ds === S.date) cls.push('selected');
    if (S.counts[ds] > 0) cls.push('has-notes');
    h += `<div class="${cls.join(' ')}" data-date="${ds}">${d}</div>`;
  }
  const rem = 7 - (start + last.getDate()) % 7;
  if (rem < 7) for (let i = 1; i <= rem; i++) h += `<div class="cal-day other">${i}</div>`;
  ID.calDays.innerHTML = h;
  renderCounts();
}

function renderCounts() {
  const items = Object.entries(S.counts).sort((a,b) => b[0].localeCompare(a[0])).slice(0,5);
  ID.calCounts.innerHTML = items.length
    ? items.map(([d,c]) => {
        const dt = new Date(d + 'T12:00:00');
        return `<div class="cal-stat"><span>${dt.getDate()} ${LOC.monthsGen[dt.getMonth()]}</span><span>${c}</span></div>`;
      }).join('')
    : '';
}

function calNav(dir) {
  S.calM += dir;
  if (S.calM > 11) { S.calM = 0; S.calY++; }
  if (S.calM < 0) { S.calM = 11; S.calY--; }
  renderCal();
  loadCounts();
}

function goToday() {
  S.date = today();
  const n = new Date();
  S.calY = n.getFullYear();
  S.calM = n.getMonth();
  renderCal();
  renderTitle();
  loadNotes();
}

function selectDate(ds) {
  S.date = ds;
  renderCal();
  renderTitle();
  loadNotes();
}

// ─── Notes ───────────────────────────────────────────────────

async function saveNote() {
  const content = ID.noteInput.value.trim();
  if (!content) return;
  ID.saveBtn.textContent = '...';
  ID.saveBtn.disabled = true;
  try {
    await api('POST', '', { content, note_date: S.date, user_id: S.user });
    ID.noteInput.value = '';
    autoResize();
    ID.charCount.textContent = '0';
    toast('Сохранено');
    syncDot('on');
    await loadNotes();
    aiSuggest(content);
  } catch {
    if (!navigator.onLine) toast('Нет интернета');
    else toast('Ошибка сохранения');
    syncDot('off');
  }
  ID.saveBtn.textContent = 'СОХРАНИТЬ';
  ID.saveBtn.disabled = false;
}

async function deleteNote(id) {
  const sid = parseInt(id, 10);
  if (isNaN(sid)) return;
  try {
    await api('DELETE', `?id=eq.${sid}&user_id=eq.${S.user}`);
    toast('Удалено');
    await loadNotes();
  } catch { toast('Ошибка'); }
}

async function loadNotes() {
  if (S.loading) showSkeleton();
  try {
    const data = await api('GET', `?user_id=eq.${S.user}&note_date=eq.${S.date}&order=created_at.desc`);
    S.notes = Array.isArray(data) ? data : [];
    S.groups = cluster(S.notes);
    await loadCounts();
    renderCal();
    renderGroups();
    try { sessionStorage.setItem(`n_${S.user}_${S.date}`, JSON.stringify(S.notes)); } catch {}
  } catch {
    if (!navigator.onLine) {
      const cached = sessionStorage.getItem(`n_${S.user}_${S.date}`);
      if (cached) {
        try { S.notes = JSON.parse(cached); S.groups = cluster(S.notes); renderGroups(); } catch {}
      }
    }
  }
  S.loading = false;
}

async function loadCounts() {
  const key = `${S.user}_${S.calY}_${S.calM}`;
  try {
    const data = await api('GET', `?user_id=eq.${S.user}&select=note_date&order=note_date.desc`);
    if (!Array.isArray(data)) return;
    S.counts = {};
    data.forEach(n => S.counts[n.note_date] = (S.counts[n.note_date]||0)+1);
    try { sessionStorage.setItem(`c_${key}`, JSON.stringify(S.counts)); } catch {}
  } catch {}
}

async function claimPublic() {
  try {
    const check = await api('GET', '?user_id=eq.public&select=id&limit=1');
    if (!Array.isArray(check) || !check.length) return;
    const all = await api('GET', '?user_id=eq.public&select=id');
    if (Array.isArray(all)) {
      for (const n of all) {
        const sid = parseInt(n.id,10);
        if (!isNaN(sid)) await api('PATCH', `?id=eq.${sid}`, { user_id: S.user });
      }
    }
  } catch {}
}

async function yesterdaySummary() {
  const y = new Date();
  y.setDate(y.getDate()-1);
  const ys = `${y.getFullYear()}-${pad2(y.getMonth()+1)}-${pad2(y.getDate())}`;
  try {
    const data = await api('GET', `?user_id=eq.${S.user}&note_date=eq.${ys}`);
    if (Array.isArray(data) && data.length) {
      const g = cluster(data);
      showSuggest(`вчера: ${data.length} ${plural(data.length, ['заметка','заметки','заметок'])}, ${Object.keys(g).length} ${plural(Object.keys(g).length, ['группа','группы','групп'])}`);
      setTimeout(hideSuggest, 5000);
    }
  } catch {}
}

// ─── UI ──────────────────────────────────────────────────────

function renderTitle() {
  const d = new Date(S.date + 'T12:00:00');
  const isToday = S.date === today();
  ID.dayTitle.textContent = isToday ? 'Сегодня' : `${d.getDate()} ${LOC.monthsGen[d.getMonth()]}`;
  ID.daySubtitle.textContent = LOC.days[d.getDay()] + (isToday ? '' : `, ${d.getFullYear()}`);
  ID.btnToday.classList.toggle('active', isToday);
}

function autoResize() {
  ID.noteInput.style.height = 'auto';
  ID.noteInput.style.height = Math.min(ID.noteInput.scrollHeight, 200) + 'px';
}

function showSkeleton() {
  ID.groups.innerHTML =
    '<div class="skeleton"><div class="skel-card"><div class="skel-line w80"></div><div class="skel-line w60" style="margin-top:8px"></div><div class="skel-line w40" style="margin-top:8px"></div></div><div class="skel-card"><div class="skel-line w60"></div><div class="skel-line w80" style="margin-top:8px"></div></div><div class="skel-card"><div class="skel-line w40"></div><div class="skel-line w60" style="margin-top:8px"></div></div></div>';
}

function renderGroups() {
  const q = ID.searchInput.value.trim().toLowerCase();
  let groups = S.groups, notes = S.notes;
  if (q) {
    notes = S.notes.filter(n => n.content.toLowerCase().includes(q));
    if (!notes.length) {
      ID.groups.innerHTML = '';
      ID.stats.textContent = '';
      ID.emptyState.innerHTML = '<div class="icon">&#9671;</div><p>Ничего не найдено</p>';
      ID.emptyState.classList.add('show');
      return;
    }
    const ids = new Set(notes.map(n => n.id));
    groups = {};
    for (const [t,items] of Object.entries(S.groups)) {
      const f = items.filter(n => ids.has(n.id));
      if (f.length) groups[t] = f;
    }
    if (!Object.keys(groups).length) groups = { 'Результаты': notes };
  }
  if (!notes.length) {
    ID.groups.innerHTML = '';
    ID.stats.textContent = '';
    ID.emptyState.innerHTML = `<div class="icon">&#9671;</div><p>${S.date === today() ? 'Напиши первую заметку за сегодня' : 'Нет заметок за этот день'}</p>`;
    ID.emptyState.classList.add('show');
    return;
  }
  ID.emptyState.classList.remove('show');
  const gc = Object.keys(groups).length;
  ID.stats.textContent = `${notes.length} ${plural(notes.length,['заметка','заметки','заметок'])} · ${gc} ${plural(gc,['группа','группы','групп'])}`;
  let h = '';
  for (const [title, items] of Object.entries(groups)) {
    h += `<div class="group"><div class="group-header"><span class="group-title">${esc(title)}</span><span class="group-count">${items.length}</span><div class="group-line"></div></div><div class="notes-grid">`;
    for (const note of items) {
      const t = new Date(note.created_at);
      const time = `${pad2(t.getHours())}:${pad2(t.getMinutes())}`;
      const sid = parseInt(note.id,10);
      h += `<div class="note-card"><div class="note-content">${esc(note.content)}</div><div class="note-meta"><span class="note-date">${time}</span><button class="note-delete" data-id="${sid}">&#10005;</button></div></div>`;
    }
    h += '</div></div>';
  }
  ID.groups.innerHTML = h;
}

function showSuggest(text) {
  ID.suggest.textContent = text;
  ID.suggest.classList.add('show');
}
function updateAiStatus() {
  ID.aiStatus.textContent = aiKey() ? '✦ AI' : '◇ AI';
  ID.aiStatus.title = aiKey() ? 'AI подключён (нажми чтобы сменить ключ)' : 'Нажми чтобы добавить AI ключ';
}

function hideSuggest() {
  ID.suggest.classList.remove('show');
}

function toast(msg, err) {
  ID.toast.textContent = msg;
  ID.toast.className = 'toast show' + (err ? ' error' : '');
  setTimeout(() => { ID.toast.className = 'toast'; }, 2500);
}

// ─── Events ──────────────────────────────────────────────────

function setupEvents() {
  ID.noteInput.addEventListener('input', () => {
    autoResize();
    ID.charCount.textContent = ID.noteInput.value.length;
  });
  ID.noteInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveNote(); }
  });
  ID.saveBtn.addEventListener('click', saveNote);
  ID.searchInput.addEventListener('input', renderGroups);
  ID.btnToday.addEventListener('click', goToday);
  ID.keyInfo.addEventListener('click', lockApp);
  ID.aiStatus.addEventListener('click', () => {
    const k = prompt(aiKey() ? 'Сменить AI ключ (оставь пустым чтобы удалить):' : 'Введи OpenRouter API ключ:');
    if (k) { setAiKey(k.trim()); updateAiStatus(); toast('AI ключ сохранён'); }
    else if (k === '') { localStorage.removeItem('_ai_key'); updateAiStatus(); toast('AI ключ удалён'); }
  });
  $$('.cal-nav').forEach(el => el.addEventListener('click', () => calNav(parseInt(el.dataset.dir,10))));
  document.addEventListener('click', e => {
    const day = e.target.closest('[data-date]');
    if (day) { selectDate(day.dataset.date); return; }
    const del = e.target.closest('[data-id]');
    if (del && del.classList.contains('note-delete')) deleteNote(del.dataset.id);
  });
  window.addEventListener('offline', () => {
    toast('Нет интернета', true);
    syncDot('off');
  });
  window.addEventListener('online', () => {
    toast('Синхронизация...');
    syncDot('on');
    loadNotes();
  });
}

// ─── Init ────────────────────────────────────────────────────

function startApp() {
  ID.appLayout.style.display = 'flex';
  ID.keyInfo.textContent = S.user;
  updateAiStatus();
  showSkeleton();
  claimPublic().then(() => {
    initCal();
    renderTitle();
    loadNotes();
    yesterdaySummary();
  });
}

initLock();
setupEvents();

})();
