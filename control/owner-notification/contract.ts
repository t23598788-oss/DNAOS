export { OWNER_NOTIFICATION_BACKEND, NOTIFICATION_TYPES, NATIVE_PERMISSION_STATES } from "./types";
export type {
  HumanNotificationProjectionV1,
  NativePermissionState,
  OwnerActiveWorkProjectionV1,
  OwnerAttentionIndexV1,
  OwnerNotificationV1,
} from "./types";

export { evaluateNotificationPolicy, deduplicationKey } from "./policy";
export { projectHumanNotification, successTruthLocks } from "./human";
export {
  attentionIndex,
  enableNativeNotifications,
  describeNativeNotificationEnablement,
  evaluateCanonicalEvent,
  listActiveWork,
  makeCanonicalEvent,
  notificationInteraction,
  ownerNotificationSurfaceSlice,
  queryNotifications,
  readMacosNotificationPermission,
  scheduleNativeFixture,
  upsertActiveWork,
} from "./engine";
export {
  listDeliveries,
  listNotifications,
  loadEnablement,
  notificationMetrics,
  persistNotification,
  resetNotificationMemory,
} from "./store";
export { helperPath, nativeNotificationPort, productionNativeNotificationPort, setNativeNotificationPort } from "./native";
export type { NativeNotificationPort } from "./native";
