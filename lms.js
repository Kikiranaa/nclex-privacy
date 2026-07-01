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
//  CAT ENGINE (IRT 1PL Rasch Model) — same as mobile
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

  pCorrect(theta, b) { return 1 / (1 + Math.exp(-(theta - b))); }
  fisherInfo(theta, b) { const p = this.pCorrect(theta, b); return p * (1 - p); }

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
      infoSum += this.fisherInfo(this.theta, this.difficultyMap[r.difficulty] || 0);
    }
    this.informationSum = infoSum;
    this.se = infoSum > 0 ? 1 / Math.sqrt(infoSum) : 3.0;
  }

  selectNextQuestion() {
    let candidates = [];
    const searchOrder = [0, 1, -1, 2, -2, 3, -3, 4, -4];
    for (const offset of searchOrder) {
      const targetDiff = Math.max(1, Math.min(5, this.currentDifficulty + offset));
      const matching = this.pool.filter(q => q.difficulty === targetDiff && !this.usedIds.has(q.id));
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
      return this.fisherInfo(this.theta, this.difficultyMap[b.difficulty] || 0)
           - this.fisherInfo(this.theta, this.difficultyMap[a.difficulty] || 0);
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
      question: q, selectedAnswer: selectedIndex, isCorrect,
      difficulty: q.difficulty, thetaBefore: this.theta,
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
      if (ciLow > 0.0) { this.finished = true; this.stopReason = '95% CI above passing standard'; return; }
      if (ciHigh < 0.0) { this.finished = true; this.stopReason = '95% CI below passing standard'; return; }
    }
  }

  getPassProbability() {
    const z = this.theta / this.se;
    return 1 / (1 + Math.exp(-1.7 * z));
  }

  hasPassed() { return this.getPassProbability() >= 0.5 && this.theta >= 0.0; }

  getResults() {
    const totalCorrect = this.responses.filter(r => r.isCorrect).length;
    const totalQuestions = this.responses.length;
    const avgDiff = totalQuestions > 0
      ? this.responses.reduce((sum, r) => sum + r.difficulty, 0) / totalQuestions : 0;
    return {
      totalQuestions, totalCorrect,
      rawAccuracy: totalQuestions > 0 ? totalCorrect / totalQuestions : 0,
      finalTheta: this.theta, finalSE: this.se,
      passProbability: this.getPassProbability(),
      passed: this.hasPassed(), avgDifficulty: avgDiff,
      stopReason: this.stopReason, responses: this.responses,
    };
  }
}

// =====================================================================
//  STATE
// =====================================================================
const state = {
  user: null,
  candidate: null,
  questions: [],
  subjects: [],
  examQuestionCount: 75,
  examSubject: 'All Subjects',
  exam: null,
  examStartTime: null,
  timerInterval: null,
  _selectedOption: null,
  _answered: false,
  currentPage: 'dashboard',
};

