# Paperand - Ad-Free Manga Reader

## Project Overview
- **Type**: Expo React Native Mobile App (iOS & Android)
- **Language**: TypeScript
- **Framework**: React Native with Expo SDK 54
- **Package Manager**: Bun (preferred) or npm

## Key Technologies
- **Navigation**: React Navigation (Bottom Tabs + Native Stack)
- **Storage**: AsyncStorage for settings & data persistence
- **State**: React Context API (ThemeContext, LibraryContext)
- **Auth**: expo-local-authentication for biometric/PIN protection
- **Privacy**: expo-screen-capture for task view protection
- **Deep Links**: Custom scheme `paperand://` for repo installation
- **Quick Actions**: expo-quick-actions for app shortcuts

## Project Structure
```
src/
├── components/     # Reusable UI components (AppDialog, MangaCard, etc.)
├── context/        # React Context providers (Theme, Library)
├── navigation/     # Navigation structure (AppNavigator, BottomTabNavigator)
├── screens/        # App screens
├── services/       # Business logic services
│   ├── settingsService.ts    # User settings management
│   ├── deepLinkService.ts    # Deep link handling
│   ├── updateService.ts      # App update checker
│   └── developerService.ts   # Debug/logging utilities
├── types/          # TypeScript type definitions
└── data/           # Data handling
```

## Build & Release
- **Android**: GitHub Actions builds APK (EAS local build)
- **iOS**: Codemagic builds unsigned IPA
- **Release**: GitHub release with both APK + IPA

### CI/CD Workflows
- `.github/workflows/build.yml` - Android build + fetch iOS from Codemagic
- `codemagic.yaml` - iOS build triggered on tags (v*)

### Required Secrets (GitHub)
- `EXPO_TOKEN` - Expo authentication
- `ANDROID_KEYSTORE_BASE64` - Android signing keystore
- `CODEMAGIC_TOKEN` - Codemagic API token
- `CODEMAGIC_APP_ID` - Codemagic app ID

## Running the App
```bash
bun install          # Install dependencies
bun start            # Start Expo dev server
bun run android      # Run on Android
bun run ios          # Run on iOS
npx expo prebuild    # Generate native projects
```

## Key Features
- **Library Management**: Add/remove manga, favorites, categories
- **Reading Progress**: Track reading history per chapter
- **Auth Protection**: Biometric/PIN lock for Library & History screens
- **Privacy**: Screen capture prevention on protected screens
- **Extensions**: External repository support for manga sources
- **Themes**: Dynamic color themes with dark mode support
- **Quick Actions**: iOS/Android home screen shortcuts

## Settings (settingsService.ts)
- `libraryAuth` / `historyAuth` - Enable auth for screens
- `portraitColumns` / `landscapeColumns` - Grid layout
- `hideUpdateModal` - Disable update notifications

## Important Notes
- Always use `expo install` for new packages (ensures SDK compatibility)
- Native modules require `npx expo prebuild --clean` + rebuild
- Codemagic builds unsigned IPA (requires sideloading)
- App uses Material You design language on Android
