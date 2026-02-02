import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Image,
    Animated,
    Modal,
    FlatList,
    ActivityIndicator,
    Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spotifyRemoteService, SpotifyPlayerState } from '../services/spotifyRemoteService';
import { SpotifyRemote, SpotifyContentItem } from '../../modules/spotify-remote/src';

interface SpotifyMiniPlayerProps {
    visible?: boolean;
    style?: any;
}

export const SpotifyMiniPlayer: React.FC<SpotifyMiniPlayerProps> = ({ 
    visible = true,
    style 
}) => {
    const [playerState, setPlayerState] = useState<SpotifyPlayerState | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [showPicker, setShowPicker] = useState(false);
    const [contentItems, setContentItems] = useState<SpotifyContentItem[]>([]);
    const [loadingContent, setLoadingContent] = useState(false);
    const [imageCache, setImageCache] = useState<Record<string, string>>({});
    const expandAnim = useState(new Animated.Value(0))[0];

    // Helper to get image - iOS uses content URI, Android uses imageUri
    const loadImageForItem = async (item: SpotifyContentItem): Promise<string | null> => {
        try {
            // iOS: fetchContentItem by URI then get image
            // Android: use imageUri directly with imagesApi
            const imageKey = Platform.OS === 'ios' ? item.uri : item.imageUri;
            if (!imageKey) return null;
            
            return await SpotifyRemote.getContentItemImage(imageKey);
        } catch (e) {
            console.log(`[SpotifyMiniPlayer] Failed to load image for ${item.title}`);
            return null;
        }
    };

    useEffect(() => {
        console.log('[SpotifyMiniPlayer] Component MOUNTED');
        // Check initial connection state
        setIsConnected(spotifyRemoteService.isConnected());
        setPlayerState(spotifyRemoteService.getPlayerState());

        // Subscribe to player state changes
        const unsubscribe = spotifyRemoteService.addPlayerStateListener((state) => {
            setPlayerState(state);
            setIsConnected(true);
        });

        // Subscribe to connection changes
        const unsubConnection = spotifyRemoteService.addConnectionListener((connected) => {
            console.log('[SpotifyMiniPlayer] Connection changed:', connected);
            setIsConnected(connected);
            if (!connected) {
                setPlayerState(null);
                // Don't close picker on disconnect - user might want to reconnect
            }
        });

        return () => {
            console.log('[SpotifyMiniPlayer] Component UNMOUNTING');
            unsubscribe();
            unsubConnection();
        };
    }, []);

    useEffect(() => {
        Animated.timing(expandAnim, {
            toValue: expanded ? 1 : 0,
            duration: 200,
            useNativeDriver: false,
        }).start();
    }, [expanded]);

    // Debug: track showPicker changes
    useEffect(() => {
        console.log('[SpotifyMiniPlayer] showPicker changed to:', showPicker);
    }, [showPicker]);

    const handleConnect = async () => {
        if (isConnecting) return;
        
        setIsConnecting(true);
        try {
            const connected = await spotifyRemoteService.connect();
            setIsConnected(connected);
            if (connected) {
                await spotifyRemoteService.refreshPlayerState();
            }
        } catch (error) {
            console.error('[SpotifyMiniPlayer] Connect failed:', error);
        } finally {
            setIsConnecting(false);
        }
    };

    const handlePlayPause = async () => {
        if (!isConnected) {
            handleConnect();
            return;
        }
        await spotifyRemoteService.togglePlayPause();
    };

    const handleNext = async () => {
        if (!isConnected) return;
        await spotifyRemoteService.skipToNext();
    };

    const handlePrevious = async () => {
        if (!isConnected) return;
        await spotifyRemoteService.skipToPrevious();
    };

    const openContentPicker = async () => {
        console.log('[SpotifyMiniPlayer] Opening content picker, isConnected:', isConnected);
        if (!isConnected) {
            console.log('[SpotifyMiniPlayer] Not connected, aborting');
            return;
        }
        
        setShowPicker(true);
        setLoadingContent(true);
        console.log('[SpotifyMiniPlayer] showPicker set to true');
        
        try {
            const items = await SpotifyRemote.getRecommendedContentItems();
            console.log('[SpotifyMiniPlayer] Got content items:', items.length);
            
            // The API returns categories/containers. We want playable items.
            // Flatten by fetching children of containers
            let playableItems: SpotifyContentItem[] = [];
            
            for (const item of items.slice(0, 6)) { // Check first 6 categories
                if (item.isContainer) {
                    try {
                        const children = await SpotifyRemote.getChildrenOfContentItem(item.uri);
                        console.log(`[SpotifyMiniPlayer] ${item.title} has ${children.length} children`);
                        // Add first 4 items from each category
                        playableItems.push(...children.slice(0, 4));
                    } catch (e) {
                        console.log(`[SpotifyMiniPlayer] Failed to get children of ${item.title}:`, e);
                    }
                } else {
                    playableItems.push(item);
                }
            }
            
            // Deduplicate by URI
            const uniqueItems = playableItems.filter((item, index, self) => 
                index === self.findIndex(t => t.uri === item.uri)
            ).slice(0, 12);
            
            console.log('[SpotifyMiniPlayer] Final playable items:', uniqueItems.length);
            setContentItems(uniqueItems);
            
            // Load images in the background - don't block the UI
            loadImagesInBackground(uniqueItems);
        } catch (error) {
            console.error('[SpotifyMiniPlayer] Failed to load content:', error);
            // Still show the modal with empty state
        } finally {
            setLoadingContent(false);
            console.log('[SpotifyMiniPlayer] Loading complete, showPicker should still be:', showPicker);
        }
    };

    const loadImagesInBackground = async (items: SpotifyContentItem[]) => {
        const newCache: Record<string, string> = {};
        for (const item of items) {
            try {
                const base64 = await loadImageForItem(item);
                if (base64) {
                    newCache[item.uri] = base64;
                    // Update cache incrementally
                    setImageCache(prev => ({ ...prev, [item.uri]: base64 }));
                }
            } catch (e) {
                // Ignore individual image errors
            }
        }
    };

    const playContentItem = async (item: SpotifyContentItem) => {
        try {
            await SpotifyRemote.play(item.uri);
            setShowPicker(false);
            // Refresh player state after playing
            setTimeout(() => spotifyRemoteService.refreshPlayerState(), 500);
        } catch (error) {
            console.error('[SpotifyMiniPlayer] Failed to play:', error);
        }
    };

    if (!visible) return null;

    // Render the modal separately so it persists across state changes
    const renderPickerModal = () => (
        <Modal
            visible={showPicker}
            animationType="slide"
            transparent
            onRequestClose={() => setShowPicker(false)}
        >
            <View style={styles.modalOverlay}>
                <View style={styles.modalContent}>
                    {/* Header */}
                    <View style={styles.modalHeader}>
                        <View style={styles.modalHeaderLeft}>
                            <Ionicons name="musical-notes" size={24} color="#1DB954" />
                            <Text style={styles.modalTitle}>Pick Music</Text>
                        </View>
                        <TouchableOpacity 
                            style={styles.modalClose}
                            onPress={() => setShowPicker(false)}
                        >
                            <Ionicons name="close" size={24} color="#fff" />
                        </TouchableOpacity>
                    </View>

                    {/* Content Grid */}
                    {loadingContent ? (
                        <View style={styles.loadingContainer}>
                            <ActivityIndicator size="large" color="#1DB954" />
                            <Text style={styles.loadingText}>Loading your music...</Text>
                        </View>
                    ) : (
                        <FlatList
                            data={contentItems}
                            keyExtractor={(item) => item.uri}
                            numColumns={3}
                            contentContainerStyle={styles.gridContent}
                            renderItem={({ item }) => (
                                <TouchableOpacity
                                    style={styles.gridItem}
                                    onPress={() => playContentItem(item)}
                                >
                                    {imageCache[item.uri] ? (
                                        <Image
                                            source={{ uri: imageCache[item.uri] }}
                                            style={styles.gridItemImage}
                                        />
                                    ) : (
                                        <View style={[styles.gridItemImage, styles.gridItemPlaceholder]}>
                                            <Ionicons 
                                                name={item.isContainer ? "albums" : "musical-note"} 
                                                size={32} 
                                                color="#1DB954" 
                                            />
                                        </View>
                                    )}
                                    <Text style={styles.gridItemTitle} numberOfLines={2}>
                                        {item.title}
                                    </Text>
                                </TouchableOpacity>
                            )}
                            ListEmptyComponent={
                                <View style={styles.emptyContainer}>
                                    <Ionicons name="musical-notes-outline" size={48} color="#666" />
                                    <Text style={styles.emptyText}>No content available</Text>
                                </View>
                            }
                        />
                    )}
                </View>
            </View>
        </Modal>
    );

    // Collapsed view - just shows Spotify icon
    if (!isConnected && !expanded) {
        return (
            <>
                {renderPickerModal()}
                <TouchableOpacity
                    style={[styles.collapsedContainer, style]}
                    onPress={handleConnect}
                    disabled={isConnecting}
                >
                    <View style={styles.spotifyIconContainer}>
                        <Ionicons 
                            name={isConnecting ? "hourglass-outline" : "musical-notes"} 
                            size={20} 
                            color="#1DB954" 
                        />
                    </View>
                </TouchableOpacity>
            </>
        );
    }

    // Connected but no track playing
    if (isConnected && !playerState?.track) {
        return (
            <>
                {renderPickerModal()}
                <TouchableOpacity
                    style={[styles.miniContainer, style]}
                    onPress={openContentPicker}
                >
                    <Ionicons name="musical-notes" size={20} color="#1DB954" />
                    <Text style={styles.noTrackText}>Tap to pick music</Text>
                </TouchableOpacity>
            </>
        );
    }

    // Mini player with track info
    const track = playerState?.track;
    const isPaused = playerState?.isPaused ?? true;

    const containerHeight = expandAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [48, 72],
    });

    return (
        <Animated.View style={[styles.container, style, { height: containerHeight }]}>
            <TouchableOpacity 
                style={styles.contentRow}
                onPress={() => setExpanded(!expanded)}
                activeOpacity={0.8}
            >
                {/* Album Art */}
                {track?.imageUri ? (
                    <Image
                        source={{ uri: track.imageUri }}
                        style={styles.albumArt}
                    />
                ) : (
                    <View style={[styles.albumArt, styles.albumArtPlaceholder]}>
                        <Ionicons name="musical-notes" size={18} color="#1DB954" />
                    </View>
                )}

                {/* Track Info */}
                <View style={styles.trackInfo}>
                    <Text style={styles.trackName} numberOfLines={1}>
                        {track?.name || 'Unknown Track'}
                    </Text>
                    <Text style={styles.artistName} numberOfLines={1}>
                        {track?.artist || 'Unknown Artist'}
                    </Text>
                </View>

                {/* Controls */}
                <View style={styles.controls}>
                    {expanded && (
                        <TouchableOpacity 
                            style={styles.controlButton}
                            onPress={handlePrevious}
                        >
                            <Ionicons name="play-skip-back" size={18} color="#fff" />
                        </TouchableOpacity>
                    )}
                    
                    <TouchableOpacity 
                        style={styles.playButton}
                        onPress={handlePlayPause}
                    >
                        <Ionicons 
                            name={isPaused ? "play" : "pause"} 
                            size={20} 
                            color="#000" 
                        />
                    </TouchableOpacity>

                    {expanded && (
                        <TouchableOpacity 
                            style={styles.controlButton}
                            onPress={handleNext}
                        >
                            <Ionicons name="play-skip-forward" size={18} color="#fff" />
                        </TouchableOpacity>
                    )}
                </View>
            </TouchableOpacity>

            {/* Expanded - Pick Music button */}
            {expanded && (
                <TouchableOpacity 
                    style={styles.openSpotifyButton}
                    onPress={openContentPicker}
                >
                    <Ionicons name="musical-notes" size={14} color="#1DB954" />
                    <Text style={styles.openSpotifyText}>Pick Music</Text>
                </TouchableOpacity>
            )}

            {/* Content Picker Modal */}
            {renderPickerModal()}
        </Animated.View>
    );
};

