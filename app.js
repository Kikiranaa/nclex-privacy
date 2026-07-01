/* ===== NCA NCLEX-RN LMS — Application Logic ===== */

// ---------- Firebase Config ----------
const firebaseConfig = {
  apiKey: "AIzaSyACdqW7cUbQVL9YsuAZx_YDxMqiW8wFEeo",
  authDomain: "nca-nclex-cat.firebaseapp.com",
  projectId: "nca-nclex-cat",
  storageBucket: "nca-nclex-cat.firebasestorage.app",
  messagingSenderId: "693790493427",
  appId: "1:693790493427:android:fa9ac7ef1696230a074586"
};

let app, auth, db;

function initFirebase() {
  app = firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  db = firebase.firestore();
}

// ---------- State ----------
const state = {
  user: null,
  candidate: null,
  questions: [],
  subjects: [],
  examQuestionCount: 85,
  examSubject: 'All Subjects',
  exam: null,
  examStartTime: null,
  timerInterval: null,
  currentPage: 'dashboard',
  bookmarks: [],
  examHistory: [],
  studyQuestions: [],
  studyIndex: 0,
  _selectedOption: null,
  _answered: false,
};

// ---------- Utility ----------
function $(sel, ctx = document) { return ctx.querySelector(sel); }
function $$(sel, ctx = document) { return ctx.querySelectorAll(sel); }

function showError(boxEl, msg) {
  boxEl.textContent = msg;
  boxEl.classList.add('visible');
}
function hideError(boxEl) {
  boxEl.textContent = '';
  boxEl.classList.remove('visible');
}

function showLoading(msg = 'Loading...') {
  const el = $('#loading-overlay');
  el.querySelector('p').textContent = msg;
  el.classList.remove('hidden');
}
function hideLoading() {
  $('#loading-overlay').classList.add('hidden');
}

