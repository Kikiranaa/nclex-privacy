/* ===== NCA NCLEX-RN CAT Simulator — Application Logic ===== */

// ---------- Firebase Config ----------
const firebaseConfig = {
  apiKey: "AIzaSyACdqW7cUbQVL9YsuAZx_YDxMqiW8wFEeo",
  authDomain: "nca-nclex-cat.firebaseapp.com",
  projectId: "nca-nclex-cat",
  storageBucket: "nca-nclex-cat.firebasestorage.app",
  messagingSenderId: "693790493427",
  appId: "1:693790493427:android:fa9ac7ef1696230a074586"
};

// ---------- Firebase Imports (compat mode for CDN simplicity) ----------
let app, auth, db;

function initFirebase() {
  app = firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  db = firebase.firestore();
}

// ---------- State ----------
const state = {
  user: null,        // firebase auth user
  candidate: null,   // approved_candidates doc
  questions: [],     // all fetched questions
  subjects: [],      // unique subjects
  // Exam config
  examQuestionCount: 85,
  examSubject: 'All Subjects',
  // Exam runtime
  exam: null,        // CATEngine instance
  examStartTime: null,
  timerInterval: null,
};

// ---------- Screens ----------
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

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

// =====================================================================
//  CAT ENGINE (IRT 1PL Rasch Model)
// =====================================================================
class CATEngine {
  constructor(questions, maxQuestions, subject) {
    this.allQuestions = questions;
    this.maxQuestions = maxQuestions;
    this.subject = subject;

    // Filter by subject
    if (subject && subject !== 'All Subjects') {
      this.pool = questions.filter(q => q.subject === subject);
    } else {
      this.pool = [...questions];
    }

    // Shuffle pool for randomness
    this.pool = this.shuffleArray(this.pool);

    this.difficultyMap = { 1: -2.0, 2: -1.0, 3: 0.0, 4: 1.0, 5: 2.0 };
    this.theta = 0.0;
    this.se = 3.0;
    this.currentDifficulty = 3;
    this.responses = [];     // { question, selectedAnswer, isCorrect, theta, se, difficulty }
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

  // Newton-Raphson MLE for theta
  estimateTheta() {
    if (this.responses.length === 0) return 0.0;

    let theta = this.theta;
    const maxIter = 25;

    for (let iter = 0; iter < maxIter; iter++) {
      let num = 0;
      let den = 0;

      for (const r of this.responses) {
        const b = this.difficultyMap[r.difficulty] || 0;
        const p = this.pCorrect(theta, b);
        const resp = r.isCorrect ? 1 : 0;
        num += (resp - p);
        den += p * (1 - p);
      }

      if (Math.abs(den) < 1e-10) break;

      const delta = num / den;
      theta += delta;

      // Clamp theta to reasonable range
      theta = Math.max(-4.0, Math.min(4.0, theta));

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
    if (infoSum > 0) {
      this.se = 1 / Math.sqrt(infoSum);
    }
  }

  selectNextQuestion() {
    // Find unused questions at target difficulty, then nearby
    let candidates = [];
    const searchOrder = [0, 1, -1, 2, -2, 3, -3, 4, -4];

    for (const offset of searchOrder) {
      const targetDiff = Math.max(1, Math.min(5, this.currentDifficulty + offset));
      const matching = this.pool.filter(q =>
        q.difficulty === targetDiff && !this.usedIds.has(q.id)
      );
      if (matching.length > 0) {
        candidates = matching;
        break;
      }
    }

    // Fallback: any unused question
    if (candidates.length === 0) {
      candidates = this.pool.filter(q => !this.usedIds.has(q.id));
    }

    if (candidates.length === 0) {
      this.finished = true;
      this.stopReason = 'No more questions available';
      return null;
    }

    // Sort by information value, pick from top 3
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

    // Record response
    const response = {
      question: q,
      selectedAnswer: selectedIndex,
      isCorrect,
      difficulty: q.difficulty,
      thetaBefore: this.theta,
    };

    this.responses.push(response);

    // Update theta
    this.theta = this.estimateTheta();
    this.updateSE();

    response.thetaAfter = this.theta;
    response.seAfter = this.se;

    // Update difficulty for next question
    if (isCorrect) {
      this.currentDifficulty = Math.min(5, this.currentDifficulty + 1);
    } else {
      this.currentDifficulty = Math.max(1, this.currentDifficulty - 1);
    }

    // Check stopping rules
    this.checkStoppingRules();

    return response;
  }

  checkStoppingRules() {
    const n = this.responses.length;

    // Rule 1: max questions reached
    if (n >= this.maxQuestions) {
      this.finished = true;
      this.stopReason = 'Maximum questions reached';
      return;
    }

    // Rule 2: after min 15 questions, SE < 0.30, 95% CI entirely above or below passing standard
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
    const prob = this.getPassProbability();
    return prob >= 0.5 && this.theta >= 0.0;
  }

  getResults() {
    const totalCorrect = this.responses.filter(r => r.isCorrect).length;
    const totalQuestions = this.responses.length;
    const avgDiff = totalQuestions > 0
      ? this.responses.reduce((sum, r) => sum + r.difficulty, 0) / totalQuestions
      : 0;

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
//  LOGIN LOGIC
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
    // Sign in with Firebase Auth
    const cred = await auth.signInWithEmailAndPassword(email, password);
    state.user = cred.user;

    // Check approved_candidates
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
    initSetupScreen();
    showScreen('setup-screen');
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

// =====================================================================
//  QUESTIONS LOADING
// =====================================================================
async function loadQuestions() {
  showLoading('Loading question bank...');

  // Try localStorage cache first
  const cached = localStorage.getItem('nca_questions_cache');
  const cacheTime = localStorage.getItem('nca_questions_cache_time');
  const ONE_HOUR = 60 * 60 * 1000;

  if (cached && cacheTime && (Date.now() - parseInt(cacheTime)) < ONE_HOUR) {
    try {
      state.questions = JSON.parse(cached);
      extractSubjects();
      hideLoading();
      return;
    } catch (e) {
      // Cache corrupt, fetch fresh
    }
  }

  try {
    const snap = await db.collection('questions').get();
    state.questions = snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // Cache
    try {
      localStorage.setItem('nca_questions_cache', JSON.stringify(state.questions));
      localStorage.setItem('nca_questions_cache_time', Date.now().toString());
    } catch (e) {
      // Storage full, ignore
    }

    extractSubjects();
  } catch (err) {
    // Fallback to cache even if stale
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
//  SETUP SCREEN
// =====================================================================
function initSetupScreen() {
  const name = state.candidate?.name || state.user?.email || 'Student';
  const batch = state.candidate?.batch || '';

  $('#setup-welcome-name').textContent = `Welcome, ${name}!`;
  $('#setup-welcome-batch').textContent = batch ? `Batch: ${batch}` : 'Prepare for your NCLEX-RN exam';

  // Populate subject dropdown with question counts
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

  // Reset chip selection
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

  // Validate enough questions
  const available = state.examSubject === 'All Subjects'
    ? state.questions.length
    : state.questions.filter(q => q.subject === state.examSubject).length;

  if (available < 10) {
    alert('Not enough questions available for this subject. Please select a different subject.');
    return;
  }

  state.exam = new CATEngine(state.questions, state.examQuestionCount, state.examSubject);
  state.examStartTime = Date.now();

  // Start timer
  if (state.timerInterval) clearInterval(state.timerInterval);
  state.timerInterval = setInterval(updateTimer, 1000);

  initQuizScreen();
  showScreen('quiz-screen');
  nextQuestion();
}

function handleLogout() {
  if (state.timerInterval) clearInterval(state.timerInterval);
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
  const se = engine.se;

  // Map theta (-4 to +4) to 0-100%
  const pct = Math.max(0, Math.min(100, ((theta + 4) / 8) * 100));
  $('#ability-marker').style.left = `${pct}%`;
  $('#ability-value').textContent = `${theta >= 0 ? '+' : ''}${theta.toFixed(2)} logits`;
}

const DIFF_LABELS = {
  1: 'Easy', 2: 'Below Avg', 3: 'Medium', 4: 'Above Avg', 5: 'Hard'
};

function nextQuestion() {
  const engine = state.exam;

  if (engine.finished) {
    finishExam();
    return;
  }

  const q = engine.selectNextQuestion();
  if (!q) {
    finishExam();
    return;
  }

  const n = engine.responses.length + 1;
  const max = engine.maxQuestions;

  // Update top bar
  $('#quiz-counter').textContent = `Q${n}/${max}`;
  $('#quiz-progress-bar').style.width = `${(n / max) * 100}%`;

  // Update ability meter
  updateAbilityMeter();

  // Question badges
  $('#question-num-badge').textContent = `Question ${n}`;
  const diffBadge = $('#question-diff-badge');
  diffBadge.textContent = DIFF_LABELS[q.difficulty] || 'Medium';
  diffBadge.className = `badge badge-diff-${q.difficulty}`;

  // Question text
  $('#question-text').textContent = q.question;

  // Options
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

  // Hide rationale, reset footer
  $('#rationale-section').classList.remove('visible');
  const footerBtn = $('#quiz-footer-btn');
  footerBtn.textContent = 'Submit Answer';
  footerBtn.disabled = true;
  footerBtn.onclick = submitCurrentAnswer;

  // State
  state._selectedOption = null;
  state._answered = false;
}

function selectOption(index) {
  if (state._answered) return;

  state._selectedOption = index;

  $$('.option-btn').forEach(btn => {
    btn.classList.remove('selected');
    if (parseInt(btn.dataset.index) === index) {
      btn.classList.add('selected');
    }
  });

  $('#quiz-footer-btn').disabled = false;
}

function submitCurrentAnswer() {
  if (state._selectedOption === null || state._answered) return;

  state._answered = true;
  const engine = state.exam;
  const q = engine.currentQuestion;
  const selected = state._selectedOption;

  // Submit to engine
  const response = engine.submitAnswer(selected);

  // Lock options
  $$('.option-btn').forEach(btn => {
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

  // Update ability meter after answer
  updateAbilityMeter();

  // Show rationale
  const rationaleSection = $('#rationale-section');
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

  // Wrong rationales
  rationaleWrongBox.innerHTML = '';
  if (q.rationale_wrong && typeof q.rationale_wrong === 'object') {
    const entries = Object.values(q.rationale_wrong).filter(v => v);
    if (entries.length > 0) {
      entries.forEach(text => {
        const div = document.createElement('div');
        div.className = 'rationale-box wrong-rationale';
        div.textContent = text;
        rationaleWrongBox.appendChild(div);
      });
    }
  }

  rationaleSection.classList.add('visible');

  // Update footer button
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
    if (confirm('You have not answered any questions. Return to setup?')) {
      if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; }
      initSetupScreen();
      showScreen('setup-screen');
    }
    return;
  }
  if (!confirm('Are you sure you want to end the exam early? Your results will be calculated based on questions answered so far.')) return;

  engine.finished = true;
  engine.stopReason = 'Exam ended early by student';
  finishExam();
}

// =====================================================================
//  FINISH EXAM & RESULTS
// =====================================================================
async function finishExam() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }

  const results = state.exam.getResults();
  const elapsed = Math.floor((Date.now() - state.examStartTime) / 1000);
  const durationMinutes = Math.round(elapsed / 60 * 10) / 10;

  // Save to Firestore
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
  showScreen('results-screen');
}

function renderResults(results, durationMinutes) {
  // Pass/Fail banner
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

  // Stat cards
  $('#stat-questions').textContent = results.totalQuestions;
  $('#stat-correct').textContent = results.totalCorrect;
  $('#stat-accuracy').textContent = `${(results.rawAccuracy * 100).toFixed(1)}%`;
  $('#stat-avg-diff').textContent = results.avgDifficulty.toFixed(1);

  // NCSBN Test Plan Distribution
  renderNCSBNDistribution(results);

  // Theta trajectory chart
  renderThetaChart(results);

  // Difficulty performance bars
  renderDifficultyBars(results);

  // Question review
  renderQuestionReview(results);
}

// NCSBN 2026 Test Plan target percentages
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
  const ctx = document.getElementById('theta-chart').getContext('2d');

  // Destroy previous chart if any
  if (window._thetaChart) {
    window._thetaChart.destroy();
  }

  const labels = results.responses.map((_, i) => `Q${i + 1}`);
  const data = results.responses.map(r => Math.round(r.thetaAfter * 100) / 100);

  window._thetaChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Ability (θ)',
          data,
          borderColor: '#0056B3',
          backgroundColor: 'rgba(0, 86, 179, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 2,
          pointHoverRadius: 5,
          borderWidth: 2.5,
        },
        {
          label: 'Passing Standard',
          data: Array(labels.length).fill(0),
          borderColor: '#CC3030',
          borderDash: [6, 4],
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'bottom', labels: { boxWidth: 14, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => ctx.dataset.label === 'Passing Standard' ? '' : `θ = ${ctx.parsed.y.toFixed(2)}`
          }
        }
      },
      scales: {
        y: {
          min: -3,
          max: 3,
          grid: { color: '#e8ecf0' },
          ticks: { font: { size: 11 } },
          title: { display: true, text: 'Ability (logits)', font: { size: 11 } }
        },
        x: {
          grid: { display: false },
          ticks: {
            font: { size: 10 },
            maxTicksLimit: 20,
          }
        }
      }
    }
  });
}

