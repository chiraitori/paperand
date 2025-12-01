<!-- Paperback - Ad-Free Manga Reader -->

## Project Overview
- **Type**: Expo React Native Mobile App
- **Language**: TypeScript
- **Framework**: React Native with Expo

## Key Technologies
- React Navigation (Bottom Tabs + Native Stack)
- AsyncStorage for persistence
- Context API for state management

## Architecture
- `src/components/` - Reusable UI components
- `src/context/` - React Context providers (Theme, Library)
- `src/navigation/` - Navigation structure
- `src/screens/` - App screens
- `src/types/` - TypeScript type definitions
- `src/data/` - Mock data (replace with real API)

## Running the App
```bash
npm start       # Start Expo dev server
npm run android # Run on Android
npm run ios     # Run on iOS
npm run web     # Run in browser
```

## Features
- Library management with favorites
- Reading progress tracking
- Dark/Light theme support
- Vertical/Horizontal reading modes
- Search and genre filtering

## Notes
- Mock data is used for demonstration
- Replace `src/data/mockData.ts` with real API calls for production
- Images use placeholder URLs from picsum.photos
