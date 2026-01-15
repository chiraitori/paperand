import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { RootStackParamList } from '../types';
import { ExtensionSource, ExtensionRepository, DEFAULT_REPOSITORIES, getTagColor } from '../services/extensionService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { t } from '../services/i18nService';
import { AppDialog } from '../components/AppDialog';
import { useDialog } from '../hooks/useDialog';

const INSTALLED_EXTENSIONS_KEY = '@installed_extensions_data';
const ADDED_REPOS_KEY = '@added_repositories';

interface InstalledExtension extends ExtensionSource {
  repoId: string;
  repoBaseUrl: string;
}

export const ExtensionsScreen: React.FC = () => {
  const { theme } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { dialogVisible, dialogConfig, showDialog, hideDialog } = useDialog();
  const [loading, setLoading] = useState(true);
  const [installedExtensions, setInstalledExtensions] = useState<InstalledExtension[]>([]);
  const [addedRepos, setAddedRepos] = useState<ExtensionRepository[]>([]);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  // Reload when coming back from BrowseRepository
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadData();
    });
    return unsubscribe;
  }, [navigation]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load installed extensions
      const stored = await AsyncStorage.getItem(INSTALLED_EXTENSIONS_KEY);
      if (stored) {
        setInstalledExtensions(JSON.parse(stored));
      } else {
        // Start with no extensions - user will install from repositories
        setInstalledExtensions([]);
      }

      // Load added repositories - merge with defaults, keep custom ones
      const storedRepos = await AsyncStorage.getItem(ADDED_REPOS_KEY);
      if (storedRepos) {
        const parsed: ExtensionRepository[] = JSON.parse(storedRepos);
        // Add any new default repos that aren't in stored
        const newDefaults = DEFAULT_REPOSITORIES.filter(def =>
          !parsed.some((repo: ExtensionRepository) => repo.id === def.id)
        );
        const mergedRepos = [...parsed, ...newDefaults];
        setAddedRepos(mergedRepos);
        if (newDefaults.length > 0) {
          await AsyncStorage.setItem(ADDED_REPOS_KEY, JSON.stringify(mergedRepos));
        }
      } else {
        // Set default repositories
        setAddedRepos(DEFAULT_REPOSITORIES);
        await AsyncStorage.setItem(ADDED_REPOS_KEY, JSON.stringify(DEFAULT_REPOSITORIES));
      }
    } catch (error) {
      console.error('Error loading data:', error);
    }
    setLoading(false);
  };

  const handleRemoveExtension = (ext: InstalledExtension) => {
    showDialog(
      t('extensions.removeExtension'),
      t('extensions.removeExtensionConfirm', { name: ext.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            const updated = installedExtensions.filter((e) => e.id !== ext.id);
            setInstalledExtensions(updated);
            await AsyncStorage.setItem(INSTALLED_EXTENSIONS_KEY, JSON.stringify(updated));
          },
        },
      ]
    );
  };

  const handleRemoveRepo = (repo: ExtensionRepository) => {
    showDialog(
      t('extensions.removeRepo'),
      t('extensions.removeRepoConfirm', { name: repo.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            const updated = addedRepos.filter((r) => r.id !== repo.id);
            setAddedRepos(updated);
            await AsyncStorage.setItem(ADDED_REPOS_KEY, JSON.stringify(updated));
          },
        },
      ]
    );
  };

  const handleAddRepository = () => {
    navigation.navigate('AddRepository');
  };

  const renderExtensionItem = (ext: InstalledExtension) => {
    // Build icon URL if we have repo info
    const iconUrl = ext.repoBaseUrl && ext.icon
      ? `${ext.repoBaseUrl}/${ext.id}/includes/${ext.icon}`
      : null;

    return (
      <View key={ext.id} style={[styles.extensionRow, { borderBottomColor: theme.border }]}>
        {isEditing && (
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={() => handleRemoveExtension(ext)}
          >
            <Ionicons name="remove-circle" size={24} color={theme.error} />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.extensionItem}
          activeOpacity={0.7}
          onPress={() => !isEditing && navigation.navigate('ExtensionDetail', { extension: ext })}
          onLongPress={() => !isEditing && handleRemoveExtension(ext)}
          disabled={isEditing}
        >
          {/* Extension Icon */}
          <View style={[styles.iconContainer, { backgroundColor: '#1C1C1E' }]}>
            {iconUrl ? (
              <Image
                source={{ uri: iconUrl }}
                style={styles.iconImage}
                defaultSource={require('../../assets/icon.png')}
              />
            ) : (
              <Ionicons name="extension-puzzle" size={24} color="#FFF" />
            )}
          </View>

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
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#FF2D55' }]}>
                <Ionicons name="paper-plane" size={12} color="#FFF" />
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#1C1C1E' }]}>
                <Ionicons name="options" size={12} color="#FFF" />
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#5856D6' }]}>
                <Ionicons name="globe-outline" size={12} color="#FFF" />
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
          {isEditing ? (
            <Ionicons name="menu" size={24} color={theme.textSecondary} style={styles.dragHandle} />
          ) : (
            <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} style={styles.chevron} />
          )}
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={styles.header}>
        {isEditing ? (
          <TouchableOpacity onPress={handleAddRepository} style={styles.addButton}>
            <Ionicons name="add" size={28} color={theme.primary} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'} size={28} color={theme.primary} />
            <Text style={[styles.backText, { color: theme.primary }]}>{t('settings.title')}</Text>
          </TouchableOpacity>
        )}
        <Text style={[styles.headerTitle, { color: theme.text }]}>{t('extensions.title')}</Text>
        <TouchableOpacity onPress={() => setIsEditing(!isEditing)} style={styles.editButtonContainer}>
          <Text style={[styles.editButton, { color: theme.primary }]}>
            {isEditing ? t('common.done') : t('common.edit')}
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {/* Enabled Extensions */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>
              {t('extensions.enabled')}
            </Text>
            <View style={[styles.sectionContent, { backgroundColor: theme.card }]}>
              {installedExtensions.length > 0 ? (
                installedExtensions.map(renderExtensionItem)
              ) : (
                <View style={styles.emptyContainer}>
                  <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                    {t('extensions.noExtensions')}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Available Repositories */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>
              {t('extensions.availableRepositories')}
            </Text>
            <View style={[styles.sectionContent, { backgroundColor: theme.card }]}>
              {/* Browse All Repositories - only show when not editing */}
              {!isEditing && (
                <TouchableOpacity
                  style={[styles.repoItem, { borderBottomColor: theme.border }]}
                  activeOpacity={0.7}
                  onPress={() => navigation.navigate('BrowseAllRepositories')}
                >
                  <Text style={[styles.repoName, { color: theme.text }]}>{t('extensions.browseAll')}</Text>
                  <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
                </TouchableOpacity>
              )}

              {/* Individual Added Repositories */}
              {addedRepos.map((repo, index) => (
                <View
                  key={repo.id}
                  style={[
                    styles.repoItemRow,
                    { borderBottomColor: theme.border },
                    index === addedRepos.length - 1 && { borderBottomWidth: 0 }
                  ]}
                >
                  {isEditing && (
                    <TouchableOpacity
                      style={styles.deleteButton}
                      onPress={() => handleRemoveRepo(repo)}
                    >
                      <Ionicons name="remove-circle" size={24} color={theme.error} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={styles.repoItemContent}
                    activeOpacity={0.7}
                    onPress={() => !isEditing && navigation.navigate('BrowseRepository', {
                      repoId: repo.id,
                      repoName: repo.name,
                      repoBaseUrl: repo.baseUrl
                    })}
                    disabled={isEditing}
                  >
                    <Text style={[styles.repoName, { color: theme.text }]}>{t('extensions.browseRepo', { name: repo.name })}</Text>
                    {!isEditing && (
                      <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
                    )}
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      )}

      {/* Material You Dialog for Android */}
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
    flex: 2,
    textAlign: 'center',
  },
  editButtonContainer: {
    flex: 1,
    alignItems: 'flex-end',
    paddingRight: 8,
  },
  editButton: {
    fontSize: 17,
    fontWeight: '400',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
  extensionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  deleteButton: {
    paddingLeft: 12,
    paddingRight: 4,
  },
  extensionItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  iconContainer: {
    width: 50,
    height: 50,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  iconImage: {
    width: 50,
    height: 50,
    borderRadius: 12,
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
  chevron: {
    marginLeft: 8,
    opacity: 0.5,
  },
  dragHandle: {
    marginLeft: 8,
    opacity: 0.5,
    paddingRight: 4,
  },
  repoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  repoItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  repoItemContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  addButton: {
    flex: 1,
    paddingLeft: 8,
  },
  repoName: {
    fontSize: 17,
  },
  emptyContainer: {
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 15,
  },
});
