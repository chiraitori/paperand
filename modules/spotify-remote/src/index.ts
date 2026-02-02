/**
 * Spotify Remote Module for React Native
 * 
 * Provides cross-platform Spotify remote control functionality
 * for iOS and Android using native Spotify SDKs.
 */

import { requireNativeModule, EventEmitter } from 'expo-modules-core';
import type { NativeModule } from 'expo-modules-core';

// Types for Spotify Remote
export interface SpotifyTrack {
    uri: string;
    name: string;
    artist: string;
    album: string;
    duration: number;
    imageUri?: string;
}

export interface PlaybackOptions {
    isShuffling: boolean;
    repeatMode: RepeatMode;
}

export interface PlaybackRestrictions {
    canSkipNext: boolean;
    canSkipPrevious: boolean;
    canSeek: boolean;
    canToggleShuffle: boolean;
    canRepeatTrack: boolean;
    canRepeatContext: boolean;
}

export interface SpotifyPlayerState {
    track: SpotifyTrack;
    playbackPosition: number;
    playbackSpeed: number;
    isPaused: boolean;
    playbackOptions: PlaybackOptions;
    playbackRestrictions: PlaybackRestrictions;
}

export interface ConnectionStatus {
    connected: boolean;
    status: 'connected' | 'disconnected' | 'failed';
    error?: string;
}

export enum RepeatMode {
    Off = 0,
    Context = 1,
    Track = 2,
}

// Subscription type for event listeners
export interface EventSubscription {
    remove(): void;
}

// Content item from Spotify (playlist, album, etc.)
export interface SpotifyContentItem {
    uri: string;
    title: string;
    subtitle: string;
    identifier: string;
    isAvailableOffline: boolean;
    isPlayable: boolean;
    isContainer: boolean;
    imageUri: string;
}

// Define the native module interface
interface SpotifyRemoteNativeModule extends NativeModule {
    configure(clientId: string, redirectUri: string): void;
    connect(): Promise<{ connected: boolean }>;
    connectSilent(): Promise<{ connected: boolean }>;
    disconnect(): Promise<{ disconnected: boolean }>;
    isConnected(): boolean;
    resume(): Promise<{ success: boolean }>;
    pause(): Promise<{ success: boolean }>;
    skipToNext(): Promise<{ success: boolean }>;
    skipToPrevious(): Promise<{ success: boolean }>;
    seekTo(positionMs: number): Promise<{ success: boolean }>;
    play(uri: string): Promise<{ success: boolean }>;
    enqueue(uri: string): Promise<{ success: boolean }>;
    getPlayerState(): Promise<SpotifyPlayerState>;
    subscribeToPlayerState(): Promise<{ subscribed: boolean }>;
    unsubscribeFromPlayerState(): Promise<{ unsubscribed: boolean }>;
    setShuffle(enabled: boolean): Promise<{ success: boolean }>;
    setRepeatMode(mode: number): Promise<{ success: boolean }>;
    // Content API
    getRecommendedContentItems(type: string): Promise<{ items: SpotifyContentItem[] }>;
    getChildrenOfContentItem(uri: string): Promise<{ items: SpotifyContentItem[] }>;
    getContentItemImage(imageUri: string, width: number, height: number): Promise<{ imageBase64: string }>;
}

// Get the native module
const SpotifyRemoteNative = requireNativeModule<SpotifyRemoteNativeModule>('SpotifyRemote');

// Create event emitter for the module
const emitter = new EventEmitter(SpotifyRemoteNative as unknown as NativeModule);

/**
 * SpotifyRemote - Cross-platform Spotify remote control
 */