// ---------- Screens ----------
function showScreen(id) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ---------- LMS Navigation ----------
function navigateTo(pageName) {
  state.currentPage = pageName;

  $$('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById('page-' + pageName);
  if (page) page.classList.add('active');

  $$('.nav-item[data-page]').forEach(n => {
    n.classList.toggle('active', n.dataset.page === pageName);
  });

  const titles = {
    'dashboard': 'Dashboard',
    'exam-setup': 'Take Exam',
    'quiz': 'CAT Exam',
    'results': 'Exam Results',
    'study-mode': 'Study Mode',
    'progress': 'Progress',
    'bookmarks': 'Bookmarks',
    'settings': 'Settings',
  };
  $('#page-title').textContent = titles[pageName] || 'Dashboard';

  closeSidebar();

  if (pageName === 'dashboard') renderDashboard();
  if (pageName === 'progress') renderProgressPage();
  if (pageName === 'bookmarks') renderBookmarksPage();
  if (pageName === 'settings') renderSettingsPage();
  if (pageName === 'study-mode') initStudyMode();
}

function toggleSidebar() {
  $('#sidebar').classList.toggle('open');
  $('#sidebar-overlay').classList.toggle('open');
}
function closeSidebar() {
  $('#sidebar').classList.remove('open');
  $('#sidebar-overlay').classList.remove('open');
}

// =====================================================================
//  CAT ENGINE (IRT 1PL Rasch Model)
// =====================================================================
class CATEngine {
  constructor(questions, maxQuestions, subject) {
    this.allQuestions = questions;
    this.maxQuestions = maxQuestions;
    this.subject = subject;

    if (subject && subject !== 'All Subjects') {
      this.pool = questions.filter(q => q.subject === subject);
    } else {
      this.pool = [...questions];
    }

    this.pool = this.shuffleArray(this.pool);

    this.difficultyMap = { 1: -2.0, 2: -1.0, 3: 0.0, 4: 1.0, 5: 2.0 };
    this.theta = 0.0;
    this.se = 3.0;
    this.currentDifficulty = 3;
    this.responses = [];
    this.usedIds = new Set();
    this.informationSum = 0;
    this.finished = false;
    this.stopReason = '';
    this.currentQuestion = null;
  }

  shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  pCorrect(theta, b) {
    return 1 / (1 + Math.exp(-(theta - b)));
  }

  fisherInfo(theta, b) {
    const p = this.pCorrect(theta, b);
    return p * (1 - p);
  }

  estimateTheta() {
    if (this.responses.length === 0) return 0.0;

    let theta = this.theta;
    for (let iter = 0; iter < 25; iter++) {
      let num = 0, den = 0;
      for (const r of this.responses) {
        const b = this.difficultyMap[r.difficulty] || 0;
        const p = this.pCorrect(theta, b);
        num += ((r.isCorrect ? 1 : 0) - p);
        den += p * (1 - p);
      }
      if (Math.abs(den) < 1e-10) break;
      const delta = num / den;
      theta = Math.max(-4.0, Math.min(4.0, theta + delta));
      if (Math.abs(delta) < 1e-6) break;
    }
    return theta;
  }

  updateSE() {
    let infoSum = 0;
    for (const r of this.responses) {
      const b = this.difficultyMap[r.difficulty] || 0;
      infoSum += this.fisherInfo(this.theta, b);
    }
    this.informationSum = infoSum;
    if (infoSum > 0) this.se = 1 / Math.sqrt(infoSum);
  }

  selectNextQuestion() {
    let candidates = [];
    const searchOrder = [0, 1, -1, 2, -2, 3, -3, 4, -4];

    for (const offset of searchOrder) {
      const targetDiff = Math.max(1, Math.min(5, this.currentDifficulty + offset));
      const matching = this.pool.filter(q =>
        q.difficulty === targetDiff && !this.usedIds.has(q.id)
      );
      if (matching.length > 0) { candidates = matching; break; }
    }

    if (candidates.length === 0) {
      candidates = this.pool.filter(q => !this.usedIds.has(q.id));
    }

    if (candidates.length === 0) {
      this.finished = true;
      this.stopReason = 'No more questions available';
      return null;
    }

    candidates.sort((a, b) => {
      const infoA = this.fisherInfo(this.theta, this.difficultyMap[a.difficulty] || 0);
      const infoB = this.fisherInfo(this.theta, this.difficultyMap[b.difficulty] || 0);
      return infoB - infoA;
    });

    const topN = candidates.slice(0, Math.min(3, candidates.length));
    const selected = topN[Math.floor(Math.random() * topN.length)];

    this.usedIds.add(selected.id);
    this.currentQuestion = selected;
    return selected;
  }

  submitAnswer(selectedIndex) {
    const q = this.currentQuestion;
    if (!q) return null;

    const isCorrect = selectedIndex === q.answer;
    const response = {
      question: q,
      selectedAnswer: selectedIndex,
      isCorrect,
      difficulty: q.difficulty,
      thetaBefore: this.theta,
    };

    this.responses.push(response);
    this.theta = this.estimateTheta();
    this.updateSE();

    response.thetaAfter = this.theta;
    response.seAfter = this.se;

    if (isCorrect) {
      this.currentDifficulty = Math.min(5, this.currentDifficulty + 1);
    } else {
      this.currentDifficulty = Math.max(1, this.currentDifficulty - 1);
    }

    this.checkStoppingRules();
    return response;
  }

  checkStoppingRules() {
    const n = this.responses.length;
    if (n >= this.maxQuestions) {
      this.finished = true;
      this.stopReason = 'Maximum questions reached';
      return;
    }
    if (n >= 15 && this.se < 0.30) {
      const ciLow = this.theta - 1.96 * this.se;
      const ciHigh = this.theta + 1.96 * this.se;
      if (ciLow > 0.0) {
        this.finished = true;
        this.stopReason = '95% CI above passing standard (Pass with confidence)';
        return;
      }
      if (ciHigh < 0.0) {
        this.finished = true;
        this.stopReason = '95% CI below passing standard (Fail with confidence)';
        return;
      }
    }
  }

  getPassProbability() {
    const z = (this.theta - 0.0) / this.se;
    return 1 / (1 + Math.exp(-1.7 * z));
  }

  hasPassed() {
    return this.getPassProbability() >= 0.5 && this.theta >= 0.0;
  }

  getResults() {
    const totalCorrect = this.responses.filter(r => r.isCorrect).length;
    const totalQuestions = this.responses.length;
    const avgDiff = totalQuestions > 0
      ? this.responses.reduce((sum, r) => sum + r.difficulty, 0) / totalQuestions : 0;

    return {
      totalQuestions,
      totalCorrect,
      rawAccuracy: totalQuestions > 0 ? totalCorrect / totalQuestions : 0,
      finalTheta: this.theta,
      finalSE: this.se,
      passProbability: this.getPassProbability(),
      passed: this.hasPassed(),
      avgDifficulty: avgDiff,
      stopReason: this.stopReason,
      responses: this.responses,
    };
  }
}

// =====================================================================
//  LOGIN
// =====================================================================
async function handleLogin() {
  const emailInput = $('#login-email');
  const passInput = $('#login-password');
  const errorBox = $('#login-error');
  const btn = $('#login-btn');

  const email = emailInput.value.trim();
  const password = passInput.value;

  hideError(errorBox);
  if (!email || !password) {
    showError(errorBox, 'Please enter both email and password.');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Signing in...';

  try {
    const cred = await auth.signInWithEmailAndPassword(email, password);
    state.user = cred.user;

    const snap = await db.collection('approved_candidates')
      .where('email', '==', email.toLowerCase())
      .where('approved', '==', true)
      .get();

    if (snap.empty) {
      await auth.signOut();
      state.user = null;
      showError(errorBox, 'Access denied. Your account has not been approved. Contact your instructor.');
      btn.disabled = false;
      btn.innerHTML = 'Sign In';
      return;
    }

    state.candidate = snap.docs[0].data();
    await loadQuestions();
    enterLMS();
  } catch (err) {
    let msg = 'Sign-in failed. Please try again.';
    if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
      msg = 'Invalid email or password.';
    } else if (err.code === 'auth/too-many-requests') {
      msg = 'Too many attempts. Please wait a few minutes.';
    } else if (err.code === 'auth/network-request-failed') {
      msg = 'Network error. Check your connection.';
    }
    showError(errorBox, msg);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
}

function enterLMS() {
  loadBookmarks();
  loadExamHistory();
  loadThemePreference();

  const name = state.candidate?.name || state.user?.email || 'Student';
  $('#header-user-name').textContent = name;
  $('#header-avatar').textContent = name.charAt(0).toUpperCase();

  initSetupScreen();
  showScreen('lms-shell');
  navigateTo('dashboard');
}

// =====================================================================
//  QUESTIONS LOADING
// =====================================================================
async function loadQuestions() {
  showLoading('Loading question bank...');

  const cached = localStorage.getItem('nca_questions_cache');
  const cacheTime = localStorage.getItem('nca_questions_cache_time');
  const ONE_HOUR = 60 * 60 * 1000;

  if (cached && cacheTime && (Date.now() - parseInt(cacheTime)) < ONE_HOUR) {
    try {
      state.questions = JSON.parse(cached);
      extractSubjects();
      hideLoading();
      return;
    } catch (e) { /* cache corrupt */ }
  }

  try {
    const snap = await db.collection('questions').get();
    state.questions = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    try {
      localStorage.setItem('nca_questions_cache', JSON.stringify(state.questions));
      localStorage.setItem('nca_questions_cache_time', Date.now().toString());
    } catch (e) { /* storage full */ }

    extractSubjects();
  } catch (err) {
    if (cached) {
      try {
        state.questions = JSON.parse(cached);
        extractSubjects();
      } catch (e) {
        alert('Failed to load questions. Please check your connection and try again.');
      }
    } else {
      alert('Failed to load questions. Please check your connection and try again.');
    }
  }
  hideLoading();
}

function extractSubjects() {
  const subs = new Set();
  state.questions.forEach(q => { if (q.subject) subs.add(q.subject); });
  state.subjects = Array.from(subs).sort();
}

// =====================================================================
//  BOOKMARKS (localStorage)
// =====================================================================
function loadBookmarks() {
  try {
    state.bookmarks = JSON.parse(localStorage.getItem('nca_bookmarks') || '[]');
  } catch (e) { state.bookmarks = []; }
}

function saveBookmarks() {
  try {
    localStorage.setItem('nca_bookmarks', JSON.stringify(state.bookmarks));
  } catch (e) { /* full */ }
}

function toggleBookmark(question) {
  const idx = state.bookmarks.findIndex(b => b.id === question.id);
  if (idx >= 0) {
    state.bookmarks.splice(idx, 1);
  } else {
    state.bookmarks.push({
      id: question.id,
      question: question.question,
      options: question.options,
      answer: question.answer,
      difficulty: question.difficulty,
      subject: question.subject || '',
      category: question.category || '',
      rationale_correct: question.rationale_correct || '',
      rationale_wrong: question.rationale_wrong || {},
    });
  }
  saveBookmarks();
}

function isBookmarked(questionId) {
  return state.bookmarks.some(b => b.id === questionId);
}

// =====================================================================
//  EXAM HISTORY (localStorage + Firestore)
// =====================================================================
function loadExamHistory() {
  try {
    state.examHistory = JSON.parse(localStorage.getItem('nca_exam_history') || '[]');
  } catch (e) { state.examHistory = []; }
}

function saveExamToHistory(results, durationMinutes) {
  const entry = {
    date: new Date().toISOString(),
    subject: state.examSubject,
    totalQuestions: results.totalQuestions,
    totalCorrect: results.totalCorrect,
    accuracy: Math.round(results.rawAccuracy * 1000) / 10,
    finalTheta: Math.round(results.finalTheta * 100) / 100,
    passed: results.passed,
    duration: durationMinutes,
    stopReason: results.stopReason,
    subjectBreakdown: getSubjectBreakdown(results),
    difficultyBreakdown: getDifficultyBreakdown(results),
  };

  state.examHistory.unshift(entry);
  if (state.examHistory.length > 50) state.examHistory.length = 50;

  try {
    localStorage.setItem('nca_exam_history', JSON.stringify(state.examHistory));
  } catch (e) { /* full */ }
}

function getSubjectBreakdown(results) {
  const map = {};
  for (const r of results.responses) {
    const subj = r.question.subject || 'Unknown';
    if (!map[subj]) map[subj] = { total: 0, correct: 0 };
    map[subj].total++;
    if (r.isCorrect) map[subj].correct++;
  }
  return map;
}

function getDifficultyBreakdown(results) {
  const map = {};
  for (const r of results.responses) {
    const d = r.difficulty;
    if (!map[d]) map[d] = { total: 0, correct: 0 };
    map[d].total++;
    if (r.isCorrect) map[d].correct++;
  }
  return map;
}

// =====================================================================
//  DASHBOARD
// =====================================================================
function renderDashboard() {
  const name = state.candidate?.name || 'Student';
  $('#dash-welcome-name').textContent = `Welcome back, ${name}!`;
  const batch = state.candidate?.batch;
  $('#dash-welcome-sub').textContent = batch
    ? `Batch: ${batch} · Ready for your NCLEX-RN preparation?`
    : 'Ready to continue your NCLEX-RN preparation?';

  $('#dash-stat-total-q').textContent = state.questions.length.toLocaleString();

  const history = state.examHistory;
  $('#dash-stat-exams').textContent = history.length;

  if (history.length > 0) {
    const avgAcc = history.reduce((s, h) => s + h.accuracy, 0) / history.length;
    $('#dash-stat-avg-score').textContent = avgAcc.toFixed(1) + '%';
    const passCount = history.filter(h => h.passed).length;
    $('#dash-stat-pass-rate').textContent = Math.round((passCount / history.length) * 100) + '%';
  } else {
    $('#dash-stat-avg-score').textContent = '--';
    $('#dash-stat-pass-rate').textContent = '--';
  }

  renderRecentExams();
  renderDashSubjects();
}

function renderRecentExams() {
  const container = $('#dash-recent-list');
  const recent = state.examHistory.slice(0, 5);

  if (recent.length === 0) {
    container.innerHTML = '<div class="dash-empty">No exams taken yet. Start your first exam!</div>';
    return;
  }

  container.innerHTML = recent.map(h => {
    const d = new Date(h.date);
    const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `
      <div class="dash-recent-item">
        <div class="dash-recent-dot ${h.passed ? 'pass' : 'fail'}"></div>
        <div class="dash-recent-info">
          <div class="dash-recent-title">${h.subject}</div>
          <div class="dash-recent-sub">${dateStr} · ${h.totalQuestions} questions · ${h.duration} min</div>
        </div>
        <div class="dash-recent-score ${h.passed ? 'pass' : 'fail'}">${h.accuracy}%</div>
      </div>
    `;
  }).join('');
}

function renderDashSubjects() {
  const container = $('#dash-subjects-list');
  const history = state.examHistory;

  if (history.length === 0) {
    container.innerHTML = '<div class="dash-empty">Take an exam to see subject analytics.</div>';
    return;
  }

  const subjectMap = {};
  for (const h of history) {
    if (h.subjectBreakdown) {
      for (const [subj, data] of Object.entries(h.subjectBreakdown)) {
        if (!subjectMap[subj]) subjectMap[subj] = { total: 0, correct: 0 };
        subjectMap[subj].total += data.total;
        subjectMap[subj].correct += data.correct;
      }
    }
  }

  const subjects = Object.entries(subjectMap)
    .map(([name, data]) => ({ name, pct: Math.round((data.correct / data.total) * 100) }))
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 8);

  container.innerHTML = subjects.map(s => {
    const color = s.pct >= 70 ? 'var(--nca-green)' : s.pct >= 50 ? 'var(--nca-amber)' : 'var(--nca-red)';
    return `
      <div class="dash-subject-row">
        <span class="dash-subject-name">${s.name}</span>
        <div class="dash-subject-bar"><div class="dash-subject-fill" style="width:${s.pct}%; background:${color}"></div></div>
        <span class="dash-subject-pct">${s.pct}%</span>
      </div>
    `;
  }).join('');
}

// =====================================================================
//  SETUP SCREEN
// =====================================================================
function initSetupScreen() {
  const sel = $('#setup-subject');
  const totalCount = state.questions.length;
  sel.innerHTML = `<option value="All Subjects">All (${totalCount} Questions)</option>`;
  state.subjects.forEach(s => {
    const count = state.questions.filter(q => q.subject === s).length;
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = `${s} (${count} Questions)`;
    sel.appendChild(opt);
  });

  // Also populate study mode dropdown
  const studySel = $('#study-subject');
  if (studySel) {
    studySel.innerHTML = `<option value="All Subjects">All Subjects (${totalCount})</option>`;
    state.subjects.forEach(s => {
      const count = state.questions.filter(q => q.subject === s).length;
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = `${s} (${count})`;
      studySel.appendChild(opt);
    });
  }

  $$('.chip[data-count]').forEach(c => c.classList.remove('selected'));
  $('[data-count="85"]').classList.add('selected');
  state.examQuestionCount = 85;
  $('#custom-slider-box').classList.remove('visible');
}

function handleChipSelect(chip) {
  $$('.chip[data-count]').forEach(c => c.classList.remove('selected'));
  chip.classList.add('selected');
  const val = chip.dataset.count;
  if (val === 'custom') {
    $('#custom-slider-box').classList.add('visible');
    state.examQuestionCount = parseInt($('#custom-slider').value);
  } else {
    $('#custom-slider-box').classList.remove('visible');
    state.examQuestionCount = parseInt(val);
  }
}

function handleSliderChange(e) {
  const val = parseInt(e.target.value);
  state.examQuestionCount = val;
  $('#custom-slider-val').textContent = `${val} Questions`;
}

function startExam() {
  state.examSubject = $('#setup-subject').value;

  const available = state.examSubject === 'All Subjects'
    ? state.questions.length
    : state.questions.filter(q => q.subject === state.examSubject).length;

  if (available < 10) {
    alert('Not enough questions available for this subject. Please select a different subject.');
    return;
  }

  state.exam = new CATEngine(state.questions, state.examQuestionCount, state.examSubject);
  state.examStartTime = Date.now();

  if (state.timerInterval) clearInterval(state.timerInterval);
  state.timerInterval = setInterval(updateTimer, 1000);

  initQuizScreen();
  navigateTo('quiz');
  nextQuestion();
}

function handleLogout() {
  if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; }
  auth.signOut();
  state.user = null;
  state.candidate = null;
  state.exam = null;
  $('#login-email').value = '';
  $('#login-password').value = '';
  hideError($('#login-error'));
  showScreen('login-screen');
}

