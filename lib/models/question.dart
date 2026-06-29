import 'package:cloud_firestore/cloud_firestore.dart';
import 'dart:convert';

/// ─────────────────────────────────────────────────────────
/// QUESTION MODEL
/// Maps to Firestore 'questions' collection
/// Supports offline JSON serialization (no code-gen needed)
/// ─────────────────────────────────────────────────────────
class Question {
  final String id;
  final String subject;
  final String category;
  final int difficulty; // 1=Easy, 2=Below Avg, 3=Medium, 4=Above Avg, 5=Hard
  final String question;
  final List<String> options;
  final int answer; // 0-3 index (0=A, 1=B, 2=C, 3=D)
  final String rationaleCorrect;
  final Map<String, String> rationaleWrong; // {"0": "...", "1": "..."}

  Question({
    required this.id,
    required this.subject,
    required this.category,
    required this.difficulty,
    required this.question,
    required this.options,
    required this.answer,
    required this.rationaleCorrect,
    required this.rationaleWrong,
  });

  /// Create from Firestore document
  factory Question.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>;
    return Question(
      id: doc.id,
      subject: data['subject'] ?? 'MI',
      category: data['category'] ?? 'General',
      difficulty: (data['difficulty'] ?? 3).toInt().clamp(1, 5),
      question: data['question'] ?? '',
      options: List<String>.from(data['options'] ?? []),
      answer: (data['answer'] ?? 0).toInt().clamp(0, 3),
      rationaleCorrect: data['rationale_correct'] ?? '',
      rationaleWrong: Map<String, String>.from(data['rationale_wrong'] ?? {}),
    );
  }

  /// Convert to Firestore map
  Map<String, dynamic> toFirestore() => {
        'subject': subject,
        'category': category,
        'difficulty': difficulty,
        'question': question,
        'options': options,
        'answer': answer,
        'rationale_correct': rationaleCorrect,
        'rationale_wrong': rationaleWrong,
      };

  /// For offline JSON storage
  Map<String, dynamic> toJson() => {
        'id': id,
        ...toFirestore(),
      };

  /// From offline JSON storage
  factory Question.fromJson(Map<String, dynamic> json) => Question(
        id: json['id'] ?? '',
        subject: json['subject'] ?? 'MI',
        category: json['category'] ?? 'General',
        difficulty: (json['difficulty'] ?? 3).toInt().clamp(1, 5),
        question: json['question'] ?? '',
        options: List<String>.from(json['options'] ?? []),
        answer: (json['answer'] ?? 0).toInt().clamp(0, 3),
        rationaleCorrect: json['rationale_correct'] ?? '',
        rationaleWrong: Map<String, String>.from(json['rationale_wrong'] ?? {}),
      );
}

/// ─────────────────────────────────────────────────────────
/// EXAM RESULT MODEL
/// ─────────────────────────────────────────────────────────
class ExamResult {
  final String odUserId;
  final String userEmail;
  final String userName;
  final String subject;
  final int totalQuestions;
  final int totalCorrect;
  final double rawAccuracy;
  final double finalTheta;
  final double finalSe;
  final double passProbability;
  final bool passed;
  final double avgDifficulty;
  final DateTime examDate;
  final double durationMinutes;
  final List<AnswerRecord> answers;

  ExamResult({
    required this.odUserId,
    required this.userEmail,
    required this.userName,
    required this.subject,
    required this.totalQuestions,
    required this.totalCorrect,
    required this.rawAccuracy,
    required this.finalTheta,
    required this.finalSe,
    required this.passProbability,
    required this.passed,
    required this.avgDifficulty,
    required this.examDate,
    required this.durationMinutes,
    required this.answers,
  });

  Map<String, dynamic> toFirestore() => {
        'user_id': odUserId,
        'user_email': userEmail,
        'user_name': userName,
        'subject': subject,
        'total_questions': totalQuestions,
        'total_correct': totalCorrect,
        'raw_accuracy': rawAccuracy,
        'final_theta': finalTheta,
        'final_se': finalSe,
        'pass_probability': passProbability,
        'passed': passed,
        'avg_difficulty': avgDifficulty,
        'exam_date': Timestamp.fromDate(examDate),
        'duration_minutes': durationMinutes,
      };
}

/// ─────────────────────────────────────────────────────────
/// SINGLE ANSWER RECORD (per question)
/// ─────────────────────────────────────────────────────────
class AnswerRecord {
  final Question question;
  final int selectedOption;
  final bool isCorrect;
  final double thetaAfter;
  final double seAfter;

  AnswerRecord({
    required this.question,
    required this.selectedOption,
    required this.isCorrect,
    required this.thetaAfter,
    required this.seAfter,
  });
}
