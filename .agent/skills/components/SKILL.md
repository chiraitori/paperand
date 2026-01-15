---
name: UI Components
description: Reusable component patterns and styling
---

# UI Components

## MangaCard

```typescript
interface MangaCardProps {
  manga: Manga;
  onPress: () => void;
  width?: number;
}

function MangaCard({ manga, onPress, width = 120 }: MangaCardProps) {
  const { colors } = useTheme();

  return (
    <Pressable onPress={onPress} style={[styles.card, { width }]}>
      <Image
        source={{ uri: manga.image }}
        style={[styles.cover, { height: width * 1.5 }]}
        contentFit="cover"
        cachePolicy="memory-disk"
      />
      <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
        {manga.title}
      </Text>
    </Pressable>
  );
}
```

## ChapterListItem

```typescript
interface ChapterItemProps {
  chapter: Chapter;
  isRead: boolean;
  onPress: () => void;
}

function ChapterListItem({ chapter, isRead, onPress }: ChapterItemProps) {
  const { colors } = useTheme();

  return (
    <Pressable onPress={onPress} style={styles.item}>
      <View style={styles.row}>
        <Text style={[
          styles.title,
          { color: isRead ? colors.textSecondary : colors.text }
        ]}>
          Chapter {chapter.chapNum}
        </Text>
        <Text style={[styles.date, { color: colors.textSecondary }]}>
          {formatDate(chapter.time)}
        </Text>
      </View>
    </Pressable>
  );
}
```

## LoadingIndicator

```typescript
function LoadingIndicator({ size = 'large' }) {
  const { colors } = useTheme();

  return (
    <View style={styles.center}>
      <ActivityIndicator size={size} color={colors.primary} />
    </View>
  );
}
```

## EmptyState

```typescript
interface EmptyStateProps {
  icon: string;
  title: string;
  message?: string;
  action?: { label: string; onPress: () => void };
}

function EmptyState({ icon, title, message, action }: EmptyStateProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      <Ionicons name={icon} size={64} color={colors.textSecondary} />
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      {message && (
        <Text style={[styles.message, { color: colors.textSecondary }]}>
          {message}
        </Text>
      )}
      {action && (
        <Pressable onPress={action.onPress} style={styles.button}>
          <Text style={{ color: colors.primary }}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}
```

## PickerModal

```typescript
interface PickerModalProps<T> {
  visible: boolean;
  title: string;
  options: { label: string; value: T }[];
  selected: T;
  onSelect: (value: T) => void;
  onClose: () => void;
}

function PickerModal<T>({ visible, title, options, selected, onSelect, onClose }) {
  const { colors } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade">
      <Pressable style={styles.overlay} onPress={onClose}>
        <View style={[styles.modal, { backgroundColor: colors.card }]}>
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          {options.map((option) => (
            <Pressable
              key={String(option.value)}
              onPress={() => { onSelect(option.value); onClose(); }}
              style={styles.option}
            >
              <Text style={{ color: colors.text }}>{option.label}</Text>
              {selected === option.value && (
                <Ionicons name="checkmark" color={colors.primary} />
              )}
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}
```

## Haptic Feedback

```typescript
import * as Haptics from 'expo-haptics';

// Light tap
Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

// Selection change
Haptics.selectionAsync();

// Success/error
Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
```

## Blur Effect

```typescript
import { BlurView } from 'expo-blur';

<BlurView intensity={80} tint="dark" style={styles.blur}>
  <Text>Content over blur</Text>
</BlurView>
```

## Linear Gradient

```typescript
import { LinearGradient } from 'expo-linear-gradient';

<LinearGradient
  colors={['transparent', 'rgba(0,0,0,0.8)']}
  style={styles.gradient}
/>
```

## Pull to Refresh

```typescript
<FlatList
  data={data}
  refreshControl={
    <RefreshControl
      refreshing={refreshing}
      onRefresh={handleRefresh}
      tintColor={colors.primary}
    />
  }
/>
```
