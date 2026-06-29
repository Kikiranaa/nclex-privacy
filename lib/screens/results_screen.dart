import 'package:flutter/material.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:provider/provider.dart';
import '../main.dart';
import '../models/question.dart';
import '../services/cat_engine.dart';
import '../services/firebase_service.dart';

class ResultsScreen extends StatefulWidget {
  final CATEngine engine;
  final List<AnswerRecord> history;
  final Map<String, dynamic> userData;
  final String subject;
  final DateTime startTime;
  final String stopReason;

  const ResultsScreen({
    super.key,
    required this.engine,
    required this.history,
    required this.userData,
    required this.subject,
    required this.startTime,
    required this.stopReason,
  });

  @override
  State<ResultsScreen> createState() => _ResultsScreenState();
}

class _ResultsScreenState extends State<ResultsScreen> {
  @override
  void initState() {
    super.initState();
    _saveResults();
  }

  Future<void> _saveResults() async {
    final e = widget.engine;
    final duration = DateTime.now().difference(widget.startTime).inSeconds / 60.0;

    final result = ExamResult(
      odUserId: widget.userData['uid'] ?? '',
      userEmail: widget.userData['email'] ?? '',
      userName: widget.userData['name'] ?? '',
      subject: widget.subject,
      totalQuestions: e.totalAnswered,
      totalCorrect: e.totalCorrect,
      rawAccuracy: e.rawAccuracy,
      finalTheta: e.theta,
      finalSe: e.se,
      passProbability: e.passProbability,
      passed: e.passed,
      avgDifficulty: e.avgDifficulty,
      examDate: DateTime.now(),
      durationMinutes: duration,
      answers: widget.history,
    );

    try {
      await context.read<FirestoreService>().saveExamResult(result);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final e = widget.engine;
    final passed = e.passed;
    final passPct = (e.passProbability * 100).round();

    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // ── PASS / FAIL BANNER ──
              Container(
                padding: const EdgeInsets.symmetric(vertical: 32, horizontal: 20),
                decoration: BoxDecoration(
                  color: passed ? const Color(0xFFF0FAF0) : const Color(0xFFFFF5F5),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(
                    color: passed ? const Color(0xFF80C880) : const Color(0xFFE0A0A0),
                    width: 2,
                  ),
                ),
                child: Column(
                  children: [
                    Icon(
                      passed ? Icons.check_circle : Icons.cancel,
                      size: 56,
                      color: passed ? NCAApp.ncaGreen : NCAApp.ncaRed,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      passed ? 'PASSED' : 'DID NOT PASS',
                      style: TextStyle(
                        fontSize: 28,
                        fontWeight: FontWeight.w900,
                        color: passed ? NCAApp.ncaGreen : NCAApp.ncaRed,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Passing Probability: $passPct%',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                        color: passed ? const Color(0xFF1A5A20) : const Color(0xFF8A2020),
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Final Ability: ${e.theta >= 0 ? "+" : ""}${e.theta.toStringAsFixed(2)} logits (SE: ±${e.se.toStringAsFixed(2)})',
                      style: const TextStyle(fontSize: 13, color: Color(0xFF5A6A7A)),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      widget.stopReason,
                      style: const TextStyle(fontSize: 11, color: Color(0xFF8A9AAA), fontStyle: FontStyle.italic),
                      textAlign: TextAlign.center,
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 24),

              // ── SUMMARY STATS ──
              const Text('PERFORMANCE SUMMARY',
                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1.5, color: NCAApp.ncaBlue)),
              const SizedBox(height: 12),
              Row(
                children: [
                  _statCard('Questions', '${e.totalAnswered}', Icons.quiz),
                  const SizedBox(width: 10),
                  _statCard('Correct', '${e.totalCorrect}', Icons.check),
                  const SizedBox(width: 10),
                  _statCard('Accuracy', '${(e.rawAccuracy * 100).round()}%', Icons.percent),
                  const SizedBox(width: 10),
                  _statCard('Avg Diff', '${e.avgDifficulty.toStringAsFixed(1)}', Icons.trending_up),
                ],
              ),

              const SizedBox(height: 24),

              // ── ABILITY TRAJECTORY CHART ──
              const Text('ABILITY TRAJECTORY',
                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1.5, color: NCAApp.ncaBlue)),
              const SizedBox(height: 12),
              _buildThetaChart(),

              const SizedBox(height: 24),

              // ── DIFFICULTY BREAKDOWN ──
              const Text('PERFORMANCE BY DIFFICULTY',
                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1.5, color: NCAApp.ncaBlue)),
              const SizedBox(height: 12),
              _buildDifficultyBreakdown(),

              const SizedBox(height: 24),

              // ── QUESTION REVIEW ──
              const Text('QUESTION REVIEW',
                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1.5, color: NCAApp.ncaBlue)),
              const SizedBox(height: 12),
              ...List.generate(widget.history.length, (i) => _buildReviewItem(i)),

              const SizedBox(height: 24),

              // ── ACTIONS ──
              SizedBox(
                height: 52,
                child: ElevatedButton.icon(
                  onPressed: () {
                    Navigator.pushNamedAndRemoveUntil(
                      context,
                      '/setup',
                      (route) => false,
                      arguments: widget.userData,
                    );
                  },
                  icon: const Icon(Icons.replay),
                  label: const Text('Take Another Exam'),
                ),
              ),
              const SizedBox(height: 12),
              TextButton.icon(
                onPressed: () {
                  context.read<AuthService>().signOut();
                  Navigator.pushNamedAndRemoveUntil(context, '/login', (route) => false);
                },
                icon: const Icon(Icons.logout, size: 18),
                label: const Text('Logout'),
                style: TextButton.styleFrom(foregroundColor: NCAApp.ncaGrey),
              ),
              const SizedBox(height: 20),
            ],
          ),
        ),
      ),
    );
  }

  Widget _statCard(String label, String value, IconData icon) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 14),
        decoration: BoxDecoration(
          color: const Color(0xFFF8FBFF),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: const Color(0xFFD8E6F5)),
        ),
        child: Column(
          children: [
            Icon(icon, size: 18, color: NCAApp.ncaBlue),
            const SizedBox(height: 6),
            Text(value,
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: NCAApp.ncaDark)),
            const SizedBox(height: 2),
            Text(label, style: const TextStyle(fontSize: 10, color: NCAApp.ncaGrey)),
          ],
        ),
      ),
    );
  }

  Widget _buildThetaChart() {
    final spots = <FlSpot>[];
    for (int i = 0; i < widget.engine.thetaHistory.length; i++) {
      spots.add(FlSpot(i.toDouble(), widget.engine.thetaHistory[i]));
    }

    return Container(
      height: 200,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FBFF),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFD8E6F5)),
      ),
      child: LineChart(
        LineChartData(
          minY: -3,
          maxY: 3,
          gridData: FlGridData(
            show: true,
            drawHorizontalLine: true,
            drawVerticalLine: false,
            horizontalInterval: 1,
            getDrawingHorizontalLine: (value) => FlLine(
              color: value == 0
                  ? NCAApp.ncaRed.withOpacity(0.5)
                  : const Color(0xFFE0E8F0),
              strokeWidth: value == 0 ? 2 : 1,
              dashArray: value == 0 ? [5, 5] : null,
            ),
          ),
          titlesData: FlTitlesData(
            leftTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true,
                reservedSize: 32,
                getTitlesWidget: (v, _) => Text(
                  v.toInt().toString(),
                  style: const TextStyle(fontSize: 10, color: Color(0xFF8A9AAA)),
                ),
              ),
            ),
            bottomTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true,
                reservedSize: 24,
                interval: (spots.length / 5).ceilToDouble().clamp(1, 50),
                getTitlesWidget: (v, _) => Text(
                  'Q${v.toInt()}',
                  style: const TextStyle(fontSize: 9, color: Color(0xFF8A9AAA)),
                ),
              ),
            ),
            rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
            topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          ),
          borderData: FlBorderData(show: false),
          lineBarsData: [
            LineChartBarData(
              spots: spots,
              isCurved: true,
              curveSmoothness: 0.2,
              color: NCAApp.ncaBlue,
              barWidth: 2.5,
              dotData: const FlDotData(show: false),
              belowBarData: BarAreaData(
                show: true,
                color: NCAApp.ncaBlue.withOpacity(0.08),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDifficultyBreakdown() {
    final breakdown = widget.engine.difficultyBreakdown;
    return Column(
      children: [1, 2, 3, 4, 5].map((d) {
        final stats = breakdown[d];
        if (stats == null) return const SizedBox.shrink();
        final total = stats['total'] ?? 0;
        final correct = stats['correct'] ?? 0;
        final pct = total > 0 ? correct / total : 0.0;

        return Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Row(
            children: [
              SizedBox(
                width: 100,
                child: Text(
                  'Level $d (${CATEngine.difficultyNames[d]})',
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: NCAApp.ncaDark),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: LinearProgressIndicator(
                    value: pct,
                    backgroundColor: const Color(0xFFE8EEF5),
                    valueColor: AlwaysStoppedAnimation(
                      pct >= 0.7 ? NCAApp.ncaGreen : pct >= 0.4 ? const Color(0xFFE8A020) : NCAApp.ncaRed,
                    ),
                    minHeight: 12,
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Text(
                '$correct/$total (${(pct * 100).round()}%)',
                style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: NCAApp.ncaGrey),
              ),
            ],
          ),
        );
      }).toList(),
    );
  }

  Widget _buildReviewItem(int i) {
    final r = widget.history[i];
    final letters = ['A', 'B', 'C', 'D'];

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: r.isCorrect ? const Color(0xFFF8FFF8) : const Color(0xFFFFF8F8),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: r.isCorrect ? const Color(0xFFC8E0C0) : const Color(0xFFF0D8D8),
        ),
      ),
      child: ExpansionTile(
        tilePadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 2),
        childrenPadding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
        leading: Icon(
          r.isCorrect ? Icons.check_circle : Icons.cancel,
          color: r.isCorrect ? NCAApp.ncaGreen : NCAApp.ncaRed,
          size: 20,
        ),
        title: Text(
          'Q${i + 1} — Difficulty ${r.question.difficulty}/5',
          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: NCAApp.ncaDark),
        ),
        subtitle: Text(
          r.question.category,
          style: const TextStyle(fontSize: 11, color: NCAApp.ncaGrey),
        ),
        children: [
          Text(r.question.question,
              style: const TextStyle(fontSize: 13, height: 1.6, color: NCAApp.ncaDark)),
          const SizedBox(height: 10),
          ...List.generate(r.question.options.length, (j) {
            String prefix = '${letters[j]}. ';
            if (j == r.question.answer) prefix = '✅ ${letters[j]}. ';
            if (j == r.selectedOption && !r.isCorrect) prefix = '❌ ${letters[j]}. ';
            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Text(prefix + r.question.options[j],
                  style: TextStyle(
                    fontSize: 12,
                    color: j == r.question.answer ? NCAApp.ncaGreen : NCAApp.ncaDark,
                    fontWeight: j == r.question.answer ? FontWeight.w600 : FontWeight.normal,
                  )),
            );
          }),
          if (r.question.rationaleCorrect.isNotEmpty) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: const Color(0xFFE8F8E8),
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text(r.question.rationaleCorrect,
                  style: const TextStyle(fontSize: 11, height: 1.6, color: Color(0xFF1A5A20))),
            ),
          ],
        ],
      ),
    );
  }
}