// =====================================================================
//  LMS NAVIGATION
// =====================================================================
const LMS = {
  navigateTo(page) {
    state.currentPage = page;

    $$('.page').forEach(p => p.classList.remove('active'));
    const target = $(`#page-${page}`);
    if (target) target.classList.add('active');

    $$('.nav-item').forEach(n => n.classList.remove('active'));
    const navItem = $(`.nav-item[data-page="${page}"]`);
    if (navItem) navItem.classList.add('active');

    const titles = {
      dashboard: 'Dashboard', setup: 'Start Exam', study: 'Study Mode',
      bookmarks: 'Bookmarks', review: 'Review Mistakes', analytics: 'Analytics',
      quiz: 'CAT Exam', results: 'Results', history: 'Exam History', settings: 'Settings',
    };
    $('#topbar-title').textContent = titles[page] || 'Dashboard';

    // Close mobile sidebar
    $('#sidebar').classList.remove('open');
    $('#sidebar-overlay').classList.remove('open');

    if (page === 'dashboard') this.refreshDashboard();
    if (page === 'review') ReviewMistakes.refresh();
    if (page === 'analytics') Analytics.refresh();
    if (page === 'history') this.refreshHistory();
    if (page === 'setup') initSetupScreen();
    if (page === 'study') StudyMode.init();
    if (page === 'bookmarks') Bookmarks.refresh();
    if (page === 'settings') Settings.refresh();
  },

  refreshDashboard() {
    const history = getExamHistory();
    const name = state.candidate?.name || state.user?.email || 'Student';
    $('#dash-welcome').textContent = `Welcome back, ${name}!`;

    // Stats
    const totalExams = history.length;
    const passCount = history.filter(h => h.passed).length;
    const avgAcc = totalExams > 0
      ? Math.round(history.reduce((s, h) => s + h.rawAccuracy, 0) / totalExams * 100) : 0;
    const bestTheta = totalExams > 0
      ? Math.max(...history.map(h => h.finalTheta)) : 0;

    $('#dash-total-exams').textContent = totalExams;
    $('#dash-pass-rate').textContent = totalExams > 0 ? `${Math.round(passCount / totalExams * 100)}%` : '--';
    $('#dash-avg-accuracy').textContent = totalExams > 0 ? `${avgAcc}%` : '--';
    $('#dash-best-theta').textContent = totalExams > 0 ? `${bestTheta >= 0 ? '+' : ''}${bestTheta.toFixed(2)}` : '--';

    // Progress tracker
    const progress = getStudyStreak();
    $('#dash-streak').textContent = progress.streak;
    $('#dash-total-days').textContent = progress.totalDays;
    let totalQ = 0, totalTime = 0;
    history.forEach(h => { totalQ += h.totalQuestions; totalTime += h.durationMinutes || 0; });
    $('#dash-total-q').textContent = totalQ;
    const pHrs = Math.floor(totalTime / 60);
    const pMins = Math.round(totalTime % 60);
    $('#dash-study-time').textContent = pHrs > 0 ? `${pHrs}h ${pMins}m` : `${pMins}m`;

    // Recent exams
    const listEl = $('#dash-recent-list');
    if (history.length === 0) {
      listEl.innerHTML = `<div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
        <p>No exams yet. Start your first one!</p>
      </div>`;
      return;
    }

    const recent = history.slice(-5).reverse();
    listEl.innerHTML = recent.map(h => {
      const date = new Date(h.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return `<div class="recent-item">
        <div class="recent-item-icon ${h.passed ? 'pass' : 'fail'}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            ${h.passed ? '<path d="M20 6L9 17l-5-5"/>' : '<path d="M18 6L6 18M6 6l12 12"/>'}
          </svg>
        </div>
        <div class="recent-item-info">
          <div class="recent-item-title">${h.subject || 'All Subjects'} — ${h.totalQuestions} questions</div>
          <div class="recent-item-sub">${date}</div>
        </div>
        <div class="recent-item-score ${h.passed ? 'pass' : 'fail'}">${Math.round(h.rawAccuracy * 100)}%</div>
      </div>`;
    }).join('');

    // Question bank stats
    const qbankEl = $('#dash-qbank-stats');
    const total = state.questions.length;
    const subjectCount = state.subjects.length;
    qbankEl.innerHTML = `
      <span><strong>${total}</strong> total questions</span>
      <span><strong>${subjectCount}</strong> subjects available</span>
    `;

    // Ability trend chart
    this.renderTrendChart(history);

    // Subject performance bars
    this.renderSubjectBars(history);

    // Weak-topic identification
    this.renderWeakAreas(history);
  },

  renderTrendChart(history) {
    if (history.length < 2) {
      $('#dash-trend-empty').style.display = '';
      $('#dash-trend-chart-wrap').style.display = 'none';
      return;
    }
    $('#dash-trend-empty').style.display = 'none';
    $('#dash-trend-chart-wrap').style.display = 'block';

    const ctx = document.getElementById('dash-trend-chart').getContext('2d');
    if (window._trendChart) window._trendChart.destroy();

    const labels = history.map((h, i) => {
      const d = new Date(h.date);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    const thetaData = history.map(h => Math.round(h.finalTheta * 100) / 100);
    const accData = history.map(h => Math.round(h.rawAccuracy * 100));

    window._trendChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Ability (θ)', data: thetaData, yAxisID: 'y',
            borderColor: '#0056B3', backgroundColor: 'rgba(0,86,179,.08)',
            fill: true, tension: 0.3, pointRadius: 4, pointHoverRadius: 7, borderWidth: 2.5,
          },
          {
            label: 'Accuracy %', data: accData, yAxisID: 'y1',
            borderColor: '#28A060', backgroundColor: 'rgba(40,160,96,.08)',
            fill: false, tension: 0.3, pointRadius: 4, pointHoverRadius: 7,
            borderWidth: 2, borderDash: [4, 4],
          },
          {
            label: 'Passing Standard', data: Array(labels.length).fill(0), yAxisID: 'y',
            borderColor: '#CC3030', borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, fill: false,
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
        scales: {
          y: { min: -3, max: 3, position: 'left', grid: { color: '#e8ecf0' }, ticks: { font: { size: 10 } }, title: { display: true, text: 'Ability', font: { size: 10 } } },
          y1: { min: 0, max: 100, position: 'right', grid: { display: false }, ticks: { font: { size: 10 }, callback: v => v + '%' }, title: { display: true, text: 'Accuracy', font: { size: 10 } } },
          x: { grid: { display: false }, ticks: { font: { size: 10 } } }
        }
      }
    });
  },

  renderSubjectBars(history) {
    const container = $('#dash-subject-bars');
    if (history.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>Complete exams to see subject breakdown.</p></div>';
      return;
    }

    const subjectMap = {};
    history.forEach(h => {
      const s = h.subject || 'All Subjects';
      if (!subjectMap[s]) subjectMap[s] = { total: 0, correct: 0, exams: 0 };
      subjectMap[s].total += h.totalQuestions;
      subjectMap[s].correct += h.totalCorrect;
      subjectMap[s].exams += 1;
    });

    const entries = Object.entries(subjectMap).sort((a, b) => b[1].exams - a[1].exams);
    container.innerHTML = entries.map(([subject, data]) => {
      const pct = data.total > 0 ? Math.round(data.correct / data.total * 100) : 0;
      const cls = pct >= 70 ? 'high' : pct >= 50 ? 'mid' : 'low';
      return `<div class="subject-bar-row">
        <span class="subject-bar-label" title="${subject}">${subject}</span>
        <div class="subject-bar-track"><div class="subject-bar-fill ${cls}" style="width:${pct}%"></div></div>
        <span class="subject-bar-stat">${data.correct}/${data.total} (${pct}%)</span>
      </div>`;
    }).join('');
  },

  renderWeakAreas(history) {
    const container = $('#dash-weak-areas');
    const listEl = $('#weak-areas-list');
    const countEl = $('#weak-areas-count');

    if (history.length === 0) { container.style.display = 'none'; return; }

    const catMap = {};
    history.forEach(h => {
      if (!h.responses) return;
      h.responses.forEach(r => {
        const key = r.question?.category || r.question?.subject || 'General';
        if (!catMap[key]) catMap[key] = { total: 0, correct: 0, subject: r.question?.subject || '' };
        catMap[key].total++;
        if (r.isCorrect) catMap[key].correct++;
      });
    });

    if (Object.keys(catMap).length === 0) {
      const subjectMap = {};
      history.forEach(h => {
        const s = h.subject || 'All Subjects';
        if (!subjectMap[s]) subjectMap[s] = { total: 0, correct: 0, subject: s };
        subjectMap[s].total += h.totalQuestions;
        subjectMap[s].correct += h.totalCorrect;
      });
      Object.assign(catMap, subjectMap);
    }

    const entries = Object.entries(catMap)
      .filter(([, d]) => d.total >= 3)
      .map(([name, d]) => {
        const pct = Math.round(d.correct / d.total * 100);
        let severity, icon, rec;
        if (pct < 40) {
          severity = 'critical';
          icon = '!!';
          rec = `Critical area. Focus study sessions on ${name} questions.`;
        } else if (pct < 60) {
          severity = 'warning';
          icon = '!';
          rec = `Needs improvement. Practice more ${name} questions to strengthen this area.`;
        } else if (pct < 75) {
          severity = 'improving';
          icon = '~';
          rec = `Getting there. A few more practice sessions will solidify your knowledge.`;
        } else {
          return null;
        }
        return { name, pct, total: d.total, correct: d.correct, subject: d.subject, severity, icon, rec };
      })
      .filter(Boolean)
      .sort((a, b) => a.pct - b.pct)
      .slice(0, 5);

    if (entries.length === 0) { container.style.display = 'none'; return; }

    container.style.display = '';
    countEl.textContent = `${entries.length} area${entries.length !== 1 ? 's' : ''} to review`;

    listEl.innerHTML = entries.map(e => `
      <div class="weak-area-item">
        <div class="weak-area-icon ${e.severity}">${e.icon}</div>
        <div class="weak-area-info">
          <div class="weak-area-title">${e.name}</div>
          <div class="weak-area-meta">${e.correct}/${e.total} correct (${e.pct}%) · ${e.subject}</div>
          <div class="weak-area-rec">${e.rec}</div>
          <div class="weak-area-bar-track"><div class="weak-area-bar-fill ${e.severity}" style="width:${e.pct}%"></div></div>
        </div>
        <div class="weak-area-action">
          <button class="btn btn-ghost btn-sm" onclick="LMS.practiceWeakArea('${e.subject || ''}')">Practice</button>
        </div>
      </div>
    `).join('');
  },

  practiceWeakArea(subject) {
    if (subject && subject !== 'All Subjects') {
      LMS.navigateTo('study');
      setTimeout(() => {
        const sel = $('#study-subject-filter');
        if ([...sel.options].some(o => o.value === subject)) {
          sel.value = subject;
        }
        StudyMode.loadQuestions();
      }, 100);
    } else {
      LMS.navigateTo('study');
    }
  },

  refreshHistory() {
    const history = getExamHistory();
    const listEl = $('#history-list');

    if (history.length === 0) {
      listEl.innerHTML = `<div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <p>No exam history yet. Take your first exam to see results here.</p>
      </div>`;
      return;
    }

    listEl.innerHTML = history.slice().reverse().map((h, idx) => {
      const date = new Date(h.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      let detailHTML = '';
      if (h.responses && h.responses.length > 0) {
        const catMap = {};
        const diffMap = { 1: { t: 0, c: 0 }, 2: { t: 0, c: 0 }, 3: { t: 0, c: 0 }, 4: { t: 0, c: 0 }, 5: { t: 0, c: 0 } };
        h.responses.forEach(r => {
          const cat = r.question?.category || r.question?.subject || 'General';
          if (!catMap[cat]) catMap[cat] = { total: 0, correct: 0 };
          catMap[cat].total++;
          if (r.isCorrect) catMap[cat].correct++;
          const d = r.difficulty || 3;
          if (diffMap[d]) { diffMap[d].t++; if (r.isCorrect) diffMap[d].c++; }
        });
        const catRows = Object.entries(catMap).sort((a, b) => b[1].total - a[1].total).map(([cat, d]) => {
          const pct = Math.round(d.correct / d.total * 100);
          const cls = pct >= 70 ? 'high' : pct >= 50 ? 'mid' : 'low';
          return `<tr><td>${cat}</td><td>${d.correct}/${d.total}</td><td><span class="hist-pct ${cls}">${pct}%</span></td></tr>`;
        }).join('');
        const diffLabels = ['Easy', 'Medium-Easy', 'Medium', 'Medium-Hard', 'Hard'];
        const diffBars = [1,2,3,4,5].filter(d => diffMap[d].t > 0).map(d => {
          const pct = Math.round(diffMap[d].c / diffMap[d].t * 100);
          return `<div class="hist-diff-row"><span class="hist-diff-label">${diffLabels[d - 1]}</span><div class="hist-diff-track"><div class="hist-diff-fill diff-${d}" style="width:${diffMap[d].t / h.responses.length * 100}%"></div></div><span class="hist-diff-stat">${diffMap[d].c}/${diffMap[d].t} (${pct}%)</span></div>`;
        }).join('');
        detailHTML = `<div class="history-detail" id="hist-detail-${idx}">
          <div class="hist-detail-grid">
            <div class="hist-detail-section"><h4>Category Breakdown</h4><table class="hist-detail-table"><thead><tr><th>Category</th><th>Score</th><th>Accuracy</th></tr></thead><tbody>${catRows}</tbody></table></div>
            <div class="hist-detail-section"><h4>Difficulty Distribution</h4>${diffBars}<div class="hist-detail-meta"><span>Stop Reason: ${h.stopReason || 'Completed'}</span><span>SE: ±${h.finalSE?.toFixed(3) || '?'}</span><span>Pass Prob: ${Math.round((h.passProbability || 0) * 100)}%</span></div></div>
          </div>
        </div>`;
      }
      return `<div class="history-item-wrap">
        <div class="history-item ${h.responses ? 'expandable' : ''}" onclick="${h.responses ? `toggleHistoryDetail(${idx})` : ''}">
        <div class="history-item-badge ${h.passed ? 'pass' : 'fail'}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            ${h.passed ? '<path d="M20 6L9 17l-5-5"/>' : '<path d="M18 6L6 18M6 6l12 12"/>'}
          </svg>
        </div>
        <div class="history-item-info">
          <div class="history-item-title">${h.subject || 'All Subjects'}</div>
          <div class="history-item-date">${date} · ${h.durationMinutes?.toFixed(1) || '?'} min</div>
        </div>
        <div class="history-item-stat">
          <div class="history-item-stat-val">${h.totalCorrect}/${h.totalQuestions}</div>
          <div class="history-item-stat-label">Score</div>
        </div>
        <div class="history-item-stat">
          <div class="history-item-stat-val">${Math.round(h.rawAccuracy * 100)}%</div>
          <div class="history-item-stat-label">Accuracy</div>
        </div>
        <div class="history-item-stat">
          <div class="history-item-stat-val">${h.finalTheta >= 0 ? '+' : ''}${h.finalTheta.toFixed(2)}</div>
          <div class="history-item-stat-label">Ability</div>
        </div>
        <div class="history-item-stat">
          <div class="history-item-stat-val" style="color:${h.passed ? 'var(--nca-green)' : 'var(--nca-red)'}">${h.passed ? 'PASS' : 'FAIL'}</div>
          <div class="history-item-stat-label">Result</div>
        </div>
        ${h.responses ? '<svg class="hist-expand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><polyline points="6 9 12 15 18 9"/></svg>' : ''}
      </div>${detailHTML}</div>`;
    }).join('');
  },
};

// =====================================================================
//  EXAM HISTORY (localStorage)
// =====================================================================
function getExamHistory() {
  try {
    return JSON.parse(localStorage.getItem('nca_exam_history') || '[]');
  } catch { return []; }
}

function saveExamToHistory(results, durationMinutes) {
  const history = getExamHistory();
  const responses = results.responses.map(r => ({
    isCorrect: r.isCorrect,
    difficulty: r.difficulty,
    question: { subject: r.question.subject, category: r.question.category },
  }));
  history.push({
    date: new Date().toISOString(),
    subject: state.examSubject,
    totalQuestions: results.totalQuestions,
    totalCorrect: results.totalCorrect,
    rawAccuracy: Math.round(results.rawAccuracy * 10000) / 10000,
    finalTheta: Math.round(results.finalTheta * 1000) / 1000,
    finalSE: Math.round(results.finalSE * 1000) / 1000,
    passProbability: Math.round(results.passProbability * 10000) / 10000,
    passed: results.passed,
    avgDifficulty: Math.round(results.avgDifficulty * 100) / 100,
    durationMinutes: Math.round(durationMinutes * 10) / 10,
    stopReason: results.stopReason,
    responses,
  });
  try {
    localStorage.setItem('nca_exam_history', JSON.stringify(history));
  } catch (e) { /* storage full */ }
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
  if (!email || !password) { showError(errorBox, 'Please enter both email and password.'); return; }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="border-color:rgba(255,255,255,.3);border-top-color:#fff;width:18px;height:18px;"></span> Signing in...';

  try {
    const cred = await auth.signInWithEmailAndPassword(email, password);
    state.user = cred.user;

    const snap = await db.collection('approved_candidates')
      .where('email', '==', email.toLowerCase())
      .where('approved', '==', true).get();

    if (snap.empty) {
      await auth.signOut();
      state.user = null;
      showError(errorBox, 'Access denied. Your account has not been approved.');
      btn.disabled = false; btn.textContent = 'Sign In';
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
    btn.disabled = false; btn.textContent = 'Sign In';
  }
}

function enterLMS() {
  // Hide login, show shell
  $('#login-screen').classList.remove('active');
  $('#login-screen').style.display = 'none';
  $('#lms-shell').classList.remove('hidden');

  // Set user info in sidebar
  const name = state.candidate?.name || state.user?.email || 'Student';
  const batch = state.candidate?.batch || 'NCLEX Candidate';
  $('#sidebar-user-name').textContent = name;
  $('#sidebar-user-batch').textContent = batch || 'NCLEX Candidate';
  $('#sidebar-avatar').textContent = name.charAt(0).toUpperCase();
  $('#topbar-user-name').textContent = name;

  LMS.navigateTo('dashboard');
}

function handleLogout() {
  if (state.timerInterval) clearInterval(state.timerInterval);
  auth.signOut();
  state.user = null;
  state.candidate = null;
  state.exam = null;

  $('#lms-shell').classList.add('hidden');
  $('#login-screen').style.display = '';
  $('#login-screen').classList.add('active');
  $('#login-email').value = '';
  $('#login-password').value = '';
  hideError($('#login-error'));
}

// =====================================================================
//  QUESTIONS
// =====================================================================
async function loadQuestions() {
  showLoading('Loading question bank...');
  const cached = localStorage.getItem('nca_questions_cache');
  const cacheTime = localStorage.getItem('nca_questions_cache_time');
  const ONE_HOUR = 60 * 60 * 1000;

  if (cached && cacheTime && (Date.now() - parseInt(cacheTime)) < ONE_HOUR) {
    try { state.questions = JSON.parse(cached); extractSubjects(); hideLoading(); return; }
    catch (e) { /* corrupt cache */ }
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
      try { state.questions = JSON.parse(cached); extractSubjects(); }
      catch (e) { alert('Failed to load questions.'); }
    } else { alert('Failed to load questions. Check your connection.'); }
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
  const sel = $('#setup-subject');
  sel.innerHTML = '<option value="All Subjects">All Subjects</option>';
  state.subjects.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s; opt.textContent = s; sel.appendChild(opt);
  });

  $$('.chip[data-count]').forEach(c => c.classList.remove('selected'));
  $('[data-count="75"]').classList.add('selected');
  state.examQuestionCount = 75;
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

function startExam() {
  state.examSubject = $('#setup-subject').value;
  const available = state.examSubject === 'All Subjects'
    ? state.questions.length
    : state.questions.filter(q => q.subject === state.examSubject).length;

  if (available < 10) {
    alert('Not enough questions available for this subject.');
    return;
  }

  state.exam = new CATEngine(state.questions, state.examQuestionCount, state.examSubject);
  state.examStartTime = Date.now();

  if (state.timerInterval) clearInterval(state.timerInterval);
  state.timerInterval = setInterval(updateTimer, 1000);

  generateWatermarks();
  LMS.navigateTo('quiz');
  nextQuestion();
}

// =====================================================================
//  QUIZ
// =====================================================================
function generateWatermarks() {
  const overlay = $('#watermark-overlay');
  overlay.innerHTML = '';
  const text = 'NEW CAREERS ACADEMY';
  for (let row = -2; row < 15; row++) {
    for (let col = -1; col < 8; col++) {
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
  const theta = state.exam.theta;
  const pct = Math.max(0, Math.min(100, ((theta + 4) / 8) * 100));
  $('#ability-marker').style.left = `${pct}%`;
  $('#ability-value').textContent = `${theta >= 0 ? '+' : ''}${theta.toFixed(2)} logits`;
}

function updateLiveStats() {
  const engine = state.exam;
  const total = engine.responses.length;
  const correct = engine.responses.filter(r => r.isCorrect).length;
  const incorrect = total - correct;
  $('#live-correct').textContent = correct;
  $('#live-incorrect').textContent = incorrect;
  $('#live-accuracy').textContent = total > 0 ? `${Math.round(correct / total * 100)}%` : '--';
  $('#live-difficulty').textContent = `${engine.currentDifficulty}/5`;
}

const DIFF_LABELS = { 1: 'Easy', 2: 'Below Avg', 3: 'Medium', 4: 'Above Avg', 5: 'Hard' };

function nextQuestion() {
  const engine = state.exam;
  if (engine.finished) { finishExam(); return; }

  const q = engine.selectNextQuestion();
  if (!q) { finishExam(); return; }

  const n = engine.responses.length + 1;
  const max = engine.maxQuestions;

  // Top bar
  $('#quiz-counter').textContent = `Q${n}/${max}`;
  $('#quiz-progress-bar').style.width = `${(n / max) * 100}%`;

  // Ability & stats
  updateAbilityMeter();
  updateLiveStats();

  // Question badges
  $('#question-num-badge').textContent = `Question ${n}`;
  const diffBadge = $('#question-diff-badge');
  diffBadge.textContent = DIFF_LABELS[q.difficulty] || 'Medium';
  diffBadge.className = `badge badge-diff-${q.difficulty}`;
  const catBadge = $('#question-cat-badge');
  catBadge.textContent = q.category || q.subject || '';
  catBadge.style.display = (q.category || q.subject) ? '' : 'none';

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
    btn.innerHTML = `<span class="option-letter">${letters[i]}</span><span class="option-text">${opt}</span>`;
    btn.addEventListener('click', () => selectOption(i));
    optionsContainer.appendChild(btn);
  });

  // Hide rationale, reset action button
  $('#rationale-panel').classList.add('hidden');
  const actionBtn = $('#quiz-action-btn');
  actionBtn.textContent = 'Submit Answer';
  actionBtn.disabled = true;
  actionBtn.onclick = submitCurrentAnswer;

  state._selectedOption = null;
  state._answered = false;

  // Scroll left pane to top
  const leftScroll = $('.quiz-left-scroll');
  if (leftScroll) leftScroll.scrollTop = 0;

  // Update question navigator
  renderQuestionNavigator();

  // Update bookmark button
  updateBookmarkBtn();
}

function selectOption(index) {
  if (state._answered) return;
  state._selectedOption = index;
  $$('.option-btn').forEach(btn => {
    btn.classList.toggle('selected', parseInt(btn.dataset.index) === index);
  });
  $('#quiz-action-btn').disabled = false;
}

function submitCurrentAnswer() {
  if (state._selectedOption === null || state._answered) return;
  state._answered = true;

  const engine = state.exam;
  const q = engine.currentQuestion;
  const selected = state._selectedOption;
  const response = engine.submitAnswer(selected);

  // Lock options, show correct/incorrect
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

  updateAbilityMeter();
  updateLiveStats();

  // Show rationale in right panel
  const rationalePanel = $('#rationale-panel');
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

  rationalePanel.classList.remove('hidden');

  // Scroll right panel to rationale
  const rightScroll = $('.quiz-right-scroll');
  if (rightScroll) {
    setTimeout(() => rationalePanel.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }

  // Update action button
  const actionBtn = $('#quiz-action-btn');
  if (engine.finished) {
    actionBtn.textContent = 'View Results';
    actionBtn.onclick = finishExam;
  } else {
    actionBtn.textContent = 'Next Question →';
    actionBtn.onclick = nextQuestion;
  }
  actionBtn.disabled = false;
}

function endExamEarly() {
  const engine = state.exam;
  if (!engine || engine.responses.length === 0) {
    if (confirm('No questions answered yet. Return to dashboard?')) {
      if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; }
      LMS.navigateTo('dashboard');
    }
    return;
  }
  if (!confirm('End the exam early? Results will be based on questions answered so far.')) return;
  engine.finished = true;
  engine.stopReason = 'Exam ended early by student';
  finishExam();
}

// =====================================================================
//  RESULTS
// =====================================================================
async function finishExam() {
  if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; }
  const results = state.exam.getResults();
  const elapsed = Math.floor((Date.now() - state.examStartTime) / 1000);
  const durationMinutes = Math.round(elapsed / 60 * 10) / 10;

  // Save to localStorage history
  saveExamToHistory(results, durationMinutes);

  // Save to Firestore
  try {
    await db.collection('exam_results').add({
      user_id: state.user?.uid || '', user_email: state.user?.email || '',
      user_name: state.candidate?.name || '', subject: state.examSubject,
      total_questions: results.totalQuestions, total_correct: results.totalCorrect,
      raw_accuracy: Math.round(results.rawAccuracy * 10000) / 10000,
      final_theta: Math.round(results.finalTheta * 1000) / 1000,
      final_se: Math.round(results.finalSE * 1000) / 1000,
      pass_probability: Math.round(results.passProbability * 10000) / 10000,
      passed: results.passed,
      avg_difficulty: Math.round(results.avgDifficulty * 100) / 100,
      exam_date: firebase.firestore.FieldValue.serverTimestamp(),
      duration_minutes: durationMinutes,
    });
  } catch (err) { console.error('Failed to save results:', err); }

  renderResults(results, durationMinutes);
  LMS.navigateTo('results');
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

  $('#r-stat-questions').textContent = results.totalQuestions;
  $('#r-stat-correct').textContent = results.totalCorrect;
  $('#r-stat-accuracy').textContent = `${(results.rawAccuracy * 100).toFixed(1)}%`;
  $('#r-stat-avg-diff').textContent = results.avgDifficulty.toFixed(1);

  renderThetaChart(results);
  renderDifficultyBars(results);
  renderQuestionReview(results);
}

