package com.hha_bot

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class HhaAutomationModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "HhaAutomationModule"

  @ReactMethod
  fun getSchedules(promise: Promise) {
    promise.resolve(HhaAutomationStore.getSchedules(reactContext).toString())
  }

  @ReactMethod
  fun upsertSchedule(scheduleJson: String, promise: Promise) {
    try {
      val schedules = HhaAutomationStore.upsertSchedule(reactContext, scheduleJson)
      promise.resolve(schedules.toString())
    } catch (error: Exception) {
      promise.reject("SCHEDULE_UPSERT_FAILED", error)
    }
  }

  @ReactMethod
  fun deleteSchedule(scheduleId: String, promise: Promise) {
    try {
      val schedules = HhaAutomationStore.deleteSchedule(reactContext, scheduleId)
      promise.resolve(schedules.toString())
    } catch (error: Exception) {
      promise.reject("SCHEDULE_DELETE_FAILED", error)
    }
  }

  @ReactMethod
  fun getLogs(promise: Promise) {
    promise.resolve(HhaAutomationStore.getLogs(reactContext).toString())
  }

  @ReactMethod
  fun clearLogs(promise: Promise) {
    HhaAutomationStore.clearLogs(reactContext)
    promise.resolve(null)
  }

  @ReactMethod
  fun saveCredentials(email: String, password: String, promise: Promise) {
    try {
      HhaAutomationStore.saveCredentials(reactContext, email, password)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("SAVE_CREDENTIALS_FAILED", error)
    }
  }

  @ReactMethod
  fun getCredentialsSummary(promise: Promise) {
    promise.resolve(HhaAutomationStore.getCredentialsSummary(reactContext).toString())
  }

  @ReactMethod
  fun getRuntimeStatus(promise: Promise) {
    promise.resolve(HhaAutomationStore.getRuntimeStatus(reactContext).toString())
  }

  @ReactMethod
  fun getSystemStatus(promise: Promise) {
    promise.resolve(HhaAutomationStore.getSystemStatus(reactContext).toString())
  }

  @ReactMethod
  fun runNow(scheduleId: String, promise: Promise) {
    val started = HhaAccessibilityService.requestExecution(reactContext, scheduleId, "manual")
    if (started) {
      promise.resolve("started")
    } else {
      promise.reject(
        "RUN_NOW_FAILED",
        "Automation could not start. Check accessibility and credentials.",
      )
    }
  }

  @ReactMethod
  fun openAccessibilitySettings(promise: Promise) {
    reactContext.startActivity(
      Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
    promise.resolve(null)
  }

  @ReactMethod
  fun openBatteryOptimizationSettings(promise: Promise) {
    val intent =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
      } else {
        Intent(Settings.ACTION_SETTINGS)
      }
    reactContext.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    promise.resolve(null)
  }

  @ReactMethod
  fun openExactAlarmSettings(promise: Promise) {
    val intent =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        Intent(
          Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
          Uri.parse("package:${reactContext.packageName}"),
        )
      } else {
        Intent(Settings.ACTION_SETTINGS)
      }
    reactContext.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    promise.resolve(null)
  }
}