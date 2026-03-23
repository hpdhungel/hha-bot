import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import  {
  DateTimePickerAndroid,
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  clearLogs,
  getAllCredentials,
  deleteSchedule,
  getLogs,
  getRuntimeStatus,
  getSchedules,
  saveCredentialSet,
  getSystemStatus,
  hasNativeAutomationSupport,
  openAccessibilitySettings,
  openBatteryOptimizationSettings,
  openExactAlarmSettings,
  runNow,
  upsertSchedule,
} from './src/hhaAutomation';
import {
  type CredentialSet,
  type ExecutionLog,
  type RuntimeStatus,
  type Schedule,
  type SystemStatus,
} from './src/types';

const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

type VisualTone = 'Neutral' | 'Success' | 'Warning' | 'Danger';

type AccountDraft = {
  id: string;
  email: string;
  password: string;
  hasPassword: boolean;
};

const emptySchedule = (): Schedule => ({
  id: '',
  name: '',
  type: 'clockIn',
  time: '',
  days: [true, true, true, true, true, true, true],
  clientName: '',
  visitLabel: '',
  enabled: true,
  packageName: 'com.hhaexchange.caregiver',
  accountId: '',
  email: '',
  password: '',
});

const emptyAccountDraft = (): AccountDraft => ({
  id: '',
  email: '',
  password: '',
  hasPassword: false,
});

