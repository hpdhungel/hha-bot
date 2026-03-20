export type ScheduleType = 'clockIn' | 'clockOut';

export type CredentialSet = {
  id: string;
  email: string;
  hasPassword: boolean;
};

export type Schedule = {
  id: string;
  name: string;
  type: ScheduleType;
  time: string;
  days: boolean[];
  clientName: string;
  visitLabel: string;
  enabled: boolean;
  packageName: string;
  email: string;
  password: string;
};

export type ExecutionStatus = 'idle' | 'running' | 'retrying' | 'success' | 'failed';

export type ExecutionLog = {
  id: string;
  scheduleId: string;
  scheduleName: string;
  type: ScheduleType;
  source: 'manual' | 'scheduled';
  status: Exclude<ExecutionStatus, 'idle'>;
  message: string;
  timestamp: string;
};

export type RuntimeStatus = {
  status: ExecutionStatus;
  scheduleId?: string;
  scheduleName?: string;
  type?: ScheduleType;
  source?: 'manual' | 'scheduled';
  message?: string;
  updatedAt?: string;
};

export type CredentialsSummary = {
  email: string;
  hasPassword: boolean;
};

export type SystemStatus = {
  accessibilityEnabled: boolean;
  exactAlarmGranted: boolean;
  ignoringBatteryOptimizations: boolean;
  notificationPermissionGranted: boolean;
  hasCredentials: boolean;
};