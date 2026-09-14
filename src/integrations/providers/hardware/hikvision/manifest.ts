import {
  ProviderConfigurationSchema,
  ProviderManifest,
} from '@/integrations/core/types.ts';
import { HIKVISION_PROVIDER_ID } from '@/integrations/providers/hardware/hikvision/isapi-types.ts';
import { hikvisionConfigDefaults } from '@/integrations/providers/hardware/hikvision/config.ts';

export const hikvisionConfigurationSchema: ProviderConfigurationSchema = {
  sections: [
    {
      id: 'devices',
      title: 'Devices',
      description:
        'Hikvision terminals reachable from the API server (LAN IP or public IP with port forwarding).',
      fields: [
        {
          key: 'devices',
          label: 'Devices (JSON)',
          type: 'json',
          required: true,
          helpText:
            'Array of { id, name, host, port, useHttps, username, password, enabled }. Host can be a LAN IP or a port-forwarded public IP/domain.',
          defaultValue: [
            {
              id: 'device-1',
              name: 'Main entrance',
              host: '192.168.1.50',
              port: 80,
              useHttps: false,
              username: 'admin',
              password: '',
              enabled: true,
            },
          ],
        },
      ],
    },
    {
      id: 'sync',
      title: 'Sync behavior',
      fields: [
        {
          key: 'pollIntervalSeconds',
          label: 'Poll interval (seconds)',
          type: 'number',
          defaultValue: hikvisionConfigDefaults.pollIntervalSeconds,
          helpText: 'Minimum 30 seconds. Polls AcsEvent while this provider is enabled.',
        },
        {
          key: 'eventLookbackMinutes',
          label: 'Event lookback (minutes)',
          type: 'number',
          defaultValue: hikvisionConfigDefaults.eventLookbackMinutes,
          helpText: 'Overlap window when fetching events to avoid gaps.',
        },
        {
          key: 'timezone',
          label: 'Timezone',
          type: 'text',
          defaultValue: hikvisionConfigDefaults.timezone,
          helpText: 'Used for odd/even punch pairing by calendar day.',
        },
        {
          key: 'autoImportPunches',
          label: 'Auto-import punches',
          type: 'switch',
          defaultValue: true,
          helpText: 'Create or close time entries from device access events.',
        },
        {
          key: 'autoSyncEmployees',
          label: 'Auto-sync employees',
          type: 'switch',
          defaultValue: true,
          helpText: 'Push create/update/delete of HR employees to the device person list.',
        },
        {
          key: 'defaultApprovalStatus',
          label: 'Default approval status',
          type: 'dropdown',
          defaultValue: 'pending',
          options: [
            { label: 'Pending', value: 'pending' },
            { label: 'Approved', value: 'approved' },
          ],
        },
        {
          key: 'pairFallbackMode',
          label: 'Fallback pairing',
          type: 'dropdown',
          defaultValue: 'odd_even',
          options: [{ label: 'Odd = in / Even = out', value: 'odd_even' }],
          helpText: 'Used when the device does not send attendanceStatus.',
        },
      ],
    },
  ],
};

export const hikvisionManifest: ProviderManifest = {
  id: HIKVISION_PROVIDER_ID,
  name: 'hikvision-attendance',
  displayName: 'Hikvision Attendance',
  category: 'hardware',
  version: '1.0.0',
  providerVersion: '1.0.0',
  minimumFrameworkVersion: '1.0.0',
  supportedFeatures: [
    'attendanceImport',
    'employeePush',
    'employeeDelete',
    'devicePolling',
  ],
  supportedEvents: ['EntityChanged'],
  offlineSupport: false,
  requiresInternet: false,
  requiresAuthentication: true,
  authenticationType: 'apiKey',
  supportsQueue: true,
  supportsRetry: true,
  supportsWebhooks: false,
  supportsCertificates: false,
  supportsBackgroundJobs: true,
  configurationSchema: hikvisionConfigurationSchema,
  documentation:
    'Fetches attendance from Hikvision access terminals via ISAPI (Digest) through the API proxy. Maps employee_number to device employeeNo. Supports LAN and port-forwarded public hosts.',
};