export const SpotifyRemote = {
    /**
     * Configure the Spotify Remote with your app credentials
     * Call this before any other methods
     * 
     * @param clientId - Your Spotify app's client ID
     * @param redirectUri - Your app's redirect URI (configured in Spotify Dashboard)
     */
    configure(clientId: string, redirectUri: string): void {
        SpotifyRemoteNative.configure(clientId, redirectUri);
    },

    /**
     * Connect to the Spotify app
     * This will open the Spotify app to establish connection
     * The most reliable way to connect - always opens Spotify first
     */
    async connect(): Promise<boolean> {
        const result = await SpotifyRemoteNative.connect();
        return result.connected;
    },

    /**
     * Try to connect silently without opening Spotify app
     * Only works if Spotify is already active in background
     * Falls back to returning false if Spotify isn't active
     */
    async connectSilent(): Promise<boolean> {
        try {
            const result = await SpotifyRemoteNative.connectSilent();
            return result.connected;
        } catch {
            return false;
        }
    },

    /**
     * Disconnect from the Spotify app
     */
    async disconnect(): Promise<boolean> {
        const result = await SpotifyRemoteNative.disconnect();
        return result.disconnected;
    },

    /**
     * Check if currently connected to Spotify
     */
    isConnected(): boolean {
        return SpotifyRemoteNative.isConnected();
    },

    /**
     * Resume playback
     */
    async resume(): Promise<boolean> {
        const result = await SpotifyRemoteNative.resume();
        return result.success;
    },

    /**
     * Pause playback
     */
    async pause(): Promise<boolean> {
        const result = await SpotifyRemoteNative.pause();
        return result.success;
    },

    /**
     * Toggle play/pause
     */
    async togglePlayPause(): Promise<boolean> {
        const state = await this.getPlayerState();
        if (state.isPaused) {
            return this.resume();
        } else {
            return this.pause();
        }
    },

    /**
     * Skip to the next track
     */
    async skipToNext(): Promise<boolean> {
        const result = await SpotifyRemoteNative.skipToNext();
        return result.success;
    },

    /**
     * Skip to the previous track
     */
    async skipToPrevious(): Promise<boolean> {
        const result = await SpotifyRemoteNative.skipToPrevious();
        return result.success;
    },

    /**
     * Seek to a position in the current track
     * 
     * @param positionMs - Position in milliseconds
     */
    async seekTo(positionMs: number): Promise<boolean> {
        const result = await SpotifyRemoteNative.seekTo(positionMs);
        return result.success;
    },

    /**
     * Play a Spotify URI (track, album, or playlist)
     * 
     * @param uri - Spotify URI (e.g., 'spotify:track:xxx')
     */
    async play(uri: string): Promise<boolean> {
        const result = await SpotifyRemoteNative.play(uri);
        return result.success;
    },

    /**
     * Add a track to the queue
     * 
     * @param uri - Spotify track URI
     */
    async enqueue(uri: string): Promise<boolean> {
        const result = await SpotifyRemoteNative.enqueue(uri);
        return result.success;
    },

    /**
     * Get the current player state
     */
    async getPlayerState(): Promise<SpotifyPlayerState> {
        return SpotifyRemoteNative.getPlayerState();
    },

    /**
     * Set shuffle mode
     * 
     * @param enabled - Whether shuffle should be enabled
     */
    async setShuffle(enabled: boolean): Promise<boolean> {
        const result = await SpotifyRemoteNative.setShuffle(enabled);
        return result.success;
    },

    /**
     * Set repeat mode
     * 
     * @param mode - Repeat mode (Off, Context, or Track)
     */
    async setRepeatMode(mode: RepeatMode): Promise<boolean> {
        const result = await SpotifyRemoteNative.setRepeatMode(mode);
        return result.success;
    },

    /**
     * Subscribe to player state changes
     * Call this after connecting to receive real-time updates
     */
    async subscribeToPlayerState(): Promise<boolean> {
        const result = await SpotifyRemoteNative.subscribeToPlayerState();
        return result.subscribed;
    },

    /**
     * Unsubscribe from player state changes
     */
    async unsubscribeFromPlayerState(): Promise<boolean> {
        const result = await SpotifyRemoteNative.unsubscribeFromPlayerState();
        return result.unsubscribed;
    },

    // Event listeners

    /**
     * Add a listener for player state changes
     * Must call subscribeToPlayerState() first
     */
    addPlayerStateListener(callback: (state: SpotifyPlayerState) => void): EventSubscription {
        return emitter.addListener('onPlayerStateChanged', callback);
    },

    /**
     * Add a listener for connection status changes
     */
    addConnectionStatusListener(callback: (status: ConnectionStatus) => void): EventSubscription {
        return emitter.addListener('onConnectionStatusChanged', callback);
    },

    /**
     * Add a listener for errors
     */
    addErrorListener(callback: (error: { error: string }) => void): EventSubscription {
        return emitter.addListener('onError', callback);
    },

    // Content API

    /**
     * Get recommended content items (playlists, albums) for the user
     * This is similar to what Google Maps shows - user's playlists and recommendations
     * 
     * @param type - Content type: 'default', 'navigation', or 'fitness'
     * @returns Array of content items
     */
    async getRecommendedContentItems(type: 'default' | 'navigation' | 'fitness' = 'default'): Promise<SpotifyContentItem[]> {
        const result = await SpotifyRemoteNative.getRecommendedContentItems(type);
        return result.items;
    },

    /**
     * Get children of a content item (e.g., tracks in a playlist)
     * 
     * @param uri - URI of the parent content item
     * @returns Array of child content items
     */
    async getChildrenOfContentItem(uri: string): Promise<SpotifyContentItem[]> {
        const result = await SpotifyRemoteNative.getChildrenOfContentItem(uri);
        return result.items;
    },

    /**
     * Get image for a content item as base64
     * 
     * @param imageUri - Image URI from content item
     * @param width - Desired width
     * @param height - Desired height
     * @returns Base64 encoded image data
     */
    async getContentItemImage(imageUri: string, width: number = 100, height: number = 100): Promise<string> {
        const result = await SpotifyRemoteNative.getContentItemImage(imageUri, width, height);
        return result.imageBase64;
    },
};

