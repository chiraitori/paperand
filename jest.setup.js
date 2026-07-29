// Jest setup file - matchers are now built into @testing-library/react-native v12.4+

// Mock expo internals that cause issues in tests
jest.mock('expo/src/winter/runtime.native', () => ({}), { virtual: true });
jest.mock('expo/src/winter/installGlobal', () => ({}), { virtual: true });

// Mock expo modules
jest.mock('expo-image', () => ({
  Image: 'Image',
}));

jest.mock('expo-file-system', () => ({
  Directory: jest.fn(),
  File: jest.fn(() => ({
    text: jest.fn().mockResolvedValue('globalThis.Sources = globalThis.Sources || {};'),
  })),
  Paths: {
    document: '/mock/documents',
  },
}));

jest.mock('expo-asset', () => ({
  Asset: {
    fromModule: jest.fn(() => ({
      uri: '/mock/YuriGarden.pbjs',
      localUri: '/mock/YuriGarden.pbjs',
      downloadAsync: jest.fn().mockResolvedValue(undefined),
    })),
  },
}));

jest.mock('expo-screen-orientation', () => ({
  lockAsync: jest.fn(),
  unlockAsync: jest.fn(),
  getOrientationAsync: jest.fn().mockResolvedValue(1),
  Orientation: {
    PORTRAIT: 1,
    LANDSCAPE_LEFT: 2,
    LANDSCAPE_RIGHT: 3,
  },
  OrientationLock: {
    PORTRAIT: 1,
    LANDSCAPE: 2,
    LANDSCAPE_LEFT: 3,
    LANDSCAPE_RIGHT: 4,
  },
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: {
    Light: 'light',
    Medium: 'medium',
    Heavy: 'heavy',
  },
  NotificationFeedbackType: {
    Success: 'success',
    Warning: 'warning',
    Error: 'error',
  },
}));

jest.mock('expo-blur', () => ({
  BlurView: 'BlurView',
}));

jest.mock('expo-status-bar', () => ({
  StatusBar: 'StatusBar',
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(),
  getItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  scheduleNotificationAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  AndroidImportance: {
    HIGH: 'high',
  },
}));

jest.mock('react-native-background-actions', () => ({
  start: jest.fn(),
  stop: jest.fn(),
  isRunning: jest.fn().mockReturnValue(false),
  updateNotification: jest.fn(),
}));

jest.mock('react-native-webview', () => 'WebView');

jest.mock('expo-localization', () => ({
  locale: 'en-US',
}));

jest.mock('cloudflare-bypass', () => ({
  getCookies: jest.fn().mockResolvedValue(''),
  setCookies: jest.fn().mockResolvedValue(true),
  clearCookies: jest.fn().mockResolvedValue(true),
  getBrowserAuthToken: jest.fn().mockResolvedValue(''),
  getBrowserAuthHosts: jest.fn().mockResolvedValue([]),
  clearBrowserAuthToken: jest.fn().mockResolvedValue(true),
  launchBypassActivity: jest.fn().mockResolvedValue(true),
}));

jest.mock('expo-linking', () => ({
  createURL: jest.fn(),
  parse: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
}));

jest.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      version: '0.0.13',
    },
  },
}));

// Silence console warnings during tests
const originalWarn = console.warn;
console.warn = (...args) => {
  if (
    args[0]?.includes('useNativeDriver') ||
    args[0]?.includes('Animated') ||
    args[0]?.includes('Non-serializable values')
  ) {
    return;
  }
  originalWarn(...args);
};
