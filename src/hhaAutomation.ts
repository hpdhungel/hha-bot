import { NativeModules, Platform } from 'react-native';
import {
  type CredentialSet,
  type CredentialsSummary,
  type ExecutionLog,
  type RuntimeStatus,
  type Schedule,
  type SystemStatus,
} from './types';

type HhaAutomationNativeModule = {
  getSchedules(): Promise<string>;
  upsertSchedule(scheduleJson: string): Promise<string>;
  deleteSchedule(scheduleId: string): Promise<string>;
  getLogs(): Promise<string>;
  clearLogs(): Promise<void>;
  getCredentialsSummary(): Promise<string>;
  saveCredentials(email: string, password: string): Promise<void>;
  getAllCredentials(): Promise<string>;
  saveCredentialSet(credentialSetJson: string): Promise<string>;
  deleteCredential(credentialId: string): Promise<string>;
  getRuntimeStatus(): Promise<string>;
  getSystemStatus(): Promise<string>;
  runNow(scheduleId: string): Promise<string>;
  openAccessibilitySettings(): Promise<void>;
  openBatteryOptimizationSettings(): Promise<void>;
  openExactAlarmSettings(): Promise<void>;
};

const nativeModule = NativeModules.HhaAutomationModule as
  | HhaAutomationNativeModule
  | undefined;

const nativeAutomationSupported =
  Platform.OS === 'android' &&
  typeof nativeModule?.getSchedules === 'function' &&
  typeof nativeModule?.runNow === 'function';

const noopModuleState = {
  schedules: [] as Schedule[],
  logs: [] as ExecutionLog[],
  credentials: { email: '', hasPassword: false } as CredentialsSummary,
  credentialSets: [] as CredentialSet[],
  runtime: { status: 'idle' } as RuntimeStatus,
  system: {
    accessibilityEnabled: false,
    exactAlarmGranted: false,
    ignoringBatteryOptimizations: false,
    notificationPermissionGranted: false,
    hasCredentials: false,
  } as SystemStatus,
};

const fallbackModule: HhaAutomationNativeModule = {
  async getSchedules() {
    return JSON.stringify(noopModuleState.schedules);
  },
  async upsertSchedule(scheduleJson: string) {
    const schedule = JSON.parse(scheduleJson) as Schedule;
    const nextSchedules = [...noopModuleState.schedules];
    const existingIndex = nextSchedules.findIndex(item => item.id === schedule.id);
    if (existingIndex >= 0) {
      nextSchedules[existingIndex] = schedule;
    } else {
      nextSchedules.push(schedule);
    }
    noopModuleState.schedules = nextSchedules;
    return JSON.stringify(nextSchedules);
  },
  async deleteSchedule(scheduleId: string) {
    noopModuleState.schedules = noopModuleState.schedules.filter(
      schedule => schedule.id !== scheduleId,
    );
    return JSON.stringify(noopModuleState.schedules);
  },
  async getLogs() {
    return JSON.stringify(noopModuleState.logs);
  },
  async clearLogs() {
    noopModuleState.logs = [];
  },
  async getCredentialsSummary() {
    return JSON.stringify(noopModuleState.credentials);
  },
  async saveCredentials(email: string) {
    noopModuleState.credentials = { email, hasPassword: true };
    noopModuleState.system = {
      ...noopModuleState.system,
      hasCredentials: true,
    };
  },
  async getAllCredentials() {
    return JSON.stringify(noopModuleState.credentialSets);
  },
  async saveCredentialSet(credentialSetJson: string) {
    const credentialSet = JSON.parse(credentialSetJson) as CredentialSet;
    const sanitizedCredential: CredentialSet = {
      id: credentialSet.id,
      email: credentialSet.email,
      hasPassword:
        credentialSet.hasPassword ||
        Boolean(typeof credentialSet.password === 'string' && credentialSet.password.trim()),
    };
    const nextCredentials = [...noopModuleState.credentialSets];
    const existingIndex = nextCredentials.findIndex(item => item.id === sanitizedCredential.id);
    if (existingIndex >= 0) {
      nextCredentials[existingIndex] = sanitizedCredential;
    } else {
      nextCredentials.push(sanitizedCredential);
    }
    noopModuleState.credentialSets = nextCredentials;
    noopModuleState.system = {
      ...noopModuleState.system,
      hasCredentials: nextCredentials.length > 0,
    };
    return JSON.stringify(nextCredentials);
  },
  async deleteCredential(credentialId: string) {
    noopModuleState.credentialSets = noopModuleState.credentialSets.filter(
      cred => cred.id !== credentialId,
    );
    noopModuleState.system = {
      ...noopModuleState.system,
      hasCredentials: noopModuleState.credentialSets.length > 0,
    };
    return JSON.stringify(noopModuleState.credentialSets);
  },
  async getRuntimeStatus() {
    return JSON.stringify(noopModuleState.runtime);
  },
  async getSystemStatus() {
    return JSON.stringify(noopModuleState.system);
  },
  async runNow(scheduleId: string) {
    noopModuleState.runtime = {
      status: 'failed',
      scheduleId,
      message: 'Native automation is available only on Android.',
    };
    return 'unsupported';
  },
  async openAccessibilitySettings() {},
  async openBatteryOptimizationSettings() {},
  async openExactAlarmSettings() {},
};

