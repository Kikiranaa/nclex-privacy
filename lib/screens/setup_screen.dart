import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../main.dart';
import '../services/firebase_service.dart';
import '../services/cat_engine.dart';
import '../models/question.dart';
import 'quiz_screen.dart';

class SetupScreen extends StatefulWidget {
  const SetupScreen({super.key});

  @override
  State<SetupScreen> createState() => _SetupScreenState();
}

class _SetupScreenState extends State<SetupScreen> {
  int _selectedCount = 75;
  int _customCount = 50;
  bool _isCustom = false;
  String _selectedSubject = 'MI';
  bool _loading = false;
  List<String> _subjects = ['MI'];
  Map<String, dynamic>? _userData;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _userData = ModalRoute.of(context)?.settings.arguments as Map<String, dynamic>?;
    _loadSubjects();
  }

  Future<void> _loadSubjects() async {
    final fs = context.read<FirestoreService>();
    final subjects = await fs.getAvailableSubjects();
    if (mounted && subjects.isNotEmpty) {
      setState(() => _subjects = subjects);
    }
  }

  Future<void> _startExam() async {
    setState(() => _loading = true);

    final fs = context.read<FirestoreService>();
    final questions = await fs.fetchQuestions(subject: _selectedSubject);

    if (!mounted) return;

    if (questions.isEmpty) {
      setState(() => _loading = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('No questions found. Upload questions first or check your connection.'),
          backgroundColor: NCAApp.ncaRed,
        ),
      );
      return;
    }

    final totalQ = _isCustom ? _customCount : _selectedCount;
    final engine = CATEngine(totalQuestions: totalQ);

    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => QuizScreen(
          questions: questions,
          engine: engine,
          userData: _userData ?? {'name': 'Student', 'email': '', 'uid': ''},
          subject: _selectedSubject,
        ),
      ),
    );

    setState(() => _loading = false);
  }

  Future<void> _logout() async {
    final auth = context.read<AuthService>();
    await auth.signOut();
    if (mounted) {
      Navigator.pushReplacementNamed(context, '/login');
    }
  }

  @override
  Widget build(BuildContext context) {
    final name = _userData?['name'] ?? 'Student';
    final batch = _userData?['batch'] ?? '';

    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // ── Header ──
              _buildHeader(),
              const SizedBox(height: 24),

              // ── Welcome ──
              Text(
                'Welcome, $name 👋',
                style: const TextStyle(
                    fontSize: 22, fontWeight: FontWeight.w800, color: NCAApp.ncaDark),
              ),
              if (batch.isNotEmpty)
                Text(
                  'Batch: $batch',
                  style: const TextStyle(fontSize: 13, color: NCAApp.ncaGrey),
                ),
              const SizedBox(height: 28),

              // ── Question Count ──
              const Text(
                'NUMBER OF QUESTIONS',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 1.5,
                  color: NCAApp.ncaBlue,
                ),
              ),
              const SizedBox(height: 10),
              Wrap(
                spacing: 10,
                runSpacing: 10,
                children: [
                  for (final n in [75, 100, 145])
                    _CountChip(
                      label: '$n',
                      selected: !_isCustom && _selectedCount == n,
                      onTap: () => setState(() {
                        _isCustom = false;
                        _selectedCount = n;
                      }),
                    ),
                  _CountChip(
                    label: 'Custom',
                    selected: _isCustom,
                    onTap: () => setState(() => _isCustom = true),
                  ),
                ],
              ),
              if (_isCustom) ...[
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: Slider(
                        value: _customCount.toDouble(),
                        min: 10,
                        max: 265,
                        divisions: 51,
                        activeColor: NCAApp.ncaBlue,
                        label: '$_customCount',
                        onChanged: (v) =>
                            setState(() => _customCount = v.round()),
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 14, vertical: 8),
                      decoration: BoxDecoration(
                        color: NCAApp.ncaBlue.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        '$_customCount',
                        style: const TextStyle(
                          fontWeight: FontWeight.w800,
                          color: NCAApp.ncaBlue,
                          fontSize: 16,
                        ),
                      ),
                    ),
                  ],
                ),
              ],

              const SizedBox(height: 24),

              // ── Subject ──
              const Text(
                'SUBJECT / TOPIC',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 1.5,
                  color: NCAApp.ncaBlue,
                ),
              ),
              const SizedBox(height: 10),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14),
                decoration: BoxDecoration(
                  color: const Color(0xFFF5F8FC),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: const Color(0xFFD8E6F5)),
                ),
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<String>(
                    isExpanded: true,
                    value: _subjects.contains(_selectedSubject)
                        ? _selectedSubject
                        : _subjects.first,
                    items: _subjects
                        .map((s) => DropdownMenuItem(value: s, child: Text(s)))
                        .toList(),
                    onChanged: (v) {
                      if (v != null) setState(() => _selectedSubject = v);
                    },
                  ),
                ),
              ),

              const SizedBox(height: 28),

              // ── How CAT Works ──
              _buildInfoCard(),

              const SizedBox(height: 24),

              // ── Start Button ──
              SizedBox(
                height: 54,
                child: ElevatedButton.icon(
                  onPressed: _loading ? null : _startExam,
                  icon: _loading
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.white),
                        )
                      : const Icon(Icons.play_arrow_rounded),
                  label: Text(_loading ? 'Loading...' : 'Start CAT Exam'),
                ),
              ),

              const SizedBox(height: 16),

              // ── Logout ──
              TextButton.icon(
                onPressed: _logout,
                icon: const Icon(Icons.logout, size: 18),
                label: const Text('Logout'),
                style: TextButton.styleFrom(foregroundColor: NCAApp.ncaGrey),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 16),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: Color(0xFFD8E6F5), width: 2)),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: NCAApp.ncaBlue.withOpacity(0.1),
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Icon(Icons.local_hospital, color: NCAApp.ncaBlue, size: 24),
          ),
          const SizedBox(width: 12),
          const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'NCA NCLEX-RN',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                  color: NCAApp.ncaDark,
                ),
              ),
              Text(
                'CAT Simulator',
                style: TextStyle(fontSize: 12, color: NCAApp.ncaGrey),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildInfoCard() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Row(
              children: [
                Icon(Icons.auto_awesome, color: NCAApp.ncaBlue, size: 18),
                SizedBox(width: 8),
                Text(
                  'How CAT Works',
                  style: TextStyle(
                      fontWeight: FontWeight.w700,
                      color: NCAApp.ncaDark,
                      fontSize: 14),
                ),
              ],
            ),
            const SizedBox(height: 12),
            _infoRow('✅ Correct', 'Next question is harder (+1 level)'),
            _infoRow('❌ Incorrect', 'Next question is easier (-1 level)'),
            _infoRow('📊 Final Score', 'Weighted — hard questions count more'),
            _infoRow('🎯 Pass/Fail', '95% confidence via logit analysis'),
          ],
        ),
      ),
    );
  }

  Widget _infoRow(String label, String desc) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 100,
            child: Text(label,
                style: const TextStyle(
                    fontWeight: FontWeight.w600, fontSize: 12, color: NCAApp.ncaDark)),
          ),
          Expanded(
            child: Text(desc,
                style: const TextStyle(fontSize: 12, color: NCAApp.ncaGrey)),
          ),
        ],
      ),
    );
  }
}

class _CountChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _CountChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 12),
        decoration: BoxDecoration(
          color: selected ? NCAApp.ncaBlue : const Color(0xFFF5F8FC),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: selected ? NCAApp.ncaBlue : const Color(0xFFD8E6F5),
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontWeight: FontWeight.w700,
            fontSize: 14,
            color: selected ? Colors.white : NCAApp.ncaDark,
          ),
        ),
      ),
    );
  }
}
