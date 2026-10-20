import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  TouchableOpacity,
  Dimensions,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { useNavigation, useFocusEffect, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../context/ThemeContext';
import { useLibrary } from '../context/LibraryContext';
import { EmptyState, LoadingIndicator, MangaPreviewModal } from '../components';
import { getInstalledExtensions, searchManga, InstalledExtension, SourceManga, SearchResult } from '../services/sourceService';
import { getInstalledExtensionIconUrl } from '../services/extensionStorageService';
import { RootStackParamList, Manga } from '../types';
import { getGeneralSettings, GeneralSettings, defaultSettings } from '../services/settingsService';
import { t } from '../services/i18nService';

type SearchScreenNavigationProp = NativeStackNavigationProp<RootStackParamList>;
type SearchScreenRouteProp = RouteProp<RootStackParamList, 'Search'>;

const { width } = Dimensions.get('window');
const NUM_COLUMNS = 3;
const GRID_PADDING = 16;
const GRID_GAP = 10;
const CARD_WIDTH = (width - GRID_PADDING * 2 - GRID_GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS;
const CARD_HEIGHT = CARD_WIDTH * 1.4;
const RECENT_SEARCHES_KEY = '@recent_searches';

interface SourceSearchResult {
  extensionId: string;
  extensionName: string;
  results: SourceManga[];
  metadata: any;
}

export const SearchScreen: React.FC = () => {
  const { theme } = useTheme();
  const { addToLibrary, removeFromLibrary, toggleFavorite, isInLibrary, isFavorite } = useLibrary();
  const navigation = useNavigation<SearchScreenNavigationProp>();
  const route = useRoute<SearchScreenRouteProp>();
  const initialQuery = (route.params as any)?.initialQuery || '';
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SourceManga[]>([]);
  const [multiSourceResults, setMultiSourceResults] = useState<SourceSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [hasMoreResults, setHasMoreResults] = useState(true);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [installedExtensions, setInstalledExtensions] = useState<InstalledExtension[]>([]);
  const [activeSource, setActiveSource] = useState<string | null>(null); // null = search all
  const [searchMetadata, setSearchMetadata] = useState<any>(null);
  const [settings, setSettings] = useState<GeneralSettings>(defaultSettings);
  const currentQueryRef = useRef<string>('');
  const pendingSearchRef = useRef<string | null>(null);
  const extensionsLoadedRef = useRef(false);

  // Preview modal state
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewManga, setPreviewManga] = useState<Manga | null>(null);
  const [previewSourceId, setPreviewSourceId] = useState<string | undefined>();

  const loadExtensions = useCallback(async () => {
    const extensions = await getInstalledExtensions();
    setInstalledExtensions(extensions);
    extensionsLoadedRef.current = true;

    // Load settings
    const loadedSettings = await getGeneralSettings();
    setSettings(loadedSettings);

    // If there's a pending search, execute it now
    if (pendingSearchRef.current) {
      const searchQuery = pendingSearchRef.current;
      pendingSearchRef.current = null;
      // Use setTimeout to ensure state is updated
      setTimeout(() => {
        performSearchDirect(searchQuery, extensions);
      }, 100);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadExtensions();
      loadRecentSearches();
    }, [loadExtensions])
  );

  // Handle initial query from navigation
  useEffect(() => {
    if (initialQuery) {
      setQuery(initialQuery);
      if (extensionsLoadedRef.current && installedExtensions.length > 0) {
        // Extensions already loaded, search immediately
        performSearchDirect(initialQuery, installedExtensions);
      } else {
        // Extensions not loaded yet, queue the search
        pendingSearchRef.current = initialQuery;
      }
    }
  }, [initialQuery]);

  const loadRecentSearches = async () => {
    try {
      const saved = await AsyncStorage.getItem(RECENT_SEARCHES_KEY);
      if (saved) {
        setRecentSearches(JSON.parse(saved));
      }
    } catch (e) {
      console.error('Failed to load recent searches:', e);
    }
  };

  const saveRecentSearch = async (searchQuery: string) => {
    try {
      const updated = [searchQuery, ...recentSearches.filter(s => s !== searchQuery)].slice(0, 10);
      setRecentSearches(updated);
      await AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
    } catch (e) {
      console.error('Failed to save recent search:', e);
    }
  };

  // Direct search with extensions passed in (used for initial query)
  const performSearchDirect = async (searchText: string, extensions: InstalledExtension[]) => {
    if (searchText.trim().length === 0 || extensions.length === 0) return;

    setQuery(searchText);
    setLoading(true);
    setHasSearched(true);
    setHasMoreResults(true);
    setResults([]);
    setMultiSourceResults([]);
    setSearchMetadata(null);
    currentQueryRef.current = searchText;

    try {
      // Multi-source search using passed extensions
      saveRecentSearch(searchText.trim());
      const searchPromises = extensions.map(async (ext) => {
        try {
          const searchResult = await searchManga(ext.id, searchText, null);
          return {
            extensionId: ext.id,
            extensionName: ext.name,
            results: searchResult.results,
            metadata: searchResult.metadata,
          };
        } catch (error) {
          console.error(`Search failed for ${ext.name}:`, error);
          return {
            extensionId: ext.id,
            extensionName: ext.name,
            results: [],
            metadata: null,
          };
        }
      });

      const allResults = await Promise.all(searchPromises);
      // Filter out sources with no results
      const resultsWithData = allResults.filter(r => r.results.length > 0);
      setMultiSourceResults(resultsWithData);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const performSearch = async (searchText: string, isNewSearch: boolean = true) => {
    if (searchText.trim().length === 0) return;

    if (isNewSearch) {
      setQuery(searchText);
      setLoading(true);
      setHasSearched(true);
      setHasMoreResults(true);
      setResults([]);
      setMultiSourceResults([]);
      setSearchMetadata(null);
      currentQueryRef.current = searchText;
    } else {
      setLoadingMore(true);
    }

    try {
      if (activeSource) {
        // Single source search
        const searchResult = await searchManga(
          activeSource,
          searchText,
          isNewSearch ? null : searchMetadata
        );

        // Check if we got any results
        if (searchResult.results.length === 0 && !isNewSearch) {
          setHasMoreResults(false);
        } else {
          if (isNewSearch) {
            setResults(searchResult.results);
            saveRecentSearch(searchText.trim());
          } else {
            setResults(prev => [...prev, ...searchResult.results]);
          }
        }

        // If no metadata returned, no more pages
        if (!searchResult.metadata) {
          setHasMoreResults(false);
        } else {
          setSearchMetadata(searchResult.metadata);
        }
      } else {
        // Multi-source search (search all installed extensions)
        if (isNewSearch) {
          saveRecentSearch(searchText.trim());
          const searchPromises = installedExtensions.map(async (ext) => {
            try {
              const searchResult = await searchManga(ext.id, searchText, null);
              return {
                extensionId: ext.id,
                extensionName: ext.name,
                results: searchResult.results,
                metadata: searchResult.metadata,
              };
            } catch (error) {
              console.error(`Search failed for ${ext.name}:`, error);
              return {
                extensionId: ext.id,
                extensionName: ext.name,
                results: [],
                metadata: null,
              };
            }
          });

          const allResults = await Promise.all(searchPromises);
          // Filter out sources with no results
          setMultiSourceResults(allResults.filter(r => r.results.length > 0));
        }
      }
    } catch (error) {
      console.error('Search failed:', error);
      setHasMoreResults(false);
      if (isNewSearch) {
        setResults([]);
        setMultiSourceResults([]);
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const loadMoreResults = () => {
    // Only load more if not already loading, have more results, and have a search query
    if (loadingMore || loading || !hasMoreResults || !currentQueryRef.current) return;
    performSearch(currentQueryRef.current, false);
  };

  const clearSearch = () => {
    setQuery('');
    setResults([]);
    setMultiSourceResults([]);
    setHasSearched(false);
    setSearchMetadata(null);
    currentQueryRef.current = '';
  };

  const clearRecentSearches = async () => {
    setRecentSearches([]);
    await AsyncStorage.removeItem(RECENT_SEARCHES_KEY);
  };

  const navigateToManga = (manga: SourceManga) => {
    navigation.navigate('MangaDetail', {
      mangaId: manga.mangaId || manga.id,
      sourceId: manga.extensionId
    });
  };

  // Convert SourceManga to Manga for preview
  const sourceMangaToManga = (manga: SourceManga): Manga => ({
    id: manga.mangaId || manga.id,
    title: manga.title,
    author: manga.subtitle || '',
    description: '',
    coverImage: manga.image,
    genres: [],
    status: 'ongoing',
    chapters: [],
    lastUpdated: new Date().toISOString(),
    source: manga.extensionId,
  });

  const handleLongPress = (manga: SourceManga) => {
    if (settings.mangaPreviewEnabled) {
      setPreviewManga(sourceMangaToManga(manga));
      setPreviewSourceId(manga.extensionId);
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

  const getExtensionIconUrl = (ext: InstalledExtension): string | null => {
    return getInstalledExtensionIconUrl(ext);
  };

  const renderSourceIcons = () => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.sourcesContainer}
    >
      {/* All Sources option */}
      <TouchableOpacity
        style={styles.sourceCard}
        onPress={() => setActiveSource(null)}
        activeOpacity={0.8}
      >
        <View style={[
          styles.sourceIconContainer,
          activeSource === null && { borderColor: '#FA233B', borderWidth: 2 }
        ]}>
          <Ionicons name="globe-outline" size={40} color={activeSource === null ? "#FA233B" : "#8E8E93"} />
        </View>
        <Text style={[
          styles.sourceName,
          { color: activeSource === null ? '#FFFFFF' : '#8E8E93' }
        ]} numberOfLines={1}>
          {t('search.all')}
        </Text>
      </TouchableOpacity>

      {installedExtensions.map((ext) => {
        const iconUrl = getExtensionIconUrl(ext);
        const isSelected = activeSource === ext.id;
        return (
          <TouchableOpacity
            key={ext.id}
            style={styles.sourceCard}
            onPress={() => setActiveSource(ext.id)}
            activeOpacity={0.8}
          >
            <View style={[
              styles.sourceIconContainer,
              isSelected && { borderColor: '#FA233B', borderWidth: 2 }
            ]}>
              {iconUrl ? (
                <Image source={{ uri: iconUrl }} style={styles.sourceIconImage} contentFit="contain" />
              ) : (
                <Ionicons name="image-outline" size={40} color="#FA233B" />
              )}
            </View>
            <Text style={[
              styles.sourceName,
              { color: isSelected ? '#FFFFFF' : '#8E8E93' }
            ]} numberOfLines={1}>
              {ext.name}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );

  const renderRecentSearches = () => {
    if (recentSearches.length === 0) return null;

    return (
      <View style={styles.recentContainer}>
        <View style={styles.recentCard}>
          <View style={styles.recentHeader}>
            <Text style={styles.recentTitle}>RECENT SEARCHES</Text>
            <TouchableOpacity onPress={clearRecentSearches} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.clearText}>CLEAR</Text>
            </TouchableOpacity>
          </View>
          {recentSearches.map((item, index) => (
            <TouchableOpacity
              key={index}
              style={[
                styles.recentItem,
                index < recentSearches.length - 1 && styles.recentDivider
              ]}
              onPress={() => performSearch(item)}
              activeOpacity={0.7}
            >
              <Text style={styles.recentItemText}>{item}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  };

  const renderResultItem = ({ item, index }: { item: SourceManga; index: number }) => {
    const isLastRow = index >= results.length - (results.length % NUM_COLUMNS || NUM_COLUMNS);
    const columnIndex = index % NUM_COLUMNS;

    return (
      <TouchableOpacity
        style={[
          styles.gridItem,
          columnIndex < NUM_COLUMNS - 1 && { marginRight: GRID_GAP },
          !isLastRow && { marginBottom: GRID_GAP },
        ]}
        onPress={() => navigateToManga(item)}
        onLongPress={() => handleLongPress(item)}
        delayLongPress={300}
        activeOpacity={0.7}
      >
        <Image
          source={{ uri: item.image }}
          style={styles.gridCover}
          contentFit="cover"
        />
        <Text style={[styles.gridTitle, { color: theme.text }]} numberOfLines={1}>
          {item.title}
        </Text>
        {item.subtitle && (
          <Text style={[styles.gridSubtitle, { color: theme.textSecondary }]} numberOfLines={1}>
            {item.subtitle}
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  const renderMangaCard = (manga: SourceManga, index: number) => (
    <TouchableOpacity
      key={`${manga.extensionId}-${manga.id}-${index}`}
      style={styles.horizontalCard}
      onPress={() => navigateToManga(manga)}
      onLongPress={() => handleLongPress(manga)}
      delayLongPress={300}
      activeOpacity={0.7}
    >
      <Image
        source={{ uri: manga.image }}
        style={styles.horizontalCover}
        contentFit="cover"
      />
      <Text style={[styles.horizontalTitle, { color: theme.text }]} numberOfLines={2}>
        {manga.title}
      </Text>
      {manga.subtitle && (
        <Text style={[styles.horizontalSubtitle, { color: theme.textSecondary }]} numberOfLines={1}>
          {manga.subtitle}
        </Text>
      )}
    </TouchableOpacity>
  );

  const navigateToViewMore = (sourceResult: SourceSearchResult) => {
    // Navigate to SearchResults screen with the source results and query for pagination
    navigation.navigate('SearchResults', {
      sourceId: sourceResult.extensionId,
      sourceName: sourceResult.extensionName,
      query: currentQueryRef.current,
      initialItems: sourceResult.results,
    });
  };

  const renderMultiSourceResults = () => (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.multiSourceContainer}>
      {multiSourceResults.map((sourceResult) => (
        <View key={sourceResult.extensionId} style={styles.sourceSection}>
          <View style={styles.sourceSectionHeader}>
            <Text style={[styles.sourceSectionTitle, { color: theme.text }]}>
              {sourceResult.extensionName}
            </Text>
            {sourceResult.results.length > 0 && (
              <TouchableOpacity style={styles.expandButton} onPress={() => navigateToViewMore(sourceResult)} activeOpacity={0.7}>
                <Ionicons name="expand-outline" size={16} color="#FA8072" />
              </TouchableOpacity>
            )}
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.horizontalList}
          >
            {sourceResult.results.slice(0, 10).map((manga, index) => renderMangaCard(manga, index))}
          </ScrollView>
        </View>
      ))}
    </ScrollView>
  );

  const hasResults = activeSource ? results.length > 0 : multiSourceResults.length > 0;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>Search Everything</Text>
        <TouchableOpacity
          onPress={() => performSearch(query)}
          disabled={!query.trim()}
        >
          <Text style={[styles.searchButton, { color: query.trim() ? '#FA233B' : '#545458' }]}>
            Search
          </Text>
        </TouchableOpacity>
      </View>

      {/* Search Bar */}
      <View style={styles.searchBarContainer}>
        <View style={[styles.searchBox, { backgroundColor: theme.card }]}>
          <Ionicons name="search" size={20} color={theme.textSecondary} style={styles.searchIcon} />
          <TextInput
            style={[styles.searchInput, { color: theme.text }]}
            placeholder={t('search.placeholder')}
            placeholderTextColor={theme.textSecondary}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => performSearch(query)}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={clearSearch}>
              <Ionicons name="close-circle" size={18} color={theme.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Content */}
      {loading ? (
        <LoadingIndicator message={t('common.searching')} />
      ) : hasSearched ? (
        !hasResults ? (
          <EmptyState
            icon="search"
            title={t('common.noResults')}
            description={t('search.noResultsFor', { query })}
          />
        ) : activeSource ? (
          // Single source - grid view with pagination
          <FlatList
            data={results}
            renderItem={renderResultItem}
            keyExtractor={(item, index) => `${item.id}-${index}`}
            numColumns={NUM_COLUMNS}
            contentContainerStyle={styles.resultsGrid}
            showsVerticalScrollIndicator={false}
            onEndReached={loadMoreResults}
            onEndReachedThreshold={0.5}
            ListFooterComponent={
              loadingMore ? (
                <View style={styles.loadingMore}>
                  <ActivityIndicator size="small" color={theme.primary} />
                  <Text style={[styles.loadingMoreText, { color: theme.textSecondary }]}>
                    {t('common.loadingMore')}
                  </Text>
                </View>
              ) : !hasMoreResults && results.length > 0 ? (
                <View style={styles.endOfResults}>
                  <Text style={[styles.endOfResultsText, { color: theme.textSecondary }]}>
                    {t('search.noMoreResults')}
                  </Text>
                </View>
              ) : null
            }
          />
        ) : (
          // Multi-source - horizontal sections
          renderMultiSourceResults()
        )
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          {installedExtensions.length > 0 ? (
            renderSourceIcons()
          ) : (
            <View style={styles.noExtensions}>
              <Text style={[styles.noExtensionsText, { color: theme.textSecondary }]}>
                {t('search.noExtensionsHint')}
              </Text>
            </View>
          )}
          {renderRecentSearches()}
        </ScrollView>
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
    paddingTop: 50,
    paddingBottom: 10,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
  },
  searchButton: {
    fontSize: 16,
    fontWeight: '500',
  },
  searchBarContainer: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 40,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    height: '100%',
  },
  sourcesContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  sourceCard: {
    alignItems: 'center',
    width: 96,
  },
  sourceIconContainer: {
    width: 96,
    height: 96,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
    backgroundColor: '#1C1C1E',
    overflow: 'hidden',
    padding: 14,
  },
  sourceIconImage: {
    width: '100%',
    height: '100%',
  },
  sourceIcon: {
    fontSize: 28,
  },
  sourceName: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  noExtensions: {
    padding: 32,
    alignItems: 'center',
  },
  noExtensionsText: {
    textAlign: 'center',
    fontSize: 14,
  },
  recentContainer: {
    marginTop: 20,
    paddingHorizontal: 16,
  },
  recentCard: {
    borderRadius: 12,
    backgroundColor: '#1C1C1E',
    overflow: 'hidden',
  },
  recentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  recentTitle: {
    fontSize: 13,
    fontWeight: '500',
    color: '#8E8E93',
    letterSpacing: 0.5,
  },
  clearText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FA233B',
    letterSpacing: 0.5,
  },
  recentItem: {
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  recentDivider: {
    borderBottomColor: '#2C2C2E',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  recentItemText: {
    fontSize: 16,
    color: '#FFFFFF',
  },
  expandButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#2C1E20',
    justifyContent: 'center',
    alignItems: 'center',
  },
  resultsGrid: {
    paddingHorizontal: GRID_PADDING,
    paddingTop: 8,
    paddingBottom: 100,
  },
  gridItem: {
    width: CARD_WIDTH,
  },
  gridCover: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 8,
    backgroundColor: '#333',
  },
  gridTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 6,
  },
  gridSubtitle: {
    fontSize: 11,
    marginTop: 2,
  },
  loadingMore: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
    gap: 10,
  },
  loadingMoreText: {
    fontSize: 14,
  },
  // Multi-source styles
  multiSourceContainer: {
    paddingBottom: 100,
  },
  sourceSection: {
    marginBottom: 24,
  },
  sourceSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  sourceSectionTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  horizontalList: {
    paddingHorizontal: 16,
    gap: 12,
  },
  horizontalCard: {
    width: CARD_WIDTH,
  },
  horizontalCover: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 8,
    backgroundColor: '#333',
  },
  horizontalTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 6,
  },
  horizontalSubtitle: {
    fontSize: 11,
    marginTop: 2,
  },
  endOfResults: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  endOfResultsText: {
    fontSize: 14,
  },
});
