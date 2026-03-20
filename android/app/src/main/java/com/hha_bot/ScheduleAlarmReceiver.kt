package com.hha_bot

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class ScheduleAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val scheduleId = intent.getStringExtra("scheduleId") ?: return
    val schedule = HhaAutomationStore.getSchedule(context, scheduleId) ?: return
    HhaAutomationStore.scheduleNextOccurrence(context, schedule)
    HhaAccessibilityService.requestExecution(context, scheduleId, "scheduled")
  }
}