// =====================================================================
//  QUIZ SCREEN
// =====================================================================
function initQuizScreen() {
  generateWatermarks();
  updateBreadcrumb();
}

function generateWatermarks() {
  const overlay = $('#watermark-overlay');
  overlay.innerHTML = '';
  const text = 'NEW CAREERS ACADEMY';
  for (let row = -2; row < 12; row++) {
    for (let col = -1; col < 5; col++) {
      const span = document.createElement('span');
      span.textContent = text;
      span.style.left = `${col * 340 + (row % 2 ? 120 : 0)}px`;
      span.style.top = `${row * 100}px`;
      overlay.appendChild(span);
    }
  }
}

function updateTimer() {
  if (!state.examStartTime) return;
  const elapsed = Math.floor((Date.now() - state.examStartTime) / 1000);
  const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const s = (elapsed % 60).toString().padStart(2, '0');
  $('#quiz-timer').textContent = `${m}:${s}`;
}

function updateAbilityMeter() {
  const engine = state.exam;
  const theta = engine.theta;
  const pct = Math.max(0, Math.min(100, ((theta + 4) / 8) * 100));
  $('#ability-marker').style.left = `${pct}%`;
  $('#ability-value').textContent = `${theta >= 0 ? '+' : ''}${theta.toFixed(2)} logits`;
}

