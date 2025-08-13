(() => {
  const els = {
    category: document.getElementById('categorySelect'),
    level: document.getElementById('levelSelect'),
    limit: document.getElementById('limitInput'),
    start: document.getElementById('startBtn'),
    shuffle: document.getElementById('shuffleBtn'),
    quiz: document.getElementById('quiz'),
    badge: document.getElementById('badge'),
    prompt: document.getElementById('prompt'),
    answer: document.getElementById('answer'),
    speak: document.getElementById('speakBtn'),
    show: document.getElementById('showBtn'),
    check: document.getElementById('checkBtn'),
    next: document.getElementById('nextBtn'),
    feedback: document.getElementById('feedback'),
    details: document.getElementById('details'),
    statCorrect: document.getElementById('statCorrect'),
    statWrong: document.getElementById('statWrong'),
    statStreak: document.getElementById('statStreak'),
    statToday: document.getElementById('statToday'),
    statGoal: document.getElementById('statGoal'),
  };

  const state = {
    allItems: [],
    currentDeck: [],
    mode: 'en-ja',
    index: 0,
    correct: 0,
    wrong: 0,
    streak: 0,
    today: loadTodayCount(),
    goal: 20,
  };

  document.getElementById('year').textContent = String(new Date().getFullYear());
  els.statToday.textContent = String(state.today);
  els.statGoal.textContent = String(state.goal);

  // Load initial data
  loadData();

  // Mode change
  for (const input of document.querySelectorAll('input[name="mode"]')) {
    input.addEventListener('change', (e) => {
      state.mode = e.target.value;
      if (!els.quiz.classList.contains('hidden')) rerenderCard();
    });
  }

  els.start.addEventListener('click', startQuiz);
  els.shuffle.addEventListener('click', () => shuffleDeck(state.currentDeck));
  els.check.addEventListener('click', () => grade());
  els.next.addEventListener('click', () => nextCard());
  els.show.addEventListener('click', () => reveal());
  els.speak.addEventListener('click', () => speakCurrent());
  els.answer.addEventListener('keydown', (e) => { if (e.key === 'Enter') grade(); });

  els.category.addEventListener('change', refreshDeck);
  els.level.addEventListener('change', refreshDeck);
  els.limit.addEventListener('change', refreshDeck);

  function loadData() {
    fetch('/api/v1/vocab?shuffle=true')
      .then(r => r.json())
      .then((data) => {
        state.allItems = data.items;
        populateSelect(els.category, [{ value: 'all', label: 'すべて' }, ...data.categories.map(c => ({ value: c, label: c }))]);
        populateSelect(els.level, [{ value: '', label: '指定なし' }, ...data.levels.map(l => ({ value: l, label: l }))]);
        refreshDeck();
      })
      .catch(err => console.error(err));
  }

  function populateSelect(select, options) {
    const current = select.value;
    select.innerHTML = '';
    for (const opt of options) {
      const o = document.createElement('option');
      o.value = opt.value; o.textContent = opt.label;
      select.appendChild(o);
    }
    if ([...select.options].some(o => o.value === current)) select.value = current;
  }

  function refreshDeck() {
    const params = new URLSearchParams();
    const category = els.category.value;
    const level = els.level.value;
    const limit = Number(els.limit.value) || 20;
    if (category && category !== 'all') params.set('category', category);
    if (level) params.set('level', level);
    params.set('limit', String(limit));
    params.set('shuffle', 'true');

    fetch('/api/v1/vocab?' + params.toString())
      .then(r => r.json())
      .then((data) => {
        state.currentDeck = data.items;
        state.index = 0;
        updateStats();
        if (state.currentDeck.length > 0) {
          els.quiz.classList.remove('hidden');
          rerenderCard();
        } else {
          els.quiz.classList.add('hidden');
        }
      })
      .catch(err => console.error(err));
  }

  function startQuiz() {
    state.correct = 0; state.wrong = 0; state.streak = 0;
    state.today = loadTodayCount();
    updateStats();
    els.quiz.classList.remove('hidden');
    state.index = 0;
    rerenderCard();
    els.answer.focus();
  }

  function currentItem() { return state.currentDeck[state.index]; }

  function rerenderCard() {
    const item = currentItem();
    if (!item) return;
    const num = state.index + 1;
    const total = state.currentDeck.length;
    els.badge.textContent = `問題 ${num} / ${total}`;
    els.feedback.textContent = ''; els.feedback.className = 'feedback';
    els.details.textContent = ''; els.details.classList.add('hidden');

    if (state.mode === 'en-ja') {
      els.prompt.textContent = item.en;
      els.answer.placeholder = '日本語で入力';
    } else if (state.mode === 'ja-en') {
      els.prompt.textContent = item.ja;
      els.answer.placeholder = '英語で入力';
    } else {
      els.prompt.textContent = item.en + ' (音声のみ)';
      els.answer.placeholder = '聞き取った語を入力';
      speak(item.en);
    }
    els.answer.value = '';
  }

  function normalize(s) {
    return (s || '').toLowerCase().trim().replace(/[！!。．.,\s]+$/g, '').replace(/^the\s+/, '');
  }

  function isCorrect(item, input) {
    const n = normalize(input);
    if (state.mode === 'en-ja') return n === normalize(item.ja);
    if (state.mode === 'ja-en' || state.mode === 'listen') return n === normalize(item.en);
    return false;
  }

  function grade() {
    const item = currentItem(); if (!item) return;
    const ans = els.answer.value;
    if (!ans) { feedback('入力してください', 'bad'); return; }
    const ok = isCorrect(item, ans);
    if (ok) {
      state.correct++; state.streak++; feedback('正解！', 'ok');
      incrementTodayCount();
    } else {
      state.wrong++; state.streak = 0; feedback(`不正解：${state.mode === 'en-ja' ? item.ja : item.en}`, 'bad');
    }
    showDetails(item);
    updateStats();
  }

  function nextCard() {
    state.index = (state.index + 1) % state.currentDeck.length;
    rerenderCard();
    els.answer.focus();
  }

  function reveal() {
    const item = currentItem(); if (!item) return;
    feedback(state.mode === 'en-ja' ? item.ja : item.en, '');
    showDetails(item);
  }

  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    const voices = window.speechSynthesis.getVoices();
    const en = voices.find(v => v.lang.startsWith('en'));
    if (en) u.voice = en;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  function speakCurrent() {
    const item = currentItem(); if (!item) return;
    speak(item.en);
  }

  function showDetails(item) {
    els.details.innerHTML = `
      <div><strong>英語</strong>: ${escapeHtml(item.en)} ${item.ipa ? `<span style="color:#8aa0b3">/${escapeHtml(item.ipa)}/</span>` : ''}</div>
      <div><strong>日本語</strong>: ${escapeHtml(item.ja)}</div>
      ${item.example_en ? `<div><strong>例文</strong>: ${escapeHtml(item.example_en)}<br><span style="color:#8aa0b3">${escapeHtml(item.example_ja || '')}</span></div>` : ''}
      <div style="margin-top:6px"><small>カテゴリ: ${escapeHtml(item.category)}${item.level ? ` / レベル: ${escapeHtml(item.level)}` : ''}</small></div>
    `;
    els.details.classList.remove('hidden');
  }

  function feedback(text, kind) {
    els.feedback.textContent = text;
    els.feedback.className = 'feedback ' + (kind || '');
  }

  function updateStats() {
    els.statCorrect.textContent = String(state.correct);
    els.statWrong.textContent = String(state.wrong);
    els.statStreak.textContent = String(state.streak);
    els.statToday.textContent = String(state.today);
  }

  function shuffleDeck(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    state.index = 0;
    rerenderCard();
  }

  function escapeHtml(s) {
    return (s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;','\'':'&#39;'}[c]));
  }

  function loadTodayCount() {
    const key = 'today_count_' + new Date().toISOString().slice(0,10);
    const v = Number(localStorage.getItem(key) || '0');
    return isNaN(v) ? 0 : v;
  }

  function incrementTodayCount() {
    const key = 'today_count_' + new Date().toISOString().slice(0,10);
    const v = loadTodayCount() + 1;
    localStorage.setItem(key, String(v));
    state.today = v;
  }
})();