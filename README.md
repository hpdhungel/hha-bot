# HHA Bot

Android-only React Native app for scheduled HHAeXchange clock-in and clock-out automation.

## What It Includes

- Multiple schedules with time, day-of-week, client, visit label, and clock-in or clock-out mode
- Secure credential storage using Android encrypted shared preferences
- Exact alarm scheduling for background execution
- Manual Run Now support that uses the same native automation path as scheduled runs
- Execution logs and runtime status in the React Native UI
- Native Android Accessibility Service for UI detection, taps, text entry, gestures, and cleanup
- Retry handling, notifications, and boot-time rescheduling

## Architecture

- React Native UI: schedule management, logs, credentials, permission shortcuts
- Native module: persistent storage, encrypted credentials, runtime status, exact-alarm scheduling
- Broadcast receivers: scheduled execution and boot/package-replaced rescheduling
- Accessibility service: HHAeXchange automation using view IDs first, then visible text, then coordinate fallback

## Android Requirements

The app is designed for Android only. The iOS folder may exist because of the React Native scaffold, but the implemented feature set depends on Android-only APIs:

- Accessibility Service
- AlarmManager exact alarms
- Boot receivers
- Android notification channels
- EncryptedSharedPreferences
- Battery optimization settings

## Local Development

### 1. Install dependencies

```sh
npm install
```

### 2. Start Metro

```sh
npm start
```

### 3. Build Android debug APK

```sh
cd android
./gradlew assembleDebug
```

### 4. Run on a device or emulator

```sh
npm run android
```

## Required Device Setup

Before schedules can run reliably, configure the Android device:

1. Open the app and save your HHA email and password.
2. Enable the app's accessibility service.
3. Allow exact alarms on Android 12 and above.
4. Disable battery optimization for this app.
5. Allow notifications if you want start, success, and failure alerts.
6. Test one manual run on the target device to validate the HHAeXchange UI layout.

## Automation Flow

The current native flow is built from the provided clock-out macro and supports both scheduled and manual execution:

1. Wait 5 seconds.
2. Swipe up to prepare or unlock the device UI.
3. Launch HHAeXchange.
4. Wait 15 seconds for app load.
5. If login fields are visible, fill credentials and tap Log In.
6. Select the visit label.
7. Select the client name.
8. Tap Clock In or Clock Out.
9. Handle GPS and confirmation steps.
10. For clock-out, check Performed items and tap Save.
11. Open recents and tap Close all using device-specific fallbacks.

## Reliability Notes

- The service retries a failed run once after a 5-second pause.
- Every run updates runtime state and app-visible execution logs.
- Notifications are emitted for start, success, and failure states.
- The implementation prefers stable view IDs, then text matches, then percentage-based coordinate taps.
- HHAeXchange UI can vary by account, app version, and device; coordinate fallbacks may need tuning on your phone.

## Important Limitations

- Accessibility automation cannot bypass lock-screen security that blocks interaction.
- Exact delivery timing on some OEM devices can still be affected if battery controls are not relaxed.
- If HHAeXchange changes IDs, labels, or flow order, the native service will need updating.
- The current implementation stores and reuses one credential set for all schedules.

## Key Files

- App.tsx
- src/hhaAutomation.ts
- src/types.ts
- android/app/src/main/java/com/hha_bot/HhaAutomationModule.kt
- android/app/src/main/java/com/hha_bot/HhaAutomationStore.kt
- android/app/src/main/java/com/hha_bot/HhaAccessibilityService.kt
- android/app/src/main/java/com/hha_bot/ScheduleAlarmReceiver.kt
- android/app/src/main/java/com/hha_bot/BootReceiver.kt
- android/app/src/main/AndroidManifest.xml
- android/app/src/main/res/xml/accessibility_service_config.xml
# hha-bot