function updateLiveStats() {
  const engine = state.exam;
  const total = engine.responses.length;
  const correct = engine.responses.filter(r => r.isCorrect).length;
  $('#live-correct').textContent = `${correct}/${total}`;
  $('#live-accuracy').textContent = total > 0 ? `${Math.round((correct / total) * 100)}%` : '--';
  $('#live-se').textContent = engine.se.toFixed(2);
}

function updateBreadcrumb() {
  const bc = $('#quiz-breadcrumb');
  bc.innerHTML = '';
  const engine = state.exam;
  if (!engine) return;

  engine.responses.forEach((r, i) => {
    const dot = document.createElement('div');
    dot.className = `bc-dot ${r.isCorrect ? 'correct' : 'incorrect'}`;
    dot.title = `Q${i + 1}: ${r.isCorrect ? 'Correct' : 'Incorrect'}`;
    bc.appendChild(dot);
  });

  if (!engine.finished) {
    const currentDot = document.createElement('div');
    currentDot.className = 'bc-dot current';
    currentDot.title = `Q${engine.responses.length + 1}: Current`;
    bc.appendChild(currentDot);
  }

  bc.scrollLeft = bc.scrollWidth;
}

const DIFF_LABELS = { 1: 'Easy', 2: 'Below Avg', 3: 'Medium', 4: 'Above Avg', 5: 'Hard' };

function nextQuestion() {
  const engine = state.exam;
  if (engine.finished) { finishExam(); return; }

  const q = engine.selectNextQuestion();
  if (!q) { finishExam(); return; }

  const n = engine.responses.length + 1;
  const max = engine.maxQuestions;

  $('#quiz-counter').textContent = `Q${n}/${max}`;
  $('#quiz-progress-bar').style.width = `${(n / max) * 100}%`;

  updateAbilityMeter();
  updateLiveStats();
  updateBreadcrumb();

  $('#question-num-badge').textContent = `Question ${n}`;
  const diffBadge = $('#question-diff-badge');
  diffBadge.textContent = DIFF_LABELS[q.difficulty] || 'Medium';
  diffBadge.className = `badge badge-diff-${q.difficulty}`;
  $('#question-subject-badge').textContent = q.subject || '';
  $('#question-text').textContent = q.question;

  const optionsContainer = $('#options-list');
  optionsContainer.innerHTML = '';
  const letters = ['A', 'B', 'C', 'D'];

  q.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.dataset.index = i;
    btn.innerHTML = `
      <span class="option-letter">${letters[i]}</span>
      <span class="option-text">${opt}</span>
    `;
    btn.addEventListener('click', () => selectOption(i));
    optionsContainer.appendChild(btn);
  });

  $('#rationale-section').classList.remove('visible');
  const footerBtn = $('#quiz-footer-btn');
  footerBtn.textContent = 'Submit Answer';
  footerBtn.disabled = true;
  footerBtn.onclick = submitCurrentAnswer;

  // Update bookmark button
  const bmBtn = $('#bookmark-question-btn');
  if (isBookmarked(q.id)) {
    bmBtn.classList.add('bookmarked');
    bmBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg> Bookmarked';
  } else {
    bmBtn.classList.remove('bookmarked');
    bmBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg> Bookmark';
  }

  state._selectedOption = null;
  state._answered = false;
}

function selectOption(index) {
  if (state._answered) return;
  state._selectedOption = index;

  $$('#options-list .option-btn').forEach(btn => {
    btn.classList.toggle('selected', parseInt(btn.dataset.index) === index);
  });

  $('#quiz-footer-btn').disabled = false;
}

function submitCurrentAnswer() {
  if (state._selectedOption === null || state._answered) return;

  state._answered = true;
  const engine = state.exam;
  const q = engine.currentQuestion;
  const selected = state._selectedOption;
  const response = engine.submitAnswer(selected);

  $$('#options-list .option-btn').forEach(btn => {
    btn.classList.add('locked');
    const idx = parseInt(btn.dataset.index);
    if (idx === q.answer) {
      btn.classList.remove('selected');
      btn.classList.add('correct');
      btn.querySelector('.option-letter').textContent = '✓';
    } else if (idx === selected && selected !== q.answer) {
      btn.classList.remove('selected');
      btn.classList.add('incorrect');
      btn.querySelector('.option-letter').textContent = '✗';
    }
  });

  updateAbilityMeter();
  updateLiveStats();
  updateBreadcrumb();

  const feedback = $('#rationale-feedback');
  const rationaleCorrectBox = $('#rationale-correct');
  const rationaleWrongBox = $('#rationale-wrong');

  if (response.isCorrect) {
    feedback.className = 'rationale-feedback correct-feedback';
    feedback.textContent = '✓ Correct! Next question will be harder.';
  } else {
    feedback.className = 'rationale-feedback incorrect-feedback';
    feedback.textContent = '✗ Incorrect. Next question will be easier.';
  }

  rationaleCorrectBox.textContent = q.rationale_correct || 'No rationale provided.';

  rationaleWrongBox.innerHTML = '';
  if (q.rationale_wrong && typeof q.rationale_wrong === 'object') {
    Object.values(q.rationale_wrong).filter(v => v).forEach(text => {
      const div = document.createElement('div');
      div.className = 'rationale-box wrong-rationale';
      div.textContent = text;
      rationaleWrongBox.appendChild(div);
    });
  }

  $('#rationale-section').classList.add('visible');

  const footerBtn = $('#quiz-footer-btn');
  if (engine.finished) {
    footerBtn.textContent = 'View Results';
    footerBtn.onclick = finishExam;
  } else {
    footerBtn.textContent = 'Next Question →';
    footerBtn.onclick = nextQuestion;
  }
  footerBtn.disabled = false;
}

function endExamEarly() {
  const engine = state.exam;
  if (!engine || engine.responses.length === 0) {
    if (confirm('You have not answered any questions. Return to dashboard?')) {
      if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; }
      navigateTo('dashboard');
    }
    return;
  }
  if (!confirm('Are you sure you want to end the exam early? Your results will be calculated based on questions answered so far.')) return;
  engine.finished = true;
  engine.stopReason = 'Exam ended early by student';
  finishExam();
}

// =====================================================================
//  KEYBOARD SHORTCUTS
// =====================================================================
function handleKeyboard(e) {
  if (state.currentPage !== 'quiz' || !state.exam) return;

  if (e.key >= '1' && e.key <= '4') {
    const idx = parseInt(e.key) - 1;
    const opts = $$('#options-list .option-btn');
    if (idx < opts.length) selectOption(idx);
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    const footerBtn = $('#quiz-footer-btn');
    if (!footerBtn.disabled) footerBtn.click();
  }

  if (e.key === 'b' || e.key === 'B') {
    if (state.exam?.currentQuestion && !state._answered) {
      toggleBookmark(state.exam.currentQuestion);
      nextQuestion(); // refresh bookmark state on button
      // re-select the option if one was selected
    } else if (state.exam?.currentQuestion) {
      toggleBookmark(state.exam.currentQuestion);
      updateBookmarkButton();
    }
  }
}

