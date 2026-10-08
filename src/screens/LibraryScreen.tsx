import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Dimensions,
  useWindowDimensions,
  AppState,
  AppStateStatus,
  ScrollView,
  TextInput,
  Modal,
  Platform,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { usePreventScreenCapture } from 'expo-screen-capture'; // Keep for type, using imperative API
import { useTheme } from '../context/ThemeContext';
import { useLibrary } from '../context/LibraryContext';
import { MangaCard, EmptyState, MangaPreviewModal, MangaCardWithPreview, LibraryUpdaterModal } from '../components';
import { LibraryUpdateResult } from '../types';
import { RootStackParamList, LibraryEntry, Manga } from '../types';
import { getGeneralSettings, GeneralSettings, defaultSettings } from '../services/settingsService';
import { t } from '../services/i18nService';
import Constants from 'expo-constants';

const isExpoGo = Constants.appOwnership === 'expo';

type LibraryScreenNavigationProp = NativeStackNavigationProp<RootStackParamList>;

export const LibraryScreen: React.FC = () => {
  const { theme } = useTheme();
  const {
    library,
    favorites,
    addToLibrary,
    removeFromLibrary,
    toggleFavorite,
    isInLibrary,
    isFavorite,
    categories,
    addCategory,
    removeCategory,
    setMangaCategory,
    updateLibraryChapters,
  } = useLibrary();
  const navigation = useNavigation<LibraryScreenNavigationProp>();
  const [activeFilter, setActiveFilter] = useState<string>('all');

  // Library updater state
  const [updaterVisible, setUpdaterVisible] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState({ current: 0, total: 0, currentTitle: '' });
  const [updateResult, setUpdateResult] = useState<LibraryUpdateResult | null>(null);

  // Category modal state
  const [categoryModalVisible, setCategoryModalVisible] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [settings, setSettings] = useState<GeneralSettings>(defaultSettings);
  const { width, height } = useWindowDimensions();

  // Preview modal state
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewManga, setPreviewManga] = useState<Manga | null>(null);
  const [previewSourceId, setPreviewSourceId] = useState<string | undefined>();

  // Authentication state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false); // Track if settings have been loaded

  // Track app state for re-auth on resume
  const appState = useRef(AppState.currentState);

  // Auth check function - extracted so it can be called from AppState listener
  const performAuthCheck = useCallback(async () => {
    const loadedSettings = await getGeneralSettings();
    setSettings(loadedSettings);
    setSettingsLoaded(true); // Mark settings as loaded

    if (loadedSettings.libraryAuth) {
      // Require authentication - will use biometric or device PIN/passcode
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: t('auth.authRequired'),
        fallbackLabel: t('auth.usePasscode'),
        disableDeviceFallback: false,
      });

      setIsAuthenticated(result.success);
    } else {
      setIsAuthenticated(true);
    }
    setAuthChecked(true);
  }, []);

  // Determine orientation and get appropriate column count
  const isLandscape = width > height;
  const numColumns = isLandscape ? settings.landscapeColumns : settings.portraitColumns;

  // Auth check only runs once when component mounts or settings change
  useEffect(() => {
    performAuthCheck();
  }, []); // Only run once on mount

  // Block screenshots when auth is enabled (requires app restart to unblock)
  useEffect(() => {
    const enableScreenCapture = async () => {
      if (!isExpoGo && settings.libraryAuth) {
        const ScreenCapture = require('expo-screen-capture');
        await ScreenCapture.preventScreenCaptureAsync();
      }
    };
    enableScreenCapture();
    // NOTE: No cleanup - requires app restart to disable (to avoid async race conditions)
  }, [settings.libraryAuth]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const loadedSettings = await getGeneralSettings();
    setSettings(loadedSettings);
    try {
      await updateLibraryChapters();
    } catch (e) {
      console.warn('Library pull-to-refresh update error:', e);
    }
    setRefreshing(false);
  }, [updateLibraryChapters]);

  const getFilteredLibrary = (): LibraryEntry[] => {
    switch (activeFilter) {
      case 'all':
        return library;
      case 'favorites':
        return favorites;
      case 'reading':
        return library.filter(entry => entry.progress !== null);
      case 'completed':
        return library.filter(entry => entry.manga.status === 'completed');
      default:
        return library.filter(entry => entry.category === activeFilter);
    }
  };

  const filteredLibrary = getFilteredLibrary();

  const baseFilters = [
    { key: 'all', label: t('library.all') || 'All' },
    { key: 'favorites', label: t('library.favorites') || 'Favorites' },
    { key: 'reading', label: t('library.reading') || 'Reading' },
    { key: 'completed', label: t('library.completed') || 'Completed' },
  ];

  const allFilters = [
    ...baseFilters,
    ...categories.map(cat => ({ key: cat, label: cat })),
  ];

  const handleStartUpdate = async () => {
    setIsUpdating(true);
    setUpdateProgress({ current: 0, total: library.length, currentTitle: '' });
    try {
      const result = await updateLibraryChapters((current, total, currentTitle) => {
        setUpdateProgress({ current, total, currentTitle });
      });
      setUpdateResult(result);
    } catch (e) {
      console.error('Failed to update library:', e);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleOpenLibraryUpdater = () => {
    setUpdaterVisible(true);
    if (!isUpdating && !updateResult) {
      handleStartUpdate();
    }
  };

  const handleCreateCategory = async () => {
    if (newCategoryName.trim()) {
      await addCategory(newCategoryName.trim());
      setActiveFilter(newCategoryName.trim());
      setNewCategoryName('');
      setCategoryModalVisible(false);
    }
  };

  const navigateToManga = (entry: LibraryEntry) => {
    navigation.navigate('MangaDetail', {
      mangaId: entry.manga.id,
      sourceId: entry.manga.source
    });
  };

  const handleLongPress = (entry: LibraryEntry) => {
    if (settings.mangaPreviewEnabled) {
      setPreviewManga(entry.manga);
      setPreviewSourceId(entry.manga.source);
      setPreviewVisible(true);
    }
  };

  const handlePreviewReadNow = (manga: Manga, chapterId: string) => {
    navigation.navigate('Reader', {
      mangaId: manga.id,
      chapterId,
      sourceId: manga.source,
    });
  };

  const handlePreviewViewDetails = (manga: Manga) => {
    navigation.navigate('MangaDetail', {
      mangaId: manga.id,
      sourceId: manga.source,
    });
  };

  const renderItem = ({ item }: { item: LibraryEntry }) => (
    <MangaCardWithPreview
      manga={item.manga}
      onPress={() => navigateToManga(item)}
      onLongPress={() => handleLongPress(item)}
      onViewDetails={() => handlePreviewViewDetails(item.manga)}
      onRemoveFromLibrary={() => removeFromLibrary(item.manga.id)}
      onToggleFavorite={() => toggleFavorite(item.manga.id)}
      isInLibrary={true}
      isFavorite={isFavorite(item.manga.id)}
      compact
      columns={numColumns}
    />
  );

  const handleRetryAuth = async () => {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: t('auth.authRequired'),
      fallbackLabel: t('auth.usePasscode'),
      disableDeviceFallback: false,
    });

    setIsAuthenticated(result.success);
  };

  // Show loading while checking auth
  if (!authChecked) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.text }]}>{t('library.title')}</Text>
        </View>
      </View>
    );
  }

  // Show locked state if auth required but not authenticated
  if (settings.libraryAuth && !isAuthenticated) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.text }]}>{t('library.title')}</Text>
        </View>
        <View style={styles.lockedContainer}>
          <Ionicons name="lock-closed" size={64} color={theme.textSecondary} />
          <Text style={[styles.lockedTitle, { color: theme.text }]}>
            {t('library.locked')}
          </Text>
          <Text style={[styles.lockedDescription, { color: theme.textSecondary }]}>
            {t('library.lockedHint')}
          </Text>
          <TouchableOpacity
            style={[styles.unlockButton, { backgroundColor: theme.primary }]}
            onPress={handleRetryAuth}
          >
            <Ionicons name="finger-print" size={20} color="#fff" />
            <Text style={styles.unlockButtonText}>{t('library.unlock')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>{t('library.title')}</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={[styles.headerActionButton, { backgroundColor: theme.card }]}
            onPress={handleOpenLibraryUpdater}
            accessibilityRole="button"
            accessibilityLabel="Check library updates"
            accessibilityHint="Checks all manga in library for new chapter updates"
          >
            <Ionicons name="cloud-download-outline" size={22} color={theme.primary} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterContainer}
      >
        {allFilters.map(filter => (
          <TouchableOpacity
            key={filter.key}
            style={[
              styles.filterButton,
              activeFilter === filter.key && {
                backgroundColor: theme.primary,
              },
              activeFilter !== filter.key && {
                backgroundColor: theme.card,
                borderColor: theme.border,
                borderWidth: 1,
              },
            ]}
            onPress={() => setActiveFilter(filter.key)}
          >
            <Text
              style={[
                styles.filterText,
                {
                  color: activeFilter === filter.key ? '#FFFFFF' : theme.text,
                },
              ]}
            >
              {filter.label}
            </Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          style={[styles.addCategoryButton, { backgroundColor: theme.card, borderColor: theme.border }]}
          onPress={() => setCategoryModalVisible(true)}
          accessibilityLabel="Add custom category"
        >
          <Ionicons name="add" size={18} color={theme.primary} />
        </TouchableOpacity>
      </ScrollView>

      {filteredLibrary.length === 0 ? (
        <EmptyState
          icon="🔖"
          title={t('library.empty')}
          description={t('library.emptyHint')}
        />
      ) : (
        <FlatList
          key={`library-${numColumns}`} // Force re-render when columns change
          data={filteredLibrary}
          renderItem={renderItem}
          keyExtractor={item => item.manga.id}
          numColumns={numColumns}
          contentContainerStyle={styles.listContent}
          columnWrapperStyle={numColumns > 1 ? styles.row : undefined}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[theme.primary]}
              tintColor={theme.primary}
            />
          }
        />
      )}

      {/* Preview Modal */}
      <MangaPreviewModal
        visible={previewVisible}
        onClose={() => setPreviewVisible(false)}
        manga={previewManga}
        sourceId={previewSourceId}
        onReadNow={handlePreviewReadNow}
        onAddToLibrary={addToLibrary}
        onRemoveFromLibrary={removeFromLibrary}
        onViewDetails={handlePreviewViewDetails}
        onToggleFavorite={toggleFavorite}
        isInLibrary={previewManga ? isInLibrary(previewManga.id) : false}
        isFavorite={previewManga ? isFavorite(previewManga.id) : false}
      />

      {/* Library Updater Modal */}
      <LibraryUpdaterModal
        visible={updaterVisible}
        onClose={() => setUpdaterVisible(false)}
        isUpdating={isUpdating}
        currentProgress={updateProgress}
        result={updateResult}
        onStartUpdate={handleStartUpdate}
      />

      {/* Category Creation Modal */}
      <Modal
        visible={categoryModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCategoryModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>New Collection / Category</Text>
            <Text style={[styles.modalSubtitle, { color: theme.textSecondary }]}>
              Enter a name for this library category (e.g. Plan to Read, Top Tier)
            </Text>
            <TextInput
              style={[styles.modalInput, { backgroundColor: theme.background, color: theme.text, borderColor: theme.border }]}
              placeholder="Category Name"
              placeholderTextColor={theme.textSecondary}
              value={newCategoryName}
              onChangeText={setNewCategoryName}
              autoFocus
            />
            <View style={styles.modalButtonsRow}>
              <TouchableOpacity
                style={[styles.modalButton, { borderColor: theme.border, borderWidth: 1 }]}
                onPress={() => { setNewCategoryName(''); setCategoryModalVisible(false); }}
              >
                <Text style={[styles.modalButtonText, { color: theme.text }]}>{t('common.cancel') || 'Cancel'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: theme.primary }]}
                onPress={handleCreateCategory}
              >
                <Text style={[styles.modalButtonText, { color: '#fff' }]}>{t('common.save') || 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerActionButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 8,
    alignItems: 'center',
  },
  addCategoryButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  modalSubtitle: {
    fontSize: 13,
    marginBottom: 16,
    lineHeight: 18,
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: 20,
  },
  modalButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalButton: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 12,
  },
  modalButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  filterButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  filterText: {
    fontSize: 14,
    fontWeight: '500',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  row: {
    justifyContent: 'flex-start',
    gap: 8,
    marginBottom: 4,
  },
  lockedContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  lockedTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 16,
    marginBottom: 8,
  },
  lockedDescription: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
  },
  unlockButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
  },
  unlockButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
