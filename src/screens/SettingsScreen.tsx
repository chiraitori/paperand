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
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { getImageCacheSize, formatCacheSize, clearImageCache } from '../services/cacheService';

export const SettingsScreen: React.FC = () => {
  const { theme } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [hideReadHistory, setHideReadHistory] = useState(false);
  const [errorPopups, setErrorPopups] = useState(true);
  const [cacheSize, setCacheSize] = useState<string>('Calculating...');
  const [isClearing, setIsClearing] = useState(false);

  const loadCacheSize = useCallback(async () => {
    const size = await getImageCacheSize();
    setCacheSize(formatCacheSize(size));
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadCacheSize();
    }, [loadCacheSize])
  );

  const handleClearCache = async () => {
    Alert.alert(
      'Clear Image Cache',
      `Are you sure you want to clear ${cacheSize} of cached images? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            setIsClearing(true);
            const success = await clearImageCache();
            setIsClearing(false);
            if (success) {
              setCacheSize('0 B');
              Alert.alert('Success', 'Image cache cleared successfully');
            } else {
              Alert.alert('Error', 'Failed to clear cache');
            }
            // Refresh cache size
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
        <Text style={[styles.title, { color: theme.text }]}>Settings</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Login */}
        {renderSection(
          null,
          renderSettingItem({
            title: 'Login to Paperback',
            onPress: () => Alert.alert('Login', 'Login functionality not implemented'),
            showChevron: false,
          })
        )}

        {/* Hide Read History */}
        {renderSection(
          null,
          <>
            {renderSettingItem({
              title: 'Hide Read History',
              rightElement: (
                <Switch
                  value={hideReadHistory}
                  onValueChange={setHideReadHistory}
                  trackColor={{ false: theme.border, true: theme.success }}
                  thumbColor={'#FFFFFF'}
                />
              ),
              showChevron: false,
            })}
          </>
        )}
        <Text style={[styles.footerText, { color: theme.textSecondary }]}>
          Hides recently read chapters from history, chapter progress is still tracked however.
        </Text>

        {/* Settings Section */}
        {renderSection(
          'SETTINGS',
          <>
            {renderSettingItem({
              title: 'Error Popups',
              rightElement: (
                <Switch
                  value={errorPopups}
                  onValueChange={setErrorPopups}
                  trackColor={{ false: theme.border, true: theme.success }}
                  thumbColor={'#FFFFFF'}
                />
              ),
              showChevron: false,
            })}
            {renderSettingItem({
              title: 'General Settings',
              onPress: () => navigation.navigate('GeneralSettings'),
            })}
            {renderSettingItem({
              title: 'Theme Settings',
              onPress: () => navigation.navigate('ThemeSettings'),
            })}
            {renderSettingItem({
              title: 'Extensions',
              onPress: () => navigation.navigate('Extensions'),
            })}
            {renderSettingItem({
              title: 'Backups',
              onPress: () => navigation.navigate('Backups'),
            })}
            {renderSettingItem({
              title: 'Clear All Search History',
              isDestructive: true,
              onPress: () => Alert.alert('Clear History', 'History cleared'),
              showChevron: false,
            })}
            {renderSettingItem({
              title: 'Attempt Database Repair',
              isDestructive: true,
              onPress: () => Alert.alert('Database Repair', 'Repair attempted'),
              showChevron: false,
            })}
          </>
        )}

        {/* Storage */}
        {renderSection(
          'STORAGE',
          <>
            {renderSettingItem({
              title: 'Download Manager',
              subtitle: 'Work in Progress',
              onPress: () => navigation.navigate('DownloadManager'),
            })}
            {renderSettingItem({
              title: 'Clear image cache',
              isDestructive: true,
              value: isClearing ? undefined : cacheSize,
              rightElement: isClearing ? (
                <ActivityIndicator size="small" color={theme.primary} />
              ) : undefined,
              onPress: isClearing ? undefined : handleClearCache,
              showChevron: false,
            })}
          </>
        )}

        {/* Information */}
        {renderSection(
          'INFORMATION',
          <>
            {renderSettingItem({
              title: 'Developer',
              onPress: () => navigation.navigate('Developer'),
            })}
            {renderSettingItem({
              title: 'Export app logs',
              onPress: () => Alert.alert('Export Logs', 'Logs exported'),
            })}
            {renderSettingItem({
              title: 'Discord server',
              onPress: () => Linking.openURL('https://discord.gg/paperback'),
            })}
            {renderSettingItem({
              title: 'Credits',
              onPress: () => navigation.navigate('Credits'),
            })}
          </>
        )}

        <Text style={[styles.versionText, { color: theme.textSecondary }]}>
          v0.8.11-r1
        </Text>
      </ScrollView>
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
  }
});
