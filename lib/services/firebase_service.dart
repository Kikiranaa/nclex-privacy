import 'dart:convert';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/question.dart';

/// ─────────────────────────────────────────────────────────
/// AUTH SERVICE — Whitelist-only Firebase Authentication
///
/// Flow:
///  1. Student enters email + password
///  2. Firebase Auth verifies credentials
///  3. App checks 'approved_candidates' collection
///  4. Only documents with approved: true can proceed
/// ─────────────────────────────────────────────────────────
class AuthService {
  final FirebaseAuth _auth = FirebaseAuth.instance;
  final FirebaseFirestore _db = FirebaseFirestore.instance;

  User? get currentUser => _auth.currentUser;
  bool get isLoggedIn => _auth.currentUser != null;
  Stream<User?> get authStream => _auth.authStateChanges();

  /// Sign in + verify whitelist
  Future<({bool success, String message, Map<String, dynamic>? userData})>
      signIn(String email, String password) async {
    try {
      // Step 1: Firebase Auth
      final cred = await _auth.signInWithEmailAndPassword(
        email: email.trim(),
        password: password,
      );

      if (cred.user == null) {
        return (success: false, message: 'Authentication failed.', userData: null);
      }

      // Step 2: Check whitelist
      final snap = await _db
          .collection('approved_candidates')
          .where('email', isEqualTo: email.trim().toLowerCase())
          .where('approved', isEqualTo: true)
          .limit(1)
          .get();

      if (snap.docs.isEmpty) {
        // Not approved — sign out
        await _auth.signOut();
        return (
          success: false,
          message: 'Your account is not approved. Contact NCA admin.',
          userData: null,
        );
      }

      final data = snap.docs.first.data();
      return (
        success: true,
        message: 'Welcome, ${data['name'] ?? 'Student'}!',
        userData: {
          'uid': cred.user!.uid,
          'email': email.trim(),
          'name': data['name'] ?? 'Student',
          'batch': data['batch'] ?? '',
        },
      );
    } on FirebaseAuthException catch (e) {
      String msg;
      switch (e.code) {
        case 'user-not-found':
          msg = 'No account found with this email.';
          break;
        case 'wrong-password':
          msg = 'Incorrect password.';
          break;
        case 'invalid-email':
          msg = 'Invalid email format.';
          break;
        case 'user-disabled':
          msg = 'This account has been disabled.';
          break;
        default:
          msg = 'Login failed: ${e.message}';
      }
      return (success: false, message: msg, userData: null);
    } catch (e) {
      return (success: false, message: 'Connection error: $e', userData: null);
    }
  }

  /// Sign out
  Future<void> signOut() async => await _auth.signOut();
}

/// ─────────────────────────────────────────────────────────
/// FIRESTORE SERVICE — Questions + Results + Offline Cache
/// ─────────────────────────────────────────────────────────
class FirestoreService {
  final FirebaseFirestore _db = FirebaseFirestore.instance;
  static const _cacheKey = 'cached_questions';
  static const _cacheTimestampKey = 'cache_timestamp';

  /// Fetch questions with offline fallback
  /// Caches questions locally so students can study offline
  Future<List<Question>> fetchQuestions({String? subject}) async {
    try {
      // Try Firestore first
      Query query = _db.collection('questions');
      if (subject != null && subject != 'All') {
        query = query.where('subject', isEqualTo: subject);
      }

      final snap = await query.get();
      final questions = snap.docs.map((d) => Question.fromFirestore(d)).toList();

      if (questions.isNotEmpty) {
        // Cache for offline use
        await _cacheQuestions(questions);
        return questions;
      }
    } catch (e) {
      // Network error — try cache
      print('Firestore fetch error: $e');
    }

    // Fallback: load from cache
    return await _loadCachedQuestions(subject: subject);
  }

  /// Cache questions locally as JSON
  Future<void> _cacheQuestions(List<Question> questions) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final jsonList = questions.map((q) => q.toJson()).toList();
      await prefs.setString(_cacheKey, jsonEncode(jsonList));
      await prefs.setInt(
          _cacheTimestampKey, DateTime.now().millisecondsSinceEpoch);
    } catch (e) {
      print('Cache save error: $e');
    }
  }

  /// Load cached questions
  Future<List<Question>> _loadCachedQuestions({String? subject}) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final jsonStr = prefs.getString(_cacheKey);
      if (jsonStr == null) return [];

      final List<dynamic> jsonList = jsonDecode(jsonStr);
      var questions = jsonList
          .map((j) => Question.fromJson(j as Map<String, dynamic>))
          .toList();

      if (subject != null && subject != 'All') {
        questions = questions.where((q) => q.subject == subject).toList();
      }
      return questions;
    } catch (e) {
      return [];
    }
  }

  /// Check if offline cache exists
  Future<bool> hasCachedQuestions() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.containsKey(_cacheKey);
  }

  /// Get cache age in hours
  Future<int> cacheAgeHours() async {
    final prefs = await SharedPreferences.getInstance();
    final ts = prefs.getInt(_cacheTimestampKey);
    if (ts == null) return -1;
    final cached = DateTime.fromMillisecondsSinceEpoch(ts);
    return DateTime.now().difference(cached).inHours;
  }

  /// Save exam results to Firestore
  Future<void> saveExamResult(ExamResult result) async {
    try {
      await _db.collection('exam_results').add(result.toFirestore());
    } catch (e) {
      print('Error saving result: $e');
      // Queue for later sync (basic offline handling)
      final prefs = await SharedPreferences.getInstance();
      final pending = prefs.getStringList('pending_results') ?? [];
      pending.add(jsonEncode(result.toFirestore()));
      await prefs.setStringList('pending_results', pending);
    }
  }

  /// Sync any pending offline results
  Future<void> syncPendingResults() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final pending = prefs.getStringList('pending_results') ?? [];
      if (pending.isEmpty) return;

      for (final jsonStr in pending) {
        final data = jsonDecode(jsonStr) as Map<String, dynamic>;
        await _db.collection('exam_results').add(data);
      }
      await prefs.setStringList('pending_results', []);
    } catch (e) {
      print('Sync error: $e');
    }
  }

  /// Get available subjects from the question bank
  Future<List<String>> getAvailableSubjects() async {
    try {
      final snap = await _db.collection('questions').get();
      final subjects = snap.docs
          .map((d) => (d.data()['subject'] ?? 'MI') as String)
          .toSet()
          .toList()
        ..sort();
      return subjects;
    } catch (e) {
      return ['MI'];
    }
  }
}
