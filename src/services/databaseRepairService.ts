/**
 * Database & Storage Repair Service
 * Reverse-engineered from Paperback iOS (SettingsViewController.swift -> FUN_1000d1688 attemptDatabaseRepair)
 * Performs deep audit and repair on library entries, download references, temporary files, and AsyncStorage integrity.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { logger } from './loggerService';
import { LibraryEntry } from '../types';

export interface DatabaseRepairReport {
  success: boolean;
  totalKeysAudited: number;
  verifiedMangaCount: number;
  repairedRecordsCount: number;
  cleanedOrphansCount: number;
  cleanedTempFilesCount: number;
  details: string[];
  error?: string;
}

const STORAGE_KEYS = {
  LIBRARY: '@paperback_library',
  CATEGORIES: '@paperback_library_categories',
  GENERAL_SETTINGS: '@general_settings',
  REPOSITORIES: '@added_repositories',
  INSTALLED_EXTENSIONS: '@installed_extensions_data',
  DOWNLOAD_QUEUE: '@download_queue',
};

/**
 * Execute full database and storage repair routine
 */
export const repairDatabase = async (): Promise<DatabaseRepairReport> => {
  logger.info('Database', 'Starting database integrity audit and repair routine...');

  const report: DatabaseRepairReport = {
    success: true,
    totalKeysAudited: 0,
    verifiedMangaCount: 0,
    repairedRecordsCount: 0,
    cleanedOrphansCount: 0,
    cleanedTempFilesCount: 0,
    details: [],
  };

  try {
    // ===== 1. AsyncStorage Key Integrity Audit =====
    const allKeys = await AsyncStorage.getAllKeys();
    report.totalKeysAudited = allKeys.length;

    for (const key of allKeys) {
      if (key.startsWith('@paperback') || key.startsWith('@general') || key.startsWith('@theme') || key.startsWith('@download')) {
        try {
          const raw = await AsyncStorage.getItem(key);
          if (raw !== null && raw !== undefined) {
            JSON.parse(raw); // Check parse validity
          }
        } catch (jsonErr) {
          logger.warn('Database', `Found corrupt JSON in key "${key}", removing damaged record.`, jsonErr);
          await AsyncStorage.removeItem(key);
          report.repairedRecordsCount++;
          report.details.push(`Repaired corrupt JSON key: ${key}`);
        }
      }
    }

    // ===== 2. Categories Integrity =====
    let validCategories: string[] = [];
    try {
      const rawCategories = await AsyncStorage.getItem(STORAGE_KEYS.CATEGORIES);
      if (rawCategories) {
        const parsed = JSON.parse(rawCategories);
        if (Array.isArray(parsed)) {
          // Deduplicate and filter out non-strings or blanks
          validCategories = [...new Set(parsed.map(c => String(c).trim()).filter(Boolean))];
          if (validCategories.length !== parsed.length) {
            await AsyncStorage.setItem(STORAGE_KEYS.CATEGORIES, JSON.stringify(validCategories));
            report.repairedRecordsCount++;
            report.details.push('Deduplicated and sanitized custom library categories');
          }
        }
      }
    } catch (e) {
      logger.error('Database', 'Failed to validate categories', e);
    }

    // ===== 3. Library Integrity & Orphan Cleanup =====
    try {
      const rawLibrary = await AsyncStorage.getItem(STORAGE_KEYS.LIBRARY);
      if (rawLibrary) {
        const parsedLib: any[] = JSON.parse(rawLibrary);
        if (Array.isArray(parsedLib)) {
          const seenMangaIds = new Set<string>();
          const cleanedLib: LibraryEntry[] = [];

          for (const item of parsedLib) {
            if (!item || !item.manga || !item.manga.id) {
              report.cleanedOrphansCount++;
              report.details.push('Removed malformed library item missing manga ID');
              continue;
            }

            const mangaId = String(item.manga.id);
            if (seenMangaIds.has(mangaId)) {
              report.cleanedOrphansCount++;
              report.details.push(`Deduplicated duplicate manga record: "${item.manga.title || mangaId}"`);
              continue;
            }
            seenMangaIds.add(mangaId);

            // Sanitize readChapters (deduplicate, remove empties)
            const readChapters = Array.isArray(item.readChapters)
              ? [...new Set(item.readChapters.map(String).filter(Boolean))]
              : [];

            // Sanitize categories (if category does not exist, unset it)
            let category = item.category;
            if (category && validCategories.length > 0 && !validCategories.includes(category)) {
              category = undefined;
              report.repairedRecordsCount++;
              report.details.push(`Unlinked deleted category from manga: "${item.manga.title || mangaId}"`);
            }

            // Ensure valid progress timestamp
            let progress = item.progress;
            if (progress && (!progress.lastReadAt || isNaN(Date.parse(progress.lastReadAt)))) {
              progress = {
                ...progress,
                lastReadAt: new Date().toISOString(),
              };
            }

            // Ensure chapters array
            const chapters = Array.isArray(item.manga.chapters) ? item.manga.chapters : [];

            cleanedLib.push({
              ...item,
              manga: {
                ...item.manga,
                chapters,
              },
              readChapters,
              category,
              progress,
              isFavorite: Boolean(item.isFavorite),
              addedAt: item.addedAt || new Date().toISOString(),
            });

            report.verifiedMangaCount++;
          }

          if (cleanedLib.length !== parsedLib.length || report.repairedRecordsCount > 0) {
            await AsyncStorage.setItem(STORAGE_KEYS.LIBRARY, JSON.stringify(cleanedLib));
          }
        }
      }
    } catch (libErr) {
      logger.error('Database', 'Error while auditing library records', libErr);
    }

    // ===== 4. Download Queue & Orphaned Temporary Files Cleanup =====
    try {
      // Check download queue
      const rawQueue = await AsyncStorage.getItem(STORAGE_KEYS.DOWNLOAD_QUEUE);
      if (rawQueue) {
        const queue: any[] = JSON.parse(rawQueue);
        if (Array.isArray(queue)) {
          const cleanedQueue = queue.filter(job => job && job.id && job.mangaId && job.chapterId);
          if (cleanedQueue.length !== queue.length) {
            await AsyncStorage.setItem(STORAGE_KEYS.DOWNLOAD_QUEUE, JSON.stringify(cleanedQueue));
            report.repairedRecordsCount += (queue.length - cleanedQueue.length);
            report.details.push(`Removed ${queue.length - cleanedQueue.length} broken download queue items`);
          }
        }
      }

      // Scan downloads directory for temporary files (.tmp, partial files)
      const downloadsDir = new Directory(Paths.document, 'downloads');
      if (downloadsDir.exists) {
        const entries = downloadsDir.list();
        for (const entry of entries) {
          if (entry.name.endsWith('.tmp') || entry.name.includes('_tmp_')) {
            try {
              entry.delete();
              report.cleanedTempFilesCount++;
              report.details.push(`Deleted temporary download file: ${entry.name}`);
            } catch {
              // Ignore failure to delete individual file
            }
          }
        }
      }

      // Check cache directory for orphaned export/backup temp files
      const cacheDir = new Directory(Paths.cache);
      if (cacheDir.exists) {
        const cacheEntries = cacheDir.list();
        for (const entry of cacheEntries) {
          if (entry.name.startsWith('paperback_backup_tmp_') || entry.name.startsWith('temp_restore_')) {
            try {
              entry.delete();
              report.cleanedTempFilesCount++;
              report.details.push(`Deleted leftover backup cache file: ${entry.name}`);
            } catch {
              // Ignore
            }
          }
        }
      }
    } catch (downloadErr) {
      logger.warn('Database', 'Non-fatal notice during downloads cleanup', downloadErr);
    }

    // ===== 5. Installed Extensions & Repositories Integrity =====
    try {
      const rawRepos = await AsyncStorage.getItem(STORAGE_KEYS.REPOSITORIES);
      if (rawRepos) {
        const repos = JSON.parse(rawRepos);
        if (Array.isArray(repos)) {
          const validRepos = repos.filter(r => r && r.url && typeof r.url === 'string');
          if (validRepos.length !== repos.length) {
            await AsyncStorage.setItem(STORAGE_KEYS.REPOSITORIES, JSON.stringify(validRepos));
            report.repairedRecordsCount += (repos.length - validRepos.length);
            report.details.push('Cleaned invalid repository configurations');
          }
        }
      }
    } catch (repoErr) {
      logger.warn('Database', 'Error while verifying repositories', repoErr);
    }

    logger.info('Database', `Database repair finished successfully. Verified ${report.verifiedMangaCount} manga, repaired ${report.repairedRecordsCount} records, cleaned ${report.cleanedTempFilesCount} temp files.`);
    return report;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Database', 'Database repair failed unexpectedly', errorMsg);
    report.success = false;
    report.error = errorMsg;
    return report;
  }
};