// Default export
// Get the auth native module (iOS and Android)
interface SpotifyAuthNativeModule extends NativeModule {
    configure(clientId: string, redirectUri: string): void;
    authorize(scopes: string[]): Promise<{ accessToken: string; expiresIn: number }>;
    isAuthorized(): boolean;
    getAccessToken(): string | null;
    logout(): void;
}

let SpotifyAuthNative: SpotifyAuthNativeModule | null = null;
try {
    SpotifyAuthNative = requireNativeModule<SpotifyAuthNativeModule>('SpotifyAuth');
} catch (e) {
    // Auth module not available
    console.warn('[SpotifyRemote] SpotifyAuth module not available:', e);
}

/**
 * SpotifyAuth - Authentication module for Spotify
 * Handles OAuth flow to get access tokens
 * Tokens are persisted - user only needs to authorize once!
 */
export const SpotifyAuth = SpotifyAuthNative ? {
    /**
     * Configure the Spotify Auth with your app credentials
     * Call this before calling authorize()
     */
    configure(clientId: string, redirectUri: string): void {
        SpotifyAuthNative!.configure(clientId, redirectUri);
    },

    /**
     * Authorize with Spotify
     * - If already authorized (token saved), returns immediately without opening Spotify
     * - If not authorized, opens Spotify app for user to authorize (only once!)
     * 
     * @param scopes - Array of scopes to request (e.g., ['streaming', 'user-read-playback-state'])
     * @returns Object with accessToken and expiresIn
     */
    async authorize(scopes: string[] = ['streaming', 'user-read-playback-state', 'user-modify-playback-state']): Promise<{ accessToken: string; expiresIn: number }> {
        return SpotifyAuthNative!.authorize(scopes);
    },

    /**
     * Check if currently authorized (has valid stored token)
     */
    isAuthorized(): boolean {
        return SpotifyAuthNative!.isAuthorized();
    },

    /**
     * Get the stored access token (if valid)
     * Returns null if not authorized or token expired
     */
    getAccessToken(): string | null {
        return SpotifyAuthNative!.getAccessToken();
    },

    /**
     * Logout - clear stored token
     * User will need to authorize again on next call
     */
    logout(): void {
        SpotifyAuthNative!.logout();
    }
} : null;

export default SpotifyRemote;

// Re-export types
export type { SpotifyRemoteNativeModule, SpotifyAuthNativeModule };