function updateBookmarkButton() {
  const q = state.exam?.currentQuestion;
  if (!q) return;
  const bmBtn = $('#bookmark-question-btn');
  if (isBookmarked(q.id)) {
    bmBtn.classList.add('bookmarked');
    bmBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg> Bookmarked';
  } else {
    bmBtn.classList.remove('bookmarked');
    bmBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg> Bookmark';
  }
}

// =====================================================================
//  FINISH EXAM & RESULTS
// =====================================================================
async function finishExam() {
  if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; }

  const results = state.exam.getResults();
  const elapsed = Math.floor((Date.now() - state.examStartTime) / 1000);
  const durationMinutes = Math.round(elapsed / 60 * 10) / 10;

  saveExamToHistory(results, durationMinutes);

  try {
    await db.collection('exam_results').add({
      user_id: state.user?.uid || '',
      user_email: state.user?.email || '',
      user_name: state.candidate?.name || '',
      subject: state.examSubject,
      total_questions: results.totalQuestions,
      total_correct: results.totalCorrect,
      raw_accuracy: Math.round(results.rawAccuracy * 10000) / 10000,
      final_theta: Math.round(results.finalTheta * 1000) / 1000,
      final_se: Math.round(results.finalSE * 1000) / 1000,
      pass_probability: Math.round(results.passProbability * 10000) / 10000,
      passed: results.passed,
      avg_difficulty: Math.round(results.avgDifficulty * 100) / 100,
      exam_date: firebase.firestore.FieldValue.serverTimestamp(),
      duration_minutes: durationMinutes,
    });
  } catch (err) {
    console.error('Failed to save exam results:', err);
  }

  renderResults(results, durationMinutes);
  navigateTo('results');
}

function renderResults(results, durationMinutes) {
  const icon = $('#results-banner-icon');
  const verdict = $('#results-verdict');
  const meta = $('#results-meta');

  if (results.passed) {
    icon.className = 'results-icon pass';
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#28A060" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>';
    verdict.className = 'results-verdict pass';
    verdict.textContent = 'PASSED';
  } else {
    icon.className = 'results-icon fail';
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#CC3030" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>';
    verdict.className = 'results-verdict fail';
    verdict.textContent = 'DID NOT PASS';
  }

  meta.innerHTML = `
    Passing Probability: <strong>${(results.passProbability * 100).toFixed(1)}%</strong><br>
    Final Ability: <strong>${results.finalTheta >= 0 ? '+' : ''}${results.finalTheta.toFixed(2)} logits ± ${results.finalSE.toFixed(2)}</strong><br>
    Stop Reason: <strong>${results.stopReason}</strong><br>
    Duration: <strong>${durationMinutes} min</strong>
  `;

  $('#stat-questions').textContent = results.totalQuestions;
  $('#stat-correct').textContent = results.totalCorrect;
  $('#stat-accuracy').textContent = `${(results.rawAccuracy * 100).toFixed(1)}%`;
  $('#stat-avg-diff').textContent = results.avgDifficulty.toFixed(1);

  renderNCSBNDistribution(results);
  renderThetaChart(results);
  renderDifficultyBars(results);
  renderQuestionReview(results);
}

const NCSBN_CATEGORIES = [
  { key: 'Management of Care', label: 'Management of Care', min: 17, max: 23 },
  { key: 'Safety and Infection Control', label: 'Safety & Infection Control', min: 9, max: 15 },
  { key: 'Health Promotion and Maintenance', label: 'Health Promotion', min: 6, max: 12 },
  { key: 'Psychosocial Integrity', label: 'Psychosocial Integrity', min: 6, max: 12 },
  { key: 'Basic Care and Comfort', label: 'Basic Care & Comfort', min: 6, max: 12 },
  { key: 'Pharmacological and Parenteral Therapies', label: 'Pharmacological Therapies', min: 13, max: 19 },
  { key: 'Reduction of Risk Potential', label: 'Reduction of Risk', min: 9, max: 15 },
  { key: 'Physiological Adaptation', label: 'Physiological Adaptation', min: 11, max: 17 },
];

function renderNCSBNDistribution(results) {
  const container = $('#ncsbn-distribution');
  container.innerHTML = '';
  const totalQ = results.totalQuestions;

  for (const cat of NCSBN_CATEGORIES) {
    const catResponses = results.responses.filter(r => {
      const subj = r.question.subject || '';
      return subj.startsWith(cat.key) || subj === cat.key;
    });
    const count = catResponses.length;
    const pct = totalQ > 0 ? Math.round((count / totalQ) * 100) : 0;
    const inRange = pct >= cat.min && pct <= cat.max;
    const barClass = pct < cat.min ? 'below-range' : pct > cat.max ? 'above-range' : 'in-range';

    const row = document.createElement('div');
    row.className = 'ncsbn-row';
    row.innerHTML = `
      <span class="ncsbn-status-icon ${inRange ? 'ok' : 'warn'}">${inRange ? '✓' : '!'}</span>
      <span class="ncsbn-label">${cat.label}</span>
      <div class="ncsbn-bar-wrap">
        <div class="ncsbn-target-zone" style="left: ${cat.min}%; width: ${cat.max - cat.min}%"></div>
        <div class="ncsbn-actual-bar ${barClass}" style="width: ${Math.min(pct, 100)}%"></div>
      </div>
      <span class="ncsbn-stat">
        <span class="count">${count} (${pct}%)</span>
        <span class="target">Target ${cat.min}-${cat.max}%</span>
      </span>
    `;
    container.appendChild(row);
  }
}

function renderThetaChart(results) {
  const ctx = document.getElementById('theta-chart');
  if (!ctx) return;

  if (window._thetaChart) window._thetaChart.destroy();

  const labels = results.responses.map((_, i) => `Q${i + 1}`);
  const data = results.responses.map(r => Math.round(r.thetaAfter * 100) / 100);
  const isDark = document.documentElement.dataset.theme === 'dark';
  const gridColor = isDark ? '#333840' : '#e8ecf0';

  window._thetaChart = new Chart(ctx.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Ability (θ)', data,
          borderColor: '#0056B3', backgroundColor: 'rgba(0, 86, 179, 0.1)',
          fill: true, tension: 0.3, pointRadius: 2, pointHoverRadius: 5, borderWidth: 2.5,
        },
        {
          label: 'Passing Standard', data: Array(labels.length).fill(0),
          borderColor: '#CC3030', borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, fill: false,
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'bottom', labels: { boxWidth: 14, font: { size: 11 }, color: isDark ? '#9aa4b0' : undefined } },
        tooltip: { callbacks: { label: (ctx) => ctx.dataset.label === 'Passing Standard' ? '' : `θ = ${ctx.parsed.y.toFixed(2)}` } }
      },
      scales: {
        y: { min: -3, max: 3, grid: { color: gridColor }, ticks: { font: { size: 11 }, color: isDark ? '#9aa4b0' : undefined }, title: { display: true, text: 'Ability (logits)', font: { size: 11 }, color: isDark ? '#9aa4b0' : undefined } },
        x: { grid: { display: false }, ticks: { font: { size: 10 }, maxTicksLimit: 20, color: isDark ? '#9aa4b0' : undefined } }
      }
    }
  });
}