function renderDifficultyBars(results) {
  const container = $('#diff-bars');
  container.innerHTML = '';

  const levels = [
    { level: 1, label: 'Easy' },
    { level: 2, label: 'Below Avg' },
    { level: 3, label: 'Medium' },
    { level: 4, label: 'Above Avg' },
    { level: 5, label: 'Hard' },
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
      <div class="diff-bar-track">
        <div class="diff-bar-fill diff-${level}" style="width: ${pct}%"></div>
      </div>
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

    const item = document.createElement('div');
    item.className = 'review-item';

    const optionsHtml = q.options.map((opt, idx) => {
      let cls = '';
      if (idx === q.answer) cls = 'is-correct';
      else if (idx === r.selectedAnswer && !r.isCorrect) cls = 'is-selected-wrong';
      return `<div class="review-option ${cls}"><span class="review-option-letter">${letters[idx]}.</span> ${opt}</div>`;
    }).join('');

    const wrongRationales = q.rationale_wrong && typeof q.rationale_wrong === 'object'
      ? Object.values(q.rationale_wrong).filter(v => v).map(t => `<div class="rationale-box wrong-rationale">${t}</div>`).join('')
      : '';

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

function takeAnotherExam() {
  initSetupScreen();
  showScreen('setup-screen');
}

// =====================================================================
//  INITIALIZATION
// =====================================================================
document.addEventListener('DOMContentLoaded', () => {
  initFirebase();

  // Login
  $('#login-btn').addEventListener('click', handleLogin);
  $('#login-password').addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });

  // Setup chips
  $$('.chip[data-count]').forEach(chip => {
    chip.addEventListener('click', () => handleChipSelect(chip));
  });
  $('#custom-slider').addEventListener('input', handleSliderChange);

  // Setup actions
  $('#start-exam-btn').addEventListener('click', startExam);
  $('#logout-btn').addEventListener('click', handleLogout);

  // Quiz
  $('#end-exam-btn').addEventListener('click', endExamEarly);

  // Results
  $('#another-exam-btn').addEventListener('click', takeAnotherExam);
  $('#results-logout-btn').addEventListener('click', handleLogout);

  // Check if already signed in
  auth.onAuthStateChanged(async (user) => {
    if (user && !state.user) {
      // Verify still approved
      try {
        const snap = await db.collection('approved_candidates')
          .where('email', '==', user.email.toLowerCase())
          .where('approved', '==', true)
          .get();

        if (!snap.empty) {
          state.user = user;
          state.candidate = snap.docs[0].data();
          await loadQuestions();
          initSetupScreen();
          showScreen('setup-screen');
          return;
        }
      } catch (e) {
        // Fall through to login
      }
    }
    // Default: show login
    if (!state.user) {
      showScreen('login-screen');
    }
  });
});
