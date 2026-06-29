"""
╔══════════════════════════════════════════════════════════════╗
║   NCA ADMIN — Question Uploader & Candidate Manager         ║
║   Upload MCQs from CSV/JSON to Firebase Firestore            ║
║   Manage approved candidate whitelist                        ║
╚══════════════════════════════════════════════════════════════╝

Usage:
  pip install firebase-admin

  # Upload questions
  python admin_upload.py upload --file questions.csv
  python admin_upload.py upload --file questions.json --clear

  # Manage candidates
  python admin_upload.py add-student --email student@nca.in --password nca2026 --name "John Doe" --batch "NCLEX 2026"
  python admin_upload.py list-students
  python admin_upload.py disable-student --email student@nca.in
"""

import csv, json, sys, argparse
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore, auth as fb_auth


def init_firebase():
    if not firebase_admin._apps:
        cred = credentials.Certificate("firebase_credentials.json")
        firebase_admin.initialize_app(cred)
    return firestore.client()


# ──────────────────────────────────────────────────
# UPLOAD QUESTIONS
# ──────────────────────────────────────────────────
def parse_csv(path):
    questions = []
    with open(path, 'r', encoding='utf-8-sig') as f:
        for i, row in enumerate(csv.DictReader(f), 2):
            row = {k.strip(): (v.strip() if v else '') for k, v in row.items()}
            try:
                answer = int(row.get('answer', 0))
                difficulty = int(row.get('difficulty', 3))
                assert 0 <= answer <= 3, f"answer must be 0-3"
                difficulty = max(1, min(5, difficulty))

                options = [row.get(f'option_{c}', '') for c in 'abcd']
                rationale_wrong = {}
                for j, c in enumerate('abcd'):
                    val = row.get(f'rationale_wrong_{c}', '')
                    if j != answer and val:
                        rationale_wrong[str(j)] = val

                questions.append({
                    'subject': row.get('subject', 'MI'),
                    'category': row.get('category', 'General'),
                    'difficulty': difficulty,
                    'question': row.get('question', ''),
                    'options': options,
                    'answer': answer,
                    'rationale_correct': row.get('rationale_correct', ''),
                    'rationale_wrong': rationale_wrong,
                })
            except Exception as e:
                print(f"  ⚠ Row {i}: {e}")
    return questions


def parse_json(path):
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    questions = []
    for i, item in enumerate(data):
        item.setdefault('subject', 'MI')
        item.setdefault('category', 'General')
        item['difficulty'] = max(1, min(5, int(item.get('difficulty', 3))))
        item.setdefault('rationale_correct', '')
        item.setdefault('rationale_wrong', {})
        questions.append(item)
    return questions


def upload_questions(args):
    path = Path(args.file)
    if not path.exists():
        print(f"❌ File not found: {path}")
        return

    ext = path.suffix.lower()
    questions = parse_csv(str(path)) if ext == '.csv' else parse_json(str(path))
    print(f"✅ Parsed {len(questions)} questions")

    db = init_firebase()
    col = db.collection('questions')

    if args.clear:
        print("🗑  Clearing existing questions...")
        for doc in col.stream():
            doc.reference.delete()

    batch = db.batch()
    for i, q in enumerate(questions):
        batch.set(col.document(), q)
        if (i + 1) % 450 == 0:
            batch.commit()
            batch = db.batch()
            print(f"   Committed {i+1}...")
    batch.commit()

    # Print summary
    diff_map = {}
    for q in questions:
        d = q['difficulty']
        diff_map[d] = diff_map.get(d, 0) + 1
    print(f"\n✅ Uploaded {len(questions)} questions!")
    print("   By difficulty:", {f"L{k}": v for k, v in sorted(diff_map.items())})


# ──────────────────────────────────────────────────
# CANDIDATE MANAGEMENT
# ──────────────────────────────────────────────────
def add_student(args):
    db = init_firebase()

    # Create Firebase Auth user
    try:
        user = fb_auth.create_user(
            email=args.email,
            password=args.password,
            display_name=args.name,
        )
        print(f"✅ Firebase Auth user created: {user.uid}")
    except fb_auth.EmailAlreadyExistsError:
        user = fb_auth.get_user_by_email(args.email)
        print(f"ℹ  User already exists in Auth: {user.uid}")
    except Exception as e:
        print(f"⚠  Auth creation failed: {e}")
        print("   Creating whitelist entry only...")

    # Add to whitelist
    db.collection('approved_candidates').document().set({
        'email': args.email.lower(),
        'password': args.password,  # For simple whitelist check; Firebase Auth handles actual auth
        'name': args.name,
        'batch': args.batch or '',
        'approved': True,
    })
    print(f"✅ Candidate whitelisted: {args.name} ({args.email})")


def list_students(args):
    db = init_firebase()
    docs = db.collection('approved_candidates').stream()
    print(f"\n{'Name':<25} {'Email':<35} {'Batch':<20} {'Status'}")
    print("─" * 100)
    for doc in docs:
        d = doc.to_dict()
        status = "✅ Approved" if d.get('approved') else "❌ Disabled"
        print(f"{d.get('name',''):<25} {d.get('email',''):<35} {d.get('batch',''):<20} {status}")


def disable_student(args):
    db = init_firebase()
    docs = db.collection('approved_candidates').where('email', '==', args.email.lower()).stream()
    found = False
    for doc in docs:
        doc.reference.update({'approved': False})
        found = True
    print(f"{'✅ Disabled' if found else '❌ Not found'}: {args.email}")


# ──────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="NCA Admin Tool")
    sub = parser.add_subparsers(dest='command')

    # Upload
    up = sub.add_parser('upload', help='Upload questions from CSV/JSON')
    up.add_argument('--file', '-f', required=True)
    up.add_argument('--clear', action='store_true')

    # Add student
    add = sub.add_parser('add-student', help='Add approved candidate')
    add.add_argument('--email', required=True)
    add.add_argument('--password', required=True)
    add.add_argument('--name', required=True)
    add.add_argument('--batch', default='')

    # List students
    sub.add_parser('list-students', help='List all candidates')

    # Disable student
    dis = sub.add_parser('disable-student', help='Disable a candidate')
    dis.add_argument('--email', required=True)

    args = parser.parse_args()
    if args.command == 'upload':
        upload_questions(args)
    elif args.command == 'add-student':
        add_student(args)
    elif args.command == 'list-students':
        list_students(args)
    elif args.command == 'disable-student':
        disable_student(args)
    else:
        parser.print_help()


if __name__ == '__main__':
    main()
