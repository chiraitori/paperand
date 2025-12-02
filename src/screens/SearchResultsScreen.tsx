import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { LoadingIndicator } from '../components';
import { searchManga, SourceManga } from '../services/sourceService';
import { RootStackParamList } from '../types';

type SearchResultsScreenRouteProp = RouteProp<RootStackParamList, 'SearchResults'>;
type SearchResultsScreenNavigationProp = NativeStackNavigationProp<RootStackParamList>;

const { width } = Dimensions.get('window');
const NUM_COLUMNS = 3;
const GRID_PADDING = 16;
const GRID_GAP = 10;
const CARD_WIDTH = (width - GRID_PADDING * 2 - GRID_GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS;
const CARD_HEIGHT = CARD_WIDTH * 1.4;

export const SearchResultsScreen: React.FC = () => {
  const { theme } = useTheme();
  const navigation = useNavigation<SearchResultsScreenNavigationProp>();
  const route = useRoute<SearchResultsScreenRouteProp>();
  const { sourceId, sourceName, query, initialItems } = route.params;

  const [results, setResults] = useState<SourceManga[]>(initialItems || []);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [metadata, setMetadata] = useState<any>(null);
  const [hasMoreResults, setHasMoreResults] = useState(true);
  const isInitialLoad = useRef(true);

  useEffect(() => {
    if (isInitialLoad.current) {
      isInitialLoad.current = false;
      // Load first page to get metadata for pagination
      loadResults(true);
    }
  }, []);

  const loadResults = async (isFirstLoad: boolean = false) => {
    if (isFirstLoad && initialItems && initialItems.length > 0) {
      // We have initial items, just load to get metadata for next page
      setLoading(true);
    } else if (isFirstLoad) {
      setLoading(true);
    } else {
      if (!hasMoreResults) return; // No more pages
      setLoadingMore(true);
    }

    try {
      const result = await searchManga(
        sourceId,
        query,
        isFirstLoad ? null : metadata
      );

      // Check if we got any results
      if (result.results.length === 0) {
        setHasMoreResults(false);
      } else {
        if (isFirstLoad) {
          if (initialItems && initialItems.length > 0) {
            // Append new results to initial items (avoiding duplicates by checking IDs)
            const existingIds = new Set(initialItems.map((item: SourceManga) => item.id));
            const newItems = result.results.filter((item: SourceManga) => !existingIds.has(item.id));
            setResults([...initialItems, ...newItems]);
          } else {
            setResults(result.results);
          }
        } else {
          setResults(prev => [...prev, ...result.results]);
        }
      }
      
      // If no metadata returned, no more pages
      if (!result.metadata) {
        setHasMoreResults(false);
      } else {
        setMetadata(result.metadata);
      }
    } catch (error) {
      console.error('Failed to load search results:', error);
      setHasMoreResults(false);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const loadMoreResults = useCallback(() => {
    if (loadingMore || loading || !hasMoreResults) return;
    loadResults(false);
  }, [loadingMore, loading, hasMoreResults]);

  const navigateToManga = (manga: SourceManga) => {
    navigation.navigate('MangaDetail', {
      mangaId: manga.mangaId || manga.id,
      sourceId: manga.extensionId || sourceId,
    });
  };

  const renderItem = ({ item, index }: { item: SourceManga; index: number }) => (
    <TouchableOpacity
      style={[styles.gridItem, { marginLeft: index % NUM_COLUMNS === 0 ? 0 : GRID_GAP }]}
      onPress={() => navigateToManga(item)}
      activeOpacity={0.7}
    >
      <Image
        source={{ uri: item.image }}
        style={[styles.gridCover, { backgroundColor: theme.card }]}
        contentFit="cover"
      />
      <Text style={[styles.gridTitle, { color: theme.text }]} numberOfLines={2}>
        {item.title}
      </Text>
      {item.subtitle && (
        <Text style={[styles.gridSubtitle, { color: theme.textSecondary }]} numberOfLines={1}>
          {item.subtitle}
        </Text>
      )}
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={28} color={theme.primary} />
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>
            {sourceName}
          </Text>
          <Text style={[styles.headerSubtitle, { color: theme.textSecondary }]} numberOfLines={1}>
            "{query}"
          </Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {/* Content */}
      {loading && results.length === 0 ? (
        <LoadingIndicator message="Searching..." />
      ) : results.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="search-outline" size={64} color={theme.textSecondary} />
          <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
            No results found
          </Text>
        </View>
      ) : (
        <FlatList
          data={results}
          renderItem={renderItem}
          keyExtractor={(item, index) => `${item.id}-${index}`}
          numColumns={NUM_COLUMNS}
          contentContainerStyle={styles.gridContainer}
          showsVerticalScrollIndicator={false}
          onEndReached={loadMoreResults}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.loadingMore}>
                <ActivityIndicator size="small" color={theme.primary} />
                <Text style={[styles.loadingMoreText, { color: theme.textSecondary }]}>
                  Loading more...
                </Text>
              </View>
            ) : !hasMoreResults && results.length > 0 ? (
              <View style={styles.endOfResults}>
                <Text style={[styles.endOfResultsText, { color: theme.textSecondary }]}>
                  No more results
                </Text>
              </View>
            ) : null
          }
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingTop: 50,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  headerSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  headerSpacer: {
    width: 44,
  },
  gridContainer: {
    padding: GRID_PADDING,
    paddingBottom: 100,
  },
  gridItem: {
    width: CARD_WIDTH,
    marginBottom: 16,
  },
  gridCover: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 8,
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
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 16,
    textAlign: 'center',
    marginTop: 16,
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
  endOfResults: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  endOfResultsText: {
    fontSize: 14,
  },
});
