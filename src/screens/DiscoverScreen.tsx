import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Dimensions,
  RefreshControl,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { LoadingIndicator } from '../components';
import { 
  getInstalledExtensions, 
  getHomeSections, 
  InstalledExtension,
  HomeSection,
  SourceManga,
} from '../services/sourceService';
import { RootStackParamList } from '../types';

type DiscoverScreenNavigationProp = NativeStackNavigationProp<RootStackParamList>;

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 48) / 2; // 2 cards with 16px padding on sides and 16px gap between

export const DiscoverScreen: React.FC = () => {
  const { theme } = useTheme();
  const navigation = useNavigation<DiscoverScreenNavigationProp>();
  const [installedExtensions, setInstalledExtensions] = useState<InstalledExtension[]>([]);
  const [activeSource, setActiveSource] = useState<string>('');
  const [sections, setSections] = useState<HomeSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Reload extensions when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      loadExtensions();
    }, [])
  );

  // Load source data when active source changes
  useEffect(() => {
    if (activeSource) {
      loadSourceData(activeSource);
    }
  }, [activeSource]);

  const loadExtensions = async () => {
    try {
      const extensions = await getInstalledExtensions();
      setInstalledExtensions(extensions);
      
      // Set active source to first extension if not set or if current is invalid
      if (extensions.length > 0) {
        if (!activeSource || !extensions.find((e: InstalledExtension) => e.id === activeSource)) {
          setActiveSource(extensions[0].id);
        }
      } else {
        setLoading(false);
      }
    } catch (error) {
      console.error('Failed to load extensions:', error);
      setLoading(false);
    }
  };

  const loadSourceData = async (extensionId: string) => {
    setLoading(true);
    try {
      const homeSections = await getHomeSections(extensionId);
      setSections(homeSections);
    } catch (error) {
      console.error('Failed to load source data:', error);
      setSections([]);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    if (activeSource) {
      await loadSourceData(activeSource);
    }
    setRefreshing(false);
  };

  const navigateToManga = (manga: SourceManga) => {
    navigation.navigate('MangaDetail', { 
      mangaId: manga.mangaId || manga.id,
      sourceId: manga.extensionId,
    });
  };

  const renderSourceTabs = () => {
    if (installedExtensions.length === 0) {
      return (
        <View style={[styles.noExtensionsContainer, { borderBottomColor: theme.border }]}>
          <Text style={[styles.noExtensionsText, { color: theme.textSecondary }]}>
            No extensions installed
          </Text>
          <TouchableOpacity 
            style={[styles.addExtensionButton, { backgroundColor: theme.primary }]}
            onPress={() => navigation.navigate('Extensions' as any)}
          >
            <Text style={styles.addExtensionText}>Add Extensions</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={[styles.tabsWrapper, { borderBottomColor: theme.border }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabsContainer}
          contentContainerStyle={styles.tabsContent}
        >
          {installedExtensions.map(ext => (
            <TouchableOpacity
              key={ext.id}
              style={[
                styles.tab,
                activeSource === ext.id && styles.activeTab,
                activeSource === ext.id && { borderBottomColor: theme.primary },
              ]}
              onPress={() => setActiveSource(ext.id)}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: activeSource === ext.id ? theme.primary : theme.textSecondary },
                ]}
              >
                {ext.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  };

  const renderMangaCard = (manga: SourceManga, sectionId: string, index: number) => (
    <TouchableOpacity
      key={`${sectionId}-${manga.id}-${index}`}
      style={styles.mangaCard}
      onPress={() => navigateToManga(manga)}
      activeOpacity={0.7}
    >
      <Image
        source={{ uri: manga.image }}
        style={[styles.mangaCover, { backgroundColor: theme.card }]}
      />
      <Text
        style={[styles.mangaTitle, { color: theme.text }]}
        numberOfLines={2}
      >
        {manga.title}
      </Text>
      <Text style={[styles.mangaSubtitle, { color: theme.textSecondary }]} numberOfLines={1}>
        {manga.subtitle || ''}
      </Text>
    </TouchableOpacity>
  );

  const navigateToCategory = (section: HomeSection) => {
    navigation.navigate('Category', {
      sourceId: activeSource,
      sectionId: section.id,
      title: section.title,
      initialItems: section.items,
    });
  };

  const renderSection = (section: HomeSection) => {
    // Skip sections with no items
    if (!section.items || section.items.length === 0) {
      return null;
    }

    return (
      <View key={section.id} style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>{section.title}</Text>
          {section.containsMoreItems && (
            <TouchableOpacity 
              style={[styles.expandButton, { backgroundColor: theme.card }]}
              onPress={() => navigateToCategory(section)}
            >
              <Ionicons name="resize-outline" size={18} color={theme.primary} />
            </TouchableOpacity>
          )}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.mangaList}
        >
          {section.items.map((manga: SourceManga, index: number) => renderMangaCard(manga, section.id, index))}
        </ScrollView>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerSpacer} />
        <Text style={[styles.headerTitle, { color: theme.text }]}>Discover</Text>
        <TouchableOpacity style={styles.globeButton}>
          <Ionicons name="globe-outline" size={24} color={theme.primary} />
        </TouchableOpacity>
      </View>

      {/* Source Tabs */}
      {renderSourceTabs()}

      {/* Content */}
      {loading ? (
        <LoadingIndicator message="Loading..." />
      ) : sections.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="library-outline" size={64} color={theme.textSecondary} />
          <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
            {installedExtensions.length === 0 
              ? 'Install extensions to discover manga'
              : 'No content available'}
          </Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.primary}
            />
          }
        >
          {sections.map(section => renderSection(section))}
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
  headerSpacer: {
    width: 40,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
  },
  globeButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  tabsWrapper: {
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  tabsContainer: {
    flexGrow: 0,
  },
  tabsContent: {
    paddingHorizontal: 8,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTab: {
    borderBottomWidth: 2,
  },
  tabText: {
    fontSize: 15,
    fontWeight: '500',
  },
  content: {
    paddingBottom: 100,
  },
  section: {
    marginTop: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '500',
  },
  expandButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#333',
  },
  mangaList: {
    paddingHorizontal: 16,
  },
  mangaCard: {
    width: CARD_WIDTH,
    marginRight: 16,
  },
  mangaCover: {
    width: CARD_WIDTH,
    height: CARD_WIDTH * 1.5,
    borderRadius: 8,
    marginBottom: 8,
  },
  mangaTitle: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
    marginBottom: 4,
  },
  mangaSubtitle: {
    fontSize: 12,
    lineHeight: 16,
  },
  noExtensionsContainer: {
    padding: 20,
    alignItems: 'center',
    borderBottomWidth: 1,
  },
  noExtensionsText: {
    fontSize: 14,
    marginBottom: 12,
  },
  addExtensionButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addExtensionText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyText: {
    fontSize: 16,
    textAlign: 'center',
    marginTop: 16,
  },
});
