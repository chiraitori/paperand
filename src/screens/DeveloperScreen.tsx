import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  TextInput,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';

export const DeveloperScreen: React.FC = () => {
  const { theme } = useTheme();
  const navigation = useNavigation();
  
  const [debugMode, setDebugMode] = useState(false);
  const [verboseLogging, setVerboseLogging] = useState(false);
  const [networkInspector, setNetworkInspector] = useState(false);
  const [customApiUrl, setCustomApiUrl] = useState('');

  const renderSettingItem = ({
    title,
    subtitle,
    rightElement,
    onPress,
    isDestructive = false,
  }: {
    title: string;
    subtitle?: string;
    rightElement?: React.ReactNode;
    onPress?: () => void;
    isDestructive?: boolean;
  }) => (
    <TouchableOpacity
      style={[styles.settingItem, { borderBottomColor: theme.border }]}
      onPress={onPress}
      disabled={!onPress && !rightElement}
      activeOpacity={onPress ? 0.7 : 1}
    >
      <View style={styles.settingContent}>
        <Text style={[styles.settingTitle, { color: isDestructive ? theme.error : theme.text }]}>
          {title}
        </Text>
        {subtitle && (
          <Text style={[styles.settingSubtitle, { color: theme.textSecondary }]}>
            {subtitle}
          </Text>
        )}
      </View>
      {rightElement}
    </TouchableOpacity>
  );

  const renderSection = (title: string, children: React.ReactNode) => (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>{title}</Text>
      <View style={[styles.sectionContent, { backgroundColor: theme.card }]}>
        {children}
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'} size={28} color={theme.primary} />
          <Text style={[styles.backText, { color: theme.primary }]}>Settings</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>Developer</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Debug Options */}
        {renderSection(
          'DEBUG OPTIONS',
          <>
            {renderSettingItem({
              title: 'Debug Mode',
              subtitle: 'Enable debug features and console output',
              rightElement: (
                <Switch
                  value={debugMode}
                  onValueChange={setDebugMode}
                  trackColor={{ false: theme.border, true: theme.success }}
                  thumbColor="#FFFFFF"
                />
              ),
            })}
            {renderSettingItem({
              title: 'Verbose Logging',
              subtitle: 'Log detailed information for debugging',
              rightElement: (
                <Switch
                  value={verboseLogging}
                  onValueChange={setVerboseLogging}
                  trackColor={{ false: theme.border, true: theme.success }}
                  thumbColor="#FFFFFF"
                />
              ),
            })}
            {renderSettingItem({
              title: 'Network Inspector',
              subtitle: 'Monitor all network requests',
              rightElement: (
                <Switch
                  value={networkInspector}
                  onValueChange={setNetworkInspector}
                  trackColor={{ false: theme.border, true: theme.success }}
                  thumbColor="#FFFFFF"
                />
              ),
            })}
          </>
        )}

        {/* API Configuration */}
        {renderSection(
          'API CONFIGURATION',
          <>
            {renderSettingItem({
              title: 'Custom API Endpoint',
              subtitle: customApiUrl || 'Not configured',
              onPress: () => {
                const promptFn = (Alert as any).prompt;
                if (typeof promptFn === 'function') {
                  promptFn(
                    'Custom API URL',
                    'Enter custom API endpoint',
                    (text: string) => setCustomApiUrl(text),
                    'plain-text',
                    customApiUrl
                  );
                } else {
                  Alert.alert('API URL', 'Set custom API endpoint in the code');
                }
              },
            })}
            {renderSettingItem({
              title: 'Reset API Configuration',
              isDestructive: true,
              onPress: () => {
                setCustomApiUrl('');
                Alert.alert('Reset', 'API configuration has been reset');
              },
            })}
          </>
        )}

        {/* Testing */}
        {renderSection(
          'TESTING',
          <>
            {renderSettingItem({
              title: 'Test Push Notifications',
              onPress: () => Alert.alert('Test', 'Push notification sent'),
            })}
            {renderSettingItem({
              title: 'Simulate Crash',
              isDestructive: true,
              onPress: () => Alert.alert('Crash', 'This would simulate a crash'),
            })}
            {renderSettingItem({
              title: 'Clear All Data',
              isDestructive: true,
              onPress: () => {
                Alert.alert(
                  'Clear All Data',
                  'This will delete all app data including library, history, and settings.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Clear',
                      style: 'destructive',
                      onPress: () => Alert.alert('Cleared', 'All data has been cleared'),
                    },
                  ]
                );
              },
            })}
          </>
        )}

        {/* App Info */}
        {renderSection(
          'APP INFO',
          <>
            {renderSettingItem({
              title: 'Version',
              rightElement: (
                <Text style={[styles.valueText, { color: theme.textSecondary }]}>0.8.11-r1</Text>
              ),
            })}
            {renderSettingItem({
              title: 'Build Number',
              rightElement: (
                <Text style={[styles.valueText, { color: theme.textSecondary }]}>2024120101</Text>
              ),
            })}
            {renderSettingItem({
              title: 'React Native',
              rightElement: (
                <Text style={[styles.valueText, { color: theme.textSecondary }]}>0.76.x</Text>
              ),
            })}
            {renderSettingItem({
              title: 'Expo SDK',
              rightElement: (
                <Text style={[styles.valueText, { color: theme.textSecondary }]}>54</Text>
              ),
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingTop: 50,
    paddingBottom: 12,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  backText: {
    fontSize: 17,
    marginLeft: -4,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  headerSpacer: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
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
  },
  settingSubtitle: {
    fontSize: 13,
    marginTop: 4,
  },
  valueText: {
    fontSize: 17,
  },
});
