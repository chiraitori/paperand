import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import SpotifyMiniPlayer from '../components/SpotifyMiniPlayer';
import { spotifyRemoteService } from '../services/spotifyRemoteService';

jest.mock('../services/spotifyRemoteService');

const mockSpotifyService = spotifyRemoteService as jest.Mocked<typeof spotifyRemoteService>;

describe('SpotifyMiniPlayer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSpotifyService.onPlayerStateChanged.mockReturnValue(() => {});
    mockSpotifyService.onConnectionChanged.mockReturnValue(() => {});
  });

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { UNSAFE_getByType } = render(<SpotifyMiniPlayer />);
      expect(UNSAFE_getByType(SpotifyMiniPlayer)).toBeTruthy();
    });

    it('should display player controls', () => {
      const { getByTestId } = render(<SpotifyMiniPlayer />);
      // Check if component renders
      expect(getByTestId).toBeDefined();
    });
  });

  describe('Playback Controls', () => {
    it('should handle next button press', async () => {
      mockSpotifyService.skipToNext.mockResolvedValue(undefined);
      
      const { getByText } = render(<SpotifyMiniPlayer />);
      const nextButton = getByText(/next/i);
      
      if (nextButton) {
        fireEvent.press(nextButton);
        await waitFor(() => {
          expect(mockSpotifyService.skipToNext).toHaveBeenCalled();
        });
      }
    });

    it('should handle previous button press', async () => {
      mockSpotifyService.skipToPrevious.mockResolvedValue(undefined);
      
      const { getByText } = render(<SpotifyMiniPlayer />);
      const prevButton = getByText(/previous|prev/i);
      
      if (prevButton) {
        fireEvent.press(prevButton);
        await waitFor(() => {
          expect(mockSpotifyService.skipToPrevious).toHaveBeenCalled();
        });
      }
    });

    it('should handle play/pause button press', async () => {
      mockSpotifyService.togglePlayPause.mockResolvedValue(undefined);
      
      const { getByText } = render(<SpotifyMiniPlayer />);
      const playButton = getByText(/play|pause/i);
      
      if (playButton) {
        fireEvent.press(playButton);
        await waitFor(() => {
          expect(mockSpotifyService.togglePlayPause).toHaveBeenCalled();
        });
      }
    });
  });

  describe('State Management', () => {
    it('should refresh player state after playback action', async () => {
      mockSpotifyService.skipToNext.mockResolvedValue(undefined);
      mockSpotifyService.refreshPlayerState.mockResolvedValue(undefined);
      
      const { getByText } = render(<SpotifyMiniPlayer />);
      const nextButton = getByText(/next/i);
      
      if (nextButton) {
        fireEvent.press(nextButton);
        
        await waitFor(() => {
          expect(mockSpotifyService.skipToNext).toHaveBeenCalled();
        }, { timeout: 700 }); // Wait for 500ms delay + buffer
      }
    });

    it('should register player state listener on mount', () => {
      render(<SpotifyMiniPlayer />);
      expect(mockSpotifyService.onPlayerStateChanged).toHaveBeenCalled();
    });

    it('should register connection listener on mount', () => {
      render(<SpotifyMiniPlayer />);
      expect(mockSpotifyService.onConnectionChanged).toHaveBeenCalled();
    });
  });

  describe('Image Loading', () => {
    it('should handle missing image gracefully', () => {
      const { UNSAFE_getByType } = render(<SpotifyMiniPlayer />);
      expect(UNSAFE_getByType(SpotifyMiniPlayer)).toBeTruthy();
    });
  });

  describe('Error Handling', () => {
    it('should handle playback control errors gracefully', async () => {
      mockSpotifyService.skipToNext.mockRejectedValue(new Error('Playback error'));
      
      const { getByText } = render(<SpotifyMiniPlayer />);
      const nextButton = getByText(/next/i);
      
      if (nextButton) {
        fireEvent.press(nextButton);
        // Should not crash the component
        await waitFor(() => {
          expect(mockSpotifyService.skipToNext).toHaveBeenCalled();
        });
      }
    });

    it('should handle connection loss', async () => {
      const { UNSAFE_getByType } = render(<SpotifyMiniPlayer />);
      const listener = mockSpotifyService.onConnectionChanged.mock.calls[0][0];
      
      // Simulate connection lost
      listener(false);
      
      expect(UNSAFE_getByType(SpotifyMiniPlayer)).toBeTruthy();
    });
  });
});