function renderDifficultyBars(results) {
  const container = $('#diff-bars');
  container.innerHTML = '';
  const levels = [
    { level: 1, label: 'Easy' }, { level: 2, label: 'Below Avg' },
    { level: 3, label: 'Medium' }, { level: 4, label: 'Above Avg' }, { level: 5, label: 'Hard' },
  ];

  for (const { level, label } of levels) {
    const responses = results.responses.filter(r => r.difficulty === level);
    const total = responses.length;
    const correct = responses.filter(r => r.isCorrect).length;
    const pct = total > 0 ? Math.round((correct / total) * 100) : 0;

    const row = document.createElement('div');
    row.className = 'diff-bar-row';
    row.innerHTML = `
      <span class="diff-bar-label">${label}</span>
      <div class="diff-bar-track"><div class="diff-bar-fill diff-${level}" style="width: ${pct}%"></div></div>
      <span class="diff-bar-stat">${correct}/${total} (${pct}%)</span>
    `;
    container.appendChild(row);
  }
}

function renderQuestionReview(results) {
  const container = $('#question-review-list');
  container.innerHTML = '';

  results.responses.forEach((r, i) => {
    const q = r.question;
    const letters = ['A', 'B', 'C', 'D'];

    const optionsHtml = q.options.map((opt, idx) => {
      let cls = '';
      if (idx === q.answer) cls = 'is-correct';
      else if (idx === r.selectedAnswer && !r.isCorrect) cls = 'is-selected-wrong';
      return `<div class="review-option ${cls}"><span class="review-option-letter">${letters[idx]}.</span> ${opt}</div>`;
    }).join('');

    const wrongRationales = q.rationale_wrong && typeof q.rationale_wrong === 'object'
      ? Object.values(q.rationale_wrong).filter(v => v).map(t => `<div class="rationale-box wrong-rationale">${t}</div>`).join('') : '';

    const item = document.createElement('div');
    item.className = 'review-item';
    item.innerHTML = `
      <div class="review-item-header" onclick="this.parentElement.classList.toggle('expanded')">
        <div class="review-item-icon ${r.isCorrect ? 'correct' : 'incorrect'}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            ${r.isCorrect ? '<path d="M20 6L9 17l-5-5"/>' : '<path d="M18 6L6 18M6 6l12 12"/>'}
          </svg>
        </div>
        <div class="review-item-info">
          <div class="review-item-num">Question ${i + 1} — ${DIFF_LABELS[q.difficulty] || 'Medium'}</div>
          <div class="review-item-cat">${q.category || q.subject || ''}</div>
        </div>
        <svg class="review-item-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
      </div>
      <div class="review-item-body">
        <div class="review-q-text">${q.question}</div>
        ${optionsHtml}
        <div class="review-rationale">
          <div class="rationale-box correct-rationale">${q.rationale_correct || 'No rationale provided.'}</div>
          ${wrongRationales}
        </div>
      </div>
    `;
    container.appendChild(item);
  });
}

// =====================================================================
//  STUDY MODE
// =====================================================================
function initStudyMode() {
  const studySel = $('#study-subject');
  if (studySel && studySel.options.length <= 1 && state.subjects.length > 0) {
    const totalCount = state.questions.length;
    studySel.innerHTML = `<option value="All Subjects">All Subjects (${totalCount})</option>`;
    state.subjects.forEach(s => {
      const count = state.questions.filter(q => q.subject === s).length;
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = `${s} (${count})`;
      studySel.appendChild(opt);
    });
  }
}

function loadStudyQuestions() {
  const subject = $('#study-subject').value;
  const difficulty = $('#study-difficulty').value;

  let questions = [...state.questions];

  if (subject !== 'All Subjects') {
    questions = questions.filter(q => q.subject === subject);
  }
  if (difficulty !== 'all') {
    questions = questions.filter(q => q.difficulty === parseInt(difficulty));
  }

  // Shuffle
  for (let i = questions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [questions[i], questions[j]] = [questions[j], questions[i]];
  }

  if (questions.length === 0) {
    alert('No questions match your filters.');
    return;
  }

  state.studyQuestions = questions;
  state.studyIndex = 0;
  $('#study-area').style.display = 'block';
  renderStudyQuestion();
}

function renderStudyQuestion() {
  const q = state.studyQuestions[state.studyIndex];
  if (!q) return;

  const total = state.studyQuestions.length;
  const num = state.studyIndex + 1;

  $('#study-counter').textContent = `${num} / ${total}`;
  $('#study-num-badge').textContent = `Question ${num}`;
  const diffBadge = $('#study-diff-badge');
  diffBadge.textContent = DIFF_LABELS[q.difficulty] || 'Medium';
  diffBadge.className = `badge badge-diff-${q.difficulty}`;

  $('#study-question-text').textContent = q.question;

  const optionsContainer = $('#study-options-list');
  optionsContainer.innerHTML = '';
  const letters = ['A', 'B', 'C', 'D'];

  q.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.dataset.index = i;
    btn.innerHTML = `
      <span class="option-letter">${letters[i]}</span>
      <span class="option-text">${opt}</span>
    `;
    btn.addEventListener('click', () => {
      $$('#study-options-list .option-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
    optionsContainer.appendChild(btn);
  });

  $('#study-rationale').classList.remove('visible');
  $('#study-prev').disabled = state.studyIndex === 0;
  $('#study-next').disabled = state.studyIndex >= total - 1;

  // Bookmark button
  const bmBtn = $('#study-bookmark-btn');
  if (isBookmarked(q.id)) {
    bmBtn.classList.add('bookmarked');
    bmBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg> Bookmarked';
  } else {
    bmBtn.classList.remove('bookmarked');
    bmBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg> Bookmark';
  }
}

function revealStudyAnswer() {
  const q = state.studyQuestions[state.studyIndex];
  if (!q) return;

  $$('#study-options-list .option-btn').forEach(btn => {
    btn.classList.add('locked');
    const idx = parseInt(btn.dataset.index);
    if (idx === q.answer) {
      btn.classList.add('correct');
      btn.querySelector('.option-letter').textContent = '✓';
    } else if (btn.classList.contains('selected')) {
      btn.classList.add('incorrect');
      btn.querySelector('.option-letter').textContent = '✗';
    }
  });

  $('#study-rationale-correct').textContent = q.rationale_correct || 'No rationale provided.';

  const wrongBox = $('#study-rationale-wrong');
  wrongBox.innerHTML = '';
  if (q.rationale_wrong && typeof q.rationale_wrong === 'object') {
    Object.values(q.rationale_wrong).filter(v => v).forEach(text => {
      const div = document.createElement('div');
      div.className = 'rationale-box wrong-rationale';
      div.textContent = text;
      wrongBox.appendChild(div);
    });
  }

  $('#study-rationale').classList.add('visible');
}

// =====================================================================
//  PROGRESS PAGE
// =====================================================================
function renderProgressPage() {
  renderExamHistory();
  renderProgressThetaChart();
  renderSubjectAnalytics();
  renderDifficultyHeatmap();
  renderWeakTopics();
}

function renderExamHistory() {
  const container = $('#exam-history-list');
  const history = state.examHistory;

  if (history.length === 0) {
    container.innerHTML = '<div class="dash-empty">No exam history available.</div>';
    return;
  }

  container.innerHTML = history.map(h => {
    const d = new Date(h.date);
    const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `
      <div class="history-item">
        <div class="history-dot ${h.passed ? 'pass' : 'fail'}"></div>
        <div class="history-info">
          <div class="history-title">${h.subject}</div>
          <div class="history-sub">${dateStr} · ${h.totalQuestions} questions · ${h.duration} min · ${h.stopReason || ''}</div>
        </div>
        <div class="history-stats">
          <div class="history-score ${h.passed ? 'pass' : 'fail'}">${h.accuracy}%</div>
          <div class="history-theta">θ = ${h.finalTheta >= 0 ? '+' : ''}${h.finalTheta}</div>
        </div>
      </div>
    `;
  }).join('');
}

function renderProgressThetaChart() {
  const ctx = document.getElementById('progress-theta-chart');
  if (!ctx) return;

  if (window._progressChart) window._progressChart.destroy();

  const history = [...state.examHistory].reverse();
  if (history.length === 0) return;

  const labels = history.map((h, i) => {
    const d = new Date(h.date);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });
  const data = history.map(h => h.finalTheta);
  const isDark = document.documentElement.dataset.theme === 'dark';
  const gridColor = isDark ? '#333840' : '#e8ecf0';

  window._progressChart = new Chart(ctx.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Final Ability (θ)', data,
          borderColor: 'var(--nca-purple, #7C3AED)', backgroundColor: 'rgba(124,58,237,0.1)',
          fill: true, tension: 0.3, pointRadius: 4, borderWidth: 2.5,
        },
        {
          label: 'Passing Standard', data: Array(labels.length).fill(0),
          borderColor: '#CC3030', borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, fill: false,
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'bottom', labels: { boxWidth: 14, font: { size: 11 }, color: isDark ? '#9aa4b0' : undefined } },
      },
      scales: {
        y: { min: -3, max: 3, grid: { color: gridColor }, ticks: { font: { size: 11 }, color: isDark ? '#9aa4b0' : undefined } },
        x: { grid: { display: false }, ticks: { font: { size: 10 }, color: isDark ? '#9aa4b0' : undefined } }
      }
    }
  });
}

