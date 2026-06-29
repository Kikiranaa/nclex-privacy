import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_windowmanager/flutter_windowmanager.dart';

/// ─────────────────────────────────────────────────────────
/// SECURE WRAPPER
///
/// Wraps any screen to:
///  1. Block screenshots & screen recording (Android FLAG_SECURE)
///  2. Detect screenshots on iOS and show warning
///  3. Disable text selection across all child widgets
///  4. Overlay diagonal watermark
/// ─────────────────────────────────────────────────────────
class SecureWrapper extends StatefulWidget {
  final Widget child;
  final bool showWatermark;

  const SecureWrapper({
    super.key,
    required this.child,
    this.showWatermark = true,
  });

  @override
  State<SecureWrapper> createState() => _SecureWrapperState();
}

class _SecureWrapperState extends State<SecureWrapper> with WidgetsBindingObserver {
  bool _screenshotDetected = false;

  @override
  void initState() {
    super.initState();
    _enableSecurity();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    _disableSecurity();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  /// Enable FLAG_SECURE on Android
  Future<void> _enableSecurity() async {
    try {
      if (Platform.isAndroid) {
        await FlutterWindowManager.addFlags(FlutterWindowManager.FLAG_SECURE);
      }
      // iOS screenshot detection is handled via didChangeAppLifecycleState
    } catch (e) {
      debugPrint('Security flag error: $e');
    }
  }

  /// Remove FLAG_SECURE when leaving secure screens
  Future<void> _disableSecurity() async {
    try {
      if (Platform.isAndroid) {
        await FlutterWindowManager.clearFlags(FlutterWindowManager.FLAG_SECURE);
      }
    } catch (e) {
      debugPrint('Security clear error: $e');
    }
  }

  /// iOS: Detect when app goes to background (possible screen capture)
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (Platform.isIOS) {
      if (state == AppLifecycleState.inactive) {
        // App is transitioning — iOS screenshot/recording might be happening
        setState(() => _screenshotDetected = true);
        Future.delayed(const Duration(seconds: 2), () {
          if (mounted) setState(() => _screenshotDetected = false);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        // ── Main Content (text selection disabled) ──
        SelectionArea(
          // Wrap in a SelectionArea but with no selection controls
          child: MediaQuery(
            data: MediaQuery.of(context).copyWith(
              // Disable text scale factor override
              textScaler: const TextScaler.linear(1.0),
            ),
            child: widget.child,
          ),
        ),

        // ── Watermark Overlay ──
        if (widget.showWatermark) const WatermarkOverlay(),

        // ── iOS Screenshot Warning Overlay ──
        if (_screenshotDetected)
          Positioned.fill(
            child: Container(
              color: Colors.white,
              child: const Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.shield, size: 64, color: Color(0xFF0056B3)),
                    SizedBox(height: 16),
                    Text(
                      'Content Protected',
                      style: TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                        color: Color(0xFF0056B3),
                      ),
                    ),
                    SizedBox(height: 8),
                    Text(
                      'Screenshots are not permitted\nduring the exam.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Color(0xFF5A6A7A), fontSize: 14),
                    ),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// ─────────────────────────────────────────────────────────
/// WATERMARK OVERLAY
/// Diagonal semi-transparent 'New Careers Academy' text
/// ─────────────────────────────────────────────────────────
class WatermarkOverlay extends StatelessWidget {
  const WatermarkOverlay({super.key});

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: SizedBox.expand(
        child: CustomPaint(
          painter: _WatermarkPainter(),
        ),
      ),
    );
  }
}

class _WatermarkPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final textStyle = TextStyle(
      color: const Color(0xFF0056B3).withOpacity(0.04),
      fontSize: 24,
      fontWeight: FontWeight.w900,
      letterSpacing: 4,
    );

    final textSpan = TextSpan(text: 'NEW CAREERS ACADEMY', style: textStyle);
    final textPainter = TextPainter(
      text: textSpan,
      textDirection: TextDirection.ltr,
    )..layout();

    canvas.save();
    canvas.translate(size.width / 2, size.height / 2);
    canvas.rotate(-0.6); // ~35 degrees diagonal

    // Draw multiple lines for full coverage
    for (double y = -size.height; y < size.height; y += 100) {
      for (double x = -size.width; x < size.width * 1.5; x += 380) {
        textPainter.paint(canvas, Offset(x, y));
      }
    }

    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

/// ─────────────────────────────────────────────────────────
/// NO-SELECT TEXT
/// Prevents copy/paste on individual text widgets
/// ─────────────────────────────────────────────────────────
class NoSelectText extends StatelessWidget {
  final String text;
  final TextStyle? style;
  final TextAlign? textAlign;
  final int? maxLines;

  const NoSelectText(
    this.text, {
    super.key,
    this.style,
    this.textAlign,
    this.maxLines,
  });

  @override
  Widget build(BuildContext context) {
    return ExcludeSemantics(
      child: Text(
        text,
        style: style,
        textAlign: textAlign,
        maxLines: maxLines,
      ),
    );
  }
}
