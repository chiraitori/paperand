import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  TouchableOpacity,
  Image,
  Dimensions,
  ScrollView,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../context/ThemeContext';
import { EmptyState, LoadingIndicator } from '../components';
import { getInstalledExtensions, searchManga, InstalledExtension, SourceManga } from '../services/sourceService';
import { RootStackParamList } from '../types';

type SearchScreenNavigationProp = NativeStackNavigationProp<RootStackParamList>;

const { width } = Dimensions.get('window');
const RECENT_SEARCHES_KEY = '@recent_searches';

export const SearchScreen: React.FC = () => {
  const { theme } = useTheme();
  const navigation = useNavigation<SearchScreenNavigationProp>();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SourceManga[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [installedExtensions, setInstalledExtensions] = useState<InstalledExtension[]>([]);
  const [activeSource, setActiveSource] = useState<string | null>(null);

  const loadExtensions = useCallback(async () => {
    const extensions = await getInstalledExtensions();
    setInstalledExtensions(extensions);
    if (extensions.length > 0 && !activeSource) {
      setActiveSource(extensions[0].id);
    }
  }, [activeSource]);

  useFocusEffect(
    useCallback(() => {
      loadExtensions();
      loadRecentSearches();
    }, [loadExtensions])
  );

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

  const performSearch = async (searchText: string) => {
    if (searchText.trim().length === 0 || !activeSource) return;
    
    setQuery(searchText);
    setLoading(true);
    setHasSearched(true);
    try {
      const searchResults = await searchManga(activeSource, searchText);
      setResults(searchResults);
      saveRecentSearch(searchText.trim());
    } catch (error) {
      console.error('Search failed:', error);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const clearSearch = () => {
    setQuery('');
    setResults([]);
    setHasSearched(false);
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

  const getExtensionIconUrl = (ext: InstalledExtension): string | null => {
    if (ext.icon && ext.repoBaseUrl) {
      return `${ext.repoBaseUrl}/${ext.id}/includes/${ext.icon}`;
    }
    return null;
  };

  const renderSourceIcons = () => (
    <ScrollView 
      horizontal 
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.sourcesContainer}
    >
      {installedExtensions.map((ext) => {
        const iconUrl = getExtensionIconUrl(ext);
        return (
          <TouchableOpacity 
            key={ext.id} 
            style={styles.sourceCard}
            onPress={() => setActiveSource(ext.id)}
          >
            <View style={[
              styles.sourceIconContainer,
              { borderColor: activeSource === ext.id ? theme.primary : 'transparent' }
            ]}>
              {iconUrl ? (
                <Image source={{ uri: iconUrl }} style={styles.sourceIconImage} />
              ) : (
                <Text style={styles.sourceIcon}>📚</Text>
              )}
            </View>
            <Text style={[
              styles.sourceName, 
              { color: activeSource === ext.id ? theme.primary : theme.text }
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
        <View style={[styles.recentCard, { backgroundColor: theme.card }]}>
          <View style={styles.recentHeader}>
            <Text style={[styles.recentTitle, { color: theme.textSecondary }]}>RECENT SEARCHES</Text>
            <TouchableOpacity onPress={clearRecentSearches}>
              <Text style={[styles.clearText, { color: theme.error }]}>CLEAR</Text>
            </TouchableOpacity>
          </View>
          {recentSearches.map((item, index) => (
            <TouchableOpacity
              key={index}
              style={[
                styles.recentItem, 
                index < recentSearches.length - 1 && { borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth }
              ]}
              onPress={() => performSearch(item)}
            >
              <Text style={[styles.recentItemText, { color: theme.text }]}>{item}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  };

  const renderResultItem = ({ item }: { item: SourceManga }) => (
    <TouchableOpacity
      style={[styles.resultItem, { backgroundColor: theme.card }]}
      onPress={() => navigateToManga(item)}
      activeOpacity={0.7}
    >
      <Image
        source={{ uri: item.image }}
        style={styles.resultCover}
      />
      <View style={styles.resultInfo}>
        <Text style={[styles.resultTitle, { color: theme.text }]} numberOfLines={2}>
          {item.title}
        </Text>
        {item.subtitle && (
          <Text style={[styles.resultAuthor, { color: theme.textSecondary }]}>
            {item.subtitle}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>Search Everything</Text>
        <TouchableOpacity onPress={() => performSearch(query)}>
          <Text style={[styles.searchButton, { color: theme.primary }]}>Search</Text>
        </TouchableOpacity>
      </View>

      {/* Search Bar */}
      <View style={styles.searchBarContainer}>
        <View style={[styles.searchBox, { backgroundColor: theme.card }]}>
          <Ionicons name="search" size={20} color={theme.textSecondary} style={styles.searchIcon} />
          <TextInput
            style={[styles.searchInput, { color: theme.text }]}
            placeholder="Search"
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
        <LoadingIndicator message="Searching..." />
      ) : hasSearched ? (
        results.length === 0 ? (
          <EmptyState
            icon="search"
            title="No results found"
            description={`No manga found for "${query}"`}
          />
        ) : (
          <FlatList
            data={results}
            renderItem={renderResultItem}
            keyExtractor={(item, index) => `${item.id}-${index}`}
            contentContainerStyle={styles.resultsList}
            showsVerticalScrollIndicator={false}
          />
        )
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          {installedExtensions.length > 0 ? (
            renderSourceIcons()
          ) : (
            <View style={styles.noExtensions}>
              <Text style={[styles.noExtensionsText, { color: theme.textSecondary }]}>
                No extensions installed. Go to Settings → Extensions to install some.
              </Text>
            </View>
          )}
          {renderRecentSearches()}
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
    width: 72,
  },
  sourceIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'hidden',
    backgroundColor: '#1A1A1A',
  },
  sourceIconImage: {
    width: '100%',
    height: '100%',
  },
  sourceIcon: {
    fontSize: 28,
  },
  sourceName: {
    fontSize: 11,
    fontWeight: '500',
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
  },
  clearText: {
    fontSize: 13,
    fontWeight: '500',
  },
  recentItem: {
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  recentItemText: {
    fontSize: 16,
  },
  resultsList: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  resultItem: {
    flexDirection: 'row',
    borderRadius: 12,
    marginBottom: 12,
    overflow: 'hidden',
  },
  resultCover: {
    width: 80,
    height: 120,
    backgroundColor: '#333',
  },
  resultInfo: {
    flex: 1,
    padding: 12,
    justifyContent: 'center',
  },
  resultTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  resultAuthor: {
    fontSize: 13,
    marginBottom: 8,
  },
});
