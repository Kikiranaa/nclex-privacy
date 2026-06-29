import 'package:flutter/material.dart';
import 'dart:async';
import '../main.dart';
import '../models/question.dart';
import '../services/cat_engine.dart';
import '../widgets/secure_wrapper.dart';
import 'results_screen.dart';

class QuizScreen extends StatefulWidget {
  final List<Question> questions;
  final CATEngine engine;
  final Map<String, dynamic> userData;
  final String subject;

  const QuizScreen({
    super.key,
    required this.questions,
    required this.engine,
    required this.userData,
    required this.subject,
  });

  @override
  State<QuizScreen> createState() => _QuizScreenState();
}

class _QuizScreenState extends State<QuizScreen> {
  Question? _currentQuestion;
  int? _selectedOption;
  bool _answered = false;
  final List<AnswerRecord> _history = [];
  late DateTime _startTime;
  Timer? _timer;
  int _elapsedSeconds = 0;

  @override
  void initState() {
    super.initState();
    _startTime = DateTime.now();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() => _elapsedSeconds++);
    });
    _loadNextQuestion();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  void _loadNextQuestion() {
    final q = widget.engine.selectNextQuestion(widget.questions);
    setState(() {
      _currentQuestion = q;
      _selectedOption = null;
      _answered = false;
    });
  }

  void _submitAnswer() {
    if (_selectedOption == null || _currentQuestion == null) return;

    final isCorrect = _selectedOption == _currentQuestion!.answer;
    widget.engine.recordResponse(isCorrect, _currentQuestion!.difficulty);

    _history.add(AnswerRecord(
      question: _currentQuestion!,
      selectedOption: _selectedOption!,
      isCorrect: isCorrect,
      thetaAfter: widget.engine.theta,
      seAfter: widget.engine.se,
    ));

    setState(() => _answered = true);
  }

  void _nextQuestion() {
    final (shouldStop, reason) = widget.engine.shouldStop();
    if (shouldStop || _history.length >= widget.engine.totalQuestions) {
      _goToResults(reason.isNotEmpty ? reason : 'Maximum questions reached.');
      return;
    }

    final q = widget.engine.selectNextQuestion(widget.questions);
    if (q == null) {
      _goToResults('No more questions available at the needed difficulty.');
      return;
    }

    setState(() {
      _currentQuestion = q;
      _selectedOption = null;
      _answered = false;
    });
  }

  void _goToResults(String stopReason) {
    _timer?.cancel();
    Navigator.pushReplacement(
      context,
      MaterialPageRoute(
        builder: (_) => ResultsScreen(
          engine: widget.engine,
          history: _history,
          userData: widget.userData,
          subject: widget.subject,
          startTime: _startTime,
          stopReason: stopReason,
        ),
      ),
    );
  }

  void _confirmEndExam() {
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('End Exam?'),
        content: Text(
          'You have answered ${_history.length} of ${widget.engine.totalQuestions} questions.\n\nAre you sure you want to end the exam now?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Continue Exam'),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(context);
              _goToResults('Exam ended by student.');
            },
            style: ElevatedButton.styleFrom(backgroundColor: NCAApp.ncaRed),
            child: const Text('End Exam'),
          ),
        ],
      ),
    );
  }

  String get _timeFormatted {
    final m = _elapsedSeconds ~/ 60;
    final s = _elapsedSeconds % 60;
    return '${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    return SecureWrapper(
      showWatermark: true,
      child: Scaffold(
        body: SafeArea(
          child: _currentQuestion == null
              ? const Center(child: CircularProgressIndicator())
              : Column(
                  children: [
                    _buildTopBar(),
                    _buildProgressBar(),
                    Expanded(
                      child: SingleChildScrollView(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 20, vertical: 12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            _buildAbilityMeter(),
                            const SizedBox(height: 16),
                            _buildQuestionCard(),
                            const SizedBox(height: 14),
                            _buildOptions(),
                            if (_answered) ...[
                              const SizedBox(height: 16),
                              _buildRationale(),
                            ],
                            const SizedBox(height: 20),
                            _buildActionButton(),
                            const SizedBox(height: 30),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
        ),
      ),
    );
  }

  // ── TOP BAR ──
  Widget _buildTopBar() {
    final qNum = _history.length + (_answered ? 0 : 1);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: const BoxDecoration(
        color: Color(0xFFF5F8FC),
        border: Border(bottom: BorderSide(color: Color(0xFFE0E8F0))),
      ),
      child: Row(
        children: [
          GestureDetector(
            onTap: _confirmEndExam,
            child: const Row(
              children: [
                Icon(Icons.stop_circle_outlined, size: 18, color: NCAApp.ncaRed),
                SizedBox(width: 4),
                Text('End', style: TextStyle(color: NCAApp.ncaRed, fontWeight: FontWeight.w600, fontSize: 13)),
              ],
            ),
          ),
          const Spacer(),
          Text(
            'Q$qNum / ${widget.engine.totalQuestions}',
            style: const TextStyle(fontWeight: FontWeight.w700, color: Color(0xFF4A5A6A), fontSize: 14),
          ),
          const Spacer(),
          Text(
            '⏱ $_timeFormatted',
            style: const TextStyle(fontWeight: FontWeight.w600, color: Color(0xFF6A7A8A), fontSize: 13),
          ),
        ],
      ),
    );
  }

  // ── PROGRESS ──
  Widget _buildProgressBar() {
    final progress = (_history.length + 1) / widget.engine.totalQuestions;
    return LinearProgressIndicator(
      value: progress.clamp(0.0, 1.0),
      backgroundColor: const Color(0xFFE8EEF5),
      valueColor: const AlwaysStoppedAnimation(NCAApp.ncaBlue),
      minHeight: 3,
    );
  }

  // ── ABILITY METER (Logit) ──
  Widget _buildAbilityMeter() {
    final theta = widget.engine.theta;
    final pct = ((theta + 3) / 6).clamp(0.0, 1.0);

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFF0F4FA),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: const Color(0xFFD0DFF0)),
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('ABILITY ESTIMATE',
                  style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: NCAApp.ncaBlue, letterSpacing: 1)),
              Text('${theta >= 0 ? "+" : ""}${theta.toStringAsFixed(2)} logits',
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: NCAApp.ncaDark)),
            ],
          ),
          const SizedBox(height: 8),
          Stack(
            children: [
              // Gradient track
              Container(
                height: 18,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(9),
                  gradient: const LinearGradient(
                    colors: [Color(0xFFD04040), Color(0xFFE8A020), Color(0xFFE8D020), Color(0xFF60B860), Color(0xFF28A060)],
                  ),
                ),
              ),
              // Marker
              Positioned(
                left: (MediaQuery.of(context).size.width - 80) * pct,
                top: -4,
                child: Container(
                  width: 4,
                  height: 26,
                  decoration: BoxDecoration(
                    color: NCAApp.ncaDark,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          const Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Below', style: TextStyle(fontSize: 9, color: Color(0xFF6A7A8A), fontWeight: FontWeight.w600)),
              Text('Standard', style: TextStyle(fontSize: 9, color: Color(0xFF6A7A8A), fontWeight: FontWeight.w600)),
              Text('Above', style: TextStyle(fontSize: 9, color: Color(0xFF6A7A8A), fontWeight: FontWeight.w600)),
            ],
          ),
        ],
      ),
    );
  }

  // ── QUESTION CARD ──
  Widget _buildQuestionCard() {
    final q = _currentQuestion!;
    final diff = q.difficulty;
    final diffColors = {
      1: const Color(0xFFE8F8E8), 2: const Color(0xFFE8F0FE),
      3: const Color(0xFFFFF8E0), 4: const Color(0xFFFEE8E0),
      5: const Color(0xFFF8E0E0),
    };
    final diffTextColors = {
      1: const Color(0xFF1A5A20), 2: const Color(0xFF0056B3),
      3: const Color(0xFF8A6800), 4: const Color(0xFFA04020),
      5: const Color(0xFF8A1A1A),
    };

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: NCAApp.ncaBlue,
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    'Q${_history.length + 1}',
                    style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w700),
                  ),
                ),
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: diffColors[diff] ?? const Color(0xFFFFF8E0),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    '${CATEngine.difficultyNames[diff]} ($diff/5)',
                    style: TextStyle(
                      color: diffTextColors[diff] ?? const Color(0xFF8A6800),
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Text(
              q.question,
              style: const TextStyle(fontSize: 15, height: 1.7, color: NCAApp.ncaDark, fontWeight: FontWeight.w500),
            ),
          ],
        ),
      ),
    );
  }

  // ── ANSWER OPTIONS ──
  Widget _buildOptions() {
    final q = _currentQuestion!;
    const letters = ['A', 'B', 'C', 'D'];

    return Column(
      children: List.generate(q.options.length, (i) {
        final isSelected = _selectedOption == i;
        final isCorrect = i == q.answer;

        Color bg = const Color(0xFFFAFCFF);
        Color border = const Color(0xFFDCE6F2);
        Color textColor = const Color(0xFF2A2A2A);
        Color letterBg = const Color(0xFFE8EEF5);
        Color letterColor = const Color(0xFF4A6A8A);
        String letterText = letters[i];

        if (_answered) {
          if (isCorrect) {
            bg = const Color(0xFFE8F8E8);
            border = NCAApp.ncaGreen;
            textColor = const Color(0xFF1A5A20);
            letterBg = NCAApp.ncaGreen;
            letterColor = Colors.white;
            letterText = '✓';
          } else if (isSelected) {
            bg = const Color(0xFFFDE8E8);
            border = NCAApp.ncaRed;
            textColor = const Color(0xFF6A1A1A);
            letterBg = NCAApp.ncaRed;
            letterColor = Colors.white;
            letterText = '✗';
          }
        } else if (isSelected) {
          bg = const Color(0xFFE0EDFF);
          border = NCAApp.ncaBlue;
          letterBg = NCAApp.ncaBlue;
          letterColor = Colors.white;
        }

        return GestureDetector(
          onTap: _answered ? null : () => setState(() => _selectedOption = i),
          child: Container(
            margin: const EdgeInsets.only(bottom: 9),
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: bg,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: border, width: 1.5),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 30,
                  height: 30,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: letterBg,
                    borderRadius: BorderRadius.circular(7),
                  ),
                  child: Text(
                    letterText,
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: letterColor),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    q.options[i],
                    style: TextStyle(fontSize: 14, height: 1.5, color: textColor),
                  ),
                ),
              ],
            ),
          ),
        );
      }),
    );
  }

  // ── RATIONALE ──
  Widget _buildRationale() {
    final q = _currentQuestion!;
    final isCorrect = _selectedOption == q.answer;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Result banner
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: isCorrect ? const Color(0xFFE8F8E8) : const Color(0xFFFDE8E8),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(
            isCorrect
                ? '✅ Correct! Next question will be harder.'
                : '❌ Incorrect. Next question will be easier.',
            style: TextStyle(
              fontWeight: FontWeight.w600,
              color: isCorrect ? NCAApp.ncaGreen : NCAApp.ncaRed,
              fontSize: 13,
            ),
          ),
        ),
        const SizedBox(height: 12),

        // Correct rationale
        if (q.rationaleCorrect.isNotEmpty)
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: const Color(0xFFE8F8E8),
              borderRadius: const BorderRadius.only(
                topRight: Radius.circular(8),
                bottomRight: Radius.circular(8),
              ),
              border: const Border(left: BorderSide(color: NCAApp.ncaGreen, width: 3)),
            ),
            child: Text(
              q.rationaleCorrect,
              style: const TextStyle(fontSize: 13, height: 1.6, color: Color(0xFF1A5A20)),
            ),
          ),

        // Wrong rationales
        ...q.rationaleWrong.entries.map((e) {
          final idx = int.tryParse(e.key) ?? -1;
          if (idx == q.answer) return const SizedBox.shrink();
          final isYours = idx == _selectedOption && !isCorrect;
          return Container(
            margin: const EdgeInsets.only(top: 7),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: isYours ? const Color(0xFFFEF5F5) : const Color(0xFFF5F8FF),
              borderRadius: const BorderRadius.only(
                topRight: Radius.circular(8),
                bottomRight: Radius.circular(8),
              ),
              border: Border(
                left: BorderSide(
                  color: isYours ? NCAApp.ncaRed : const Color(0xFFD0D8E0),
                  width: 3,
                ),
              ),
            ),
            child: Text(
              e.value,
              style: TextStyle(fontSize: 12, height: 1.6, color: isYours ? const Color(0xFF5A2020) : NCAApp.ncaGrey),
            ),
          );
        }),
      ],
    );
  }

  // ── ACTION BUTTON ──
  Widget _buildActionButton() {
    if (!_answered) {
      return SizedBox(
        height: 52,
        child: ElevatedButton(
          onPressed: _selectedOption == null ? null : _submitAnswer,
          style: ElevatedButton.styleFrom(
            backgroundColor: _selectedOption != null ? NCAApp.ncaBlue : const Color(0xFFC0CCD8),
          ),
          child: const Text('Submit Answer'),
        ),
      );
    }

    final (shouldStop, _) = widget.engine.shouldStop();
    final atMax = _history.length >= widget.engine.totalQuestions;

    return SizedBox(
      height: 52,
      child: ElevatedButton.icon(
        onPressed: () {
          if (shouldStop || atMax) {
            _goToResults(shouldStop ? 'Stopping rule met.' : 'Maximum questions reached.');
          } else {
            _nextQuestion();
          }
        },
        icon: Icon(shouldStop || atMax ? Icons.assessment : Icons.arrow_forward),
        label: Text(shouldStop || atMax ? 'View Results' : 'Next Question'),
      ),
    );
  }
}
