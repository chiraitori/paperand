import React from 'react';
import { Platform, View, Image, Text, StyleSheet } from 'react-native';
import { Manga } from '../types';
import { MangaCard } from './MangaCard';
import { useTheme } from '../context/ThemeContext';
import Constants from 'expo-constants';

// Conditionally import react-native-ios-context-menu
let ContextMenuView: any = null;

const isExpoGo = Constants.appOwnership === 'expo';

if (!isExpoGo && Platform.OS === 'ios') {
    try {
        const contextMenu = require('react-native-ios-context-menu');
        ContextMenuView = contextMenu.ContextMenuView;
    } catch (e) {
        // native module not available
    }
}

interface MangaCardWithPreviewProps {
    manga: Manga;
    onPress: () => void;
    onAddToLibrary?: () => void;
    onRemoveFromLibrary?: () => void;
    onViewDetails?: () => void;
    onToggleFavorite?: () => void;
    isInLibrary?: boolean;
    isFavorite?: boolean;
    compact?: boolean;
    columns?: number;
    // For Android/Expo Go fallback
    onLongPress?: () => void;
}

/**
 * MangaCard with native iOS context menu preview
 * - iOS (production): Uses native ContextMenuView for 3D Touch/Haptic Touch preview
 * - Android/Expo Go: Uses the existing onLongPress callback for custom modal
 */
export const MangaCardWithPreview: React.FC<MangaCardWithPreviewProps> = ({
    manga,
    onPress,
    onAddToLibrary,
    onRemoveFromLibrary,
    onViewDetails,
    onToggleFavorite,
    isInLibrary = false,
    isFavorite = false,
    compact = false,
    columns,
    onLongPress,
}) => {
    const { theme } = useTheme();

    // Use native iOS context menu on iOS production builds
    if (Platform.OS === 'ios' && ContextMenuView && !isExpoGo) {
        // Build menu items dynamically based on props
        const menuItems: any[] = [];

        if (onViewDetails) {
            menuItems.push({
                actionKey: 'viewDetails',
                actionTitle: 'View Details',
                icon: {
                    type: 'IMAGE_SYSTEM',
                    imageValue: { systemName: 'info.circle' },
                },
            });
        }

        if (isInLibrary) {
            if (onToggleFavorite) {
                menuItems.push({
                    actionKey: 'toggleFavorite',
                    actionTitle: isFavorite ? 'Remove from Favorites' : 'Add to Favorites',
                    icon: {
                        type: 'IMAGE_SYSTEM',
                        imageValue: { systemName: isFavorite ? 'star.slash' : 'star' },
                    },
                });
            }
            if (onRemoveFromLibrary) {
                menuItems.push({
                    actionKey: 'removeFromLibrary',
                    actionTitle: 'Remove from Library',
                    menuAttributes: ['destructive'],
                    icon: {
                        type: 'IMAGE_SYSTEM',
                        imageValue: { systemName: 'trash' },
                    },
                });
            }
        } else {
            if (onAddToLibrary) {
                menuItems.push({
                    actionKey: 'addToLibrary',
                    actionTitle: 'Add to Library',
                    icon: {
                        type: 'IMAGE_SYSTEM',
                        imageValue: { systemName: 'plus' },
                    },
                });
            }
        }

        const handleMenuAction = ({ nativeEvent }: any) => {
            switch (nativeEvent.actionKey) {
                case 'viewDetails':
                    onViewDetails?.();
                    break;
                case 'addToLibrary':
                    onAddToLibrary?.();
                    break;
                case 'removeFromLibrary':
                    onRemoveFromLibrary?.();
                    break;
                case 'toggleFavorite':
                    onToggleFavorite?.();
                    break;
            }
        };

        // Custom preview component that shows manga cover and title
        const renderPreview = () => (
            <View style={[styles.previewContainer, { backgroundColor: theme.card }]}>
                <Image
                    source={{ uri: manga.coverImage }}
                    style={styles.previewImage}
                    resizeMode="cover"
                />
                <View style={styles.previewInfo}>
                    <Text style={[styles.previewTitle, { color: theme.text }]} numberOfLines={2}>
                        {manga.title}
                    </Text>
                    {manga.author && (
                        <Text style={[styles.previewAuthor, { color: theme.textSecondary }]} numberOfLines={1}>
                            {manga.author}
                        </Text>
                    )}
                    {manga.description && (
                        <Text style={[styles.previewDescription, { color: theme.textSecondary }]} numberOfLines={4}>
                            {manga.description}
                        </Text>
                    )}
                </View>
            </View>
        );

        return (
            <ContextMenuView
                menuConfig={{
                    menuTitle: '',
                    menuItems,
                }}
                onPressMenuItem={handleMenuAction}
                onPressMenuPreview={onPress}
                previewConfig={{
                    previewType: 'CUSTOM',
                    previewSize: 'INHERIT',
                }}
                renderPreview={renderPreview}
            >
                <MangaCard
                    manga={manga}
                    onPress={onPress}
                    compact={compact}
                    columns={columns}
                />
            </ContextMenuView>
        );
    }

    // Fallback: Use standard MangaCard with onLongPress for Android/Expo Go
    return (
        <MangaCard
            manga={manga}
            onPress={onPress}
            onLongPress={onLongPress}
            compact={compact}
            columns={columns}
        />
    );
};

const styles = StyleSheet.create({
    previewContainer: {
        width: 280,
        borderRadius: 12,
        overflow: 'hidden',
    },
    previewImage: {
        width: '100%',
        height: 200,
    },
    previewInfo: {
        padding: 12,
    },
    previewTitle: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 4,
    },
    previewAuthor: {
        fontSize: 13,
        marginBottom: 8,
    },
    previewDescription: {
        fontSize: 12,
        lineHeight: 16,
    },
});
