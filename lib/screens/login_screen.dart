import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/firebase_service.dart';
import '../main.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _emailCtrl = TextEditingController();
  final _passCtrl = TextEditingController();
  final _formKey = GlobalKey<FormState>();
  bool _loading = false;
  bool _obscure = true;
  String? _error;

  @override
  void dispose() {
    _emailCtrl.dispose();
    _passCtrl.dispose();
    super.dispose();
  }

  Future<void> _login() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _loading = true;
      _error = null;
    });

    final auth = context.read<AuthService>();
    final result = await auth.signIn(
      _emailCtrl.text.trim(),
      _passCtrl.text,
    );

    if (!mounted) return;

    if (result.success) {
      // Sync any pending offline results
      context.read<FirestoreService>().syncPendingResults();

      Navigator.pushReplacementNamed(
        context,
        '/setup',
        arguments: result.userData,
      );
    } else {
      setState(() {
        _loading = false;
        _error = result.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 40),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const SizedBox(height: 40),

                // ── Logo / Header ──
                Center(
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                    decoration: BoxDecoration(
                      color: const Color(0xFFE8F0FE),
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: const Color(0xFFB8D4F0)),
                    ),
                    child: const Text(
                      "DHALIWAL'S NEW CAREERS ACADEMY",
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 2.5,
                        color: NCAApp.ncaBlue,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 20),
                const Center(
                  child: Text(
                    'NCLEX-RN\nCAT Simulator',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 30,
                      fontWeight: FontWeight.w800,
                      color: NCAApp.ncaDark,
                      height: 1.2,
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                const Center(
                  child: Text(
                    'Computerized Adaptive Testing Engine',
                    style: TextStyle(
                      fontSize: 14,
                      color: NCAApp.ncaGrey,
                    ),
                  ),
                ),

                const SizedBox(height: 48),

                // ── Shield Icon ──
                Center(
                  child: Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: const Color(0xFFE8F0FE),
                      shape: BoxShape.circle,
                      border: Border.all(
                          color: NCAApp.ncaBlue.withOpacity(0.2)),
                    ),
                    child: const Icon(Icons.lock_outline,
                        size: 32, color: NCAApp.ncaBlue),
                  ),
                ),
                const SizedBox(height: 24),
                const Center(
                  child: Text(
                    'Approved Candidates Only',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: NCAApp.ncaGrey,
                    ),
                  ),
                ),

                const SizedBox(height: 28),

                // ── Email ──
                TextFormField(
                  controller: _emailCtrl,
                  keyboardType: TextInputType.emailAddress,
                  autocorrect: false,
                  decoration: const InputDecoration(
                    labelText: 'Email Address',
                    prefixIcon: Icon(Icons.email_outlined),
                  ),
                  validator: (v) {
                    if (v == null || v.trim().isEmpty) {
                      return 'Enter your email';
                    }
                    if (!v.contains('@')) return 'Enter a valid email';
                    return null;
                  },
                ),
                const SizedBox(height: 16),

                // ── Password ──
                TextFormField(
                  controller: _passCtrl,
                  obscureText: _obscure,
                  decoration: InputDecoration(
                    labelText: 'Password',
                    prefixIcon: const Icon(Icons.lock_outline),
                    suffixIcon: IconButton(
                      icon: Icon(
                          _obscure ? Icons.visibility_off : Icons.visibility),
                      onPressed: () => setState(() => _obscure = !_obscure),
                    ),
                  ),
                  validator: (v) {
                    if (v == null || v.isEmpty) return 'Enter your password';
                    return null;
                  },
                  onFieldSubmitted: (_) => _login(),
                ),

                // ── Error Message ──
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 16),
                    child: Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFEF5F5),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: const Color(0xFFE0B0B0)),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.error_outline,
                              color: NCAApp.ncaRed, size: 20),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              _error!,
                              style: const TextStyle(
                                color: NCAApp.ncaRed,
                                fontSize: 13,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),

                const SizedBox(height: 28),

                // ── Login Button ──
                SizedBox(
                  height: 52,
                  child: ElevatedButton(
                    onPressed: _loading ? null : _login,
                    child: _loading
                        ? const SizedBox(
                            width: 22,
                            height: 22,
                            child: CircularProgressIndicator(
                              strokeWidth: 2.5,
                              color: Colors.white,
                            ),
                          )
                        : const Text('Sign In'),
                  ),
                ),

                const SizedBox(height: 40),

                // ── Footer ──
                Center(
                  child: Text(
                    'Est. 1967 · Dhaliwal\'s New Careers Academy\nAll content is protected and monitored.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 11,
                      color: NCAApp.ncaGrey.withOpacity(0.6),
                      height: 1.6,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
