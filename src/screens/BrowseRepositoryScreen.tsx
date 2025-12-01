import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Alert,
  Platform,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import {
  ExtensionSource,
  fetchRepositoryVersioning,
  getTagColor,
} from '../services/extensionService';
import AsyncStorage from '@react-native-async-storage/async-storage';

type RouteParams = {
  BrowseRepository: {
    repoId: string;
    repoName: string;
    repoBaseUrl: string;
  };
};

// Use same key as ExtensionsScreen for sync
const INSTALLED_EXTENSIONS_KEY = '@installed_extensions_data';

interface InstalledExtension extends ExtensionSource {
  repoId: string;
  repoBaseUrl: string;
  sourceJs?: string; // The actual extension source code
}

export const BrowseRepositoryScreen: React.FC = () => {
  const { theme } = useTheme();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RouteParams, 'BrowseRepository'>>();
  const { repoId, repoName, repoBaseUrl } = route.params;

  const [loading, setLoading] = useState(true);
  const [extensions, setExtensions] = useState<ExtensionSource[]>([]);
  const [installedExtensions, setInstalledExtensions] = useState<InstalledExtension[]>([]);
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());

  // Derive installed IDs from full extension data
  const installedIds = new Set(installedExtensions.map(ext => ext.id));

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    
    // Load installed extensions (full data)
    try {
      const stored = await AsyncStorage.getItem(INSTALLED_EXTENSIONS_KEY);
      if (stored) {
        const exts: InstalledExtension[] = JSON.parse(stored);
        setInstalledExtensions(exts);
      }
    } catch (error) {
      console.error('Error loading installed extensions:', error);
    }

    // Fetch repository extensions
    try {
      const versioning = await fetchRepositoryVersioning(repoBaseUrl);
      if (versioning && versioning.sources) {
        setExtensions(versioning.sources);
      }
    } catch (error) {
      console.error('Error fetching extensions:', error);
    }

    setLoading(false);
  };

  const handleInstall = async (ext: ExtensionSource) => {
    setLoadingIds((prev) => new Set(prev).add(ext.id));

    try {
      // Download the extension's source.js
      const sourceUrl = `${repoBaseUrl}/${ext.id}/source.js`;
      console.log(`Downloading extension source from: ${sourceUrl}`);
      
      const sourceResponse = await fetch(sourceUrl);
      if (!sourceResponse.ok) {
        throw new Error(`Failed to download source.js: ${sourceResponse.status}`);
      }
      const sourceJs = await sourceResponse.text();

      // Create full extension data with repo info and source code
      const installedExt: InstalledExtension = {
        ...ext,
        repoId: repoId,
        repoBaseUrl: repoBaseUrl,
        sourceJs: sourceJs, // Store the actual extension code
      };

      const newInstalled = [...installedExtensions, installedExt];
      setInstalledExtensions(newInstalled);

      // Save to storage
      await AsyncStorage.setItem(
        INSTALLED_EXTENSIONS_KEY,
        JSON.stringify(newInstalled)
      );

      Alert.alert('Installed', `${ext.name} has been installed successfully.`);
    } catch (error) {
      console.error('Error installing extension:', error);
      Alert.alert('Error', `Failed to install ${ext.name}: ${error}`);
    }

    setLoadingIds((prev) => {
      const next = new Set(prev);
      next.delete(ext.id);
      return next;
    });
  };

  const handleReload = async (ext: ExtensionSource) => {
    setLoadingIds((prev) => new Set(prev).add(ext.id));

    // Simulate reload delay
    await new Promise((resolve) => setTimeout(resolve, 1000));

    setLoadingIds((prev) => {
      const next = new Set(prev);
      next.delete(ext.id);
      return next;
    });

    Alert.alert('Reloaded', `${ext.name} has been reloaded.`);
  };

  const handleUninstall = async (ext: ExtensionSource) => {
    Alert.alert(
      'Uninstall Extension',
      `Are you sure you want to uninstall ${ext.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Uninstall',
          style: 'destructive',
          onPress: async () => {
            const newInstalled = installedExtensions.filter(e => e.id !== ext.id);
            setInstalledExtensions(newInstalled);

            try {
              await AsyncStorage.setItem(
                INSTALLED_EXTENSIONS_KEY,
                JSON.stringify(newInstalled)
              );
            } catch (error) {
              console.error('Error saving installed extensions:', error);
            }
          },
        },
      ]
    );
  };

  const renderExtensionItem = (ext: ExtensionSource) => {
    const isInstalled = installedIds.has(ext.id);
    const isLoading = loadingIds.has(ext.id);

    return (
      <View
        key={ext.id}
        style={[styles.extensionItem, { borderBottomColor: theme.border }]}
      >
        {/* Extension Icon */}
        <View style={[styles.iconContainer, { backgroundColor: '#2A2A2D' }]}>
          {ext.icon && repoBaseUrl ? (
            <Image
              source={{ uri: `${repoBaseUrl}/${ext.id}/includes/${ext.icon}` }}
              style={styles.iconImage}
              defaultSource={require('../../assets/icon.png')}
            />
          ) : (
            <Ionicons name="extension-puzzle" size={28} color="#FFF" />
          )}
        </View>

        {/* Extension Info */}
        <View style={styles.extensionContent}>
          <Text style={[styles.extensionName, { color: theme.text }]}>{ext.name}</Text>
          <Text style={[styles.extensionAuthor, { color: theme.textSecondary }]}>
            {ext.author} | {ext.version}
          </Text>
          <View style={styles.tagsRow}>
            {/* Action buttons */}
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#007AFF' }]}>
              <Ionicons name="list" size={12} color="#FFF" />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#5856D6' }]}>
              <Ionicons name="globe" size={12} color="#FFF" />
            </TouchableOpacity>
            {/* Tags */}
            {ext.tags?.map((tag, idx) => {
              const colors = getTagColor(tag.type);
              return (
                <View key={idx} style={[styles.tag, { backgroundColor: colors.bg }]}>
                  <Text style={[styles.tagText, { color: colors.text }]}>{tag.text}</Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* Install/Reload Button */}
        <TouchableOpacity
          style={[
            styles.actionButton,
            {
              backgroundColor: isInstalled ? 'transparent' : theme.primary,
              borderWidth: isInstalled ? 1 : 0,
              borderColor: theme.primary,
            },
          ]}
          onPress={() => (isInstalled ? handleReload(ext) : handleInstall(ext))}
          onLongPress={() => isInstalled && handleUninstall(ext)}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={isInstalled ? theme.primary : '#FFF'} />
          ) : (
            <Text
              style={[
                styles.actionButtonText,
                { color: isInstalled ? theme.primary : '#FFF' },
              ]}
            >
              {isInstalled ? 'RELOAD' : 'GET'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'} size={28} color={theme.primary} />
          <Text style={[styles.backText, { color: theme.primary }]}>Extensions</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={[styles.loadingText, { color: theme.textSecondary }]}>
            Loading extensions...
          </Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {/* Repository Name Section */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>
              {repoName.toUpperCase()}
            </Text>
            <View style={[styles.sectionContent, { backgroundColor: theme.card }]}>
              {extensions.length > 0 ? (
                extensions.map(renderExtensionItem)
              ) : (
                <View style={styles.emptyContainer}>
                  <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                    No extensions available
                  </Text>
                </View>
              )}
            </View>
          </View>
        </ScrollView>
      )}
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
    paddingHorizontal: 8,
    paddingTop: 50,
    paddingBottom: 12,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backText: {
    fontSize: 17,
    marginLeft: -4,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
  },
  content: {
    paddingBottom: 40,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '400',
    marginLeft: 16,
    marginBottom: 8,
  },
  sectionContent: {
    marginHorizontal: 16,
    borderRadius: 10,
    overflow: 'hidden',
  },
  extensionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconContainer: {
    width: 50,
    height: 50,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  iconImage: {
    width: 50,
    height: 50,
    borderRadius: 10,
  },
  extensionContent: {
    flex: 1,
  },
  extensionName: {
    fontSize: 17,
    fontWeight: '500',
    marginBottom: 2,
  },
  extensionAuthor: {
    fontSize: 13,
    marginBottom: 6,
  },
  tagsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  actionBtn: {
    width: 22,
    height: 22,
    borderRadius: 5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tag: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
  },
  tagText: {
    fontSize: 11,
    fontWeight: '600',
  },
  actionButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  emptyContainer: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 15,
  },
});
