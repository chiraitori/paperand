import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { Chapter } from '../types';

interface ChapterListItemProps {
  chapter: Chapter;
  onPress: () => void;
  isRead?: boolean;
}

export const ChapterListItem: React.FC<ChapterListItemProps> = ({
  chapter,
  onPress,
  isRead = false,
}) => {
  const { theme } = useTheme();

  return (
    <TouchableOpacity
      style={[
        styles.container,
        { backgroundColor: theme.card, borderBottomColor: theme.border },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.content}>
        <View style={styles.leftContent}>
          <Text
            style={[
              styles.chapterNumber,
              { color: isRead ? theme.textSecondary : theme.text },
            ]}
          >
            Chapter {chapter.number}
          </Text>
          {chapter.title !== `Chapter ${chapter.number}` && (
            <Text
              style={[styles.chapterTitle, { color: theme.textSecondary }]}
              numberOfLines={1}
            >
              {chapter.title}
            </Text>
          )}
        </View>
        <View style={styles.rightContent}>
          <Text style={[styles.date, { color: theme.textSecondary }]}>
            {formatDate(chapter.releaseDate)}
          </Text>
          {isRead && (
            <View style={[styles.readBadge, { backgroundColor: theme.primary }]}>
              <Text style={styles.readBadgeText}>READ</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
};

const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - date.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return date.toLocaleDateString();
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  content: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  leftContent: {
    flex: 1,
    marginRight: 12,
  },
  rightContent: {
    alignItems: 'flex-end',
  },
  chapterNumber: {
    fontSize: 15,
    fontWeight: '500',
  },
  chapterTitle: {
    fontSize: 13,
    marginTop: 2,
  },
  date: {
    fontSize: 12,
  },
  readBadge: {
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  readBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: 'bold',
  },
});