function renderSubjectAnalytics() {
  const container = $('#subject-analytics');
  const history = state.examHistory;

  if (history.length === 0) {
    container.innerHTML = '<div class="dash-empty">No data yet.</div>';
    return;
  }

  const subjectMap = {};
  for (const h of history) {
    if (h.subjectBreakdown) {
      for (const [subj, data] of Object.entries(h.subjectBreakdown)) {
        if (!subjectMap[subj]) subjectMap[subj] = { total: 0, correct: 0 };
        subjectMap[subj].total += data.total;
        subjectMap[subj].correct += data.correct;
      }
    }
  }

  const subjects = Object.entries(subjectMap)
    .map(([name, data]) => ({ name, total: data.total, pct: Math.round((data.correct / data.total) * 100) }))
    .sort((a, b) => a.pct - b.pct);

  container.innerHTML = subjects.map(s => {
    const color = s.pct >= 70 ? 'var(--nca-green)' : s.pct >= 50 ? 'var(--nca-amber)' : 'var(--nca-red)';
    return `
      <div class="subject-row">
        <span class="subject-name">${s.name}</span>
        <div class="subject-bar-track"><div class="subject-bar-fill" style="width:${s.pct}%; background:${color}"></div></div>
        <span class="subject-stat">${s.pct}%</span>
      </div>
    `;
  }).join('');
}

function renderDifficultyHeatmap() {
  const container = $('#difficulty-heatmap');
  const history = state.examHistory;

  if (history.length === 0) {
    container.innerHTML = '<div class="dash-empty" style="grid-column:1/-1">No data yet.</div>';
    return;
  }

  const diffMap = {};
  for (const h of history) {
    if (h.difficultyBreakdown) {
      for (const [d, data] of Object.entries(h.difficultyBreakdown)) {
        if (!diffMap[d]) diffMap[d] = { total: 0, correct: 0 };
        diffMap[d].total += data.total;
        diffMap[d].correct += data.correct;
      }
    }
  }

  const levels = [
    { level: '1', label: 'Easy' }, { level: '2', label: 'Below Avg' },
    { level: '3', label: 'Medium' }, { level: '4', label: 'Above Avg' }, { level: '5', label: 'Hard' },
  ];

  container.innerHTML = levels.map(({ level, label }) => {
    const data = diffMap[level] || { total: 0, correct: 0 };
    const pct = data.total > 0 ? Math.round((data.correct / data.total) * 100) : 0;
    const color = pct >= 70 ? 'var(--nca-green)' : pct >= 50 ? 'var(--nca-amber)' : pct > 0 ? 'var(--nca-red)' : 'var(--text-muted)';
    return `
      <div class="heatmap-cell">
        <div class="heatmap-label">${label}</div>
        <div class="heatmap-value" style="color:${color}">${pct}%</div>
        <div class="heatmap-sub">${data.correct}/${data.total}</div>
      </div>
    `;
  }).join('');
}

function renderWeakTopics() {
  const container = $('#weak-topics');
  const history = state.examHistory;

  if (history.length === 0) {
    container.innerHTML = '<div class="dash-empty">Take more exams to identify weak areas.</div>';
    return;
  }

  const subjectMap = {};
  for (const h of history) {
    if (h.subjectBreakdown) {
      for (const [subj, data] of Object.entries(h.subjectBreakdown)) {
        if (!subjectMap[subj]) subjectMap[subj] = { total: 0, correct: 0 };
        subjectMap[subj].total += data.total;
        subjectMap[subj].correct += data.correct;
      }
    }
  }

  const weak = Object.entries(subjectMap)
    .map(([name, data]) => ({ name, total: data.total, pct: Math.round((data.correct / data.total) * 100) }))
    .filter(s => s.pct < 65 && s.total >= 3)
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 8);

  if (weak.length === 0) {
    container.innerHTML = '<div class="dash-empty">Great job! No weak topics identified.</div>';
    return;
  }

  container.innerHTML = weak.map(s => `
    <div class="weak-topic-item">
      <span class="weak-topic-icon">⚠</span>
      <span class="weak-topic-name">${s.name}</span>
      <span class="weak-topic-pct">${s.pct}% (${s.total} Q)</span>
    </div>
  `).join('');
}

