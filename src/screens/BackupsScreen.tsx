import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { useTheme } from '../context/ThemeContext';
import { useLibrary } from '../context/LibraryContext';
import { t } from '../services/i18nService';
import { useDialog } from '../hooks';
import { AppDialog } from '../components';

const BACKUPS_STORAGE_KEY = '@paperback_local_backups';

interface BackupRecord {
  id: string;
  name: string;
  date: string;
  size: number;
  uri?: string;
  itemCount: {
    library: number;
    repos: number;
  };
}

export const BackupsScreen: React.FC = () => {
  const { theme } = useTheme();
  const navigation = useNavigation();
  const { library, reloadLibrary } = useLibrary() as ReturnType<typeof useLibrary> & {
    reloadLibrary?: () => Promise<void>;
  };
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const { dialogVisible, dialogConfig, showDialog, hideDialog } = useDialog();

  useEffect(() => {
    loadBackupsList();
  }, []);

  const loadBackupsList = async () => {
    try {
      const stored = await AsyncStorage.getItem(BACKUPS_STORAGE_KEY);
      if (stored) {
        setBackups(JSON.parse(stored));
      }
    } catch (e) {
      console.warn('Failed to load backups list:', e);
    }
  };

  const saveBackupsList = async (list: BackupRecord[]) => {
    try {
      await AsyncStorage.setItem(BACKUPS_STORAGE_KEY, JSON.stringify(list));
      setBackups(list);
    } catch (e) {
      console.warn('Failed to save backups list:', e);
    }
  };

  const handleNewBackup = async () => {
    setLoading(true);
    try {
      // Gather all app data for backup (matches Paperback iOS BackupManager schema)
      const [
        storedLib,
        storedCats,
        storedRepos,
        storedExtensions,
        storedSettings,
        storedThemes,
        storedThemeMode,
        storedActiveCustomTheme,
        storedHistory,
      ] = await Promise.all([
        AsyncStorage.getItem('@paperback_library'),
        AsyncStorage.getItem('@paperback_library_categories'),
        AsyncStorage.getItem('@added_repositories'),
        AsyncStorage.getItem('@installed_extensions_data'),
        AsyncStorage.getItem('@general_settings'),
        AsyncStorage.getItem('@paperback_custom_themes'),
        AsyncStorage.getItem('@paperback_theme'),
        AsyncStorage.getItem('@paperback_active_custom_theme'),
        AsyncStorage.getItem('@reading_history'),
      ]);

      const parsedLib = storedLib ? JSON.parse(storedLib) : library;
      const parsedRepos = storedRepos ? JSON.parse(storedRepos) : [];

      const backupPayload = {
        version: 1,
        app: 'Paperback',
        platform: Platform.OS,
        createdAt: new Date().toISOString(),
        library: parsedLib,
        categories: storedCats ? JSON.parse(storedCats) : [],
        repositories: parsedRepos,
        installedExtensions: storedExtensions ? JSON.parse(storedExtensions) : [],
        settings: storedSettings ? JSON.parse(storedSettings) : null,
        customThemes: storedThemes ? JSON.parse(storedThemes) : [],
        themeMode: storedThemeMode || null,
        activeCustomTheme: storedActiveCustomTheme || null,
        history: storedHistory ? JSON.parse(storedHistory) : [],
      };

      const jsonStr = JSON.stringify(backupPayload, null, 2);
      const now = new Date();
      const dateTag = now.toISOString().split('T')[0];
      const pad2 = (n: number) => String(n).padStart(2, '0');
      const pad3 = (n: number) => String(n).padStart(3, '0');
      const timeTag = `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}_${pad3(now.getMilliseconds())}`;
      const fileName = `Paperback_Backup_${dateTag}_${timeTag}.paperback`;

      const backupFile = new File(Paths.document, fileName);
      await backupFile.write(jsonStr);

      const newRecord: BackupRecord = {
        id: Date.now().toString(),
        name: fileName,
        date: now.toISOString(),
        size: jsonStr.length,
        uri: backupFile.uri,
        itemCount: {
          library: Array.isArray(parsedLib) ? parsedLib.length : 0,
          repos: Array.isArray(parsedRepos) ? parsedRepos.length : 0,
        },
      };

      const updated = [newRecord, ...backups];
      await saveBackupsList(updated);

      // Offer to export/share
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(backupFile.uri, {
          mimeType: 'application/json',
          dialogTitle: 'Export Paperback Backup',
          UTI: 'public.json',
        });
      }

      showDialog(
        t('backups.backupCreated') || 'Backup Created',
        `Successfully backed up ${newRecord.itemCount.library} manga and ${newRecord.itemCount.repos} repositories.`
      );
    } catch (e: any) {
      console.error('Failed to create backup:', e);
      showDialog(t('common.error') || 'Error', e?.message || 'Failed to create backup');
    } finally {
      setLoading(false);
    }
  };

  const handleExportBackup = async (backup: BackupRecord) => {
    try {
      if (!backup.uri) {
        showDialog(t('common.error') || 'Error', 'Backup file path not found.');
        return;
      }
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(backup.uri, {
          mimeType: 'application/json',
          dialogTitle: 'Export Paperback Backup',
          UTI: 'public.json',
        });
      }
    } catch (e: any) {
      console.error('Failed to export backup:', e);
      showDialog(t('common.error') || 'Error', e?.message || 'Failed to export backup');
    }
  };

  const handleImportBackup = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      const file = new File(asset.uri);
      const content = await file.text();

      let data: any;
      try {
        data = JSON.parse(content);
      } catch (err) {
        showDialog(t('common.error') || 'Error', 'Invalid backup file format (must be valid JSON).');
        return;
      }

      const mangaCount = Array.isArray(data.library) ? data.library.length : 0;
      const repoCount = Array.isArray(data.repositories) ? data.repositories.length : 0;

      showDialog(
        'Restore Backup',
        `This will restore ${mangaCount} manga and ${repoCount} repositories from "${asset.name}". Existing library entries will be updated. Proceed?`,
        [
          { text: t('common.cancel') || 'Cancel', style: 'cancel' },
          {
            text: 'Restore',
            style: 'destructive',
            onPress: async () => {
              hideDialog();
              await restoreBackupData(data);
            },
          },
        ]
      );
    } catch (e: any) {
      console.error('Failed to import backup:', e);
      showDialog(t('common.error') || 'Error', e?.message || 'Failed to read backup file');
    }
  };

  const restoreBackupData = async (data: any) => {
    setLoading(true);
    try {
      if (Array.isArray(data.library)) {
        await AsyncStorage.setItem('@paperback_library', JSON.stringify(data.library));
      }
      if (Array.isArray(data.categories)) {
        await AsyncStorage.setItem('@paperback_library_categories', JSON.stringify(data.categories));
      }
      if (Array.isArray(data.repositories)) {
        await AsyncStorage.setItem('@added_repositories', JSON.stringify(data.repositories));
      }
      if (Array.isArray(data.installedExtensions)) {
        await AsyncStorage.setItem('@installed_extensions_data', JSON.stringify(data.installedExtensions));
      }
      if (data.settings) {
        await AsyncStorage.setItem('@general_settings', JSON.stringify(data.settings));
      }
      if (Array.isArray(data.customThemes)) {
        await AsyncStorage.setItem('@paperback_custom_themes', JSON.stringify(data.customThemes));
      }
      if (typeof data.themeMode === 'string') {
        await AsyncStorage.setItem('@paperback_theme', data.themeMode);
      }
      if (typeof data.activeCustomTheme === 'string') {
        await AsyncStorage.setItem('@paperback_active_custom_theme', data.activeCustomTheme);
      }
      if (Array.isArray(data.history)) {
        await AsyncStorage.setItem('@reading_history', JSON.stringify(data.history));
      }

      await reloadLibrary?.();

      showDialog(
        t('common.success') || 'Success',
        'Backup restored successfully! Changes will be visible immediately.'
      );
    } catch (e: any) {
      console.error('Failed to restore backup:', e);
      showDialog(t('common.error') || 'Error', e?.message || 'Failed to restore backup');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteBackup = (backup: BackupRecord) => {
    showDialog(
      t('backups.deleteTitle') || 'Delete Backup',
      t('backups.deleteConfirm', { name: backup.name }) || `Delete "${backup.name}"?`,
      [
        { text: t('common.cancel') || 'Cancel', style: 'cancel' },
        {
          text: t('common.delete') || 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (backup.uri) {
              try {
                new File(backup.uri).delete();
              } catch (e) {
                console.warn('Failed to delete backup file on disk:', e);
              }
            }
            const filtered = backups.filter(b => b.id !== backup.id);
            await saveBackupsList(filtered);
            hideDialog();
          },
        },
      ]
    );
  };

  const renderBackupItem = ({ item }: { item: BackupRecord }) => (
    <TouchableOpacity
      style={[styles.backupItem, { backgroundColor: theme.card, borderBottomColor: theme.border }]}
      onPress={() => handleExportBackup(item)}
      onLongPress={() => handleDeleteBackup(item)}
    >
      <View style={styles.backupInfo}>
        <Text style={[styles.backupName, { color: theme.text }]} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={[styles.backupDate, { color: theme.textSecondary }]}>
          {new Date(item.date).toLocaleString()} • {item.itemCount.library} manga • {(item.size / 1024).toFixed(1)} KB
        </Text>
      </View>
      <View style={styles.backupActions}>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={() => handleExportBackup(item)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="share-outline" size={20} color={theme.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={() => handleDeleteBackup(item)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="trash-outline" size={20} color={theme.error || '#FF453A'} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'} size={28} color={theme.primary} />
          <Text style={[styles.backText, { color: theme.primary }]}>{t('settings.title') || 'Settings'}</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>{t('backups.title') || 'Backups'}</Text>
        <TouchableOpacity
          style={styles.newBackupButton}
          onPress={handleNewBackup}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator size="small" color={theme.primary} />
          ) : (
            <Text style={[styles.newBackupText, { color: theme.primary }]}>
              {t('backups.newBackup') || 'Backup'}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Import / Actions Banner */}
      <View style={styles.actionsBar}>
        <TouchableOpacity
          style={[styles.actionBannerButton, { backgroundColor: theme.card, borderColor: theme.border }]}
          onPress={handleImportBackup}
        >
          <Ionicons name="folder-open-outline" size={20} color={theme.primary} />
          <Text style={[styles.actionBannerText, { color: theme.text }]}>
            Restore from File (.paperback)
          </Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      <View style={styles.content}>
        <Text style={[styles.sectionHeader, { color: theme.textSecondary }]}>
          {t('backups.selectToExport') || 'PREVIOUS BACKUPS'}
        </Text>

        {backups.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="archive-outline" size={56} color={theme.textSecondary} />
            <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
              No backups created yet.{'\n'}Tap "+ Backup" to create a complete backup of your library and settings.
            </Text>
          </View>
        ) : (
          <FlatList
            data={backups}
            renderItem={renderBackupItem}
            keyExtractor={item => item.id}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>

      <AppDialog
        visible={dialogVisible}
        title={dialogConfig.title}
        message={dialogConfig.message}
        buttons={dialogConfig.buttons}
        onDismiss={hideDialog}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 60 : 48,
    paddingBottom: 16,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backText: {
    fontSize: 17,
    marginLeft: 4,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  newBackupButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  newBackupText: {
    fontSize: 17,
    fontWeight: '600',
  },
  actionsBar: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  actionBannerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
  },
  actionBannerText: {
    fontSize: 15,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 12,
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  backupItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 8,
  },
  backupInfo: {
    flex: 1,
    marginRight: 12,
  },
  backupName: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  backupDate: {
    fontSize: 12,
  },
  backupActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconButton: {
    padding: 4,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 80,
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 20,
  },
});