const styles = StyleSheet.create({
    collapsedContainer: {
        backgroundColor: 'rgba(30, 30, 30, 0.95)',
        borderRadius: 24,
        padding: 10,
        alignSelf: 'flex-start',
    },
    spotifyIconContainer: {
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: 'rgba(29, 185, 84, 0.2)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    miniContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(30, 30, 30, 0.95)',
        borderRadius: 24,
        paddingHorizontal: 14,
        paddingVertical: 10,
        gap: 8,
    },
    noTrackText: {
        color: '#aaa',
        fontSize: 13,
    },
    container: {
        backgroundColor: 'rgba(30, 30, 30, 0.95)',
        borderRadius: 12,
        overflow: 'hidden',
    },
    contentRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 6,
        flex: 1,
    },
    albumArt: {
        width: 36,
        height: 36,
        borderRadius: 6,
    },
    albumArtPlaceholder: {
        backgroundColor: 'rgba(29, 185, 84, 0.2)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    trackInfo: {
        flex: 1,
        marginHorizontal: 10,
    },
    trackName: {
        color: '#fff',
        fontSize: 13,
        fontWeight: '600',
    },
    artistName: {
        color: '#aaa',
        fontSize: 11,
        marginTop: 1,
    },
    controls: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    controlButton: {
        padding: 6,
    },
    playButton: {
        backgroundColor: '#1DB954',
        width: 32,
        height: 32,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
    },
    openSpotifyButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 6,
        borderTopWidth: 1,
        borderTopColor: 'rgba(255, 255, 255, 0.1)',
    },
    openSpotifyText: {
        color: '#1DB954',
        fontSize: 12,
        fontWeight: '500',
    },
    // Modal styles
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        backgroundColor: '#1a1a1a',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        maxHeight: '70%',
        paddingBottom: Platform.OS === 'ios' ? 34 : 16,
    },
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    },
    modalHeaderLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    modalTitle: {
        color: '#fff',
        fontSize: 18,
        fontWeight: '600',
    },
    modalClose: {
        padding: 4,
    },
    loadingContainer: {
        padding: 60,
        alignItems: 'center',
    },
    loadingText: {
        color: '#aaa',
        marginTop: 12,
        fontSize: 14,
    },
    gridContent: {
        padding: 12,
    },
    gridItem: {
        flex: 1,
        margin: 6,
        maxWidth: '31%',
    },
    gridItemImage: {
        width: '100%',
        aspectRatio: 1,
        borderRadius: 8,
    },
    gridItemPlaceholder: {
        backgroundColor: 'rgba(29, 185, 84, 0.15)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    gridItemTitle: {
        color: '#fff',
        fontSize: 12,
        marginTop: 6,
        textAlign: 'center',
    },
    emptyContainer: {
        padding: 60,
        alignItems: 'center',
    },
    emptyText: {
        color: '#666',
        marginTop: 12,
        fontSize: 14,
    },
});

export default SpotifyMiniPlayer;
