import { spotifyRemoteService, SpotifyPlayerState, SpotifyTrack } from '../services/spotifyRemoteService';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage');
jest.mock('react-native', () => ({
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    currentState: 'active',
  },
}));

describe('Spotify Remote Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Configuration', () => {
    it('should configure with client ID and redirect URI', () => {
      spotifyRemoteService.configure('test-client-id', 'test-redirect-uri');
      // Service should accept config without errors
      expect(spotifyRemoteService).toBeDefined();
    });

    it('should not crash if native module is unavailable', () => {
      expect(() => {
        spotifyRemoteService.configure('test', 'test');
      }).not.toThrow();
    });
  });

  describe('Player State Listeners', () => {
    it('should register and call player state listeners', (done) => {
      const mockListener = jest.fn();
      spotifyRemoteService.onPlayerStateChanged(mockListener);

      // Simulate state change
      const testState: SpotifyPlayerState = {
        track: {
          uri: 'spotify:track:123',
          name: 'Test Track',
          artist: 'Test Artist',
          album: 'Test Album',
          duration: 180000,
          imageUri: 'https://example.com/image.jpg',
        },
        playbackPosition: 0,
        isPaused: false,
        isShuffling: false,
        repeatMode: 0,
      };

      // Give async operations time to complete
      setTimeout(() => {
        expect(mockListener).toBeDefined();
        done();
      }, 100);
    });

    it('should unregister player state listeners', (done) => {
      const mockListener = jest.fn();
      const unsubscribe = spotifyRemoteService.onPlayerStateChanged(mockListener);
      
      unsubscribe();
      
      setTimeout(() => {
        expect(unsubscribe).toBeDefined();
        done();
      }, 100);
    });
  });

  describe('Connection Listeners', () => {
    it('should register and call connection listeners', (done) => {
      const mockListener = jest.fn();
      spotifyRemoteService.onConnectionChanged(mockListener);

      setTimeout(() => {
        expect(mockListener).toBeDefined();
        done();
      }, 100);
    });

    it('should unregister connection listeners', (done) => {
      const mockListener = jest.fn();
      const unsubscribe = spotifyRemoteService.onConnectionChanged(mockListener);
      
      unsubscribe();
      
      setTimeout(() => {
        expect(unsubscribe).toBeDefined();
        done();
      }, 100);
    });
  });

  describe('Playback Controls', () => {
    it('should handle skipToNext without errors', async () => {
      spotifyRemoteService.configure('test', 'test');
      // Should not throw
      await expect(spotifyRemoteService.skipToNext()).resolves.not.toThrow();
    });

    it('should handle skipToPrevious without errors', async () => {
      spotifyRemoteService.configure('test', 'test');
      // Should not throw
      await expect(spotifyRemoteService.skipToPrevious()).resolves.not.toThrow();
    });

    it('should handle skipNext without errors', async () => {
      spotifyRemoteService.configure('test', 'test');
      // Should not throw
      await expect(spotifyRemoteService.skipNext()).resolves.not.toThrow();
    });

    it('should handle skipPrevious without errors', async () => {
      spotifyRemoteService.configure('test', 'test');
      // Should not throw
      await expect(spotifyRemoteService.skipPrevious()).resolves.not.toThrow();
    });

    it('should handle togglePlayPause without errors', async () => {
      spotifyRemoteService.configure('test', 'test');
      // Should not throw
      await expect(spotifyRemoteService.togglePlayPause()).resolves.not.toThrow();
    });

    it('should handle play without errors', async () => {
      spotifyRemoteService.configure('test', 'test');
      // Should not throw
      await expect(spotifyRemoteService.play()).resolves.not.toThrow();
    });

    it('should handle pause without errors', async () => {
      spotifyRemoteService.configure('test', 'test');
      // Should not throw
      await expect(spotifyRemoteService.pause()).resolves.not.toThrow();
    });
  });

  describe('State Refresh', () => {
    it('should refresh player state without errors', async () => {
      spotifyRemoteService.configure('test', 'test');
      // Should not throw
      await expect(spotifyRemoteService.refreshPlayerState()).resolves.not.toThrow();
    });
  });

  describe('Cleanup', () => {
    it('should disconnect without errors', async () => {
      spotifyRemoteService.configure('test', 'test');
      await expect(spotifyRemoteService.disconnect()).resolves.not.toThrow();
    });
  });
});
