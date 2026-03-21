package com.hha_bot

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.accessibilityservice.GestureDescription
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.graphics.Path
import android.graphics.Rect
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONObject
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.math.roundToInt

class HhaAccessibilityService : AccessibilityService() {
  private val executor = Executors.newSingleThreadExecutor()

  @Volatile private var isRunning = false

  companion object {
    @Volatile private var instance: HhaAccessibilityService? = null

    fun requestExecution(context: Context, scheduleId: String, source: String): Boolean {
      val schedule = HhaAutomationStore.getSchedule(context, scheduleId) ?: return false
      val service = instance

      if (!HhaAutomationStore.getSystemStatus(context).optBoolean("accessibilityEnabled", false) || service == null) {
        val message = "Accessibility service is not enabled."
        HhaAutomationStore.setRuntimeStatus(
          context,
          HhaAutomationStore.buildRuntime(schedule, source, "failed", message),
        )
        HhaAutomationStore.appendLog(
          context,
          HhaAutomationStore.buildLog(schedule, source, "failed", message),
        )
        HhaAutomationStore.showNotification(context, schedule.optString("name"), message, "failed")
        return false
      }

      return service.startExecution(schedule, source)
    }
  }

  override fun onServiceConnected() {
    super.onServiceConnected()
    instance = this
    serviceInfo = serviceInfo.apply {
      flags =
        flags or
          AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
          AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
    }
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

  override fun onInterrupt() = Unit

  override fun onDestroy() {
    if (instance === this) {
      instance = null
    }
    executor.shutdownNow()
    super.onDestroy()
  }

  private fun startExecution(schedule: JSONObject, source: String): Boolean {
    synchronized(this) {
      if (isRunning) {
        val message = "Another automation run is already active."
        HhaAutomationStore.setRuntimeStatus(
          this,
          HhaAutomationStore.buildRuntime(schedule, source, "failed", message),
        )
        HhaAutomationStore.appendLog(this, HhaAutomationStore.buildLog(schedule, source, "failed", message))
        return false
      }
      isRunning = true
    }

    executor.execute {
      executeWithRetry(schedule, source)
    }
    return true
  }

  private fun executeWithRetry(schedule: JSONObject, source: String) {
    val actionLabel = if (schedule.optString("type") == "clockIn") "Clock In" else "Clock Out"
    HhaAutomationStore.setRuntimeStatus(
      this,
      HhaAutomationStore.buildRuntime(schedule, source, "running", "$actionLabel started."),
    )
    HhaAutomationStore.appendLog(
      this,
      HhaAutomationStore.buildLog(schedule, source, "running", "$actionLabel started."),
    )
    HhaAutomationStore.showNotification(this, schedule.optString("name"), "$actionLabel started.", "running")

    var lastError = "Unknown failure"
    for (attempt in 1..2) {
      try {
        executeOnce(schedule)
        val successMessage = "$actionLabel completed successfully."
        HhaAutomationStore.setRuntimeStatus(
          this,
          HhaAutomationStore.buildRuntime(schedule, source, "success", successMessage),
        )
        HhaAutomationStore.appendLog(
          this,
          HhaAutomationStore.buildLog(schedule, source, "success", successMessage),
        )
        HhaAutomationStore.showNotification(this, schedule.optString("name"), successMessage, "success")
        isRunning = false
        return
      } catch (error: Exception) {
        lastError = error.message ?: "Unknown error"
        if (attempt < 2) {
          val retryMessage = "Attempt $attempt failed. Retrying in 5 seconds."
          HhaAutomationStore.setRuntimeStatus(
            this,
            HhaAutomationStore.buildRuntime(schedule, source, "retrying", retryMessage),
          )
          HhaAutomationStore.appendLog(
            this,
            HhaAutomationStore.buildLog(schedule, source, "retrying", "$retryMessage $lastError"),
          )
          sleep(5000)
        }
      }
    }

    HhaAutomationStore.setRuntimeStatus(
      this,
      HhaAutomationStore.buildRuntime(schedule, source, "failed", lastError),
    )
    HhaAutomationStore.appendLog(
      this,
      HhaAutomationStore.buildLog(schedule, source, "failed", lastError),
    )
    HhaAutomationStore.showNotification(this, schedule.optString("name"), lastError, "failed")
    isRunning = false
  }

  private fun executeOnce(schedule: JSONObject) {
    val email = schedule.optString("email", "").takeIf { it.isNotBlank() }
    val password = schedule.optString("password", "").takeIf { it.isNotBlank() }

    if (email.isNullOrBlank() || password.isNullOrBlank()) {
      throw IllegalStateException("Credentials are missing from schedule.")
    }

    sleep(5000)
    swipe(0.5f, 0.85f, 0.5f, 0.18f, 250)

    if (!launchTargetApp(schedule.optString("packageName", "com.hhaexchange.caregiver"))) {
      throw IllegalStateException("Unable to launch HHAeXchange.")
    }

    sleep(10000)

    if (isLoginScreenVisible()) {
      setTextOnBestField(
        required = false,
        value = email,
        viewIds = listOf(
          "com.hhaexchange.caregiver:id/txt_email",
          "com.hhaexchange.caregiver:id/et_email",
          "com.hhaexchange.caregiver:id/edit_email",
          "com.hhaexchange.caregiver:id/txt_username",
        ),
        hints = listOf("email", "e-mail", "username"),
      )
      setTextOnBestField(
        required = true,
        value = password,
        viewIds = listOf(
          "com.hhaexchange.caregiver:id/txt_password",
          "com.hhaexchange.caregiver:id/edit_password",
          "com.hhaexchange.caregiver:id/et_password",
        ),
        hints = listOf("password"),
      )
      clickByCandidates(
        viewIds = listOf("com.hhaexchange.caregiver:id/btn_login"),
        texts = listOf("Log In", "Login"),
        contentDescriptions = emptyList(),
      )
      sleep(7000)

      if (isLoginScreenVisible()) {
        throw IllegalStateException("Login failed or the dashboard did not load.")
      }
    }

    openVisitForSchedule(schedule)
    sleep(1500)

    openClientForSchedule(schedule)
    sleep(2000)

    val scheduleType = schedule.optString("type")
    if (isClockActionAlreadyCompleted(scheduleType)) {
      cleanupRecentAppsSafely()
      return
    }

    if (scheduleType == "clockIn") {
      clickByCandidates(
        viewIds = listOf("com.hhaexchange.caregiver:id/btn_clock_in"),
        texts = listOf("Clock In"),
        contentDescriptions = emptyList(),
      )
    } else {
      clickByCandidates(
        viewIds = listOf("com.hhaexchange.caregiver:id/btn_clock_out"),
        texts = listOf("Clock Out"),
        contentDescriptions = emptyList(),
      )
    }

    sleep(3000)

    clickByCandidates(
      viewIds = listOf(
        "com.hhaexchange.caregiver:id/btn_gps",
        "com.hhaexchange.caregiver:id/button_gps",
      ),
      texts = listOf("GPS", "Verify Location"),
      contentDescriptions = listOf("GPS"),
      fallback = 0.472f to 0.826f,
      timeoutMs = 3000,
    )
    sleep(8000)

    clickByCandidates(
      viewIds = listOf(
        "com.hhaexchange.caregiver:id/button_confirm",
        "com.hhaexchange.caregiver:id/btn_confirm",
      ),
      texts = listOf("Confirm", "Done", "OK", "Continue"),
      contentDescriptions = listOf("Confirm"),
      fallback = 0.49f to 0.963f,
      timeoutMs = 3000,
    )
    sleep(4000)

    if (schedule.optString("type") == "clockOut") {
      completePerformedChecklist()
      clickByCandidates(
        viewIds = listOf("com.hhaexchange.caregiver:id/button_save"),
        texts = listOf("Save"),
        contentDescriptions = listOf("Save"),
        fallback = 0.883f to 0.067f,
        timeoutMs = 3000,
      )
      sleep(4000)
    }

    cleanupRecentAppsSafely()
  }

  private fun isLoginScreenVisible(): Boolean {
    return findNode(
      viewIds = listOf(
        "com.hhaexchange.caregiver:id/btn_login",
        "com.hhaexchange.caregiver:id/txt_password",
      ),
      texts = listOf("Log In", "Login"),
      contentDescriptions = emptyList(),
    ) != null
  }

  private fun openVisitForSchedule(schedule: JSONObject) {
    val visitLabel = schedule.optString("visitLabel").trim()
    val clientName = schedule.optString("clientName").trim()

    // If client is already visible, there is no need to click "Today's Schedule" again.
    if (clientName.isNotEmpty() && isClientVisible(clientName)) {
      return
    }

    val candidates = mutableListOf<String>()
    if (visitLabel.isNotEmpty()) {
      candidates.add(visitLabel)
    }
    candidates.add("Today's Schedule")
    candidates.add("Today's Schadule")
    candidates.add("Today")

    candidates.distinct().forEach { label ->
      val clicked = runCatching {
        clickByCandidates(
          viewIds = emptyList(),
          texts = listOf(label),
          contentDescriptions = emptyList(),
          timeoutMs = 4000,
        )
        true
      }.getOrDefault(false)

      if (clicked) {
        sleep(1500)
        if (clientName.isNotEmpty() && isClientVisible(clientName)) {
          return
        }
      }
    }

    if (clientName.isNotEmpty() && isClientVisible(clientName)) {
      return
    }

    throw IllegalStateException("Unable to open today's schedule view.")
  }

  private fun openClientForSchedule(schedule: JSONObject) {
    val clientName = schedule.optString("clientName").trim()
    val visitLabel = schedule.optString("visitLabel").trim()
    val scheduleType = schedule.optString("type")

    // If the visit detail page is already open, skip client tapping.
    if (isVisitDetailScreen(scheduleType)) {
      return
    }

    val candidates = findClientCandidatesForVisit(clientName, visitLabel, scheduleType)
    candidates.take(8).forEach { candidate ->
      if (!clickNode(candidate)) {
        return@forEach
      }

      sleep(1200)
      if (isVisitDetailScreen(scheduleType)) {
        return
      }
    }

    clickByCandidates(
      viewIds = emptyList(),
      texts = listOf(clientName),
      contentDescriptions = emptyList(),
      timeoutMs = 7000,
    )

    sleep(1200)
    if (!isVisitDetailScreen(scheduleType)) {
      throw IllegalStateException("Unable to open the correct client visit.")
    }
  }

  private fun isClientVisible(clientName: String): Boolean {
    if (clientName.isBlank()) {
      return false
    }

    return findNode(
      viewIds = emptyList(),
      texts = listOf(clientName),
      contentDescriptions = emptyList(),
    ) != null
  }

  private fun isClockActionVisible(scheduleType: String): Boolean {
    val isClockIn = scheduleType == "clockIn"
    val actionViewId = if (isClockIn) {
      "com.hhaexchange.caregiver:id/btn_clock_in"
    } else {
      "com.hhaexchange.caregiver:id/btn_clock_out"
    }
    val actionLabel = if (isClockIn) "Clock In" else "Clock Out"

    return findNode(
      viewIds = listOf(actionViewId),
      texts = listOf(actionLabel),
      contentDescriptions = emptyList(),
    ) != null
  }

  private fun isVisitDetailScreen(scheduleType: String): Boolean {
    if (isClockActionVisible(scheduleType)) {
      return true
    }

    return findNode(
      viewIds = emptyList(),
      texts = listOf("Visit Detail", "Clock In/Out"),
      contentDescriptions = emptyList(),
    ) != null
  }

  private fun isClockActionAlreadyCompleted(scheduleType: String): Boolean {
    if (!isVisitDetailScreen(scheduleType)) {
      return false
    }

    val isClockIn = scheduleType == "clockIn"
    val actionViewId = if (isClockIn) {
      "com.hhaexchange.caregiver:id/btn_clock_in"
    } else {
      "com.hhaexchange.caregiver:id/btn_clock_out"
    }
    val actionLabel = if (isClockIn) "Clock In" else "Clock Out"

    val confirmedVisible = isConfirmedStatusVisible()
    if (!confirmedVisible) {
      return false
    }

    val actionNode =
      findNode(
        viewIds = listOf(actionViewId),
        texts = listOf(actionLabel),
        contentDescriptions = emptyList(),
      )

    // If confirmed status is visible and the action button is gone or disabled,
    // the visit action was already completed.
    return actionNode == null || !isNodeActionable(actionNode)
  }

  private fun isConfirmedStatusVisible(): Boolean {
    val root = rootInActiveWindow ?: return false
    return traverse(root).any { node ->
      val text = node.text?.toString().orEmpty()
      val description = node.contentDescription?.toString().orEmpty()
      text.contains("Confirmed", true) || description.contains("Confirmed", true)
    }
  }

  private fun findClientCandidatesForVisit(
    clientName: String,
    visitLabel: String,
    scheduleType: String,
  ): List<AccessibilityNodeInfo> {
    val root = rootInActiveWindow ?: return emptyList()
    if (clientName.isBlank()) {
      return emptyList()
    }

    val normalizedClient = normalizeForMatch(clientName)
    val normalizedVisit = normalizeForMatch(visitLabel)
    val timeTokens = extractTimeTokens(visitLabel)
    val dateTokens = extractDateTokens(visitLabel)

    data class Ranked(val node: AccessibilityNodeInfo, val score: Int)

    val ranked = mutableListOf<Ranked>()
    val seen = mutableSetOf<String>()

    traverse(root).forEach { node ->
      val nodeText = node.text?.toString().orEmpty()
      if (!normalizeForMatch(nodeText).contains(normalizedClient)) {
        return@forEach
      }

      val container = findClickableContainer(node)
      val key = getNodeBoundsKey(container)
      if (!seen.add(key)) {
        return@forEach
      }

      val rawContext = collectSubtreeText(container)
      val normalizedContext = normalizeForMatch(rawContext)
      var score = 10

      if (normalizedVisit.isNotBlank() && !isGenericVisitLabel(visitLabel) && normalizedContext.contains(normalizedVisit)) {
        score += 100
      }

      timeTokens.forEach { token ->
        if (normalizedContext.contains(token)) {
          score += 35
        }
      }

      dateTokens.forEach { token ->
        if (normalizedContext.contains(token)) {
          score += 20
        }
      }

      val confirmedCount = Regex("confirmed", RegexOption.IGNORE_CASE).findAll(rawContext).count()
      if (scheduleType == "clockOut") {
        if (confirmedCount == 1) {
          score += 20
        }
        if (confirmedCount >= 2) {
          score -= 25
        }
      }

      if (scheduleType == "clockIn") {
        if (confirmedCount == 0) {
          score += 20
        }
        if (confirmedCount >= 1) {
          score -= 10
        }
      }

      ranked.add(Ranked(container, score))
    }

    return ranked.sortedByDescending { it.score }.map { it.node }
  }

  private fun collectSubtreeText(node: AccessibilityNodeInfo): String {
    return traverse(node)
      .joinToString(" ") {
        val text = it.text?.toString().orEmpty()
        val description = it.contentDescription?.toString().orEmpty()
        listOf(text, description).filter { value -> value.isNotBlank() }.joinToString(" ")
      }
  }

  private fun findClickableContainer(node: AccessibilityNodeInfo): AccessibilityNodeInfo {
    var current: AccessibilityNodeInfo? = node
    var fallback = node
    var depth = 0
    while (current != null && depth < 6) {
      fallback = current
      if (current.isClickable) {
        return current
      }
      current = current.parent
      depth += 1
    }
    return fallback
  }

  private fun normalizeForMatch(value: String): String {
    return value
      .lowercase(Locale.US)
      .replace(Regex("\\s+"), "")
  }

  private fun extractTimeTokens(value: String): List<String> {
    val regex = Regex("\\b\\d{1,2}:\\d{2}\\s?(?:AM|PM)\\b", RegexOption.IGNORE_CASE)
    return regex.findAll(value).map { normalizeForMatch(it.value) }.toList()
  }

  private fun extractDateTokens(value: String): List<String> {
    val regex = Regex("\\b\\d{1,2}/\\d{1,2}/\\d{2,4}\\b")
    return regex.findAll(value).map { normalizeForMatch(it.value) }.toList()
  }

  private fun isGenericVisitLabel(value: String): Boolean {
    val normalized = normalizeForMatch(value)
    return normalized == "clockin" || normalized == "clockout"
  }

  private fun getNodeBoundsKey(node: AccessibilityNodeInfo): String {
    val rect = Rect()
    node.getBoundsInScreen(rect)
    return "${rect.left},${rect.top},${rect.right},${rect.bottom}"
  }

  private fun isNodeActionable(node: AccessibilityNodeInfo): Boolean {
    var current: AccessibilityNodeInfo? = node
    while (current != null) {
      if (current.isClickable && current.isEnabled) {
        return true
      }
      current = current.parent
    }
    return false
  }

  private fun completePerformedChecklist() {
    var clicked = 0
    for (attempt in 0 until 3) {
      val nodes =
        rootInActiveWindow
          ?.findAccessibilityNodeInfosByViewId("com.hhaexchange.caregiver:id/check_box_performed")
          ?.filterNotNull()
          ?: emptyList()

      nodes.forEach { node ->
        if (!node.isChecked && clickNode(node)) {
          clicked += 1
          sleep(400)
        }
      }

      if (!performScrollForward()) {
        break
      }

      if (attempt < 2) {
        sleep(700)
      }
    }

    if (clicked == 0) {
      val fallbacks = listOf(
        0.833f to 0.259f,
        0.833f to 0.333f,
        0.833f to 0.407f,
        0.833f to 0.63f,
        0.833f to 0.852f,
      )
      fallbacks.forEach {
        tapAtPercent(it.first, it.second)
        sleep(350)
      }
    }
  }

  private fun cleanupRecentAppsSafely() {
    runCatching {
      cleanupRecentApps()
    }
  }

  private fun cleanupRecentApps() {
    performGlobalAction(GLOBAL_ACTION_RECENTS)
    sleep(3000)
    runCatching {
      clickByCandidates(
        viewIds = listOf(
          "com.sec.android.app.launcher:id/clear_all_button",
          "com.android.systemui:id/recents_RemoveAll_button_kk",
        ),
        texts = listOf("Close all", "Clear all", "CLEAR ALL"),
        contentDescriptions = listOf("Close all", "Clear all"),
        timeoutMs = 2500,
        required = false,
      )
    }
    sleep(3000)
  }

  private fun setTextOnBestField(
    required: Boolean,
    value: String,
    viewIds: List<String>,
    hints: List<String>,
  ) {
    val node = waitForNode(3500) { findEditableNode(viewIds, hints) }

    if (node == null) {
      if (required) {
        throw IllegalStateException("Required text field was not found.")
      }
      return
    }

    if (!setNodeText(node, value)) {
      throw IllegalStateException("Failed to fill a required field.")
    }
  }

  private fun clickByCandidates(
    viewIds: List<String>,
    texts: List<String>,
    contentDescriptions: List<String>,
    fallback: Pair<Float, Float>? = null,
    timeoutMs: Long = 5000,
    required: Boolean = true,
  ) {
    val node = waitForNode(timeoutMs) { findNode(viewIds, texts, contentDescriptions) }

    if (node != null && clickNode(node)) {
      return
    }

    if (fallback != null) {
      tapAtPercent(fallback.first, fallback.second)
      return
    }

    if (!required) {
      return
    }

    val label = (texts + contentDescriptions + viewIds).firstOrNull() ?: "target"
    throw IllegalStateException("Unable to click $label.")
  }

  private fun findEditableNode(viewIds: List<String>, hints: List<String>): AccessibilityNodeInfo? {
    val root = rootInActiveWindow ?: return null
    viewIds.forEach { viewId ->
      root.findAccessibilityNodeInfosByViewId(viewId)?.firstOrNull()?.let { return it }
    }

    return traverse(root).firstOrNull { node ->
      node.className?.toString()?.contains("EditText") == true &&
        hints.any { hint ->
          val text = node.text?.toString()?.lowercase(Locale.US).orEmpty()
          val description = node.contentDescription?.toString()?.lowercase(Locale.US).orEmpty()
          val viewId = node.viewIdResourceName?.lowercase(Locale.US).orEmpty()
          text.contains(hint) || description.contains(hint) || viewId.contains(hint)
        }
    }
  }

  private fun findNode(
    viewIds: List<String>,
    texts: List<String>,
    contentDescriptions: List<String>,
  ): AccessibilityNodeInfo? {
    val root = rootInActiveWindow ?: return null

    viewIds.forEach { viewId ->
      root.findAccessibilityNodeInfosByViewId(viewId)?.firstOrNull()?.let { return it }
    }

    val textMatches = texts.filter { it.isNotBlank() }
    traverse(root).forEach { node ->
      val nodeText = node.text?.toString().orEmpty()
      val nodeDescription = node.contentDescription?.toString().orEmpty()
      if (textMatches.any { candidate -> nodeText.contains(candidate, true) }) {
        return node
      }
      if (contentDescriptions.any { candidate -> nodeDescription.contains(candidate, true) }) {
        return node
      }
    }

    return null
  }

  private fun waitForNode(
    timeoutMs: Long,
    provider: () -> AccessibilityNodeInfo?,
  ): AccessibilityNodeInfo? {
    val start = System.currentTimeMillis()
    while (System.currentTimeMillis() - start < timeoutMs) {
      provider()?.let { return it }
      sleep(350)
    }
    return null
  }

  private fun clickNode(node: AccessibilityNodeInfo): Boolean {
    var current: AccessibilityNodeInfo? = node
    while (current != null) {
      if (current.isClickable) {
        return current.performAction(AccessibilityNodeInfo.ACTION_CLICK)
      }
      current = current.parent
    }
    return false
  }

  private fun setNodeText(node: AccessibilityNodeInfo, value: String): Boolean {
    clickNode(node)
    sleep(400)

    val args = Bundle().apply {
      putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value)
    }
    if (node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
      return true
    }

    val clipboardManager =
      getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
    clipboardManager.setPrimaryClip(ClipData.newPlainText("secure", value))
    node.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
    val pasted = node.performAction(AccessibilityNodeInfo.ACTION_PASTE)
    clipboardManager.setPrimaryClip(ClipData.newPlainText("secure", ""))
    return pasted
  }