function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent(): React.JSX.Element {
  const safeAreaInsets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<'schedules' | 'logs' | 'settings'>(
    'schedules',
  );
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [credentialSets, setCredentialSets] = useState<CredentialSet[]>([]);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>({
    status: 'idle',
  });
  const [accountEditorVisible, setAccountEditorVisible] = useState(false);
  const [accountDraft, setAccountDraft] = useState<AccountDraft>(emptyAccountDraft());
  const [showAccountPassword, setShowAccountPassword] = useState(false);
  const [editorVisible, setEditorVisible] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [draft, setDraft] = useState<Schedule>(emptySchedule());
  const [busyScheduleId, setBusyScheduleId] = useState<string | null>(null);

  useEffect(() => {
    ignorePromise(refreshAll());

    if (!hasNativeAutomationSupport()) {
      return undefined;
    }

    const timer = setInterval(() => {
      ignorePromise(refreshRuntimeAndLogs());
    }, 2500);

    return () => clearInterval(timer);
  }, []);

  async function refreshAll() {
    const [nextSchedules, nextLogs, nextRuntime, nextSystem, nextCredentialSets] =
      await Promise.all([
        getSchedules(),
        getLogs(),
        getRuntimeStatus(),
        getSystemStatus(),
        getAllCredentials(),
      ]);

    setSchedules(nextSchedules);
    setLogs(nextLogs);
    setRuntimeStatus(nextRuntime);
    setSystemStatus(nextSystem);
    setCredentialSets(nextCredentialSets);
  }

  async function refreshRuntimeAndLogs() {
    const [nextRuntime, nextLogs] = await Promise.all([
      getRuntimeStatus(),
      getLogs(),
    ]);

    setRuntimeStatus(nextRuntime);
    setLogs(nextLogs);
    setBusyScheduleId(
      nextRuntime.status === 'running' || nextRuntime.status === 'retrying'
        ? nextRuntime.scheduleId ?? null
        : null,
    );
  }

  function openCreateModal(accountId?: string) {
    const linkedAccount = accountId
      ? credentialSets.find(account => account.id === accountId)
      : undefined;

    setDraft({
      ...emptySchedule(),
      accountId: linkedAccount?.id ?? '',
      email: linkedAccount?.email ?? '',
    });
    setShowPassword(false);
    setEditorVisible(true);
  }

  function openCreateAccountModal() {
    setAccountDraft(emptyAccountDraft());
    setShowAccountPassword(false);
    setAccountEditorVisible(true);
  }

  function openEditAccountModal(account: CredentialSet) {
    setAccountDraft({
      id: account.id,
      email: account.email,
      password: '',
      hasPassword: account.hasPassword,
    });
    setShowAccountPassword(false);
    setAccountEditorVisible(true);
  }

  function openEditModal(schedule: Schedule) {
    const linkedAccount =
      (schedule.accountId
        ? credentialSets.find(account => account.id === schedule.accountId)
        : undefined) ?? findCredentialByEmail(credentialSets, schedule.email);

    setDraft({
      ...schedule,
      accountId: linkedAccount?.id ?? schedule.accountId ?? '',
      email: linkedAccount?.email ?? schedule.email,
      password: '',
    });
    setShowPassword(false);
    setEditorVisible(true);
  }

  async function saveScheduleDraft() {
    if (!isValidTime(draft.time)) {
      Alert.alert('Invalid time', 'Please use the clock picker to choose a valid time.');
      return;
    }

    if (!draft.clientName.trim() || !draft.visitLabel.trim()) {
      Alert.alert('Missing fields', 'Client name and visit label are required.');
      return;
    }

    const email = draft.email.trim();
    if (!email) {
      Alert.alert('Missing account', 'HHA account email is required.');
      return;
    }

    const linkedById = draft.accountId
      ? credentialSets.find(account => account.id === draft.accountId)
      : undefined;
    const linkedByEmail = findCredentialByEmail(credentialSets, email);
    const linkedAccount = linkedByEmail ?? linkedById;
    const enteredPassword = draft.password.trim();

    if ((!linkedAccount || !linkedAccount.hasPassword) && !enteredPassword) {
      Alert.alert(
        'Missing password',
        'Add a password for new accounts, or pick an existing account with saved credentials.',
      );
      return;
    }

    if (!draft.days.some(Boolean)) {
      Alert.alert('Missing days', 'Pick at least one day for the schedule.');
      return;
    }

    const accountPayload: CredentialSet = {
      id: linkedAccount?.id ?? createAccountId(),
      email,
      hasPassword: linkedAccount?.hasPassword ?? false,
      ...(enteredPassword ? { password: enteredPassword } : {}),
    };

    const shouldUpsertAccount =
      !linkedAccount ||
      linkedAccount.email.trim().toLowerCase() !== email.toLowerCase() ||
      Boolean(enteredPassword);

    let nextCredentialSets = credentialSets;
    if (shouldUpsertAccount) {
      nextCredentialSets = await saveCredentialSet(accountPayload);
      setCredentialSets(nextCredentialSets);
    }

    const resolvedAccount =
      nextCredentialSets.find(account => account.id === accountPayload.id) ??
      findCredentialByEmail(nextCredentialSets, email);

    const payload: Schedule = {
      ...draft,
      id: draft.id || createId(),
      name:
        draft.name.trim() ||
        `${draft.type === 'clockOut' ? 'Clock Out' : 'Clock In'} ${draft.clientName.trim()}`,
      clientName: draft.clientName.trim(),
      visitLabel: draft.visitLabel.trim(),
      accountId: resolvedAccount?.id,
      email,
      password: '',
    };

    const nextSchedules = await upsertSchedule(payload);
    setSchedules(nextSchedules);
    setEditorVisible(false);
    setShowPassword(false);
    setDraft(emptySchedule());
    setSystemStatus(await getSystemStatus());
  }

  async function onDeleteSchedule(schedule: Schedule) {
    Alert.alert('Delete schedule', `Remove ${schedule.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const nextSchedules = await deleteSchedule(schedule.id);
          setSchedules(nextSchedules);
        },
      },
    ]);
  }

  async function onToggleEnabled(schedule: Schedule, enabled: boolean) {
    const nextSchedules = await upsertSchedule({ ...schedule, enabled });
    setSchedules(nextSchedules);
    setSystemStatus(await getSystemStatus());
  }

  async function onRunNow(schedule: Schedule) {
    try {
      setBusyScheduleId(schedule.id);
      await runNow(schedule.id);
      await refreshRuntimeAndLogs();
    } catch (error) {
      setBusyScheduleId(null);
      Alert.alert(
        'Run failed',
        error instanceof Error ? error.message : 'Automation could not start.',
      );
    }
  }

  async function onClearLogs() {
    await clearLogs();
    setLogs([]);
  }

  async function saveAccountDraft() {
    const email = accountDraft.email.trim();
    if (!email) {
      Alert.alert('Missing email', 'HHA account email is required.');
      return;
    }

    const existingById = accountDraft.id
      ? credentialSets.find(account => account.id === accountDraft.id)
      : undefined;
    const existingByEmail = findCredentialByEmail(credentialSets, email);
    const existing = existingById ?? existingByEmail;
    const enteredPassword = accountDraft.password.trim();

    if (!(existing?.hasPassword || accountDraft.hasPassword) && !enteredPassword) {
      Alert.alert('Missing password', 'Password is required for a new user account.');
      return;
    }

    const payload: CredentialSet = {
      id: existing?.id ?? (accountDraft.id || createAccountId()),
      email,
      hasPassword: existing?.hasPassword ?? accountDraft.hasPassword,
      ...(enteredPassword ? { password: enteredPassword } : {}),
    };

    const nextCredentialSets = await saveCredentialSet(payload);
    setCredentialSets(nextCredentialSets);
    setAccountEditorVisible(false);
    setAccountDraft(emptyAccountDraft());
    setShowAccountPassword(false);
    setSystemStatus(await getSystemStatus());
  }

  function parseDraftToDate(): Date {
    const d = new Date();
    const m = draft.time.match(/(\d{1,2}):(\d{2})/);
    if (m) {
      d.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
    } else {
      d.setHours(6, 30, 0, 0);
    }
    return d;
  }

  function onTimePickerChange(event: DateTimePickerEvent, selected?: Date) {
    if (event.type !== 'set' || !selected) {
      return;
    }

    // Store as 24-hour HH:MM — Kotlin alarm parser requires this format
    const h24 = String(selected.getHours()).padStart(2, '0');
    const min = String(selected.getMinutes()).padStart(2, '0');
    setDraft(current => ({ ...current, time: `${h24}:${min}` }));
  }

  function openTimePicker() {
    DateTimePickerAndroid.open({
      value: parseDraftToDate(),
      mode: 'time',
      is24Hour: false,
      display: 'default',
      onChange: onTimePickerChange,
    });
  }

  function parseVisitTimeToDate(): Date {
    const d = new Date();
    const m = draft.visitLabel.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);

    if (!m) {
      d.setHours(7, 0, 0, 0);
      return d;
    }

    const rawHour = parseInt(m[1], 10);
    const minute = parseInt(m[2], 10);
    const isPm = m[3].toUpperCase() === 'PM';
    let hour24 = rawHour % 12;
    if (isPm) {
      hour24 += 12;
    }

    d.setHours(hour24, minute, 0, 0);
    return d;
  }

  function formatTimeForVisitLabel(date: Date): string {
    let hour = date.getHours();
    const minute = String(date.getMinutes()).padStart(2, '0');
    const period = hour < 12 ? 'AM' : 'PM';
    if (hour === 0) {
      hour = 12;
    } else if (hour > 12) {
      hour -= 12;
    }
    return `${hour}:${minute} ${period}`;
  }

  function onVisitTimePickerChange(event: DateTimePickerEvent, selected?: Date) {
    if (event.type !== 'set' || !selected) {
      return;
    }

    setDraft(current => ({
      ...current,
      visitLabel: formatTimeForVisitLabel(selected),
    }));
  }

  function openVisitTimePicker() {
    DateTimePickerAndroid.open({
      value: parseVisitTimeToDate(),
      mode: 'time',
      is24Hour: false,
      display: 'default',
      onChange: onVisitTimePickerChange,
    });
  }

  const enabledCount = schedules.filter(schedule => schedule.enabled).length;
  const statusTone = getStatusTone(runtimeStatus.status);
  const schedulesByAccount = credentialSets.map(account => ({
    account,
    schedules: schedules.filter(schedule => {
      if (schedule.accountId) {
        return schedule.accountId === account.id;
      }

      return (
        schedule.email.trim().toLowerCase() === account.email.trim().toLowerCase()
      );
    }),
  }));

  const unassignedSchedules = schedules.filter(schedule => {
    const linkedById = schedule.accountId
      ? credentialSets.some(account => account.id === schedule.accountId)
      : false;

    if (linkedById) {
      return false;
    }

    return !findCredentialByEmail(credentialSets, schedule.email);
  });

  return (
    <View
      style={[
        styles.safeArea,
        {
          paddingTop: safeAreaInsets.top,
          paddingBottom: safeAreaInsets.bottom,
        },
      ]}>
      <StatusBar barStyle="light-content" backgroundColor="#102a43" />
      <View style={styles.backgroundOrbTop} />
      <View style={styles.backgroundOrbBottom} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.headerCard}>
          <Text style={styles.eyebrow}>ANDROID AUTOMATION CONSOLE</Text>
          <Text style={styles.title}>HHA schedule runner</Text>
          <Text style={styles.subtitle}>
            Exact alarms, secure credentials, manual runs, and a native
            accessibility flow for HHAeXchange.
          </Text>
          <View style={styles.summaryRow}>
            <SummaryPill label="Schedules" value={String(schedules.length)} />
            <SummaryPill label="Enabled" value={String(enabledCount)} />
            <SummaryPill
              label="Runtime"
              value={runtimeStatus.status.toUpperCase()}
              tone={statusTone}
            />
          </View>
        </View>

        <View style={styles.segmentRow}>
          <TabButton
            label="Schedules"
            active={activeTab === 'schedules'}
            onPress={() => setActiveTab('schedules')}
          />
          <TabButton
            label="Logs"
            active={activeTab === 'logs'}
            onPress={() => setActiveTab('logs')}
          />
          <TabButton
            label="Settings"
            active={activeTab === 'settings'}
            onPress={() => setActiveTab('settings')}
          />
        </View>

        {runtimeStatus.status !== 'idle' ? (
          <View style={[styles.runtimeBanner, getRuntimeBannerStyle(statusTone)]}>
            <Text style={styles.runtimeBannerTitle}>
              {runtimeStatus.status === 'running'
                ? 'Running automation'
                : runtimeStatus.status === 'success'
                  ? 'Last run completed'
                  : runtimeStatus.status === 'retrying'
                    ? 'Retrying automation'
                    : 'Last run failed'}
            </Text>
            <Text style={styles.runtimeBannerText}>
              {runtimeStatus.scheduleName ?? 'Schedule'}
              {runtimeStatus.message ? ` • ${runtimeStatus.message}` : ''}
            </Text>
          </View>
        ) : null}

        {activeTab === 'schedules' ? (
          <View style={styles.panel}>
            <View style={styles.panelHeader}>
              <View style={styles.panelHeaderText}>
                <Text style={styles.panelTitle}>Users & Schedules</Text>
                <Text style={styles.panelBody}>
                  Create an HHA user account first, then add multiple child
                  clock-in and clock-out schedules inside that account.
                </Text>
              </View>
              <Pressable style={styles.primaryButton} onPress={openCreateAccountModal}>
                <Text style={styles.primaryButtonText}>Add user</Text>
              </Pressable>
            </View>

            {credentialSets.length === 0 ? (
              <EmptyState
                title="No users yet"
                body="Create a HHA user account first, then add clock schedules under that user."
              />
            ) : (
              schedulesByAccount.map(({ account, schedules: accountSchedules }) => (
                <View key={account.id} style={styles.userCard}>
                  <View style={styles.userHeader}>
                    <View style={styles.panelHeaderText}>
                      <Text style={styles.userEmail}>{account.email}</Text>
                      <Text style={styles.userMeta}>
                        {accountSchedules.length} Total
                        {accountSchedules.length === 1 ? ' schedule' : ' schedules'}
                      </Text>
                    </View>
                    <View style={styles.userActions}>
                     
                      <GhostButton
                        label="Edit user"
                        onPress={() => openEditAccountModal(account)}
                      />
                       <GhostButton
                        label="New Schedule"
                        onPress={() => openCreateModal(account.id)}
                      />
                    </View>
                  </View>

                  {accountSchedules.length === 0 ? (
                    <Text style={styles.userEmptyText}>
                      No child schedules yet. Use Add clock to create the first Clock In or Clock Out.
                    </Text>
                  ) : (
                    <View style={styles.userScheduleList}>
                      {accountSchedules.map(schedule => (
                        <View key={schedule.id} style={styles.childScheduleCard}>
                          <View style={styles.scheduleTopRow}>
                            <View style={styles.panelHeaderText}>
                              <Text style={styles.scheduleTypeChip}>
                                {schedule.type === 'clockOut' ? 'CLOCK OUT' : 'CLOCK IN'}
                              </Text>
                              <Text style={styles.scheduleTitle}>{schedule.name}</Text>
                              <Text style={styles.scheduleMeta}>
                                Automation Start at: {formatTimeAMPM(schedule.time)}
                              </Text>
                              <Text style={styles.scheduleMeta}>
                                Days: {formatDays(schedule.days)}
                              </Text>
                            </View>
                            <Switch
                              value={schedule.enabled}
                              onValueChange={value => {
                                ignorePromise(onToggleEnabled(schedule, value));
                              }}
                              thumbColor={schedule.enabled ? '#f0b429' : '#9fb3c8'}
                              trackColor={{ false: '#486581', true: '#334e68' }}
                            />
                          </View>
                          <Text style={styles.scheduleDetail}>Client: {schedule.clientName}</Text>
                          <Text style={styles.scheduleDetail}>Visit: {schedule.visitLabel}</Text>
                          <View style={styles.scheduleActions}>
                            <GhostButton
                              label={busyScheduleId === schedule.id ? 'Running…' : 'Run now'}
                              onPress={() => {
                                ignorePromise(onRunNow(schedule));
                              }}
                            />
                            <GhostButton
                              label="Edit"
                              onPress={() => openEditModal(schedule)}
                            />
                            <GhostButton
                              label="Delete"
                              tone="danger"
                              onPress={() => {
                                ignorePromise(onDeleteSchedule(schedule));
                              }}
                            />
                          </View>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              ))
            )}

            {unassignedSchedules.length > 0 ? (
              <View style={styles.unassignedCard}>
                <Text style={styles.settingsTitle}>Unassigned schedules</Text>
                <Text style={styles.panelBody}>
                  These schedules are not linked to a parent account yet. Edit each one and pick a user.
                </Text>
                {unassignedSchedules.map(schedule => (
                  <View key={schedule.id} style={styles.credentialItem}>
                    <View style={styles.panelHeaderText}>
                      <Text style={styles.credentialEmail}>{schedule.name}</Text>
                      <Text style={styles.scheduleMeta}>
                        {schedule.type === 'clockOut' ? 'Clock Out' : 'Clock In'} • {formatTimeAMPM(schedule.time)}
                      </Text>
                    </View>
                    <GhostButton label="Assign" onPress={() => openEditModal(schedule)} />
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {activeTab === 'logs' ? (
          <View style={styles.panel}>
            <View style={styles.panelHeader}>
              <View style={styles.panelHeaderText}>
                <Text style={styles.panelTitle}>Execution logs</Text>
                <Text style={styles.panelBody}>
                  Every scheduled and manual run is recorded by the Android layer,
                  even when the React Native screen is closed.
                </Text>
              </View>
              <GhostButton
                label="Clear logs"
                onPress={() => {
                  ignorePromise(onClearLogs());
                }}
              />
            </View>

            {logs.length === 0 ? (
              <EmptyState
                title="No execution history"
                body="Logs appear here after the first scheduled or manual automation run."
              />
            ) : (
              logs.map(log => (
                <View key={log.id} style={styles.logCard}>
                  <View style={styles.logHeader}>
                    <Text style={styles.logTitle}>{log.scheduleName}</Text>
                    <Text style={[styles.logResult, getLogResultStyle(getStatusTone(log.status))]}>
                      {log.status.toUpperCase()}
                    </Text>
                  </View>
                  <Text style={styles.logMeta}>
                    {formatDate(log.timestamp)} • {log.source.toUpperCase()} • {log.type === 'clockOut' ? 'Clock Out' : 'Clock In'}
                  </Text>
                  <Text style={styles.logMessage}>{log.message}</Text>
                </View>
              ))
            )}
          </View>
        ) : null}

        {activeTab === 'settings' ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Permissions</Text>
            <Text style={styles.panelBody}>
              HHA credentials are stored as reusable encrypted parent accounts,
              and each schedule links to one account. Exact alarms, accessibility
              access, notifications, and battery settings determine whether
              automation runs reliably in the background.
            </Text>

            <PermissionRow
              label="Accessibility service"
              value={systemStatus?.accessibilityEnabled ? 'Enabled' : 'Required'}
              tone={systemStatus?.accessibilityEnabled ? 'Success' : 'Danger'}
              actionLabel="Open accessibility"
              onPress={() => {
                ignorePromise(openAccessibilitySettings());
              }}
            />
            <PermissionRow
              label="Exact alarms"
              value={
                systemStatus?.exactAlarmGranted
                  ? 'Granted'
                  : 'Needed for exact time'
              }
              tone={systemStatus?.exactAlarmGranted ? 'Success' : 'Warning'}
              actionLabel="Open alarm settings"
              onPress={() => {
                ignorePromise(openExactAlarmSettings());
              }}
            />
            <PermissionRow
              label="Battery optimization"
              value={
                systemStatus?.ignoringBatteryOptimizations
                  ? 'Ignored'
                  : 'Disable optimization'
              }
              tone={systemStatus?.ignoringBatteryOptimizations ? 'Success' : 'Warning'}
              actionLabel="Open battery settings"
              onPress={() => {
                ignorePromise(openBatteryOptimizationSettings());
              }}
            />

            <View style={styles.instructionsCard}>
              <Text style={styles.settingsTitle}>Device checklist</Text>
              <Text style={styles.instructionsLine}>
                1. Enable accessibility for this app so native taps and text
                entry can run.
              </Text>
              <Text style={styles.instructionsLine}>
                2. Allow exact alarms on Android 12+ if you want start times
                like 06:57 AM to be precise.
              </Text>
              <Text style={styles.instructionsLine}>
                3. Disable battery optimization for this app so scheduled runs
                keep firing when the screen is off.
              </Text>
              <Text style={styles.instructionsLine}>
                4. Grant notifications if you want start, success, and failure
                alerts.
              </Text>
              <Text style={styles.instructionsLine}>
                5. Validate the flow once on your own device because HHAeXchange
                screens can vary by account and build.
              </Text>
            </View>
          </View>
        ) : null}
      </ScrollView>

      <Modal animationType="slide" visible={accountEditorVisible} transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardAvoidingView}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>
                {accountDraft.id ? 'Edit User account' : 'Add User Account'}
              </Text>

              <TextInput
                style={styles.input}
                placeholder="HHA account email"
                placeholderTextColor="#7b8794"
                keyboardType="email-address"
                autoCapitalize="none"
                value={accountDraft.email}
                onChangeText={value =>
                  setAccountDraft(current => ({ ...current, email: value }))
                }
              />

              <View style={styles.passwordFieldRow}>
                <TextInput
                  style={[styles.input, styles.passwordInput]}
                  placeholder={
                    accountDraft.id
                      ? 'HHA Password (optional - keep empty to keep current)'
                      : 'HHA account Password (required)'
                  }
                  placeholderTextColor="#7b8794"
                  secureTextEntry={!showAccountPassword}
                  value={accountDraft.password}
                  onChangeText={value =>
                    setAccountDraft(current => ({ ...current, password: value }))
                  }
                />
                <Pressable
                  style={styles.passwordToggle}
                  accessibilityRole="button"
                  accessibilityLabel={
                    showAccountPassword ? 'Hide password' : 'Show password'
                  }
                  onPress={() => setShowAccountPassword(current => !current)}>
                  <Text style={styles.passwordToggleText}>
                    {showAccountPassword ? '🙈' : '👁'}
                  </Text>
                </Pressable>
              </View>

              <View style={styles.modalActions}>
                <GhostButton
                  label="Cancel"
                  onPress={() => {
                    setAccountEditorVisible(false);
                    setShowAccountPassword(false);
                    setAccountDraft(emptyAccountDraft());
                  }}
                />
                <Pressable
                  style={styles.primaryButton}
                  onPress={() => {
                    ignorePromise(saveAccountDraft());
                  }}>
                  <Text style={styles.primaryButtonText}>Save user</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

        <Modal animationType="slide" visible={editorVisible} transparent>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.keyboardAvoidingView}>
            <View style={styles.modalBackdrop}>
              <ScrollView 
                style={styles.modalCardScroll}
                contentContainerStyle={styles.modalCardContent}
                showsVerticalScrollIndicator={false}>
                <View style={styles.modalCard}>
                <Text style={styles.modalTitle}>
                  {draft.id ? 'Edit schedule' : 'New schedule'}
                </Text>
              <TextInput
                style={styles.input}
                placeholder="Schedule name"
                placeholderTextColor="#7b8794"
                value={draft.name}
                onChangeText={value => setDraft(current => ({ ...current, name: value }))}
              />

              <View style={styles.typeRow}>
                <TypeButton
                  label="Clock In"
                  active={draft.type === 'clockIn'}
                  onPress={() => setDraft(current => ({ ...current, type: 'clockIn' }))}
                />
                <TypeButton
                  label="Clock Out"
                  active={draft.type === 'clockOut'}
                  onPress={() =>
                    setDraft(current => ({ ...current, type: 'clockOut' }))
                  }
                />
                
              </View>

              <Pressable
                style={styles.timePickerButton}
                onPress={openTimePicker}>
                <Text style={styles.timePickerLabel}>Automation Start time(tap to select)</Text>
                <Text style={styles.timePickerValue}>
                  {draft.time ? formatTimeAMPM(draft.time) : 'Pick a time'}
                </Text>
              </Pressable>
              <Pressable
                style={styles.timePickerButton}
                onPress={openVisitTimePicker}>
                <Text style={styles.timePickerLabel}>
                  {draft.type === 'clockOut'
                    ? 'Clock-Out Time (tap to select)'
                    : 'Clock-In Time (tap to select)'}
                </Text>
                <Text style={styles.timePickerValue}>
                  {draft.visitLabel || 'Pick a time'}
                </Text>
              </Pressable>
              <TextInput
                style={styles.input}
                placeholder="Client name"
                placeholderTextColor="#7b8794"
                value={draft.clientName}
                onChangeText={value =>
                  setDraft(current => ({ ...current, clientName: value }))
                }
              />
              <View style={styles.daysRow}>
                {dayLabels.map((label, index) => (
                  <Pressable
                    key={`${label}-${index}`}
                    style={[
                      styles.dayChip,
                      draft.days[index] ? styles.dayChipActive : null,
                    ]}
                    onPress={() => {
                      setDraft(current => ({
                        ...current,
                        days: current.days.map((day, dayIndex) =>
                          dayIndex === index ? !day : day,
                        ),
                      }));
                    }}>
                    <Text
                      style={[
                        styles.dayChipText,
                        draft.days[index] ? styles.dayChipTextActive : null,
                      ]}>
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.dayHint}>
                {formatDays(draft.days) || 'No days selected'}
              </Text>

              <View style={styles.modalActions}>
                <GhostButton
                  label="Cancel"
                  onPress={() => {
                    setEditorVisible(false);
                    setShowPassword(false);
                    setDraft(emptySchedule());
                  }}
                />
                <Pressable
                  style={styles.primaryButton}
                  onPress={() => {
                    ignorePromise(saveScheduleDraft());
                  }}>
                  <Text style={styles.primaryButtonText}>Save schedule</Text>
                </Pressable>
              </View>
            </View>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>
    </View>
  );
}

function SummaryPill({
  label,
  value,
  tone = 'Neutral',
}: {
  label: string;
  value: string;
  tone?: VisualTone;
}) {
  return (
    <View style={[styles.summaryPill, getSummaryPillStyle(tone)]}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.tabButton, active ? styles.tabButtonActive : null]}
      onPress={onPress}>
      <Text style={[styles.tabButtonText, active ? styles.tabButtonTextActive : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

function TypeButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.typeButton, active ? styles.typeButtonActive : null]}
      onPress={onPress}>
      <Text
        style={[styles.typeButtonText, active ? styles.typeButtonTextActive : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

function GhostButton({
  label,
  onPress,
  tone = 'neutral',
}: {
  label: string;
  onPress: () => void;
  tone?: 'neutral' | 'danger';
}) {
  return (
    <Pressable
      style={[styles.ghostButton, tone === 'danger' ? styles.ghostButtonDanger : null]}
      onPress={onPress}>
      <Text
        style={[
          styles.ghostButtonText,
          tone === 'danger' ? styles.ghostButtonDangerText : null,
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyStateTitle}>{title}</Text>
      <Text style={styles.emptyStateBody}>{body}</Text>
    </View>
  );
}

function PermissionRow({
  label,
  value,
  tone,
  actionLabel,
  onPress,
}: {
  label: string;
  value: string;
  tone: Exclude<VisualTone, 'Neutral'>;
  actionLabel: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.permissionRow}>
      <View style={styles.panelHeaderText}>
        <Text style={styles.permissionLabel}>{label}</Text>
        <Text style={[styles.permissionValue, getPermissionValueStyle(tone)]}>
          {value}
        </Text>
      </View>
      <GhostButton label={actionLabel} onPress={onPress} />
    </View>
  );
}

function formatTimeAMPM(time: string): string {
  const m = time.match(/(\d{1,2}):(\d{2})/);
  if (!m) return time;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const period = h < 12 ? 'AM' : 'PM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${min} ${period}`;
}

function isValidTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function formatDays(days: boolean[]) {
  return dayNames.filter((_, index) => days[index]).join(', ');
}

function createId() {
  return `sch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createAccountId() {
  return `cred_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function findCredentialByEmail(credentialSets: CredentialSet[], email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  return credentialSets.find(
    credential => credential.email.trim().toLowerCase() === normalized,
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function getStatusTone(status: RuntimeStatus['status'] | ExecutionLog['status']) {
  if (status === 'success') {
    return 'Success' as const;
  }
  if (status === 'failed') {
    return 'Danger' as const;
  }
  if (status === 'retrying') {
    return 'Warning' as const;
  }
  return 'Neutral' as const;
}

function getSummaryPillStyle(tone: VisualTone) {
  switch (tone) {
    case 'Success':
      return styles.summaryPillSuccess;
    case 'Warning':
      return styles.summaryPillWarning;
    case 'Danger':
      return styles.summaryPillDanger;
    default:
      return styles.summaryPillNeutral;
  }
}

function getRuntimeBannerStyle(tone: VisualTone) {
  switch (tone) {
    case 'Success':
      return styles.runtimeBannerSuccess;
    case 'Warning':
      return styles.runtimeBannerWarning;
    case 'Danger':
      return styles.runtimeBannerDanger;
    default:
      return styles.runtimeBannerNeutral;
  }
}

function getLogResultStyle(tone: VisualTone) {
  switch (tone) {
    case 'Success':
      return styles.logResultSuccess;
    case 'Warning':
      return styles.logResultWarning;
    case 'Danger':
      return styles.logResultDanger;
    default:
      return styles.logResultNeutral;
  }
}

function getPermissionValueStyle(tone: Exclude<VisualTone, 'Neutral'>) {
  switch (tone) {
    case 'Success':
      return styles.permissionValueSuccess;
    case 'Warning':
      return styles.permissionValueWarning;
    case 'Danger':
      return styles.permissionValueDanger;
  }
}

function ignorePromise<T>(promise: Promise<T>) {
  promise.catch(() => undefined);
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#102a43',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
    gap: 18,
  },
  backgroundOrbTop: {
    position: 'absolute',
    top: -120,
    right: -70,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: '#d9e2ec22',
  },
  backgroundOrbBottom: {
    position: 'absolute',
    bottom: -90,
    left: -50,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: '#f0b42922',
  },
  headerCard: {
    backgroundColor: '#243b53',
    borderRadius: 28,
    padding: 22,
    gap: 12,
  },
  eyebrow: {
    color: '#f0b429',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.6,
  },
  title: {
    color: '#f8fbff',
    fontSize: 30,
    fontWeight: '800',
  },
  subtitle: {
    color: '#bcccdc',
    fontSize: 15,
    lineHeight: 22,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  summaryPill: {
    minWidth: 96,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
  },
  summaryPillNeutral: {
    backgroundColor: '#334e68',
  },
  summaryPillSuccess: {
    backgroundColor: '#1f513f',
  },
  summaryPillWarning: {
    backgroundColor: '#725f1d',
  },
  summaryPillDanger: {
    backgroundColor: '#6b2d2d',
  },
  summaryLabel: {
    color: '#9fb3c8',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  summaryValue: {
    color: '#f8fbff',
    fontSize: 20,
    fontWeight: '800',
    marginTop: 4,
  },
  segmentRow: {
    flexDirection: 'row',
    gap: 10,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 18,
    backgroundColor: '#1f3852',
    alignItems: 'center',
  },
  tabButtonActive: {
    backgroundColor: '#f0b429',
  },
  tabButtonText: {
    color: '#d9e2ec',
    fontWeight: '700',
  },
  tabButtonTextActive: {
    color: '#102a43',
  },
  runtimeBanner: {
    borderRadius: 18,
    padding: 16,
    gap: 4,
  },
  runtimeBannerNeutral: {
    backgroundColor: '#334e68',
  },
  runtimeBannerSuccess: {
    backgroundColor: '#1f513f',
  },
  runtimeBannerWarning: {
    backgroundColor: '#725f1d',
  },
  runtimeBannerDanger: {
    backgroundColor: '#6b2d2d',
  },
  runtimeBannerTitle: {
    color: '#f8fbff',
    fontSize: 16,
    fontWeight: '800',
  },
  runtimeBannerText: {
    color: '#d9e2ec',
    fontSize: 13,
  },
  panel: {
    backgroundColor: '#f8fbff',
    borderRadius: 28,
    padding: 20,
    gap: 16,
  },
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 14,
  },
  panelHeaderText: {
    flex: 1,
  },
  panelTitle: {
    color: '#102a43',
    fontSize: 22,
    fontWeight: '800',
  },
  panelBody: {
    color: '#486581',
    fontSize: 14,
    lineHeight: 21,
    marginTop: 4,
  },
  primaryButton: {
    borderRadius: 16,
    backgroundColor: '#f0b429',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  primaryButtonWide: {
    borderRadius: 16,
    backgroundColor: '#f0b429',
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#102a43',
    fontWeight: '800',
  },
  scheduleCard: {
    borderRadius: 22,
    backgroundColor: '#e6edf5',
    padding: 16,
    gap: 10,
  },
  userCard: {
    borderRadius: 22,
    backgroundColor: '#dce8f5',
    padding: 16,
    gap: 12,
  },
  userHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'flex-start',
  },
  userLabel: {
    color: '#486581',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  userEmail: {
    color: '#102a43',
    fontSize: 15,
    fontWeight: '800',
    marginTop: 4,
  },
  userMeta: {
    color: '#334e68',
    marginTop: 4,
    fontSize: 13,
  },
  userActions: {
    gap: 4,
    alignItems: 'flex-end',
  },
  userEmptyText: {
    color: '#486581',
    fontSize: 14,
    lineHeight: 20,
    backgroundColor: '#f0f4f8',
    borderRadius: 14,
    padding: 12,
  },
  userScheduleList: {
    gap: 10,
  },
  childScheduleCard: {
    borderRadius: 18,
    backgroundColor: '#f8fbff',
    padding: 14,
    gap: 8,
  },
  unassignedCard: {
    borderRadius: 22,
    backgroundColor: '#fff3cd',
    padding: 16,
    gap: 10,
  },
  scheduleTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  scheduleTypeChip: {
    color: '#7c5e10',
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 1,
  },
  scheduleTitle: {
    color: '#102a43',
    fontSize: 20,
    fontWeight: '800',
    marginTop: 4,
  },
  scheduleMeta: {
    color: '#486581',
    fontSize: 13,
    marginTop: 4,
  },
  scheduleDetail: {
    color: '#243b53',
    fontSize: 14,
  },
  scheduleActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  ghostButton: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#bcccdc',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  ghostButtonDanger: {
    borderColor: '#d64545',
  },
  ghostButtonText: {
    color: '#243b53',
    fontWeight: '700',
  },
  ghostButtonDangerText: {
    color: '#9b1c1c',
  },
  emptyState: {
    borderRadius: 18,
    padding: 18,
    backgroundColor: '#f0f4f8',
    gap: 8,
  },
  emptyStateTitle: {
    color: '#102a43',
    fontSize: 18,
    fontWeight: '700',
  },
  emptyStateBody: {
    color: '#486581',
    fontSize: 14,
    lineHeight: 21,
  },
  logCard: {
    borderRadius: 20,
    backgroundColor: '#f0f4f8',
    padding: 16,
    gap: 8,
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  logTitle: {
    color: '#102a43',
    fontSize: 17,
    fontWeight: '800',
    flex: 1,
  },
  logResult: {
    fontSize: 12,
    fontWeight: '800',
  },
  logResultNeutral: {
    color: '#486581',
  },
  logResultSuccess: {
    color: '#1f7a59',
  },
  logResultWarning: {
    color: '#7c5e10',
  },
  logResultDanger: {
    color: '#b42318',
  },
  logMeta: {
    color: '#627d98',
    fontSize: 12,
  },
  logMessage: {
    color: '#243b53',
    fontSize: 14,
    lineHeight: 20,
  },
  settingsCard: {
    borderRadius: 22,
    backgroundColor: '#e6edf5',
    padding: 16,
    gap: 12,
  },
  settingsTitle: {
    color: '#102a43',
    fontSize: 18,
    fontWeight: '800',
  },
  input: {
    borderRadius: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d9e2ec',
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: '#102a43',
  },
  passwordFieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  passwordInput: {
    flex: 1,
  },
  passwordToggle: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d9e2ec',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  passwordToggleText: {
    fontSize: 20,
  },
  timePickerButton: {
    borderRadius: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d9e2ec',
    paddingHorizontal: 14,
    paddingVertical: 13,
    justifyContent: 'center',
  },
  timePickerLabel: {
    color: '#7b8794',
    fontSize: 13,
    marginBottom: 6,
  },
  timePickerValue: {
    color: '#102a43',
    fontSize: 16,
    fontWeight: '600',
  },
  permissionRow: {
    borderRadius: 20,
    backgroundColor: '#f0f4f8',
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 14,
  },
  permissionLabel: {
    color: '#102a43',
    fontSize: 16,
    fontWeight: '700',
  },
  permissionValue: {
    fontSize: 13,
    marginTop: 4,
  },
  permissionValueSuccess: {
    color: '#1f7a59',
  },
  permissionValueWarning: {
    color: '#7c5e10',
  },
  permissionValueDanger: {
    color: '#b42318',
  },
  instructionsCard: {
    borderRadius: 20,
    backgroundColor: '#102a43',
    padding: 18,
    gap: 8,
  },
  instructionsLine: {
    color: '#d9e2ec',
    lineHeight: 21,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  modalCardScroll: {
    flex: 1,
  },
  modalCardContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: '#102a43aa',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#f8fbff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    gap: 14,
  },
  modalTitle: {
    color: '#102a43',
    fontSize: 24,
    fontWeight: '800',
  },
  typeRow: {
    flexDirection: 'row',
    gap: 12,
  },
  typeButton: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: '#e6edf5',
    paddingVertical: 14,
    alignItems: 'center',
  },
  typeButtonActive: {
    backgroundColor: '#243b53',
  },
  typeButtonText: {
    color: '#334e68',
    fontWeight: '700',
  },
  typeButtonTextActive: {
    color: '#f8fbff',
  },
  daysRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  dayChip: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: '#e6edf5',
    alignItems: 'center',
    paddingVertical: 12,
  },
  dayChipActive: {
    backgroundColor: '#f0b429',
  },
  dayChipText: {
    color: '#334e68',
    fontWeight: '700',
  },
  dayChipTextActive: {
    color: '#102a43',
  },
  dayHint: {
    color: '#486581',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  credentialCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },
  credentialItem: {
    borderRadius: 16,
    backgroundColor: '#ffffff',
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#d9e2ec',
  },
  credentialEmail: {
    color: '#102a43',
    fontSize: 16,
    fontWeight: '700',
  },
  credentialActions: {
    flexDirection: 'row',
    gap: 8,
  },
  secondaryButton: {
    borderRadius: 12,
    backgroundColor: '#e6edf5',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  secondaryButtonText: {
    color: '#243b53',
    fontWeight: '700',
    fontSize: 13,
  },
  dangerButton: {
    backgroundColor: '#fce4e4',
  },
  credentialSelector: {
    gap: 8,
  },
  credentialOption: {
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d9e2ec',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  credentialOptionActive: {
    backgroundColor: '#f0b429',
    borderColor: '#e8a80a',
  },
  credentialOptionText: {
    color: '#243b53',
    fontWeight: '600',
  },
  credentialOptionTextActive: {
    color: '#102a43',
    fontWeight: '800',
  },
  inputLabel: {
    color: '#102a43',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 6,
  },
});

export default App;
