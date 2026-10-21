import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  Linking,
  ActivityIndicator,
  Platform,
  Modal,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useLibrary } from '../context/LibraryContext';
import { getImageCacheSize, formatCacheSize, clearImageCache, getCacheLimit, setCacheLimit, CACHE_LIMIT_OPTIONS, CacheLimitOption } from '../services/cacheService';
import { PickerModal, NativeDropdown } from '../components';
import Constants from 'expo-constants';
import * as Sharing from 'expo-sharing';
import { Paths, File } from 'expo-file-system';
import { t } from '../services/i18nService';
import { logger } from '../services/loggerService';
import { repairDatabase } from '../services/databaseRepairService';
import { getGeneralSettings, updateGeneralSetting, clearAllSearchHistory } from '../services/settingsService';

export const SettingsScreen: React.FC = () => {
  const { theme } = useTheme();
  const { clearHistory, library, reloadLibrary } = useLibrary() as ReturnType<typeof useLibrary> & {
    reloadLibrary?: () => Promise<void>;
  };
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [hideReadHistory, setHideReadHistory] = useState(false);
  const [errorPopups, setErrorPopups] = useState(true);
  const [isRepairing, setIsRepairing] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [cacheSize, setCacheSize] = useState<string>(t('common.loading'));
  const [isClearing, setIsClearing] = useState(false);
  const [cacheLimit, setCacheLimitState] = useState<CacheLimitOption>('500MB');
  const [showCachePicker, setShowCachePicker] = useState(false);

  const loadCacheSize = useCallback(async () => {
    const size = await getImageCacheSize();
    setCacheSize(formatCacheSize(size));
  }, []);

  const loadCacheLimit = useCallback(async () => {
    const limit = await getCacheLimit();
    setCacheLimitState(limit);
  }, []);

  const loadGeneralSettings = useCallback(async () => {
    const settings = await getGeneralSettings();
    setHideReadHistory(settings.hideReadHistory ?? false);
    setErrorPopups(settings.errorPopups ?? true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadCacheSize();
      loadCacheLimit();
      loadGeneralSettings();
    }, [loadCacheSize, loadCacheLimit, loadGeneralSettings])
  );

  const handleCacheLimitChange = () => {
    setShowCachePicker(true);
  };

  const handleCacheLimitSelect = (displayValue: string) => {
    const options: CacheLimitOption[] = ['No Cache', '300MB', '500MB', '1GB', '3GB', '5GB', '10GB'];
    const displayOptions = options.map(opt => opt === 'No Cache' ? t('settings.noCache') : opt);
    const index = displayOptions.indexOf(displayValue);
    if (index !== -1) {
      const option = options[index];
      setCacheLimitState(option);
      setCacheLimit(option);
    }
  };

  const handleClearCache = async () => {
    Alert.alert(
      t('settings.clearImageCache'),
      t('settings.clearCacheConfirm', { size: cacheSize }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            setIsClearing(true);
            const success = await clearImageCache();
            setIsClearing(false);
            if (success) {
              setCacheSize('0 B');
              Alert.alert(t('common.success'), t('settings.cacheClearedSuccess'));
            } else {
              Alert.alert(t('common.error'), t('settings.cacheClearFailed'));
            }
            loadCacheSize();
          },
        },
      ]
    );
  };

  const renderSettingItem = ({
    title,
    subtitle,
    onPress,
    rightElement,
    isDestructive = false,
    showChevron = true,
    value,
  }: {
    title: string;
    subtitle?: string;
    onPress?: () => void;
    rightElement?: React.ReactNode;
    isDestructive?: boolean;
    showChevron?: boolean;
    value?: string;
  }) => (
    <TouchableOpacity
      style={[styles.settingItem, { borderBottomColor: theme.border }]}
      onPress={onPress}
      disabled={onPress === undefined && !rightElement}
      activeOpacity={onPress ? 0.7 : 1}
    >
      <View style={styles.settingContent}>
        <Text
          style={[
            styles.settingTitle,
            { color: isDestructive ? theme.error : theme.text },
          ]}
        >
          {title}
        </Text>
        {subtitle && (
          <Text style={[styles.settingSubtitle, { color: theme.textSecondary }]}>
            {subtitle}
          </Text>
        )}
      </View>
      <View style={styles.rightContainer}>
        {value && (
          <Text style={[styles.valueText, { color: theme.textSecondary }]}>
            {value}
          </Text>
        )}
        {rightElement}
        {showChevron && onPress && !rightElement && (
          <Ionicons
            name="chevron-forward"
            size={20}
            color={theme.textSecondary}
            style={styles.chevron}
          />
        )}
      </View>
    </TouchableOpacity>
  );

  const renderSection = (title: string | null, children: React.ReactNode) => (
    <View style={styles.section}>
      {title && (
        <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>
          {title}
        </Text>
      )}
      <View style={[styles.sectionContent, { backgroundColor: theme.card }]}>
        {children}
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>{t('settings.title')}</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Login / Profile */}
        {renderSection(
          null,
          renderSettingItem({
            title: t('settings.loginToPaperand'),
            onPress: () => setShowAccountModal(true),
            showChevron: true,
          })
        )}

        {/* Hide Read History */}
        {renderSection(
          null,
          <>
            {renderSettingItem({
              title: t('settings.hideReadHistory'),
              rightElement: (
                <Switch
                  value={hideReadHistory}
                  onValueChange={async (val) => {
                    setHideReadHistory(val);
                    await updateGeneralSetting('hideReadHistory', val);
                  }}
                  trackColor={{ false: theme.border, true: theme.success }}
                  thumbColor={'#FFFFFF'}
                />
              ),
              showChevron: false,
            })}
          </>
        )}
        <Text style={[styles.footerText, { color: theme.textSecondary }]}>
          {t('settings.hideReadHistoryHint')}
        </Text>

        {/* Settings Section */}
        {renderSection(
          t('settings.settingsSection'),
          <>
            {renderSettingItem({
              title: t('settings.errorPopups'),
              rightElement: (
                <Switch
                  value={errorPopups}
                  onValueChange={async (val) => {
                    setErrorPopups(val);
                    await updateGeneralSetting('errorPopups', val);
                    await logger.setErrorPopupsEnabled(val);
                  }}
                  trackColor={{ false: theme.border, true: theme.success }}
                  thumbColor={'#FFFFFF'}
                />
              ),
              showChevron: false,
            })}
            {renderSettingItem({
              title: t('settings.generalSettings'),
              onPress: () => navigation.navigate('GeneralSettings'),
            })}
            {renderSettingItem({
              title: t('settings.themeSettings'),
              onPress: () => navigation.navigate('ThemeSettings'),
            })}
            {renderSettingItem({
              title: t('extensions.title'),
              onPress: () => navigation.navigate('Extensions'),
            })}
            {renderSettingItem({
              title: t('settings.backups'),
              onPress: () => navigation.navigate('Backups'),
            })}
            {renderSettingItem({
              title: t('settings.clearReadingHistory'),
              isDestructive: true,
              onPress: () => {
                Alert.alert(
                  t('settings.clearReadingHistory'),
                  t('settings.clearHistoryConfirm'),
                  [
                    { text: t('common.cancel'), style: 'cancel' },
                    {
                      text: t('common.delete'),
                      style: 'destructive',
                      onPress: async () => {
                        await clearHistory();
                        Alert.alert(t('common.success'), t('settings.historyCleared'));
                      },
                    },
                  ]
                );
              },
              showChevron: false,
            })}
            {renderSettingItem({
              title: 'Clear All Search History',
              isDestructive: true,
              onPress: () => {
                Alert.alert(
                  'Clear All Search History',
                  'All search history for all sources will be cleared.',
                  [
                    { text: t('common.cancel'), style: 'cancel' },
                    {
                      text: t('common.delete'),
                      style: 'destructive',
                      onPress: async () => {
                        const success = await clearAllSearchHistory();
                        if (success) {
                          Alert.alert(t('common.success'), 'Search history cleared successfully.');
                        }
                      },
                    },
                  ]
                );
              },
              showChevron: false,
            })}
            {renderSettingItem({
              title: t('settings.attemptDatabaseRepair'),
              isDestructive: true,
              rightElement: isRepairing ? (
                <ActivityIndicator size="small" color={theme.primary} />
              ) : undefined,
              onPress: isRepairing ? undefined : () => {
                Alert.alert(
                  t('settings.attemptDatabaseRepair'),
                  'Attempt database repair?\n\nThis routine checks and repairs library integrity, deduplicates records, validates chapter references, unlinks deleted categories, and cleans corrupt cache/download temporary files.',
                  [
                    { text: t('common.cancel'), style: 'cancel' },
                    {
                      text: t('settings.databaseRepair'),
                      style: 'destructive',
                      onPress: async () => {
                        setIsRepairing(true);
                        try {
                          const report = await repairDatabase();
                          if (report.success) {
                            await reloadLibrary?.();
                          }
                          setIsRepairing(false);
                          if (report.success) {
                            Alert.alert(
                              t('common.success'),
                              `Database repair completed successfully!\n\n• Verified: ${report.verifiedMangaCount} manga\n• Repaired: ${report.repairedRecordsCount} records\n• Cleaned: ${report.cleanedTempFilesCount} temp files\n• Removed: ${report.cleanedOrphansCount} broken items`
                            );
                          } else {
                            Alert.alert(t('common.error'), report.error || 'Failed to complete database repair.');
                          }
                        } catch (err) {
                          setIsRepairing(false);
                          Alert.alert(t('common.error'), err instanceof Error ? err.message : 'Unknown repair error');
                        }
                      },
                    },
                  ]
                );
              },
              showChevron: false,
            })}
          </>
        )}

        {/* Storage */}
        {renderSection(
          t('settings.storageSection'),
          <>
            {Platform.OS === 'ios' ? (
              <View
                style={[styles.settingItem, { borderBottomColor: theme.border }]}
              >
                <View style={styles.settingContent}>
                  <Text style={[styles.settingTitle, { color: theme.text }]}>
                    {t('settings.imageCacheSize')}
                  </Text>
                </View>
                <NativeDropdown
                  options={[
                    { label: t('settings.noCache'), value: 'No Cache' },
                    { label: '300MB', value: '300MB' },
                    { label: '500MB', value: '500MB' },
                    { label: '1GB', value: '1GB' },
                    { label: '3GB', value: '3GB' },
                    { label: '5GB', value: '5GB' },
                    { label: '10GB', value: '10GB' },
                  ]}
                  selectedValue={cacheLimit}
                  onSelect={(value) => {
                    setCacheLimitState(value as CacheLimitOption);
                    setCacheLimit(value as CacheLimitOption);
                  }}
                  title={t('settings.imageCacheSize')}
                >
                  <View style={styles.rightContainer}>
                    <Text style={[styles.valueText, { color: theme.textSecondary }]}>
                      {cacheLimit === 'No Cache' ? t('settings.noCache') : cacheLimit}
                    </Text>
                    <Ionicons
                      name="chevron-expand"
                      size={20}
                      color={theme.textSecondary}
                      style={styles.chevron}
                    />
                  </View>
                </NativeDropdown>
              </View>
            ) : (
              renderSettingItem({
                title: t('settings.imageCacheSize'),
                value: cacheLimit === 'No Cache' ? t('settings.noCache') : cacheLimit,
                onPress: handleCacheLimitChange,
              })
            )}
            {renderSettingItem({
              title: t('settings.clearImageCache'),
              isDestructive: true,
              value: isClearing ? undefined : cacheSize,
              rightElement: isClearing ? (
                <ActivityIndicator size="small" color={theme.primary} />
              ) : undefined,
              onPress: isClearing ? undefined : handleClearCache,
              showChevron: false,
            })}
            {renderSettingItem({
              title: t('settings.downloadManager'),
              onPress: () => navigation.navigate('DownloadManager'),
            })}
          </>
        )}

        {/* Information */}
        {renderSection(
          t('settings.informationSection'),
          <>
            {renderSettingItem({
              title: t('settings.developer'),
              onPress: () => navigation.navigate('Developer'),
            })}
            {renderSettingItem({
              title: t('settings.exportAppLogs'),
              onPress: async () => {
                try {
                  const res = await logger.exportLogs();
                  if (!res.success) {
                    Alert.alert(t('common.error'), res.error || t('settings.exportLogsFailed'));
                  }
                } catch (error) {
                  Alert.alert(t('common.error'), t('settings.exportLogsFailed'));
                }
              },
            })}
            {renderSettingItem({
              title: t('settings.credits'),
              onPress: () => navigation.navigate('Credits'),
            })}
          </>
        )}

        <Text style={[styles.versionText, { color: theme.textSecondary }]}>
          v{Constants.expoConfig?.version || '0.0.1'}
        </Text>
      </ScrollView>

      {/* Account / Profile Modal */}
      <Modal
        visible={showAccountModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAccountModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.accountCard, { backgroundColor: theme.card }]}>
            <View style={styles.accountHeader}>
              <View style={[styles.avatarCircle, { backgroundColor: theme.primary }]}>
                <Ionicons name="person" size={32} color="#FFFFFF" />
              </View>
              <Text style={[styles.accountName, { color: theme.text }]}>Guest Profile</Text>
              <Text style={[styles.accountSubtitle, { color: theme.textSecondary }]}>
                Local Library Mode
              </Text>
            </View>

            <View style={[styles.accountStatsBox, { backgroundColor: theme.background }]}>
              <View style={styles.statCol}>
                <Text style={[styles.statNumber, { color: theme.primary }]}>{library.length}</Text>
                <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Manga</Text>
              </View>
              <View style={[styles.statDivider, { backgroundColor: theme.border }]} />
              <View style={styles.statCol}>
                <Text style={[styles.statNumber, { color: theme.success }]}>Active</Text>
                <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Local Storage</Text>
              </View>
            </View>

            <View style={styles.accountActions}>
              <TouchableOpacity
                style={[styles.accountActionButton, { backgroundColor: theme.background }]}
                onPress={() => {
                  setShowAccountModal(false);
                  navigation.navigate('Backups');
                }}
              >
                <Ionicons name="cloud-download-outline" size={20} color={theme.primary} style={{ marginRight: 8 }} />
                <Text style={[styles.accountActionText, { color: theme.text }]}>Manage Backups</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.accountCloseButton, { backgroundColor: theme.primary }]}
              onPress={() => setShowAccountModal(false)}
            >
              <Text style={styles.accountCloseButtonText}>{t('common.done') || 'Done'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Cache Size Picker Modal for Android */}
      {Platform.OS === 'android' && (
        <PickerModal
          visible={showCachePicker}
          title={t('settings.imageCacheSize')}
          subtitle={t('settings.imageCacheSizeHint')}
          options={['No Cache', '300MB', '500MB', '1GB', '3GB', '5GB', '10GB'].map(opt => opt === 'No Cache' ? t('settings.noCache') : opt)}
          selectedValue={cacheLimit === 'No Cache' ? t('settings.noCache') : cacheLimit}
          onSelect={handleCacheLimitSelect}
          onClose={() => setShowCachePicker(false)}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 16,
  },
  title: {
    fontSize: 34,
    fontWeight: 'bold',
  },
  scrollContent: {
    paddingBottom: 100,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 16,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  sectionContent: {
    marginHorizontal: 16,
    borderRadius: 10,
    overflow: 'hidden',
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 44,
  },
  settingContent: {
    flex: 1,
    paddingRight: 16,
  },
  settingTitle: {
    fontSize: 17,
    fontWeight: '400',
  },
  settingSubtitle: {
    fontSize: 13,
    marginTop: 4,
    lineHeight: 18,
  },
  rightContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  valueText: {
    fontSize: 17,
    marginRight: 6,
  },
  chevron: {
    marginLeft: 4,
    opacity: 0.5,
  },
  footerText: {
    fontSize: 13,
    marginHorizontal: 32,
    marginTop: -16,
    marginBottom: 24,
    lineHeight: 18,
  },
  versionText: {
    textAlign: 'center',
    fontSize: 13,
    marginBottom: 20,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  accountCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 24,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 12,
  },
  accountHeader: {
    alignItems: 'center',
    marginBottom: 20,
  },
  avatarCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  accountName: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  accountSubtitle: {
    fontSize: 14,
  },
  accountStatsBox: {
    flexDirection: 'row',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 20,
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  statCol: {
    alignItems: 'center',
    flex: 1,
  },
  statNumber: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    height: 30,
  },
  accountActions: {
    marginBottom: 20,
  },
  accountActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
  },
  accountActionText: {
    fontSize: 15,
    fontWeight: '600',
  },
  accountCloseButton: {
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  accountCloseButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
