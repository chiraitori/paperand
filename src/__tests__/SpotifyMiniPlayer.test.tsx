import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import SpotifyMiniPlayer from '../components/SpotifyMiniPlayer';
import { spotifyRemoteService } from '../services/spotifyRemoteService';

jest.mock('spotify-remote', () => ({
  SpotifyRemote: {
    getContentItemImage: jest.fn(),
    getRecommendedContentItems: jest.fn().mockResolvedValue([]),
    getChildrenOfContentItem: jest.fn().mockResolvedValue([]),
    play: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock('../services/spotifyRemoteService', () => ({
  spotifyRemoteService: {
    isConnected: jest.fn(),
    getPlayerState: jest.fn(),
    addPlayerStateListener: jest.fn(),
    addConnectionListener: jest.fn(),
    connect: jest.fn(),
    refreshPlayerState: jest.fn(),
    togglePlayPause: jest.fn(),
    skipToNext: jest.fn(),
    skipToPrevious: jest.fn(),
  },
}));

const mockSpotifyService = spotifyRemoteService as jest.Mocked<typeof spotifyRemoteService>;

describe('SpotifyMiniPlayer', () => {
  beforeAll(() => {
    jest.useFakeTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSpotifyService.isConnected.mockReturnValue(false);
    mockSpotifyService.getPlayerState.mockReturnValue(null);
    mockSpotifyService.addPlayerStateListener.mockReturnValue(jest.fn());
    mockSpotifyService.addConnectionListener.mockImplementation((listener) => {
      listener(false);
      return jest.fn();
    });
    mockSpotifyService.connect.mockResolvedValue(true);
    mockSpotifyService.refreshPlayerState.mockResolvedValue(null);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('renders the Android/iOS connection action while disconnected', () => {
    const { getByLabelText } = render(<SpotifyMiniPlayer />);
    expect(getByLabelText('Connect Spotify')).toBeTruthy();
  });

  it('connects when the collapsed Spotify action is pressed', async () => {
    const { getByLabelText } = render(<SpotifyMiniPlayer />);

    fireEvent.press(getByLabelText('Connect Spotify'));

    await waitFor(() => {
      expect(mockSpotifyService.connect).toHaveBeenCalledTimes(1);
    });
  });

  it('registers and cleans up player and connection listeners', () => {
    const removePlayer = jest.fn();
    const removeConnection = jest.fn();
    mockSpotifyService.addPlayerStateListener.mockReturnValue(removePlayer);
    mockSpotifyService.addConnectionListener.mockReturnValue(removeConnection);

    const { unmount } = render(<SpotifyMiniPlayer />);
    expect(mockSpotifyService.addPlayerStateListener).toHaveBeenCalledTimes(1);
    expect(mockSpotifyService.addConnectionListener).toHaveBeenCalledTimes(1);

    unmount();
    expect(removePlayer).toHaveBeenCalledTimes(1);
    expect(removeConnection).toHaveBeenCalledTimes(1);
  });
});
