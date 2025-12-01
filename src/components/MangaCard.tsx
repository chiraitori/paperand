import React from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { Manga } from '../types';

interface MangaCardProps {
  manga: Manga;
  onPress: () => void;
  compact?: boolean;
}

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 48) / 3;
const COMPACT_CARD_WIDTH = (width - 48) / 2; // 16px padding each side + 16px gap between cards

export const MangaCard: React.FC<MangaCardProps> = ({ manga, onPress, compact = false }) => {
  const { theme } = useTheme();

  const cardWidth = compact ? COMPACT_CARD_WIDTH : CARD_WIDTH;
  const imageHeight = compact ? cardWidth * 1.5 : cardWidth * 1.4;

  return (
    <TouchableOpacity
      style={[
        styles.container,
        { width: cardWidth, backgroundColor: theme.card },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Image
        source={{ uri: manga.coverImage }}
        style={[styles.coverImage, { height: imageHeight }]}
        resizeMode="cover"
      />
      <View style={styles.infoContainer}>
        <Text
          style={[styles.title, { color: theme.text }]}
          numberOfLines={2}
        >
          {manga.title}
        </Text>
        {compact && (
          <Text
            style={[styles.author, { color: theme.textSecondary }]}
            numberOfLines={1}
          >
            {manga.author}
          </Text>
        )}
      </View>
      {manga.status === 'completed' && (
        <View style={[styles.badge, { backgroundColor: theme.success }]}>
          <Text style={styles.badgeText}>END</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  coverImage: {
    width: '100%',
    backgroundColor: '#E0E0E0',
  },
  infoContainer: {
    padding: 8,
  },
  title: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  author: {
    fontSize: 10,
    marginTop: 2,
  },
  badge: {
    position: 'absolute',
    top: 8,
    right: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: 'bold',
  },
});
