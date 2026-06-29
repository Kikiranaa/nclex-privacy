# 🏥 NCA NCLEX-RN CAT — Flutter Mobile App

**Dhaliwal's New Careers Academy — Est. 1967**
Cross-platform mobile app (Android + iOS) with Computerized Adaptive Testing,
Firebase backend, screenshot blocking, and offline support.

---

## 📁 Project Structure

```
nca-flutter-app/
├── pubspec.yaml                         # Dependencies
├── lib/
│   ├── main.dart                        # App entry, theme, routes
│   ├── models/
│   │   └── question.dart                # Data models (Question, ExamResult)
│   ├── services/
│   │   ├── cat_engine.dart              # CAT algorithm (IRT 1PL Rasch model)
│   │   └── firebase_service.dart        # Auth + Firestore + offline cache
│   ├── screens/
│   │   ├── login_screen.dart            # Whitelist-only Firebase login
│   │   ├── setup_screen.dart            # Exam configuration (75/100/145/custom)
│   │   ├── quiz_screen.dart             # Main CAT quiz with adaptive logic
│   │   └── results_screen.dart          # Performance report + logit chart
│   └── widgets/
│       └── secure_wrapper.dart          # FLAG_SECURE + watermark + no-copy
├── scripts/
│   ├── admin_upload.py                  # Question uploader + candidate manager
│   └── sample_questions.csv             # CSV template
└── README.md
```

---

## 🚀 Setup Guide

### Step 1: Create Flutter Project

```bash
flutter create nca_nclex_cat --org com.newcareersacademy
cd nca_nclex_cat
```

Then replace the generated `lib/`, `pubspec.yaml` with the files provided.

### Step 2: Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com) → Create project
2. Add Android app:
   - Package name: `com.newcareersacademy.nca_nclex_cat`
   - Download `google-services.json` → place in `android/app/`
3. Add iOS app:
   - Bundle ID: `com.newcareersacademy.ncaNclexCat`
   - Download `GoogleService-Info.plist` → place in `ios/Runner/`
4. Enable **Firestore Database** (production mode)
5. Enable **Authentication** → Email/Password sign-in method
6. Download **Service Account key** for admin scripts:
   - Project Settings → Service Accounts → Generate New Private Key
   - Save as `scripts/firebase_credentials.json`

### Step 3: Android Configuration

**`android/app/build.gradle`** — set minimum SDK:
```gradle
android {
    defaultConfig {
        minSdkVersion 21  // Required for Flutter WindowManager
    }
}
```

**`android/app/src/main/AndroidManifest.xml`** — add internet permission:
```xml
<uses-permission android:name="android.permission.INTERNET"/>
```

### Step 4: Install Dependencies

```bash
flutter pub get
```

### Step 5: Upload Questions

```bash
cd scripts
pip install firebase-admin
python admin_upload.py upload --file sample_questions.csv
python admin_upload.py add-student --email student@nca.in --password nca2026 --name "Demo Student" --batch "NCLEX 2026"
```

### Step 6: Run

```bash
flutter run
```

---

## 🔥 Firebase Firestore Structure

```
Firestore
│
├── questions/                        ← Your question bank
│   ├── {auto-id}
│   │   ├── subject: "MI"            ← Topic filter
│   │   ├── category: "Priority"     ← Sub-category
│   │   ├── difficulty: 3            ← INTEGER 1-5 (CAT uses this!)
│   │   ├── question: "A client..."  ← Question stem
│   │   ├── options: [A, B, C, D]    ← Array of 4 strings
│   │   ├── answer: 2                ← 0=A, 1=B, 2=C, 3=D
│   │   ├── rationale_correct: "..." ← Why correct answer is right
│   │   └── rationale_wrong: {       ← Why each wrong answer is wrong
│   │         "0": "A is wrong...",
│   │         "1": "B is wrong...",
│   │         "3": "D is wrong..."
│   │       }
│   └── ...
│
├── approved_candidates/              ← Whitelist
│   ├── {auto-id}
│   │   ├── email: "student@nca.in"  ← Must match Firebase Auth email
│   │   ├── password: "nca2026"      ← For backup verification
│   │   ├── name: "Student Name"
│   │   ├── batch: "NCLEX 2026"
│   │   └── approved: true           ← Toggle to enable/disable access
│   └── ...
│
└── exam_results/                     ← Auto-saved after each exam
    ├── {auto-id}
    │   ├── user_email, user_name, batch
    │   ├── total_questions: 75
    │   ├── total_correct: 52
    │   ├── raw_accuracy: 0.693
    │   ├── final_theta: +0.45       ← IRT ability estimate
    │   ├── pass_probability: 0.82
    │   ├── passed: true
    │   ├── avg_difficulty: 3.2
    │   └── exam_date: Timestamp
    └── ...
```

