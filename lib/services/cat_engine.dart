import 'dart:math';
import '../models/question.dart';

/// ─────────────────────────────────────────────────────────
/// CAT ENGINE — Item Response Theory (1PL Rasch Model)
///
/// Adaptive algorithm that adjusts question difficulty
/// based on student performance, calculates ability (theta)
/// using Maximum Likelihood Estimation, and determines
/// pass/fail with 95% confidence.
/// ─────────────────────────────────────────────────────────
class CATEngine {
  final int totalQuestions;
  final double passingStandard;
  final double seThreshold;
  final int minQuestions;

  // Current state
  double theta = 0.0; // ability estimate (logits)
  double se = 3.0; // standard error
  int _currentDifficulty = 3; // start at medium

  // History
  final List<_Response> _responses = [];
  final List<double> thetaHistory = [0.0];
  final List<double> seHistory = [3.0];
  final List<int> difficultyHistory = [];
  final Set<String> _usedIds = {};

  int get totalAnswered => _responses.length;
  int get totalCorrect => _responses.where((r) => r.correct).length;
  int get currentDifficulty => _currentDifficulty;

  CATEngine({
    this.totalQuestions = 75,
    this.passingStandard = 0.0,
    this.seThreshold = 0.30,
    this.minQuestions = 15,
  });

  // ── Difficulty ↔ Logit mapping ──
  static const Map<int, double> _diffToLogit = {
    1: -2.0, // Easy
    2: -1.0, // Below Average
    3: 0.0, // Medium (passing standard)
    4: 1.0, // Above Average
    5: 2.0, // Hard
  };

  static const Map<int, String> difficultyNames = {
    1: 'Easy',
    2: 'Below Average',
    3: 'Medium',
    4: 'Above Average',
    5: 'Hard',
  };

  double _logitFor(int diff) => _diffToLogit[diff.clamp(1, 5)] ?? 0.0;

  /// IRT 1PL probability: P = 1 / (1 + e^-(θ-b))
  double _pCorrect(double th, double b) {
    final exp = (th - b).clamp(-10.0, 10.0);
    return 1.0 / (1.0 + pow(e, -exp));
  }

  /// Fisher Information: I = P * Q
  double _info(double th, double b) {
    final p = _pCorrect(th, b);
    return p * (1.0 - p);
  }

  // ────────────────────────────────────────────────────────
  // RECORD A RESPONSE
  // ────────────────────────────────────────────────────────
  void recordResponse(bool isCorrect, int difficulty) {
    final b = _logitFor(difficulty);
    _responses.add(_Response(correct: isCorrect, b: b));
    difficultyHistory.add(difficulty);

    // Update theta via MLE
    _updateThetaMLE();
    _updateSE();

    // Update target difficulty for next question
    if (isCorrect) {
      _currentDifficulty = (_currentDifficulty + 1).clamp(1, 5);
    } else {
      _currentDifficulty = (_currentDifficulty - 1).clamp(1, 5);
    }

    thetaHistory.add(theta);
    seHistory.add(se);
  }

  /// Maximum Likelihood Estimation via Newton-Raphson
  void _updateThetaMLE() {
    // Edge cases: all correct or all wrong
    if (totalCorrect == totalAnswered) {
      final maxB = _responses.map((r) => r.b).reduce(max);
      theta = maxB + 0.5;
      return;
    }
    if (totalCorrect == 0) {
      final minB = _responses.map((r) => r.b).reduce(min);
      theta = minB - 0.5;
      return;
    }

    double th = theta;
    for (int i = 0; i < 25; i++) {
      double num = 0.0, den = 0.0;
      for (final r in _responses) {
        final p = _pCorrect(th, r.b);
        final u = r.correct ? 1.0 : 0.0;
        num += (u - p);
        den += (p * (1 - p));
      }
      if (den == 0) break;
      final delta = num / den;
      th = (th + delta).clamp(-4.0, 4.0);
      if (delta.abs() < 0.001) break;
    }
    theta = th;
  }

  /// Standard Error = 1/√(Σ Information)
  void _updateSE() {
    double totalInfo = 0.0;
    for (final r in _responses) {
      totalInfo += _info(theta, r.b);
    }
    se = totalInfo > 0 ? 1.0 / sqrt(totalInfo) : 3.0;
  }

  // ────────────────────────────────────────────────────────
  // SELECT NEXT QUESTION (Maximum Information)
  // ────────────────────────────────────────────────────────
  Question? selectNextQuestion(List<Question> pool) {
    final rng = Random();

    // Search expanding from target difficulty
    for (int range = 0; range < 5; range++) {
      final candidates = pool
          .where((q) =>
              !_usedIds.contains(q.id) &&
              (q.difficulty - _currentDifficulty).abs() <= range)
          .toList();

      if (candidates.isEmpty) continue;

      // Score by information, pick from top 3 with jitter
      candidates.sort((a, b) {
        final infoA = _info(theta, _logitFor(a.difficulty));
        final infoB = _info(theta, _logitFor(b.difficulty));
        return infoB.compareTo(infoA);
      });

      final topN = candidates.take(3).toList();
      final selected = topN[rng.nextInt(topN.length)];
      _usedIds.add(selected.id);
      return selected;
    }
    return null;
  }

  // ────────────────────────────────────────────────────────
  // STOPPING RULE
  // ────────────────────────────────────────────────────────
  /// Returns (shouldStop, reason)
  (bool, String) shouldStop() {
    // Max questions reached
    if (totalAnswered >= totalQuestions) {
      return (true, 'Maximum questions reached.');
    }

    // Confidence-based early stop
    if (totalAnswered >= minQuestions && se < seThreshold) {
      final lower = theta - 1.96 * se;
      final upper = theta + 1.96 * se;
      if (lower > passingStandard) {
        return (true, '95% confidence: Ability ABOVE passing standard.');
      }
      if (upper < passingStandard) {
        return (true, '95% confidence: Ability BELOW passing standard.');
      }
    }

    return (false, '');
  }

  // ────────────────────────────────────────────────────────
  // PASS PROBABILITY
  // ────────────────────────────────────────────────────────
  /// P(pass) = Φ((θ - standard) / SE) using logistic approx
  double get passProbability {
    if (se == 0) return theta > passingStandard ? 1.0 : 0.0;
    final z = (theta - passingStandard) / se;
    return 1.0 / (1.0 + pow(e, -1.7 * z)); // logistic CDF ≈ normal CDF
  }

  bool get passed => passProbability >= 0.5 && theta >= passingStandard;

  // ────────────────────────────────────────────────────────
  // REPORT DATA
  // ────────────────────────────────────────────────────────
  double get rawAccuracy =>
      totalAnswered > 0 ? totalCorrect / totalAnswered : 0.0;

  double get avgDifficulty =>
      difficultyHistory.isNotEmpty
          ? difficultyHistory.reduce((a, b) => a + b) / difficultyHistory.length
          : 3.0;

  /// Breakdown by difficulty level: {level: {total, correct}}
  Map<int, Map<String, int>> get difficultyBreakdown {
    final map = <int, Map<String, int>>{};
    for (int i = 0; i < _responses.length; i++) {
      final diff = difficultyHistory[i];
      map.putIfAbsent(diff, () => {'total': 0, 'correct': 0});
      map[diff]!['total'] = map[diff]!['total']! + 1;
      if (_responses[i].correct) {
        map[diff]!['correct'] = map[diff]!['correct']! + 1;
      }
    }
    return map;
  }
}

class _Response {
  final bool correct;
  final double b; // item difficulty in logits
  _Response({required this.correct, required this.b});
}
