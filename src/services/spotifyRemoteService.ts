/**
 * Spotify Remote Service
 * 
 * High-level service for controlling Spotify playback from within Paperand.
 * Provides singleton connection management, auto-reconnect, and state caching.
 * 
 * Usage:
 * ```typescript
 * import { spotifyRemoteService } from '@/services/spotifyRemoteService';
 * 
 * // Configure once at app startup
 * spotifyRemoteService.configure('your-client-id', 'your-redirect-uri');
 * 
 * // Connect and control playback
 * await spotifyRemoteService.connect();
 * await spotifyRemoteService.togglePlayPause();
 * ```
 */

import { AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { EventSubscription } from 'spotify-remote';

const SPOTIFY_ACCESS_TOKEN_KEY = '@spotify_access_token';
const SPOTIFY_TOKEN_EXPIRY_KEY = '@spotify_token_expiry';

// Import the native module
// Note: This will be available after running `npx expo prebuild`
let SpotifyRemote: typeof import('spotify-remote').SpotifyRemote | null = null;
let SpotifyAuth: typeof import('spotify-remote').SpotifyAuth | null = null;

try {
    const spotifyModule = require('spotify-remote');
    SpotifyRemote = spotifyModule.SpotifyRemote;
    SpotifyAuth = spotifyModule.SpotifyAuth;
    console.log('[SpotifyRemoteService] Native modules loaded successfully');
    console.log('[SpotifyRemoteService] SpotifyAuth available:', !!SpotifyAuth);
} catch (error) {
    console.error('[SpotifyRemoteService] Native module not available:', error);
}

export interface SpotifyTrack {
    uri: string;
    name: string;
    artist: string;
    album: string;
    duration: number;
    imageUri?: string;
}

export interface SpotifyPlayerState {
    track: SpotifyTrack;
    playbackPosition: number;
    isPaused: boolean;
    isShuffling: boolean;
    repeatMode: 0 | 1 | 2; // 0 = off, 1 = context, 2 = track
}

type PlayerStateListener = (state: SpotifyPlayerState) => void;
type ConnectionListener = (connected: boolean) => void;

class SpotifyRemoteService {
    private clientId: string = '';
    private redirectUri: string = '';
    private isConfigured: boolean = false;
    private cachedState: SpotifyPlayerState | null = null;
    private playerStateListeners: Set<PlayerStateListener> = new Set();
    private connectionListeners: Set<ConnectionListener> = new Set();
    private nativeSubscriptions: EventSubscription[] = [];
    private appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
    private autoReconnect: boolean = true;

    /**
     * Configure the Spotify Remote with your app credentials
     * This must be called before any other methods
     */
    configure(clientId: string, redirectUri: string): void {
        if (!SpotifyRemote) {
            console.warn('[SpotifyRemoteService] Native module not available');
            return;
        }

        this.clientId = clientId;
        this.redirectUri = redirectUri;

        console.log('[SpotifyRemoteService] Configuring with clientId:', clientId, 'redirectUri:', redirectUri);

        SpotifyRemote.configure(clientId, redirectUri);

        // Also configure auth module if available (Android)
        if (SpotifyAuth) {
            console.log('[SpotifyRemoteService] Configuring SpotifyAuth module');
            SpotifyAuth.configure(clientId, redirectUri);
        } else {
            console.log('[SpotifyRemoteService] SpotifyAuth module not available');
        }

        this.isConfigured = true;

        // Set up native event listeners
        this.setupEventListeners();

        // Set up app state listener for auto-reconnect
        this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange);
    }

    /**
     * Check if we have a valid stored access token
     */
    async hasValidToken(): Promise<boolean> {
        try {
            const token = await AsyncStorage.getItem(SPOTIFY_ACCESS_TOKEN_KEY);
            const expiry = await AsyncStorage.getItem(SPOTIFY_TOKEN_EXPIRY_KEY);

            if (!token || !expiry) {
                return false;
            }

            // Check if token is still valid (with 5 minute buffer)
            const expiryTime = parseInt(expiry, 10);
            const now = Date.now();
            const isValid = expiryTime > now + 5 * 60 * 1000;

            console.log('[SpotifyRemoteService] Token valid:', isValid);
            return isValid;
        } catch (error) {
            console.error('[SpotifyRemoteService] Error checking token:', error);
            return false;
        }
    }

    /**
     * Authorize with Spotify (Android only)
     * This must be called before connect() on Android
     * Returns an access token that will be used automatically
     * Saves the token to AsyncStorage for persistence
     */
    async authorize(scopes?: string[]): Promise<{ accessToken: string; expiresIn: number } | null> {
        if (!SpotifyAuth) {
            console.warn('[SpotifyRemoteService] Auth module not available (iOS or module not loaded)');
            return null;
        }

        // Ensure auth module is configured
        if (this.clientId && this.redirectUri) {
            SpotifyAuth.configure(this.clientId, this.redirectUri);
        }

        try {
            const result = await SpotifyAuth.authorize(scopes);

            // Save token to AsyncStorage
            if (result.accessToken) {
                const expiryTime = Date.now() + (result.expiresIn * 1000);
                await AsyncStorage.setItem(SPOTIFY_ACCESS_TOKEN_KEY, result.accessToken);
                await AsyncStorage.setItem(SPOTIFY_TOKEN_EXPIRY_KEY, expiryTime.toString());
                console.log('[SpotifyRemoteService] Token saved to storage');
            }

            return result;
        } catch (error) {
            console.error('[SpotifyRemoteService] Authorization failed:', error);
            throw error;
        }
    }

    /**
     * Clear stored token (logout)
     */
    async clearToken(): Promise<void> {
        try {
            await AsyncStorage.removeItem(SPOTIFY_ACCESS_TOKEN_KEY);
            await AsyncStorage.removeItem(SPOTIFY_TOKEN_EXPIRY_KEY);
            console.log('[SpotifyRemoteService] Token cleared');
        } catch (error) {
            console.error('[SpotifyRemoteService] Error clearing token:', error);
        }
    }

    /**
     * Connect to the Spotify app
     * @param silent - If true, try to connect without opening Spotify (only works if Spotify is active)
     */
    async connect(silent: boolean = false): Promise<boolean> {
        if (!SpotifyRemote || !this.isConfigured) {
            console.warn('[SpotifyRemoteService] Not configured');
            return false;
        }

        try {
            // Add a timeout to prevent infinite loading
            const timeoutPromise = new Promise<boolean>((_, reject) => {
                setTimeout(() => reject(new Error('Connection timeout')), 30000); // 30 second timeout
            });

            let connected: boolean;

            if (silent) {
                // Try silent connect (only works if Spotify is already active)
                console.log('[SpotifyRemoteService] Attempting silent connect...');
                connected = await Promise.race([SpotifyRemote.connectSilent(), timeoutPromise]);
            } else {
                // Open Spotify to establish connection (more reliable)
                console.log('[SpotifyRemoteService] Connecting via Spotify app...');
                connected = await Promise.race([SpotifyRemote.connect(), timeoutPromise]);
            }

            if (connected) {
                console.log('[SpotifyRemoteService] Connected successfully!');
                // Subscribe to player state changes
                await SpotifyRemote.subscribeToPlayerState();

                // Get initial state
                await this.refreshPlayerState();
            }

            return connected;
        } catch (error) {
            console.error('[SpotifyRemoteService] Connection failed:', error);
            return false;
        }
    }

    /**
     * Try to connect silently, fallback to opening Spotify if needed
     */
    async connectWithFallback(): Promise<boolean> {
        // First try silent connect (won't interrupt user)
        const silentConnected = await this.connect(true);
        if (silentConnected) {
            return true;
        }

        // Silent connect failed, need to open Spotify
        console.log('[SpotifyRemoteService] Silent connect failed, opening Spotify...');
        return this.connect(false);
    }

    /**
     * Disconnect from Spotify
     */
    async disconnect(): Promise<void> {
        if (!SpotifyRemote) return;

        try {
            await SpotifyRemote.unsubscribeFromPlayerState();
            await SpotifyRemote.disconnect();
        } catch (error) {
            console.error('[SpotifyRemoteService] Disconnect failed:', error);
        }
    }

    /**
     * Check if connected to Spotify
     */
    isConnected(): boolean {
        if (!SpotifyRemote) return false;
        return SpotifyRemote.isConnected();
    }

    /**
     * Toggle play/pause
     */
    async togglePlayPause(): Promise<boolean> {
        if (!SpotifyRemote) return false;
        return SpotifyRemote.togglePlayPause();
    }

    /**
     * Resume playback
     */
    async play(): Promise<boolean> {
        if (!SpotifyRemote) return false;
        return SpotifyRemote.resume();
    }

    /**
     * Pause playback
     */
    async pause(): Promise<boolean> {
        if (!SpotifyRemote) return false;
        return SpotifyRemote.pause();
    }

    /**
     * Skip to next track
     */
    async skipNext(): Promise<boolean> {
        if (!SpotifyRemote) return false;
        return SpotifyRemote.skipToNext();
    }

    /**
     * Skip to next track (alias)
     */
    async skipToNext(): Promise<boolean> {
        return this.skipNext();
    }

    /**
     * Skip to previous track
     */
    async skipPrevious(): Promise<boolean> {
        if (!SpotifyRemote) return false;
        return SpotifyRemote.skipToPrevious();
    }

    /**
     * Skip to previous track (alias)
     */
    async skipToPrevious(): Promise<boolean> {
        return this.skipPrevious();
    }

    /**
     * Seek to position in milliseconds
     */
    async seekTo(positionMs: number): Promise<boolean> {
        if (!SpotifyRemote) return false;
        return SpotifyRemote.seekTo(positionMs);
    }

    /**
     * Play a Spotify URI (track, album, playlist)
     */
    async playUri(uri: string): Promise<boolean> {
        if (!SpotifyRemote) return false;
        return SpotifyRemote.play(uri);
    }

    /**
     * Add a track to the queue
     */
    async addToQueue(uri: string): Promise<boolean> {
        if (!SpotifyRemote) return false;
        return SpotifyRemote.enqueue(uri);
    }

    /**
     * Set shuffle mode
     */
    async setShuffle(enabled: boolean): Promise<boolean> {
        if (!SpotifyRemote) return false;
        return SpotifyRemote.setShuffle(enabled);
    }

    /**
     * Set repeat mode (0 = off, 1 = context, 2 = track)
     */
    async setRepeatMode(mode: 0 | 1 | 2): Promise<boolean> {
        if (!SpotifyRemote) return false;
        return SpotifyRemote.setRepeatMode(mode);
    }

    /**
     * Get the current player state (cached)
     */
    getPlayerState(): SpotifyPlayerState | null {
        return this.cachedState;
    }

    /**
     * Refresh and get the current player state from Spotify
     */
    async refreshPlayerState(): Promise<SpotifyPlayerState | null> {
        if (!SpotifyRemote) return null;

        try {
            const state = await SpotifyRemote.getPlayerState();
            this.cachedState = this.normalizePlayerState(state);
            return this.cachedState;
        } catch (error) {
            console.error('[SpotifyRemoteService] Failed to get player state:', error);
            return null;
        }
    }

    /**
     * Add a listener for player state changes
     */
    addPlayerStateListener(listener: PlayerStateListener): () => void {
        this.playerStateListeners.add(listener);

        // Immediately call with cached state if available
        if (this.cachedState) {
            listener(this.cachedState);
        }

        return () => {
            this.playerStateListeners.delete(listener);
        };
    }

    /**
     * Add a listener for connection status changes
     */
    addConnectionListener(listener: ConnectionListener): () => void {
        this.connectionListeners.add(listener);

        // Immediately call with current status
        listener(this.isConnected());

        return () => {
            this.connectionListeners.delete(listener);
        };
    }

    /**
     * Enable or disable auto-reconnect when app comes to foreground
     */
    setAutoReconnect(enabled: boolean): void {
        this.autoReconnect = enabled;
    }

    /**
     * Clean up resources
     */
    cleanup(): void {
        this.nativeSubscriptions.forEach(sub => sub.remove());
        this.nativeSubscriptions = [];
        this.appStateSubscription?.remove();
        this.appStateSubscription = null;
        this.playerStateListeners.clear();
        this.connectionListeners.clear();
    }

    // Private methods

    private setupEventListeners(): void {
        if (!SpotifyRemote) return;

        // Player state changes
        const playerStateSub = SpotifyRemote.addPlayerStateListener((state: any) => {
            this.cachedState = this.normalizePlayerState(state);
            this.playerStateListeners.forEach(listener => {
                if (this.cachedState) {
                    listener(this.cachedState);
                }
            });
        });

        // Connection status changes
        const connectionSub = SpotifyRemote.addConnectionStatusListener((status: { connected: boolean }) => {
            const connected = status.connected;
            this.connectionListeners.forEach(listener => listener(connected));
        });

        this.nativeSubscriptions.push(playerStateSub, connectionSub);
    }

    private handleAppStateChange = (nextAppState: AppStateStatus): void => {
        // Auto-reconnect disabled to prevent connection timeout spam
        // The connection should be explicitly managed by the user
    };

    private normalizePlayerState(state: any): SpotifyPlayerState {
        return {
            track: {
                uri: state.track?.uri ?? '',
                name: state.track?.name ?? '',
                artist: state.track?.artist ?? '',
                album: state.track?.album ?? '',
                duration: state.track?.duration ?? 0,
                imageUri: state.track?.imageUri,
            },
            playbackPosition: state.playbackPosition ?? 0,
            isPaused: state.isPaused ?? true,
            isShuffling: state.playbackOptions?.isShuffling ?? false,
            repeatMode: state.playbackOptions?.repeatMode ?? 0,
        };
    }
}

// Export singleton instance
export const spotifyRemoteService = new SpotifyRemoteService();

// Export class for testing
export { SpotifyRemoteService };
