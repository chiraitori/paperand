# Native Modules

This directory contains native Expo modules for Paperand.

## Modules

### spotify-remote

Cross-platform Spotify Remote control using native Spotify SDKs.

**Features:**
- Connect/disconnect to Spotify app
- Playback control (play, pause, skip, previous, seek)
- Player state observation
- Shuffle and repeat mode control

**Setup:**
1. Register your app at [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Download the SDKs:
   - **iOS**: Download [SpotifyiOS.xcframework](https://github.com/spotify/ios-sdk/releases) and place in `modules/spotify-remote/ios/Frameworks/`
   - **Android**: Download [spotify-app-remote-release-0.8.0.aar](https://github.com/spotify/android-sdk/releases) and place in `modules/spotify-remote/android/libs/`
3. Add the plugin to `app.config.js`:
   ```javascript
   plugins: [
     ['./plugins/withSpotifySDK', { 
       clientId: 'YOUR_SPOTIFY_CLIENT_ID',
       redirectScheme: 'paperand-spotify'
     }],
   ]
   ```
4. Run `npx expo prebuild --clean`

**Usage:**
```typescript
import { spotifyRemoteService } from '@/services/spotifyRemoteService';

// Configure at app startup
spotifyRemoteService.configure('YOUR_CLIENT_ID', 'paperand-spotify://callback');

// Connect and control
await spotifyRemoteService.connect();
await spotifyRemoteService.togglePlayPause();

// Listen for state changes
spotifyRemoteService.addPlayerStateListener((state) => {
  console.log('Now playing:', state.track.name);
});
```

---

### reading-activity

iOS-only Live Activity module for displaying reading progress and download status on lock screen and Dynamic Island.

**Features:**
- Reading progress activity (shows current page, chapter)
- Download progress activity (shows queue status)
- Custom Activity attributes for manga reading

**Requirements:**
- iOS 16.2+
- Native rebuild required

**Usage:**
```typescript
import { ReadingActivity } from '../modules/reading-activity/src';

// Check support
if (ReadingActivity.isSupported()) {
  // Start reading activity
  await ReadingActivity.startReadingActivity({
    mangaTitle: 'One Piece',
    chapterId: 'ch-1000',
    chapterTitle: 'Chapter 1000',
    currentPage: 5,
    totalPages: 20
  });

  // Update progress
  await ReadingActivity.updateReadingActivity(10, 20);

  // End activity
  await ReadingActivity.endReadingActivity();
}
```

---

## Development

### Adding a new module

```bash
# Create a new local module
npx create-expo-module@latest --local
```

### Testing

Run `npx expo prebuild --clean` to regenerate native projects with the modules.

### Troubleshooting

- **"Native module not available"**: Run `npx expo prebuild --clean` and rebuild the app
- **Spotify connection failed**: Ensure the Spotify app is installed and you're using the correct credentials
- **Live Activity not showing**: Check iOS version (16.2+) and ensure Live Activities are enabled in Settings
