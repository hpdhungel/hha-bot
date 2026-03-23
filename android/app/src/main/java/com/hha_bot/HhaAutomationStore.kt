package com.hha_bot

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDateTime
import java.time.ZoneId
import java.util.UUID

object HhaAutomationStore {
  private const val PREFS_NAME = "hha_automation"
  private const val SECURE_PREFS_NAME = "hha_automation_secure"
  private const val KEY_SCHEDULES = "schedules"
  private const val KEY_LOGS = "logs"
  private const val KEY_RUNTIME = "runtime"
  private const val KEY_EMAIL = "email"
  private const val KEY_PASSWORD = "password"
  private const val KEY_CREDENTIAL_SETS = "credential_sets"
  private const val KEY_CREDENTIAL_PASSWORD_PREFIX = "credential_password_"

  private const val EXECUTION_CHANNEL_ID = "hha_execution"
  private const val MAX_LOGS = 200

  fun getSchedules(context: Context): JSONArray {
    return JSONArray(getPrefs(context).getString(KEY_SCHEDULES, "[]") ?: "[]")
  }

  fun getSchedule(context: Context, scheduleId: String): JSONObject? {
    val schedules = getSchedules(context)
    for (index in 0 until schedules.length()) {
      val schedule = schedules.optJSONObject(index) ?: continue
      if (schedule.optString("id") == scheduleId) {
        return schedule
      }
    }
    return null
  }

  fun upsertSchedule(context: Context, scheduleJson: String): JSONArray {
    val schedule = JSONObject(scheduleJson)
    if (!schedule.has("packageName")) {
      schedule.put("packageName", "com.hhaexchange.caregiver")
    }

    val schedules = getSchedules(context)
    val nextSchedules = JSONArray()
    var updated = false

    for (index in 0 until schedules.length()) {
      val current = schedules.optJSONObject(index) ?: continue
      if (current.optString("id") == schedule.optString("id")) {
        nextSchedules.put(schedule)
        updated = true
      } else {
        nextSchedules.put(current)
      }
    }

    if (!updated) {
      nextSchedules.put(schedule)
    }

    saveSchedules(context, nextSchedules)
    if (schedule.optBoolean("enabled", true)) {
      scheduleNextOccurrence(context, schedule)
    } else {
      cancelSchedule(context, schedule.optString("id"))
    }

    return nextSchedules
  }

  fun deleteSchedule(context: Context, scheduleId: String): JSONArray {
    val schedules = getSchedules(context)
    val nextSchedules = JSONArray()

    for (index in 0 until schedules.length()) {
      val current = schedules.optJSONObject(index) ?: continue
      if (current.optString("id") != scheduleId) {
        nextSchedules.put(current)
      }
    }

    saveSchedules(context, nextSchedules)
    cancelSchedule(context, scheduleId)
    return nextSchedules
  }

  fun rescheduleAll(context: Context) {
    val schedules = getSchedules(context)
    for (index in 0 until schedules.length()) {
      val schedule = schedules.optJSONObject(index) ?: continue
      if (schedule.optBoolean("enabled", true)) {
        scheduleNextOccurrence(context, schedule)
      } else {
        cancelSchedule(context, schedule.optString("id"))
      }
    }
  }