function renderThetaChart(results) {
  const ctx = document.getElementById('theta-chart').getContext('2d');
  if (window._thetaChart) window._thetaChart.destroy();

  const labels = results.responses.map((_, i) => `Q${i + 1}`);
  const data = results.responses.map(r => Math.round(r.thetaAfter * 100) / 100);

  window._thetaChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Ability (θ)', data,
          borderColor: '#0056B3', backgroundColor: 'rgba(0, 86, 179, 0.08)',
          fill: true, tension: 0.3, pointRadius: 3, pointHoverRadius: 6, borderWidth: 2.5,
        },
        {
          label: 'Passing Standard',
          data: Array(labels.length).fill(0),
          borderColor: '#CC3030', borderDash: [6, 4], borderWidth: 1.5,
          pointRadius: 0, fill: false,
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'bottom', labels: { boxWidth: 14, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => ctx.dataset.label === 'Passing Standard' ? '' : `θ = ${ctx.parsed.y.toFixed(2)}`
          }
        }
      },
      scales: {
        y: { min: -3, max: 3, grid: { color: '#e8ecf0' }, ticks: { font: { size: 11 } }, title: { display: true, text: 'Ability (logits)', font: { size: 11 } } },
        x: { grid: { display: false }, ticks: { font: { size: 10 }, maxTicksLimit: 20 } }
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
      <div class="diff-bar-track"><div class="diff-bar-fill diff-${level}" style="width:${pct}%"></div></div>
      <span class="diff-bar-stat">${correct}/${total} (${pct}%)</span>
    `;
    container.appendChild(row);
  }
}

function renderQuestionReview(results) {
  const container = $('#question-review-list');
  container.innerHTML = '';
  const letters = ['A', 'B', 'C', 'D'];

  results.responses.forEach((r, i) => {
    const q = r.question;
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

// =====================================================================
//  KEYBOARD SHORTCUTS (Quiz)
// =====================================================================
document.addEventListener('keydown', (e) => {
  if (state.currentPage !== 'quiz' || !state.exam) return;

  // 1-4 to select option
  if (!state._answered && e.key >= '1' && e.key <= '4') {
    const idx = parseInt(e.key) - 1;
    const options = $$('.option-btn');
    if (idx < options.length) {
      e.preventDefault();
      selectOption(idx);
    }
  }

  // A-D to select option
  if (!state._answered) {
    const letterMap = { a: 0, b: 1, c: 2, d: 3 };
    const idx = letterMap[e.key.toLowerCase()];
    if (idx !== undefined) {
      const options = $$('.option-btn');
      if (idx < options.length) {
        e.preventDefault();
        selectOption(idx);
      }
    }
  }

  // Enter to submit or next
  if (e.key === 'Enter') {
    e.preventDefault();
    const actionBtn = $('#quiz-action-btn');
    if (!actionBtn.disabled) actionBtn.click();
  }
});

// =====================================================================
//  INITIALIZATION
// =====================================================================
document.addEventListener('DOMContentLoaded', () => {
  // Apply saved theme immediately
  applyTheme(localStorage.getItem('nca_theme') || 'light');

  initFirebase();

  // Login
  $('#login-btn').addEventListener('click', handleLogin);
  $('#login-password').addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });

  // Sidebar nav
  $$('.nav-item[data-page]').forEach(item => {
    item.addEventListener('click', () => {
      const page = item.dataset.page;
      if (page === 'quiz' && !state.exam) return;
      LMS.navigateTo(page);
    });
  });

  // Sidebar mobile toggle
  $('#hamburger-btn').addEventListener('click', () => {
    $('#sidebar').classList.toggle('open');
    $('#sidebar-overlay').classList.toggle('open');
  });
  $('#sidebar-overlay').addEventListener('click', () => {
    $('#sidebar').classList.remove('open');
    $('#sidebar-overlay').classList.remove('open');
  });

  // Logout
  $('#sidebar-logout-btn').addEventListener('click', handleLogout);

  // Setup chips
  $$('.chip[data-count]').forEach(chip => {
    chip.addEventListener('click', () => handleChipSelect(chip));
  });
  $('#custom-slider').addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    state.examQuestionCount = val;
    $('#custom-slider-val').textContent = `${val} Questions`;
  });

  // Start exam
  $('#start-exam-btn').addEventListener('click', startExam);

  // End exam
  $('#end-exam-btn').addEventListener('click', endExamEarly);

  // Firebase auth state
  auth.onAuthStateChanged(async (user) => {
    if (user && !state.user) {
      try {
        const snap = await db.collection('approved_candidates')
          .where('email', '==', user.email.toLowerCase())
          .where('approved', '==', true).get();

        if (!snap.empty) {
          state.user = user;
          state.candidate = snap.docs[0].data();
          await loadQuestions();
          enterLMS();
          return;
        }
      } catch (e) { /* fall through to login */ }
    }
    if (!state.user) {
      $('#login-screen').style.display = '';
      $('#login-screen').classList.add('active');
    }
  });
});

// =====================================================================
//  QUESTION NAVIGATOR (quiz breadcrumb strip)
// =====================================================================
function renderQuestionNavigator() {
  const engine = state.exam;
  if (!engine) return;

  const nav = $('#q-navigator');
  const total = engine.maxQuestions;
  const answered = engine.responses.length;
  const currentIdx = answered; // 0-indexed current question

  let html = '';
  for (let i = 0; i < Math.min(total, answered + 1); i++) {
    let cls = 'q-nav-dot';
    let label = i + 1;

    if (i < answered) {
      const r = engine.responses[i];
      cls += r.isCorrect ? ' correct' : ' incorrect';
      label = r.isCorrect ? '✓' : '✗';
      if (Bookmarks.has(r.question.id)) cls += ' bookmarked';
    } else if (i === currentIdx) {
      cls += ' current';
    }

    html += `<div class="${cls}" title="Question ${i + 1}">${label}</div>`;
  }

  // Show remaining as empty dots (up to a reasonable limit)
  const remaining = Math.min(total - answered - 1, 20);
  for (let i = 0; i < remaining; i++) {
    html += `<div class="q-nav-dot" title="Question ${answered + 2 + i}">${answered + 2 + i}</div>`;
  }
  if (total - answered - 1 > 20) {
    html += `<div class="q-nav-dot" style="border:none;background:none;">...</div>`;
  }

  nav.innerHTML = html;
}

// =====================================================================
//  BOOKMARKS
// =====================================================================
const Bookmarks = {
  _key: 'nca_bookmarks',

  getAll() {
    try { return JSON.parse(localStorage.getItem(this._key) || '{}'); }
    catch { return {}; }
  },

  has(questionId) {
    return !!this.getAll()[questionId];
  },

  toggle(questionId, questionData) {
    const all = this.getAll();
    if (all[questionId]) {
      delete all[questionId];
    } else {
      all[questionId] = {
        id: questionId,
        question: questionData.question,
        subject: questionData.subject,
        category: questionData.category,
        difficulty: questionData.difficulty,
        options: questionData.options,
        answer: questionData.answer,
        rationale_correct: questionData.rationale_correct,
        rationale_wrong: questionData.rationale_wrong,
        bookmarkedAt: new Date().toISOString(),
      };
    }
    try { localStorage.setItem(this._key, JSON.stringify(all)); } catch {}
    return !!all[questionId];
  },

  clearAll() {
    if (!confirm('Remove all bookmarked questions?')) return;
    localStorage.removeItem(this._key);
    this.refresh();
  },

  refresh() {
    const all = this.getAll();
    const entries = Object.values(all).sort((a, b) =>
      new Date(b.bookmarkedAt) - new Date(a.bookmarkedAt)
    );

    const container = $('#bookmarks-list');
    const clearBtn = $('#clear-bookmarks-btn');

    if (entries.length === 0) {
      container.innerHTML = `<div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>
        <p>No bookmarked questions yet. Use the bookmark icon during exams or study mode.</p>
      </div>`;
      clearBtn.style.display = 'none';
      return;
    }

    clearBtn.style.display = '';
    const letters = ['A', 'B', 'C', 'D'];

    container.innerHTML = entries.map((q, i) => {
      const optionsHtml = q.options.map((opt, idx) => {
        return `<div class="study-option" data-qid="${q.id}" data-idx="${idx}">
          <span class="study-option-letter">${letters[idx]}</span>
          <span>${opt}</span>
        </div>`;
      }).join('');

      const wrongRationales = q.rationale_wrong && typeof q.rationale_wrong === 'object'
        ? Object.values(q.rationale_wrong).filter(v => v).map(t => `<div class="rationale-box wrong-rationale">${t}</div>`).join('')
        : '';

      return `<div class="study-question-card" id="bm-${q.id}">
        <div class="study-question-header" onclick="this.parentElement.classList.toggle('expanded')">
          <div class="study-q-num diff-${q.difficulty}">${DIFF_LABELS[q.difficulty] ? DIFF_LABELS[q.difficulty].charAt(0) : 'M'}</div>
          <div class="study-q-info">
            <div class="study-q-title">${q.question}</div>
            <div class="study-q-meta">${q.subject || ''} · ${q.category || ''} · Difficulty ${q.difficulty}/5</div>
          </div>
          <button class="study-q-bookmark active" onclick="event.stopPropagation(); Bookmarks.toggle('${q.id}', ${JSON.stringify(q).replace(/'/g, "\\'")}); document.getElementById('bm-${q.id}').remove(); if(!Object.keys(Bookmarks.getAll()).length) Bookmarks.refresh();">
            <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>
          </button>
          <svg class="study-q-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
        </div>
        <div class="study-question-body">
          <div class="study-q-text">${q.question}</div>
          ${optionsHtml}
          <button class="study-reveal-btn" onclick="StudyMode.revealAnswer(this, '${q.id}', ${q.answer})">Show Answer & Rationale</button>
          <div class="study-rationale-block" id="rationale-bm-${q.id}">
            <div class="rationale-box correct-rationale">${q.rationale_correct || 'No rationale provided.'}</div>
            ${wrongRationales}
          </div>
        </div>
      </div>`;
    }).join('');
  },
};

function toggleBookmark() {
  const engine = state.exam;
  if (!engine || !engine.currentQuestion) return;
  const q = engine.currentQuestion;
  const isNow = Bookmarks.toggle(q.id, q);
  updateBookmarkBtn();
  renderQuestionNavigator();
}

function updateBookmarkBtn() {
  const engine = state.exam;
  if (!engine || !engine.currentQuestion) return;
  const btn = $('#bookmark-btn');
  if (Bookmarks.has(engine.currentQuestion.id)) {
    btn.classList.add('active');
  } else {
    btn.classList.remove('active');
  }
}

// =====================================================================
//  STUDY MODE
// =====================================================================
const StudyMode = {
  init() {
    const sel = $('#study-subject-filter');
    const currentVal = sel.value;
    sel.innerHTML = '<option value="All">All Subjects</option>';
    state.subjects.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s; opt.textContent = s; sel.appendChild(opt);
    });
    if (currentVal && [...sel.options].some(o => o.value === currentVal)) {
      sel.value = currentVal;
    }
  },

  loadQuestions() {
    const subject = $('#study-subject-filter').value;
    const diff = $('#study-diff-filter').value;

    let filtered = [...state.questions];
    if (subject !== 'All') {
      filtered = filtered.filter(q => q.subject === subject);
    }
    if (diff !== 'All') {
      filtered = filtered.filter(q => q.difficulty === parseInt(diff));
    }

    // Shuffle and limit to 50 for performance
    filtered = this.shuffle(filtered).slice(0, 50);

    const countEl = $('#study-count');
    countEl.textContent = `Showing ${filtered.length} question${filtered.length !== 1 ? 's' : ''} (max 50)`;

    const container = $('#study-questions-list');
    if (filtered.length === 0) {
      container.innerHTML = `<div class="empty-state"><p>No questions match your filters.</p></div>`;
      return;
    }

    const letters = ['A', 'B', 'C', 'D'];

    container.innerHTML = filtered.map((q, i) => {
      const isBookmarked = Bookmarks.has(q.id);
      const optionsHtml = q.options.map((opt, idx) => {
        return `<div class="study-option" data-qid="${q.id}" data-idx="${idx}">
          <span class="study-option-letter">${letters[idx]}</span>
          <span>${opt}</span>
        </div>`;
      }).join('');

      const wrongRationales = q.rationale_wrong && typeof q.rationale_wrong === 'object'
        ? Object.values(q.rationale_wrong).filter(v => v).map(t => `<div class="rationale-box wrong-rationale">${t}</div>`).join('')
        : '';

      const qJson = JSON.stringify(q).replace(/</g, '\\u003c').replace(/'/g, "\\'");

      return `<div class="study-question-card" id="study-${q.id}">
        <div class="study-question-header" onclick="this.parentElement.classList.toggle('expanded')">
          <div class="study-q-num diff-${q.difficulty}">${i + 1}</div>
          <div class="study-q-info">
            <div class="study-q-title">${q.question}</div>
            <div class="study-q-meta">${q.subject || ''} · ${q.category || ''} · ${DIFF_LABELS[q.difficulty] || 'Medium'}</div>
          </div>
          <button class="study-q-bookmark ${isBookmarked ? 'active' : ''}" onclick="event.stopPropagation(); StudyMode.toggleBookmark('${q.id}', this);">
            <svg viewBox="0 0 24 24" fill="${isBookmarked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>
          </button>
          <svg class="study-q-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
        </div>
        <div class="study-question-body">
          <div class="study-q-text">${q.question}</div>
          ${optionsHtml}
          <button class="study-reveal-btn" onclick="StudyMode.revealAnswer(this, '${q.id}', ${q.answer})">Show Answer & Rationale</button>
          <div class="study-rationale-block" id="rationale-study-${q.id}">
            <div class="rationale-box correct-rationale">${q.rationale_correct || 'No rationale provided.'}</div>
            ${wrongRationales}
          </div>
          ${renderNoteWidget(q.id)}
        </div>
      </div>`;
    }).join('');
  },

  toggleBookmark(questionId, btnEl) {
    const q = state.questions.find(q => q.id === questionId);
    if (!q) return;
    const isNow = Bookmarks.toggle(questionId, q);
    btnEl.classList.toggle('active', isNow);
    const svg = btnEl.querySelector('svg');
    svg.setAttribute('fill', isNow ? 'currentColor' : 'none');
  },

  revealAnswer(btn, questionId, correctIdx) {
    const card = btn.closest('.study-question-card');
    const options = card.querySelectorAll('.study-option');
    options.forEach(opt => {
      const idx = parseInt(opt.dataset.idx);
      if (idx === correctIdx) {
        opt.classList.add('revealed-correct');
      } else {
        opt.classList.add('revealed-wrong');
      }
    });

    btn.style.display = 'none';

    // Show rationale block
    const rationaleId = `rationale-study-${questionId}`;
    let rationaleBlock = document.getElementById(rationaleId);
    if (!rationaleBlock) {
      rationaleBlock = document.getElementById(`rationale-bm-${questionId}`);
    }
    if (rationaleBlock) rationaleBlock.classList.add('visible');
  },

  search(query) {
    const cards = $$('#study-questions-list .study-question-card');
    const term = query.toLowerCase().trim();
    let visible = 0;
    cards.forEach(card => {
      const text = card.textContent.toLowerCase();
      const match = !term || text.includes(term);
      card.style.display = match ? '' : 'none';
      if (match) visible++;
    });
    const countEl = $('#study-count');
    if (term) {
      countEl.textContent = `${visible} question${visible !== 1 ? 's' : ''} matching "${query.trim()}"`;
    }
  },

  shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  },
};

// =====================================================================
//  NOTES (localStorage)
// =====================================================================
const Notes = {
  getAll() {
    try { return JSON.parse(localStorage.getItem('nca_notes') || '{}'); } catch { return {}; }
  },
  get(qId) { return this.getAll()[qId] || ''; },
  save(qId, text) {
    const all = this.getAll();
    if (text.trim()) { all[qId] = text.trim(); } else { delete all[qId]; }
    try { localStorage.setItem('nca_notes', JSON.stringify(all)); } catch {}
  },
  count() { return Object.keys(this.getAll()).length; },
};

function renderNoteWidget(questionId) {
  const existing = Notes.get(questionId);
  return `<div class="note-widget">
    <button class="note-toggle-btn" onclick="toggleNote(this, '${questionId}')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      ${existing ? 'Edit Note' : 'Add Note'}
    </button>
    <div class="note-editor" id="note-editor-${questionId}" style="display:none;">
      <textarea class="note-textarea" id="note-text-${questionId}" placeholder="Add your personal notes here...">${existing}</textarea>
      <div class="note-actions">
        <button class="btn btn-ghost btn-sm" onclick="toggleNote(document.querySelector('#note-editor-${questionId}').previousElementSibling, '${questionId}')">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="saveNote('${questionId}')">Save Note</button>
      </div>
    </div>
    ${existing ? `<div class="note-display" id="note-display-${questionId}"><strong>Note:</strong> ${existing}</div>` : ''}
  </div>`;
}

function toggleNote(btn, qId) {
  const editor = document.getElementById('note-editor-' + qId);
  editor.style.display = editor.style.display === 'none' ? '' : 'none';
}

function saveNote(qId) {
  const text = document.getElementById('note-text-' + qId).value;
  Notes.save(qId, text);
  const editor = document.getElementById('note-editor-' + qId);
  editor.style.display = 'none';
  const display = document.getElementById('note-display-' + qId);
  if (display) {
    display.innerHTML = text.trim() ? `<strong>Note:</strong> ${text.trim()}` : '';
    display.style.display = text.trim() ? '' : 'none';
  } else if (text.trim()) {
    const widget = editor.closest('.note-widget');
    const div = document.createElement('div');
    div.className = 'note-display';
    div.id = 'note-display-' + qId;
    div.innerHTML = `<strong>Note:</strong> ${text.trim()}`;
    widget.appendChild(div);
  }
  const toggleBtn = editor.previousElementSibling;
  if (toggleBtn && toggleBtn.classList.contains('note-toggle-btn')) {
    toggleBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> ${text.trim() ? 'Edit Note' : 'Add Note'}`;
  }
}

