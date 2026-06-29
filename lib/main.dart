import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:provider/provider.dart';
import 'services/firebase_service.dart';
import 'screens/login_screen.dart';
import 'screens/setup_screen.dart';
import 'screens/quiz_screen.dart';
import 'screens/results_screen.dart';

/// ─────────────────────────────────────────────────────────
/// NCA NCLEX-RN CAT SIMULATOR
/// Dhaliwal's New Careers Academy — Est. 1967
/// ─────────────────────────────────────────────────────────
void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp();

  // Lock orientation to portrait
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  // Set status bar style
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.dark,
  ));

  runApp(
    MultiProvider(
      providers: [
        Provider(create: (_) => AuthService()),
        Provider(create: (_) => FirestoreService()),
      ],
      child: const NCAApp(),
    ),
  );
}

class NCAApp extends StatelessWidget {
  const NCAApp({super.key});

  // ── NCA Brand Colors ──
  static const Color ncaBlue = Color(0xFF0056B3);
  static const Color ncaDark = Color(0xFF0A0A0A);
  static const Color ncaGrey = Color(0xFF5A6A7A);
  static const Color ncaLight = Color(0xFFF5F8FC);
  static const Color ncaGreen = Color(0xFF28A060);
  static const Color ncaRed = Color(0xFFCC3030);

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'NCA NCLEX-RN CAT',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.light,
        scaffoldBackgroundColor: Colors.white,
        colorScheme: ColorScheme.fromSeed(
          seedColor: ncaBlue,
          brightness: Brightness.light,
        ),
        appBarTheme: const AppBarTheme(
          backgroundColor: Colors.white,
          foregroundColor: ncaDark,
          elevation: 0,
          centerTitle: true,
          titleTextStyle: TextStyle(
            color: ncaDark,
            fontSize: 18,
            fontWeight: FontWeight.w700,
          ),
        ),
        elevatedButtonTheme: ElevatedButtonThemeData(
          style: ElevatedButton.styleFrom(
            backgroundColor: ncaBlue,
            foregroundColor: Colors.white,
            elevation: 0,
            padding: const EdgeInsets.symmetric(vertical: 16),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(10),
            ),
            textStyle: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: ncaLight,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10),
            borderSide: const BorderSide(color: Color(0xFFD8E6F5)),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10),
            borderSide: const BorderSide(color: Color(0xFFD8E6F5)),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10),
            borderSide: const BorderSide(color: ncaBlue, width: 2),
          ),
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        ),
        cardTheme: CardTheme(
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: const BorderSide(color: Color(0xFFD8E6F5)),
          ),
          color: const Color(0xFFF8FBFF),
        ),
      ),
      initialRoute: '/login',
      routes: {
        '/login': (_) => const LoginScreen(),
        '/setup': (_) => const SetupScreen(),
        // Quiz and Results are pushed with arguments, not named routes
      },
    );
  }
}