  private fun performScrollForward(): Boolean {
    val root = rootInActiveWindow ?: return false
    traverse(root).forEach { node ->
      if (node.isScrollable && node.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)) {
        return true
      }
    }
    return false
  }

  private fun launchTargetApp(packageName: String): Boolean {
    val intent = packageManager.getLaunchIntentForPackage(packageName) ?: return false
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    startActivity(intent)
    return true
  }

  private fun tapAtPercent(xPercent: Float, yPercent: Float) {
    val metrics = resources.displayMetrics
    val x = (metrics.widthPixels * xPercent).roundToInt().toFloat()
    val y = (metrics.heightPixels * yPercent).roundToInt().toFloat()
    val path = Path().apply {
      moveTo(x, y)
    }
    val gesture =
      GestureDescription.Builder()
        .addStroke(GestureDescription.StrokeDescription(path, 0, 80))
        .build()
    dispatchGesture(gesture, null, Handler(Looper.getMainLooper()))
    sleep(250)
  }

  private fun swipe(startX: Float, startY: Float, endX: Float, endY: Float, durationMs: Long) {
    val metrics = resources.displayMetrics
    val path = Path().apply {
      moveTo(metrics.widthPixels * startX, metrics.heightPixels * startY)
      lineTo(metrics.widthPixels * endX, metrics.heightPixels * endY)
    }
    val gesture =
      GestureDescription.Builder()
        .addStroke(GestureDescription.StrokeDescription(path, 0, durationMs))
        .build()
    dispatchGesture(gesture, null, Handler(Looper.getMainLooper()))
    sleep(durationMs + 250)
  }

  private fun traverse(node: AccessibilityNodeInfo?): List<AccessibilityNodeInfo> {
    if (node == null) {
      return emptyList()
    }

    val result = mutableListOf<AccessibilityNodeInfo>()
    val queue = ArrayDeque<AccessibilityNodeInfo>()
    queue.add(node)

    while (queue.isNotEmpty()) {
      val current = queue.removeFirst()
      result.add(current)
      for (index in 0 until current.childCount) {
        current.getChild(index)?.let(queue::add)
      }
    }

    return result
  }

  private fun sleep(durationMs: Long) {
    try {
      TimeUnit.MILLISECONDS.sleep(durationMs)
    } catch (_: InterruptedException) {
      Thread.currentThread().interrupt()
    }
  }
}