// =====================================================================
//  REVIEW MISTAKES
// =====================================================================
const ReviewMistakes = {
  refresh() {
    const history = getExamHistory();
    const catFilter = $('#review-cat-filter').value;
    const sortBy = $('#review-sort').value;

    const mistakeMap = {};
    const categories = new Set();

    history.forEach(h => {
      if (!h.responses) return;
      h.responses.forEach(r => {
        if (r.isCorrect) return;
        const qId = r.question?.category + '_' + (r.question?.subject || '');
        const cat = r.question?.category || r.question?.subject || 'General';
        categories.add(cat);

        const q = state.questions.find(sq =>
          sq.category === r.question?.category && sq.subject === r.question?.subject
        );
        if (!q) return;

        if (!mistakeMap[q.id]) {
          mistakeMap[q.id] = { question: q, missCount: 0, lastMissed: h.date, difficulty: q.difficulty };
        }
        mistakeMap[q.id].missCount++;
        if (h.date > mistakeMap[q.id].lastMissed) mistakeMap[q.id].lastMissed = h.date;
      });
    });

    // Also add questions directly from history responses that match state.questions
    history.forEach(h => {
      if (!h.responses) return;
      h.responses.forEach(r => {
        if (r.isCorrect) return;
        state.questions.forEach(q => {
          if (q.subject === r.question?.subject && q.category === r.question?.category && q.difficulty === r.difficulty) {
            if (!mistakeMap[q.id]) {
              mistakeMap[q.id] = { question: q, missCount: 0, lastMissed: h.date, difficulty: q.difficulty };
              const cat = q.category || q.subject || 'General';
              categories.add(cat);
            }
          }
        });
      });
    });

    // Populate category filter
    const catSel = $('#review-cat-filter');
    const currentCat = catSel.value;
    catSel.innerHTML = '<option value="All">All Categories</option>';
    [...categories].sort().forEach(c => {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c; catSel.appendChild(opt);
    });
    if ([...catSel.options].some(o => o.value === currentCat)) catSel.value = currentCat;

    let entries = Object.values(mistakeMap);

    if (catFilter !== 'All') {
      entries = entries.filter(e => (e.question.category || e.question.subject) === catFilter);
    }

    if (sortBy === 'frequency') entries.sort((a, b) => b.missCount - a.missCount);
    else if (sortBy === 'difficulty') entries.sort((a, b) => b.difficulty - a.difficulty);
    else entries.sort((a, b) => new Date(b.lastMissed) - new Date(a.lastMissed));

    entries = entries.slice(0, 50);

    const badge = $('#review-stats-badge');
    badge.textContent = `${Object.keys(mistakeMap).length} unique mistakes`;

    const countEl = $('#review-count');
    countEl.textContent = `Showing ${entries.length} question${entries.length !== 1 ? 's' : ''}`;

    const container = $('#review-questions-list');
    if (entries.length === 0) {
      container.innerHTML = `<div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <p>No mistakes found. Keep up the great work!</p>
      </div>`;
      return;
    }

    const letters = ['A', 'B', 'C', 'D'];
    const DIFF_LABELS = { 1: 'Easy', 2: 'Below Avg', 3: 'Medium', 4: 'Above Avg', 5: 'Hard' };

    container.innerHTML = entries.map((e, i) => {
      const q = e.question;
      const optionsHtml = q.options.map((opt, idx) =>
        `<div class="study-option" data-qid="${q.id}" data-idx="${idx}">
          <span class="study-option-letter">${letters[idx]}</span>
          <span>${opt}</span>
        </div>`
      ).join('');

      const wrongRationales = q.rationale_wrong && typeof q.rationale_wrong === 'object'
        ? Object.values(q.rationale_wrong).filter(v => v).map(t => `<div class="rationale-box wrong-rationale">${t}</div>`).join('')
        : '';

      return `<div class="study-question-card" id="review-${q.id}">
        <div class="study-question-header" onclick="this.parentElement.classList.toggle('expanded')">
          <div class="study-q-num diff-${q.difficulty}">${i + 1}</div>
          <div class="study-q-info">
            <div class="study-q-title">${q.question}</div>
            <div class="study-q-meta">
              ${q.subject || ''} · ${q.category || ''} · ${DIFF_LABELS[q.difficulty] || 'Medium'}
              <span class="review-miss-badge">Missed ${e.missCount}x</span>
            </div>
          </div>
          <svg class="study-q-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
        </div>
        <div class="study-question-body">
          <div class="study-q-text">${q.question}</div>
          ${optionsHtml}
          <button class="study-reveal-btn" onclick="StudyMode.revealAnswer(this, '${q.id}', ${q.answer})">Show Answer & Rationale</button>
          <div class="study-rationale-block" id="rationale-review-${q.id}">
            <div class="rationale-box correct-rationale">${q.rationale_correct || 'No rationale provided.'}</div>
            ${wrongRationales}
          </div>
          ${renderNoteWidget(q.id)}
        </div>
      </div>`;
    }).join('');
  },
};

