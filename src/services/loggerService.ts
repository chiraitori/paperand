/**
 * Paperback-Compatible Structured Logger Service
 * Reverse-engineered from Paperback iOS (Models/Logger.swift, _TtC9Paperback6Logger, LoggerToastSettings)
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogTag =
  | 'Extension'
  | 'Reader'
  | 'Network'
  | 'Library'
  | 'Database'
  | 'Backup'
  | 'Settings'
  | 'Download'
  | 'System'
  | 'UI'
  | 'Auth'
  | string;

export interface LogEntry {
  id: string;
  timestamp: string; // ISO 8601
  level: LogLevel;
  tag: LogTag;
  message: string;
  details?: string;
  stack?: string;
}

export type ErrorToastListener = (entry: LogEntry) => void;
export type LogStreamListener = (entry: LogEntry) => void;

const MAX_RING_BUFFER_SIZE = 1000;
const ERROR_POPUPS_SETTING_KEY = '@error_popups_enabled';

class LoggerService {
  private buffer: LogEntry[] = [];
  private errorListeners = new Set<ErrorToastListener>();
  private streamListeners = new Set<LogStreamListener>();
  private errorPopupsEnabled = true;
  private lastErrorFingerprint = '';
  private lastErrorTime = 0;
  private initialized = false;

  constructor() {
    this.initErrorPopupsSetting();
  }

  /**
   * Load error popups preference from storage
   */
  private async initErrorPopupsSetting(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(ERROR_POPUPS_SETTING_KEY);
      if (stored !== null) {
        this.errorPopupsEnabled = JSON.parse(stored);
      } else {
        // Also check @general_settings for existing user preference
        const generalSettingsStr = await AsyncStorage.getItem('@general_settings');
        if (generalSettingsStr) {
          const general = JSON.parse(generalSettingsStr);
          if (typeof general.errorPopups === 'boolean') {
            this.errorPopupsEnabled = general.errorPopups;
          }
        }
      }
    } catch {
      // Default to true
      this.errorPopupsEnabled = true;
    }
  }

  /**
   * Initialize global console and ErrorUtils capture
   */
  public initCapture(): void {
    if (this.initialized) return;
    this.initialized = true;

    // Hook console.error
    const originalConsoleError = console.error;
    console.error = (...args: any[]) => {
      try {
        const parsed = this.parseConsoleArgs(args);
        this.recordLog('error', parsed.tag || 'System', parsed.message, parsed.details, parsed.stack);
      } catch {
        // Fallback safely
      }
      originalConsoleError.apply(console, args);
    };

    // Hook console.warn
    const originalConsoleWarn = console.warn;
    console.warn = (...args: any[]) => {
      try {
        const parsed = this.parseConsoleArgs(args);
        this.recordLog('warn', parsed.tag || 'System', parsed.message, parsed.details);
      } catch {
        // Fallback safely
      }
      originalConsoleWarn.apply(console, args);
    };

    // Global JS Exception Handler in React Native environment
    try {
      const globalAny = global as any;
      if (globalAny?.ErrorUtils?.setJSExceptionHandler) {
        const prevHandler = globalAny.ErrorUtils.getJSExceptionHandler?.();
        globalAny.ErrorUtils.setJSExceptionHandler((error: Error, isFatal?: boolean) => {
          this.recordLog(
            'error',
            isFatal ? 'System:Fatal' : 'System',
            error?.message || 'Unhandled JavaScript Exception',
            isFatal ? 'Fatal application error occurred' : undefined,
            error?.stack
          );
          if (typeof prevHandler === 'function') {
            prevHandler(error, isFatal);
          }
        });
      }
    } catch {
      // Ignore if ErrorUtils is unavailable
    }

    this.info('System', `Logger initialized. App version: ${Constants.expoConfig?.version || 'unknown'}`);
  }

  private parseConsoleArgs(args: any[]): { tag?: LogTag; message: string; details?: string; stack?: string } {
    let tag: LogTag | undefined;
    let stack: string | undefined;

    const parts = args.map((arg) => {
      if (arg === null) return 'null';
      if (arg === undefined) return 'undefined';
      if (arg instanceof Error) {
        stack = arg.stack;
        return `${arg.name}: ${arg.message}`;
      }
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    });

    let fullMessage = parts.join(' ');

    // Detect tags like [Extension], [Reader], [Network], etc.
    const tagMatch = fullMessage.match(/^\[([a-zA-Z0-9_\-:]+)\]\s*(.*)/s);
    if (tagMatch) {
      tag = tagMatch[1];
      fullMessage = tagMatch[2];
      if (tag === 'SourceService' || tag === 'HeadlessRuntime') tag = 'Extension';
      if (tag === 'SpotifyRemoteService') tag = 'Spotify';
      if (tag === 'Notifications') tag = 'Notification';
    } else {
      const lower = fullMessage.toLowerCase();
      if (lower.includes('chapter') || lower.includes('reader')) tag = 'Reader';
      else if (lower.includes('extension') || lower.includes('source')) tag = 'Extension';
      else if (lower.includes('network') || lower.includes('fetch')) tag = 'Network';
      else if (lower.includes('database') || lower.includes('asyncstorage')) tag = 'Database';
      else tag = 'System';
    }

    return { tag, message: fullMessage, stack };
  }

  /**
   * Record a structured log entry into the ring buffer
   */
  private recordLog(
    level: LogLevel,
    tag: LogTag,
    message: string,
    details?: string,
    stack?: string
  ): LogEntry {
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      level,
      tag: tag || 'General',
      message: message || '',
      details,
      stack,
    };

    // Add to ring buffer (newest first)
    this.buffer.unshift(entry);
    if (this.buffer.length > MAX_RING_BUFFER_SIZE) {
      this.buffer.pop();
    }

    // Notify stream listeners (e.g. DeveloperScreen live log stream)
    this.streamListeners.forEach((listener) => {
      try {
        listener(entry);
      } catch (err) {
        // Prevent listener crashes from affecting app
      }
    });

    // Check error toast notification (LoggerToastSettings.showErrorToasts)
    if (level === 'error' && this.errorPopupsEnabled) {
      this.notifyErrorToast(entry);
    }

    return entry;
  }

  /**
   * Dispatch error toast to registered UI toast handlers with deduplication
   */
  private notifyErrorToast(entry: LogEntry): void {
    const now = Date.now();
    const fingerprint = `${entry.tag}:${entry.message}`;

    // Suppress rapid identical toasts within 3.5 seconds
    if (fingerprint === this.lastErrorFingerprint && now - this.lastErrorTime < 3500) {
      return;
    }

    this.lastErrorFingerprint = fingerprint;
    this.lastErrorTime = now;

    this.errorListeners.forEach((listener) => {
      try {
        listener(entry);
      } catch (err) {
        // Prevent listener crashes
      }
    });
  }

  // ===== Public Logging API =====

  public debug(tag: LogTag, message: string, details?: any): LogEntry {
    const detailsStr = details ? (typeof details === 'string' ? details : JSON.stringify(details)) : undefined;
    return this.recordLog('debug', tag, message, detailsStr);
  }

  public info(tag: LogTag, message: string, details?: any): LogEntry {
    const detailsStr = details ? (typeof details === 'string' ? details : JSON.stringify(details)) : undefined;
    return this.recordLog('info', tag, message, detailsStr);
  }

  public warn(tag: LogTag, message: string, details?: any): LogEntry {
    const detailsStr = details ? (typeof details === 'string' ? details : JSON.stringify(details)) : undefined;
    return this.recordLog('warn', tag, message, detailsStr);
  }

  public error(tag: LogTag, message: string, errorOrDetails?: any): LogEntry {
    let details: string | undefined;
    let stack: string | undefined;

    if (errorOrDetails instanceof Error) {
      stack = errorOrDetails.stack;
      details = errorOrDetails.message;
    } else if (typeof errorOrDetails === 'object' && errorOrDetails !== null) {
      try {
        details = JSON.stringify(errorOrDetails, null, 2);
      } catch {
        details = String(errorOrDetails);
      }
    } else if (errorOrDetails) {
      details = String(errorOrDetails);
    }

    return this.recordLog('error', tag, message, details, stack);
  }

  // ===== Error Popup Subscription & Preferences =====

  /**
   * Subscribe to on-screen error toast popups (Paperback LoggerToastSettings.showErrorToasts)
   */
  public subscribeToErrorToasts(listener: ErrorToastListener): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  /**
   * Subscribe to live log stream (for developer tools)
   */
  public subscribeToLogStream(listener: LogStreamListener): () => void {
    this.streamListeners.add(listener);
    return () => {
      this.streamListeners.delete(listener);
    };
  }

  /**
   * Enable or disable error popups
   */
  public async setErrorPopupsEnabled(enabled: boolean): Promise<void> {
    this.errorPopupsEnabled = enabled;
    try {
      await AsyncStorage.setItem(ERROR_POPUPS_SETTING_KEY, JSON.stringify(enabled));
    } catch {
      // Ignore
    }
  }

  public isErrorPopupsEnabled(): boolean {
    return this.errorPopupsEnabled;
  }

  // ===== Log Retrieval & Buffer Management =====

  /**
   * Retrieve all captured logs (newest first)
   */
  public getLogs(): LogEntry[] {
    return [...this.buffer];
  }

  /**
   * Retrieve error logs only
   */
  public getErrorLogs(): LogEntry[] {
    return this.buffer.filter((entry) => entry.level === 'error');
  }

  /**
   * Clear the in-memory ring buffer
   */
  public clearLogs(): void {
    this.buffer = [];
    this.info('System', 'Log backlog cleared by user.');
  }

  // ===== Log Export (ActivityViewController / expo-sharing) =====

  /**
   * Generate diagnostic logs file and open native share sheet
   */
  public async exportLogs(): Promise<{ success: boolean; filePath?: string; count: number; error?: string }> {
    try {
      const logs = [...this.buffer].reverse(); // Chronological order (oldest to newest)
      const dateStr = new Date().toISOString();
      const filename = `paperand_diagnostics_${Date.now()}.log`;

      const header = [
        '================================================================================',
        '                      PAPERAND APPLICATION DIAGNOSTIC LOGS                      ',
        '================================================================================',
        `App Name:          ${Constants.expoConfig?.name || 'Paperand'}`,
        `App Version:       v${Constants.expoConfig?.version || '0.0.1'}`,
        `SDK Version:       ${Constants.expoConfig?.sdkVersion || 'unknown'}`,
        `Platform:          ${Platform.OS} (${Platform.Version})`,
        `Device Name:       ${Constants.deviceName || 'unknown'}`,
        `Generated At:      ${dateStr}`,
        `Total Log Entries: ${logs.length}`,
        `Error Popups:      ${this.errorPopupsEnabled ? 'ENABLED' : 'DISABLED'}`,
        '================================================================================',
        '',
      ].join('\n');

      const logLines = logs.map((log) => {
        const timestamp = log.timestamp.replace('T', ' ').replace('Z', '');
        const levelTag = `[${log.level.toUpperCase()}]`.padEnd(9);
        const categoryTag = `[${log.tag}]`.padEnd(14);
        let line = `${timestamp} ${levelTag} ${categoryTag} ${log.message}`;
        if (log.details) {
          line += `\n    Details: ${log.details.replace(/\n/g, '\n    ')}`;
        }
        if (log.stack) {
          line += `\n    Stack: ${log.stack.replace(/\n/g, '\n    ')}`;
        }
        return line;
      }).join('\n');

      const fullContent = header + logLines;

      // Write to cache using expo-file-system File API
      const logFile = new File(Paths.cache, filename);
      await logFile.create();
      await logFile.write(fullContent);

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(logFile.uri, {
          mimeType: 'text/plain',
          dialogTitle: 'Export Paperand Logs',
          UTI: 'public.plain-text',
        });
      }

      return {
        success: true,
        filePath: logFile.uri,
        count: logs.length,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.error('System', 'Failed to export logs', errorMsg);
      return {
        success: false,
        count: 0,
        error: errorMsg,
      };
    }
  }
}

export const logger = new LoggerService();