export function hasNativeAutomationSupport() {
  return nativeAutomationSupported;
}

function requireAndroidModule() {
  if (!nativeAutomationSupported) {
    return fallbackModule;
  }

  return nativeModule;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function getSchedules() {
  const module = requireAndroidModule();
  return parseJson<Schedule[]>(await module.getSchedules(), []);
}

export async function upsertSchedule(schedule: Schedule) {
  const module = requireAndroidModule();
  return parseJson<Schedule[]>(
    await module.upsertSchedule(JSON.stringify(schedule)),
    [],
  );
}

export async function deleteSchedule(scheduleId: string) {
  const module = requireAndroidModule();
  return parseJson<Schedule[]>(await module.deleteSchedule(scheduleId), []);
}

export async function getLogs() {
  const module = requireAndroidModule();
  return parseJson<ExecutionLog[]>(await module.getLogs(), []);
}

export async function clearLogs() {
  const module = requireAndroidModule();
  await module.clearLogs();
}

export async function getCredentials() {
  const module = requireAndroidModule();
  return parseJson<CredentialsSummary>(await module.getCredentialsSummary(), {
    email: '',
    hasPassword: false,
  });
}

export async function saveCredentials(email: string, password: string) {
  const module = requireAndroidModule();
  await module.saveCredentials(email, password);
}

export async function getAllCredentials() {
  const module = requireAndroidModule();
  return parseJson<CredentialSet[]>(await module.getAllCredentials(), []);
}

export async function saveCredentialSet(credentialSet: CredentialSet) {
  const module = requireAndroidModule();
  return parseJson<CredentialSet[]>(
    await module.saveCredentialSet(JSON.stringify(credentialSet)),
    [],
  );
}

export async function deleteCredential(credentialId: string) {
  const module = requireAndroidModule();
  return parseJson<CredentialSet[]>(await module.deleteCredential(credentialId), []);
}

export async function getRuntimeStatus() {
  const module = requireAndroidModule();
  return parseJson<RuntimeStatus>(await module.getRuntimeStatus(), {
    status: 'idle',
  });
}

export async function getSystemStatus() {
  const module = requireAndroidModule();
  return parseJson<SystemStatus>(await module.getSystemStatus(), {
    accessibilityEnabled: false,
    exactAlarmGranted: false,
    ignoringBatteryOptimizations: false,
    notificationPermissionGranted: false,
    hasCredentials: false,
  });
}

export async function runNow(scheduleId: string) {
  const module = requireAndroidModule();
  return module.runNow(scheduleId);
}

export async function openAccessibilitySettings() {
  const module = requireAndroidModule();
  await module.openAccessibilitySettings();
}

export async function openBatteryOptimizationSettings() {
  const module = requireAndroidModule();
  await module.openBatteryOptimizationSettings();
}

export async function openExactAlarmSettings() {
  const module = requireAndroidModule();
  await module.openExactAlarmSettings();
}