// =====================================================================
//  PRINT REPORT
// =====================================================================
function printReport() {
  const resultsPage = $('#page-results');
  if (!resultsPage) return;

  const printWin = window.open('', '_blank');
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  printWin.document.write(`<!DOCTYPE html><html><head><title>Exam Report — NCA NCLEX-RN</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; color: #1a1a1a; }
    .report-header { text-align: center; border-bottom: 2px solid #0056B3; padding-bottom: 16px; margin-bottom: 24px; }
    .report-header h1 { color: #0056B3; font-size: 1.4rem; margin: 0 0 4px; }
    .report-header p { color: #666; font-size: .85rem; margin: 0; }
    .verdict { text-align: center; font-size: 1.5rem; font-weight: 700; margin: 16px 0; }
    .verdict.pass { color: #28A060; }
    .verdict.fail { color: #CC3030; }
    .stats-row { display: flex; gap: 16px; margin-bottom: 20px; }
    .stat-box { flex: 1; background: #f5f8fc; border-radius: 8px; padding: 12px; text-align: center; }
    .stat-box .val { font-size: 1.3rem; font-weight: 700; }
    .stat-box .lbl { font-size: .75rem; color: #666; }
    .meta-info { background: #f9fafb; border-radius: 8px; padding: 12px 16px; font-size: .85rem; margin-bottom: 20px; line-height: 1.8; }
    .review-item { border: 1px solid #e8ecf0; border-radius: 8px; padding: 12px; margin-bottom: 10px; page-break-inside: avoid; }
    .review-q { font-weight: 600; margin-bottom: 6px; }
    .review-opt { padding: 3px 8px; margin: 2px 0; font-size: .85rem; border-radius: 4px; }
    .review-opt.correct { background: #e6f7ef; color: #1a7a45; }
    .review-opt.wrong { background: #fce8e8; color: #a82020; }
    .review-opt.neutral { color: #555; }
    h3 { color: #0056B3; border-bottom: 1px solid #e8ecf0; padding-bottom: 6px; margin-top: 24px; }
    @media print { body { padding: 0; } .stats-row { gap: 8px; } }
  </style></head><body>`);

  const verdict = $('#results-verdict');
  const meta = $('#results-meta');
  const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const candidateName = state.candidate?.name || state.user?.email || 'Student';

  printWin.document.write(`
    <div class="report-header">
      <h1>NCA NCLEX-RN — Exam Report</h1>
      <p>Dhaliwal's New Careers Academy · ${now}</p>
      <p>Candidate: ${candidateName}</p>
    </div>
    <div class="verdict ${verdict.classList.contains('pass') ? 'pass' : 'fail'}">${verdict.textContent}</div>
    <div class="stats-row">
      <div class="stat-box"><div class="val">${$('#r-stat-questions').textContent}</div><div class="lbl">Questions</div></div>
      <div class="stat-box"><div class="val">${$('#r-stat-correct').textContent}</div><div class="lbl">Correct</div></div>
      <div class="stat-box"><div class="val">${$('#r-stat-accuracy').textContent}</div><div class="lbl">Accuracy</div></div>
      <div class="stat-box"><div class="val">${$('#r-stat-avg-diff').textContent}</div><div class="lbl">Avg Difficulty</div></div>
    </div>
    <div class="meta-info">${meta.innerHTML}</div>
  `);

  // Add question review
  const reviewItems = $$('#question-review-list .review-item');
  if (reviewItems.length > 0) {
    printWin.document.write('<h3>Question Review</h3>');
    reviewItems.forEach(item => {
      const qText = item.querySelector('.review-q-text')?.textContent || '';
      const options = item.querySelectorAll('.review-option');
      let optHtml = '';
      options.forEach(opt => {
        let cls = 'neutral';
        if (opt.classList.contains('is-correct')) cls = 'correct';
        else if (opt.classList.contains('is-selected-wrong')) cls = 'wrong';
        optHtml += `<div class="review-opt ${cls}">${opt.textContent}</div>`;
      });
      printWin.document.write(`<div class="review-item"><div class="review-q">${qText}</div>${optHtml}</div>`);
    });
  }

  printWin.document.write(`<div style="text-align:center; margin-top:30px; color:#999; font-size:.75rem;">&copy; 2026 New Careers Academy</div></body></html>`);
  printWin.document.close();
  setTimeout(() => printWin.print(), 500);
}