---

## 🧠 CAT Algorithm

### Adaptive Flow
```
START → Difficulty = 3 (Medium)
  │
  ├─ ✅ Correct → Difficulty +1 → Theta increases via MLE
  │
  ├─ ❌ Incorrect → Difficulty -1 → Theta decreases via MLE
  │
  └─ STOP when:
       ├─ 95% confidence above or below passing standard (0.0 logits)
       ├─ Standard Error < 0.30 after minimum 15 questions
       └─ Maximum questions reached
```

### Difficulty ↔ Logit Mapping
| Level | Name         | Logit |
|:---:|---|:---:|
| 1 | Easy          | -2.0 |
| 2 | Below Average | -1.0 |
| 3 | Medium        |  0.0 ← Passing Standard |
| 4 | Above Average | +1.0 |
| 5 | Hard          | +2.0 |

### Scoring (Matches NCLEX Philosophy)
| Performance | Raw Score | Logit | Result |
|---|:---:|:---:|:---:|
| 90% on Easy (L1-2) | 90% | -0.8 | **FAIL** |
| 75% on Medium (L3) | 75% | +0.2 | **PASS** |
| 65% on Hard (L4-5) | 65% | +1.1 | **STRONG PASS** |

---

## 🔒 Security Features

| Feature | Android | iOS |
|---|---|---|
| **Screenshot Blocking** | `FLAG_SECURE` via `flutter_windowmanager` — screen goes black | Content hidden when app goes inactive |
| **Screen Recording Block** | `FLAG_SECURE` blocks all capture | Warning overlay on detection |
| **Text Selection** | Disabled globally | Disabled globally |
| **Copy/Paste** | Disabled via widget tree | Disabled via widget tree |
| **Watermark** | Diagonal "New Careers Academy" overlay | Same |
| **Auth** | Firebase Auth + Firestore whitelist | Same |

---

## 📱 Offline Mode

The app automatically:
1. **Caches all questions locally** (JSON in SharedPreferences) after first fetch
2. **Works without internet** using cached questions
3. **Queues exam results** if offline
4. **Syncs results** to Firebase when connection is restored

---

## 📊 Admin Commands

```bash
# Upload questions (CSV or JSON)
python admin_upload.py upload --file my_questions.csv

# Clear existing + upload fresh
python admin_upload.py upload --file my_questions.csv --clear

# Add approved student
python admin_upload.py add-student \
  --email student@nca.in \
  --password nca2026 \
  --name "Preet Kaur" \
  --batch "NCLEX Jan 2026"

# List all candidates
python admin_upload.py list-students

# Disable a student's access
python admin_upload.py disable-student --email student@nca.in
```

---

## 🎯 Recommended Question Distribution

| Difficulty | % of Bank | Minimum |
|:---:|:---:|:---:|
| Level 1 (Easy) | 15% | 50+ |
| Level 2 (Below Avg) | 20% | 60+ |
| Level 3 (Medium) | 30% | 100+ |
| Level 4 (Above Avg) | 20% | 60+ |
| Level 5 (Hard) | 15% | 50+ |

**Total minimum: 320+ questions** for robust CAT testing.

---

## 🏗 Building for Release

### Android APK
```bash
flutter build apk --release
# Output: build/app/outputs/flutter-apk/app-release.apk
```

### Android App Bundle (Play Store)
```bash
flutter build appbundle --release
# Output: build/app/outputs/bundle/release/app-release.aab
```

### iOS (requires macOS + Xcode)
```bash
flutter build ios --release
# Then archive via Xcode for App Store submission
```

---

© 2026 Dhaliwal's New Careers Academy. All Rights Reserved.
