import { createApi } from '@reduxjs/toolkit/query/react';
import { baseQueryWithReauth } from './baseQueryWithReauth';

// Create a base API slice that other API slices will inject endpoints into.
// It has an empty `endpoints` object which will be populated by other files.
export const emptyApi = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithReauth,
  keepUnusedDataFor: 60,
  serializeQueryArgs: ({ endpointName, queryArgs }) => {
    const normalizedArgs = queryArgs && typeof queryArgs === 'object' ? JSON.stringify(queryArgs) : String(queryArgs ?? '')
    return `${endpointName}:${normalizedArgs}`
  },
  tagTypes: [
    'ActivityLog',
    'Advertisement',
    'AdminStats',
    'AdminChartData',
    'AdminPayments',
    'AdminSettings',
    'AuditLog',
    'AutomationStatus',
    'AutomationLogs',
    'AutomationMetrics',
    'Backup',
    'ChannelCategories',
    'Channels',
    'FinishedMatch',
    'EmailTemplate',
    'Events',
    'Highlight',
    'LiveMatch',
    'ME',
    'ManualVerification',
    'Match',
    'Matches',
    'Notifications',
    'NotificationPreferences',
    'Payments',
    'Permissions',
    'Popup',
    'PushTemplates',
    'RecentUsers',
    'Reports',
    'Role',
    'Standings',
    'Stream',
    'SystemLog',
    'SubscriptionPlan',
    'UpcomingMatch',
    'User',
    'Banner',
    'AI',
  ],
  endpoints: () => ({}),
});