// =====================================================================
//  HISTORY DETAIL TOGGLE
// =====================================================================
function toggleHistoryDetail(idx) {
  const el = document.getElementById('hist-detail-' + idx);
  if (!el) return;
  const wrap = el.closest('.history-item-wrap');
  wrap.classList.toggle('expanded');
}

// =====================================================================
//  ANALYTICS
// =====================================================================
const Analytics = {
  refresh() {
    const history = getExamHistory();

    // Summary stats
    let totalQ = 0, totalTime = 0;
    history.forEach(h => {
      totalQ += h.totalQuestions;
      totalTime += h.durationMinutes || 0;
    });
    $('#ana-total-questions').textContent = totalQ;
    const hrs = Math.floor(totalTime / 60);
    const mins = Math.round(totalTime % 60);
    $('#ana-total-time').textContent = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;

    // Streak calculation
    const streak = this.calcStreak(history);
    $('#ana-streak').textContent = streak;

    // Improvement (first vs last theta)
    if (history.length >= 2) {
      const first = history[0].finalTheta;
      const last = history[history.length - 1].finalTheta;
      const diff = last - first;
      const sign = diff >= 0 ? '+' : '';
      $('#ana-improvement').textContent = `${sign}${diff.toFixed(2)}`;
      $('#ana-improvement').style.color = diff >= 0 ? 'var(--nca-green)' : 'var(--nca-red)';
    } else {
      $('#ana-improvement').textContent = '--';
      $('#ana-improvement').style.color = '';
    }

    this.renderAccuracyChart(history);
    this.renderDifficultyChart(history);
    this.renderCategoryTable(history);
    this.renderActivityGrid(history);
  },

  calcStreak(history) {
    if (history.length === 0) return 0;
    const days = new Set();
    history.forEach(h => {
      days.add(new Date(h.date).toISOString().slice(0, 10));
    });
    const sorted = [...days].sort().reverse();
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (sorted[0] !== today && sorted[0] !== yesterday) return 0;
    let streak = 1;
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1]);
      const curr = new Date(sorted[i]);
      const diffDays = (prev - curr) / 86400000;
      if (diffDays === 1) streak++;
      else break;
    }
    return streak;
  },

  renderAccuracyChart(history) {
    if (history.length < 2) {
      $('#ana-accuracy-empty').style.display = '';
      $('#ana-accuracy-chart-wrap').style.display = 'none';
      return;
    }
    $('#ana-accuracy-empty').style.display = 'none';
    $('#ana-accuracy-chart-wrap').style.display = 'block';

    const ctx = document.getElementById('ana-accuracy-chart').getContext('2d');
    if (window._anaAccChart) window._anaAccChart.destroy();

    const labels = history.map(h => new Date(h.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    const accData = history.map(h => Math.round(h.rawAccuracy * 100));
    const thetaData = history.map(h => Math.round(h.finalTheta * 100) / 100);

    window._anaAccChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Accuracy %', data: accData, yAxisID: 'y',
            borderColor: '#28A060', backgroundColor: 'rgba(40,160,96,.1)',
            fill: true, tension: 0.3, pointRadius: 5, pointHoverRadius: 8, borderWidth: 2.5,
          },
          {
            label: 'Ability (θ)', data: thetaData, yAxisID: 'y1',
            borderColor: '#0056B3', backgroundColor: 'transparent',
            fill: false, tension: 0.3, pointRadius: 4, borderWidth: 2, borderDash: [5, 5],
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
        scales: {
          y: { min: 0, max: 100, position: 'left', grid: { color: '#e8ecf0' }, ticks: { font: { size: 10 }, callback: v => v + '%' }, title: { display: true, text: 'Accuracy', font: { size: 10 } } },
          y1: { min: -3, max: 3, position: 'right', grid: { display: false }, ticks: { font: { size: 10 } }, title: { display: true, text: 'Ability (θ)', font: { size: 10 } } },
          x: { grid: { display: false }, ticks: { font: { size: 10 } } }
        }
      }
    });
  },

  renderDifficultyChart(history) {
    const allResponses = [];
    history.forEach(h => { if (h.responses) allResponses.push(...h.responses); });
    if (allResponses.length === 0) {
      $('#ana-difficulty-empty').style.display = '';
      $('#ana-difficulty-chart-wrap').style.display = 'none';
      return;
    }
    $('#ana-difficulty-empty').style.display = 'none';
    $('#ana-difficulty-chart-wrap').style.display = 'block';

    const diffMap = { 1: { t: 0, c: 0 }, 2: { t: 0, c: 0 }, 3: { t: 0, c: 0 }, 4: { t: 0, c: 0 }, 5: { t: 0, c: 0 } };
    allResponses.forEach(r => {
      const d = r.difficulty || 3;
      if (diffMap[d]) { diffMap[d].t++; if (r.isCorrect) diffMap[d].c++; }
    });

    const ctx = document.getElementById('ana-difficulty-chart').getContext('2d');
    if (window._anaDiffChart) window._anaDiffChart.destroy();

    const labels = ['Easy', 'Med-Easy', 'Medium', 'Med-Hard', 'Hard'];
    const totals = [1,2,3,4,5].map(d => diffMap[d].t);
    const corrects = [1,2,3,4,5].map(d => diffMap[d].c);
    const incorrects = [1,2,3,4,5].map(d => diffMap[d].t - diffMap[d].c);

    window._anaDiffChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Correct', data: corrects, backgroundColor: 'rgba(40,160,96,.7)', borderRadius: 4 },
          { label: 'Incorrect', data: incorrects, backgroundColor: 'rgba(204,48,48,.5)', borderRadius: 4 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { stacked: true, beginAtZero: true, grid: { color: '#e8ecf0' }, ticks: { font: { size: 10 } } }
        }
      }
    });
  },

  renderCategoryTable(history) {
    const allResponses = [];
    history.forEach(h => { if (h.responses) allResponses.push(...h.responses); });
    if (allResponses.length === 0) {
      $('#ana-category-empty').style.display = '';
      $('#ana-category-table-wrap').style.display = 'none';
      return;
    }
    $('#ana-category-empty').style.display = 'none';
    $('#ana-category-table-wrap').style.display = '';

    const catMap = {};
    history.forEach(h => {
      if (!h.responses) return;
      h.responses.forEach(r => {
        const cat = r.question?.category || r.question?.subject || 'General';
        if (!catMap[cat]) catMap[cat] = { total: 0, correct: 0, recent: [] };
        catMap[cat].total++;
        if (r.isCorrect) catMap[cat].correct++;
        catMap[cat].recent.push(r.isCorrect ? 1 : 0);
      });
    });

    const rows = Object.entries(catMap).sort((a, b) => b[1].total - a[1].total);
    const tbody = $('#ana-category-tbody');
    tbody.innerHTML = rows.map(([cat, d]) => {
      const pct = Math.round(d.correct / d.total * 100);
      const cls = pct >= 70 ? 'high' : pct >= 50 ? 'mid' : 'low';
      const last5 = d.recent.slice(-5);
      const trendDots = last5.map(v => `<span class="ana-dot ${v ? 'correct' : 'wrong'}"></span>`).join('');
      return `<tr>
        <td>${cat}</td>
        <td>${d.total}</td>
        <td>${d.correct}</td>
        <td><span class="hist-pct ${cls}">${pct}%</span></td>
        <td><div class="ana-trend-dots">${trendDots}</div></td>
      </tr>`;
    }).join('');
  },

  renderActivityGrid(history) {
    if (history.length === 0) {
      $('#ana-activity-empty').style.display = '';
      $('#ana-activity-wrap').style.display = 'none';
      return;
    }
    $('#ana-activity-empty').style.display = 'none';
    $('#ana-activity-wrap').style.display = '';

    const dayMap = {};
    history.forEach(h => {
      const day = new Date(h.date).toISOString().slice(0, 10);
      dayMap[day] = (dayMap[day] || 0) + h.totalQuestions;
    });

    const grid = $('#ana-activity-grid');
    const today = new Date();
    const cells = [];
    for (let i = 89; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const count = dayMap[key] || 0;
      let level = 0;
      if (count > 0) level = 1;
      if (count >= 10) level = 2;
      if (count >= 30) level = 3;
      if (count >= 60) level = 4;
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      cells.push(`<div class="ana-cell l${level}" title="${label}: ${count} questions"></div>`);
    }
    grid.innerHTML = cells.join('');
  },
};