// =====================================================================
//  BOOKMARKS PAGE
// =====================================================================
function renderBookmarksPage() {
  const container = $('#bookmarks-list');
  const countEl = $('#bookmarks-count');

  countEl.textContent = `${state.bookmarks.length} Bookmarked Questions`;

  if (state.bookmarks.length === 0) {
    container.innerHTML = '<div class="dash-empty">No bookmarked questions yet. Bookmark questions during exams or study mode.</div>';
    return;
  }

  const letters = ['A', 'B', 'C', 'D'];

  container.innerHTML = state.bookmarks.map((q, i) => {
    const optionsHtml = q.options.map((opt, idx) => {
      const cls = idx === q.answer ? 'is-correct' : '';
      return `<div class="review-option ${cls}"><span class="review-option-letter">${letters[idx]}.</span> ${opt}</div>`;
    }).join('');

    const wrongRationales = q.rationale_wrong && typeof q.rationale_wrong === 'object'
      ? Object.values(q.rationale_wrong).filter(v => v).map(t => `<div class="rationale-box wrong-rationale">${t}</div>`).join('') : '';

    return `
      <div class="bookmark-item" data-id="${q.id}">
        <div class="bookmark-item-header" onclick="this.parentElement.classList.toggle('expanded')">
          <span class="bookmark-item-q">${q.question}</span>
          <span class="bookmark-item-diff badge badge-diff-${q.difficulty}">${DIFF_LABELS[q.difficulty] || 'Medium'}</span>
          <button class="bookmark-remove" onclick="event.stopPropagation(); removeBookmark('${q.id}')" title="Remove">✕</button>
        </div>
        <div class="bookmark-item-body">
          <div class="review-q-text">${q.question}</div>
          ${optionsHtml}
          <div class="review-rationale">
            <div class="rationale-box correct-rationale">${q.rationale_correct || 'No rationale provided.'}</div>
            ${wrongRationales}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function removeBookmark(questionId) {
  state.bookmarks = state.bookmarks.filter(b => b.id !== questionId);
  saveBookmarks();
  renderBookmarksPage();
}

function clearAllBookmarks() {
  if (!confirm('Remove all bookmarks?')) return;
  state.bookmarks = [];
  saveBookmarks();
  renderBookmarksPage();
}

// =====================================================================
//  SETTINGS PAGE
// =====================================================================
function renderSettingsPage() {
  $('#settings-name').textContent = state.candidate?.name || '--';
  $('#settings-email').textContent = state.user?.email || '--';
  $('#settings-batch').textContent = state.candidate?.batch || '--';

  const cached = localStorage.getItem('nca_questions_cache');
  const cacheTime = localStorage.getItem('nca_questions_cache_time');

  if (cached) {
    try {
      const count = JSON.parse(cached).length;
      $('#settings-cache-count').textContent = count.toLocaleString();
    } catch (e) {
      $('#settings-cache-count').textContent = '0';
    }
  } else {
    $('#settings-cache-count').textContent = '0';
  }

  if (cacheTime) {
    const age = Date.now() - parseInt(cacheTime);
    const mins = Math.floor(age / 60000);
    if (mins < 60) {
      $('#settings-cache-age').textContent = `${mins} min ago`;
    } else {
      const hrs = Math.floor(mins / 60);
      $('#settings-cache-age').textContent = `${hrs} hr ago`;
    }
  } else {
    $('#settings-cache-age').textContent = '--';
  }

  $('#settings-history-count').textContent = `${state.examHistory.length} exams`;

  // Theme buttons
  const currentTheme = document.documentElement.dataset.theme || 'light';
  $$('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === currentTheme);
  });
}

async function refreshQuestionCache() {
  localStorage.removeItem('nca_questions_cache');
  localStorage.removeItem('nca_questions_cache_time');
  await loadQuestions();
  initSetupScreen();
  renderSettingsPage();
}

function clearQuestionCache() {
  localStorage.removeItem('nca_questions_cache');
  localStorage.removeItem('nca_questions_cache_time');
  renderSettingsPage();
  alert('Question cache cleared. Questions will be re-downloaded on next use.');
}

function clearLocalHistory() {
  if (!confirm('Clear all local exam history? This cannot be undone.')) return;
  state.examHistory = [];
  localStorage.removeItem('nca_exam_history');
  renderSettingsPage();
}

// =====================================================================
//  THEME
// =====================================================================
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('nca_theme', theme); } catch (e) {}
  $$('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
}

function loadThemePreference() {
  try {
    const saved = localStorage.getItem('nca_theme');
    if (saved === 'dark' || saved === 'light') {
      document.documentElement.dataset.theme = saved;
    }
  } catch (e) {}
}

// =====================================================================
//  INITIALIZATION
// =====================================================================
document.addEventListener('DOMContentLoaded', () => {
  loadThemePreference();
  initFirebase();

  // Login
  $('#login-btn').addEventListener('click', handleLogin);
  $('#login-password').addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });

  // Sidebar navigation
  $$('.nav-item[data-page]').forEach(item => {
    item.addEventListener('click', () => navigateTo(item.dataset.page));
  });

  $('#hamburger-btn').addEventListener('click', toggleSidebar);
  $('#sidebar-overlay').addEventListener('click', closeSidebar);
  $('#sidebar-logout-btn').addEventListener('click', handleLogout);

  // Dashboard
  $('#dash-start-exam').addEventListener('click', () => {
    initSetupScreen();
    navigateTo('exam-setup');
  });

  // Setup chips
  $$('.chip[data-count]').forEach(chip => {
    chip.addEventListener('click', () => handleChipSelect(chip));
  });
  $('#custom-slider').addEventListener('input', handleSliderChange);
  $('#start-exam-btn').addEventListener('click', startExam);

  // Quiz
  $('#end-exam-btn').addEventListener('click', endExamEarly);
  $('#bookmark-question-btn').addEventListener('click', () => {
    if (state.exam?.currentQuestion) {
      toggleBookmark(state.exam.currentQuestion);
      updateBookmarkButton();
    }
  });

  // Results
  $('#another-exam-btn').addEventListener('click', () => {
    initSetupScreen();
    navigateTo('exam-setup');
  });
  $('#results-dashboard-btn').addEventListener('click', () => navigateTo('dashboard'));

  // Study mode
  $('#study-load-btn').addEventListener('click', loadStudyQuestions);
  $('#study-prev').addEventListener('click', () => {
    if (state.studyIndex > 0) { state.studyIndex--; renderStudyQuestion(); }
  });
  $('#study-next').addEventListener('click', () => {
    if (state.studyIndex < state.studyQuestions.length - 1) { state.studyIndex++; renderStudyQuestion(); }
  });
  $('#study-reveal-btn').addEventListener('click', revealStudyAnswer);
  $('#study-bookmark-btn').addEventListener('click', () => {
    const q = state.studyQuestions[state.studyIndex];
    if (q) { toggleBookmark(q); renderStudyQuestion(); }
  });

  // Bookmarks
  $('#clear-bookmarks-btn').addEventListener('click', clearAllBookmarks);

  // Settings
  $('#refresh-cache-btn').addEventListener('click', refreshQuestionCache);
  $('#clear-cache-btn').addEventListener('click', clearQuestionCache);
  $('#clear-history-btn').addEventListener('click', clearLocalHistory);
  $('#settings-logout-btn').addEventListener('click', handleLogout);

  $$('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => setTheme(btn.dataset.theme));
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', handleKeyboard);

  // Auth state
  auth.onAuthStateChanged(async (user) => {
    if (user && !state.user) {
      try {
        const snap = await db.collection('approved_candidates')
          .where('email', '==', user.email.toLowerCase())
          .where('approved', '==', true)
          .get();

        if (!snap.empty) {
          state.user = user;
          state.candidate = snap.docs[0].data();
          await loadQuestions();
          enterLMS();
          return;
        }
      } catch (e) {}
    }
    if (!state.user) showScreen('login-screen');
  });
});