  fun scheduleNextOccurrence(context: Context, schedule: JSONObject) {
    val scheduleId = schedule.optString("id")
    if (scheduleId.isBlank() || !schedule.optBoolean("enabled", true)) {
      cancelSchedule(context, scheduleId)
      return
    }

    val nextTrigger = computeNextTriggerAtMillis(schedule) ?: run {
      cancelSchedule(context, scheduleId)
      return
    }

    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val pendingIntent = buildSchedulePendingIntent(context, scheduleId)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && alarmManager.canScheduleExactAlarms()) {
      alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, nextTrigger, pendingIntent)
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, nextTrigger, pendingIntent)
    } else {
      alarmManager.setExact(AlarmManager.RTC_WAKEUP, nextTrigger, pendingIntent)
    }
  }

  fun cancelSchedule(context: Context, scheduleId: String) {
    if (scheduleId.isBlank()) {
      return
    }

    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    alarmManager.cancel(buildSchedulePendingIntent(context, scheduleId))
  }

  fun getLogs(context: Context): JSONArray {
    return JSONArray(getPrefs(context).getString(KEY_LOGS, "[]") ?: "[]")
  }

  fun clearLogs(context: Context) {
    getPrefs(context).edit().putString(KEY_LOGS, "[]").apply()
  }

  fun appendLog(context: Context, log: JSONObject) {
    val current = getLogs(context)
    val next = JSONArray()
    next.put(log)
    for (index in 0 until current.length()) {
      if (index >= MAX_LOGS - 1) {
        break
      }
      current.optJSONObject(index)?.let(next::put)
    }
    getPrefs(context).edit().putString(KEY_LOGS, next.toString()).apply()
  }

  fun setRuntimeStatus(context: Context, runtime: JSONObject?) {
    val payload = runtime?.toString() ?: JSONObject().put("status", "idle").toString()
    getPrefs(context).edit().putString(KEY_RUNTIME, payload).apply()
  }

  fun getRuntimeStatus(context: Context): JSONObject {
    val fallback = JSONObject().put("status", "idle").toString()
    return JSONObject(getPrefs(context).getString(KEY_RUNTIME, fallback) ?: fallback)
  }

  fun saveCredentials(context: Context, email: String, password: String) {
    getSecurePrefs(context)
      .edit()
      .putString(KEY_EMAIL, email)
      .putString(KEY_PASSWORD, password)
      .apply()
  }

  fun getCredentialsSummary(context: Context): JSONObject {
    val securePrefs = getSecurePrefs(context)
    return JSONObject()
      .put("email", securePrefs.getString(KEY_EMAIL, "") ?: "")
      .put("hasPassword", !securePrefs.getString(KEY_PASSWORD, "").isNullOrBlank())
  }

  fun getCredentialEmail(context: Context): String? {
    return getSecurePrefs(context).getString(KEY_EMAIL, null)
  }

  fun getCredentialPassword(context: Context): String? {
    return getSecurePrefs(context).getString(KEY_PASSWORD, null)
  }

  fun getAllCredentials(context: Context): JSONArray {
    return JSONArray(getPrefs(context).getString(KEY_CREDENTIAL_SETS, "[]") ?: "[]")
  }

  fun saveCredentialSet(context: Context, credentialSetJson: String): JSONArray {
    val incoming = JSONObject(credentialSetJson)
    val email = incoming.optString("email").trim()
    if (email.isBlank()) {
      throw IllegalArgumentException("Credential email is required.")
    }

    val requestedId = incoming.optString("id").trim()
    val credentialId = if (requestedId.isBlank()) "cred_${UUID.randomUUID()}" else requestedId
    val incomingPassword = incoming.optString("password")
    val securePrefs = getSecurePrefs(context)
    val existingPassword = securePrefs.getString(getCredentialPasswordKey(credentialId), null)
    val hasPassword = incomingPassword.isNotBlank() || !existingPassword.isNullOrBlank()

    val current = getAllCredentials(context)
    val next = JSONArray()
    var updated = false

    for (index in 0 until current.length()) {
      val item = current.optJSONObject(index) ?: continue
      if (item.optString("id") == credentialId) {
        next.put(
          JSONObject()
            .put("id", credentialId)
            .put("email", email)
            .put("hasPassword", hasPassword),
        )
        updated = true
      } else {
        next.put(
          JSONObject()
            .put("id", item.optString("id"))
            .put("email", item.optString("email"))
            .put("hasPassword", item.optBoolean("hasPassword", false)),
        )
      }
    }

    if (!updated) {
      next.put(
        JSONObject()
          .put("id", credentialId)
          .put("email", email)
          .put("hasPassword", hasPassword),
      )
    }

    getPrefs(context).edit().putString(KEY_CREDENTIAL_SETS, next.toString()).apply()

    val secureEditor = securePrefs.edit()
    if (incomingPassword.isNotBlank()) {
      secureEditor.putString(getCredentialPasswordKey(credentialId), incomingPassword)
    } else if (!hasPassword) {
      secureEditor.remove(getCredentialPasswordKey(credentialId))
    }
    secureEditor.apply()

    return next
  }

  fun deleteCredential(context: Context, credentialId: String): JSONArray {
    if (credentialId.isBlank()) {
      return getAllCredentials(context)
    }

    val current = getAllCredentials(context)
    val next = JSONArray()

    for (index in 0 until current.length()) {
      val item = current.optJSONObject(index) ?: continue
      if (item.optString("id") != credentialId) {
        next.put(item)
      }
    }

    getPrefs(context).edit().putString(KEY_CREDENTIAL_SETS, next.toString()).apply()
    getSecurePrefs(context).edit().remove(getCredentialPasswordKey(credentialId)).apply()

    val schedules = getSchedules(context)
    val updatedSchedules = JSONArray()
    for (index in 0 until schedules.length()) {
      val schedule = schedules.optJSONObject(index) ?: continue
      if (schedule.optString("accountId") == credentialId) {
        val cleaned = JSONObject(schedule.toString())
        cleaned.remove("accountId")
        cleaned.put("password", "")
        updatedSchedules.put(cleaned)
      } else {
        updatedSchedules.put(schedule)
      }
    }
    saveSchedules(context, updatedSchedules)

    return next
  }

  fun getCredentialEmailById(context: Context, credentialId: String): String? {
    if (credentialId.isBlank()) {
      return null
    }

    val credentials = getAllCredentials(context)
    for (index in 0 until credentials.length()) {
      val credential = credentials.optJSONObject(index) ?: continue
      if (credential.optString("id") == credentialId) {
        return credential.optString("email").trim().ifBlank { null }
      }
    }

    return null
  }

  fun getCredentialPasswordById(context: Context, credentialId: String): String? {
    if (credentialId.isBlank()) {
      return null
    }

    return getSecurePrefs(context)
      .getString(getCredentialPasswordKey(credentialId), null)
      ?.takeIf { it.isNotBlank() }
  }

  fun getSystemStatus(context: Context): JSONObject {
    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    val notificationsGranted =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        ContextCompat.checkSelfPermission(
          context,
          android.Manifest.permission.POST_NOTIFICATIONS,
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
      } else {
        true
      }

    val exactAlarmGranted =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        alarmManager.canScheduleExactAlarms()
      } else {
        true
      }

    val batteryIgnored =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        powerManager.isIgnoringBatteryOptimizations(context.packageName)
      } else {
        true
      }

    val credentials = getAllCredentials(context)
    var hasAccountCredentials = false
    for (index in 0 until credentials.length()) {
      val credential = credentials.optJSONObject(index) ?: continue
      if (credential.optBoolean("hasPassword", false)) {
        hasAccountCredentials = true
        break
      }
    }

    val hasLegacyCredentials = getCredentialsSummary(context).optBoolean("hasPassword", false)

    return JSONObject()
      .put("accessibilityEnabled", isAccessibilityServiceEnabled(context))
      .put("exactAlarmGranted", exactAlarmGranted)
      .put("ignoringBatteryOptimizations", batteryIgnored)
      .put("notificationPermissionGranted", notificationsGranted)
      .put("hasCredentials", hasAccountCredentials || hasLegacyCredentials)
  }

  fun showNotification(context: Context, title: String, body: String, status: String) {
    ensureNotificationChannel(context)
    val icon =
      when (status) {
        "success" -> android.R.drawable.stat_sys_download_done
        "failed" -> android.R.drawable.stat_notify_error
        else -> android.R.drawable.stat_notify_sync
      }
    val notification =
      NotificationCompat.Builder(context, EXECUTION_CHANNEL_ID)
        .setSmallIcon(icon)
        .setContentTitle(title)
        .setContentText(body)
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setAutoCancel(true)
        .build()

    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.notify((System.currentTimeMillis() % Int.MAX_VALUE).toInt(), notification)
  }

  fun buildLog(
    schedule: JSONObject,
    source: String,
    status: String,
    message: String,
  ): JSONObject {
    return JSONObject()
      .put("id", UUID.randomUUID().toString())
      .put("scheduleId", schedule.optString("id"))
      .put("scheduleName", schedule.optString("name"))
      .put("type", schedule.optString("type", "clockOut"))
      .put("source", source)
      .put("status", status)
      .put("message", message)
      .put("timestamp", java.time.Instant.now().toString())
  }

  fun buildRuntime(
    schedule: JSONObject,
    source: String,
    status: String,
    message: String,
  ): JSONObject {
    return JSONObject()
      .put("scheduleId", schedule.optString("id"))
      .put("scheduleName", schedule.optString("name"))
      .put("type", schedule.optString("type", "clockOut"))
      .put("source", source)
      .put("status", status)
      .put("message", message)
      .put("updatedAt", java.time.Instant.now().toString())
  }

  private fun getPrefs(context: Context): SharedPreferences {
    return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
  }

  private fun getSecurePrefs(context: Context): SharedPreferences {
    val masterKey =
      MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    return EncryptedSharedPreferences.create(
      context,
      SECURE_PREFS_NAME,
      masterKey,
      EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
      EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )
  }

  private fun saveSchedules(context: Context, schedules: JSONArray) {
    getPrefs(context).edit().putString(KEY_SCHEDULES, schedules.toString()).apply()
  }

  private fun buildSchedulePendingIntent(context: Context, scheduleId: String): PendingIntent {
    val intent =
      Intent(context, ScheduleAlarmReceiver::class.java).apply {
        action = "com.hha_bot.RUN_SCHEDULE"
        putExtra("scheduleId", scheduleId)
      }
    return PendingIntent.getBroadcast(
      context,
      scheduleId.hashCode(),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun ensureNotificationChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }

    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val channel =
      NotificationChannel(
        EXECUTION_CHANNEL_ID,
        context.getString(R.string.notification_channel_execution_name),
        NotificationManager.IMPORTANCE_HIGH,
      ).apply {
        description = context.getString(R.string.notification_channel_execution_description)
      }
    manager.createNotificationChannel(channel)
  }

  private fun isAccessibilityServiceEnabled(context: Context): Boolean {
    val enabledServices =
      Settings.Secure.getString(
        context.contentResolver,
        Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
      ) ?: return false

    val expected = ComponentName(context, HhaAccessibilityService::class.java).flattenToString()
    return enabledServices.contains(expected)
  }

  private fun computeNextTriggerAtMillis(schedule: JSONObject): Long? {
    val time = schedule.optString("time")
    val parts = time.split(":")
    if (parts.size != 2) {
      return null
    }

    val hour = parts[0].toIntOrNull() ?: return null
    val minute = parts[1].toIntOrNull() ?: return null
    val days = schedule.optJSONArray("days") ?: return null
    val zoneId = ZoneId.systemDefault()
    val now = LocalDateTime.now(zoneId)

    for (offset in 0..7) {
      val candidateDate = now.toLocalDate().plusDays(offset.toLong())
      val dayIndex = candidateDate.dayOfWeek.value - 1
      val enabledForDay = days.optBoolean(dayIndex, false)
      if (!enabledForDay) {
        continue
      }

      val candidateDateTime = candidateDate.atTime(hour, minute)
      if (candidateDateTime.isAfter(now)) {
        return candidateDateTime.atZone(zoneId).toInstant().toEpochMilli()
      }
    }

    return null
  }

  private fun getCredentialPasswordKey(credentialId: String): String {
    return "$KEY_CREDENTIAL_PASSWORD_PREFIX$credentialId"
  }
}