// =====================================================================
//  PROGRESS TRACKING (localStorage)
// =====================================================================
function getStudyStreak() {
  const history = getExamHistory();
  if (history.length === 0) return { streak: 0, totalDays: 0 };
  const days = new Set();
  history.forEach(h => days.add(new Date(h.date).toISOString().slice(0, 10)));
  const sorted = [...days].sort().reverse();
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  let streak = 0;
  if (sorted[0] === today || sorted[0] === yesterday) {
    streak = 1;
    for (let i = 1; i < sorted.length; i++) {
      const diff = (new Date(sorted[i - 1]) - new Date(sorted[i])) / 86400000;
      if (diff === 1) streak++;
      else break;
    }
  }
  return { streak, totalDays: days.size };
}

const Settings = {
  refresh() {
    $('#settings-name').textContent = state.candidate?.name || 'Student';
    $('#settings-email').textContent = state.user?.email || '--';
    $('#settings-batch').textContent = state.candidate?.batch || 'NCLEX Candidate';

    const historyCount = getExamHistory().length;
    $('#settings-history-count').textContent = `${historyCount} exam record${historyCount !== 1 ? 's' : ''} stored locally`;

    const bookmarkCount = Object.keys(Bookmarks.getAll()).length;
    $('#settings-bookmarks-count').textContent = `${bookmarkCount} bookmarked question${bookmarkCount !== 1 ? 's' : ''}`;

    const notesCount = Notes.count();
    $('#settings-notes-count').textContent = `${notesCount} note${notesCount !== 1 ? 's' : ''} saved`;

    const current = localStorage.getItem('nca_theme') || 'light';
    $$('.theme-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === current);
    });
  },

  setTheme(theme) {
    localStorage.setItem('nca_theme', theme);
    applyTheme(theme);
    $$('.theme-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === theme);
    });
  },

  clearHistory() {
    if (!confirm('Delete all exam history? This cannot be undone.')) return;
    localStorage.removeItem('nca_exam_history');
    this.refresh();
  },

  clearBookmarks() {
    if (!confirm('Remove all bookmarked questions?')) return;
    localStorage.removeItem('nca_bookmarks');
    this.refresh();
  },

  clearNotes() {
    if (!confirm('Delete all personal notes?')) return;
    localStorage.removeItem('nca_notes');
    this.refresh();
  },

  clearCache() {
    localStorage.removeItem('nca_questions_cache');
    localStorage.removeItem('nca_questions_cache_time');
    alert('Question cache cleared. Questions will reload from server on next use.');
  },
};

function applyTheme(theme) {
  if (theme === 'auto') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (localStorage.getItem('nca_theme') === 'auto') applyTheme('auto');
});
