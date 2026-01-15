---
name: Internationalization
description: Multi-language support with i18n-js
---

# Internationalization (i18n)

## Basic Usage

```typescript
import { i18n } from '../services/i18nService';

// Simple translation
<Text>{i18n.t('library.title')}</Text>

// With interpolation
<Text>{i18n.t('reader.pageCount', { current: 5, total: 20 })}</Text>

// Pluralization
<Text>{i18n.t('library.mangaCount', { count: items.length })}</Text>
```

## Locale Files

Location: `src/locales/`

| File | Language |
|------|----------|
| `en.json` | English (default) |
| `vi.json` | Vietnamese |
| `ja.json` | Japanese |
| `zh.json` | Chinese |
| `ko.json` | Korean |
| `es.json` | Spanish |
| `pt.json` | Portuguese |
| `fr.json` | French |
| `de.json` | German |
| `ru.json` | Russian |
| `id.json` | Indonesian |
| `th.json` | Thai |
| `ar.json` | Arabic |
| `ms.json` | Malay |
| `fil.json` | Filipino |
| `tr.json` | Turkish |
| `it.json` | Italian |

## Translation File Format

```json
{
  "common": {
    "loading": "Loading...",
    "error": "Error",
    "retry": "Retry",
    "cancel": "Cancel",
    "save": "Save",
    "delete": "Delete"
  },
  "library": {
    "title": "Library",
    "empty": "Your library is empty",
    "mangaCount": {
      "one": "{{count}} manga",
      "other": "{{count}} manga"
    }
  },
  "reader": {
    "pageCount": "Page {{current}} of {{total}}"
  }
}
```

## i18n Service Setup

```typescript
// services/i18nService.ts
import { I18n } from 'i18n-js';
import * as Localization from 'expo-localization';

import en from '../locales/en.json';
import vi from '../locales/vi.json';
import ja from '../locales/ja.json';
// ... import other locales

export const i18n = new I18n({
  en, vi, ja, // ... other locales
});

// Set default & fallback
i18n.defaultLocale = 'en';
i18n.enableFallback = true;

// Detect device language
i18n.locale = Localization.locale.split('-')[0];
```

## Language Settings

```typescript
// Get current language
const currentLang = i18n.locale;

// Change language
export function setLanguage(langCode: string) {
  i18n.locale = langCode;
  // Save preference
  AsyncStorage.setItem('@language', langCode);
}

// Load saved preference
export async function loadLanguagePreference() {
  const saved = await AsyncStorage.getItem('@language');
  if (saved) {
    i18n.locale = saved;
  }
}
```

## Adding New Translation

1. Create `src/locales/{langCode}.json`
2. Copy structure from `en.json`
3. Translate all strings
4. Import in `i18nService.ts`:

```typescript
import newLang from '../locales/newLang.json';

export const i18n = new I18n({
  en, vi, ja, newLang, // Add here
});
```

5. Add to `app.json` for iOS:

```json
"CFBundleLocalizations": ["en", "vi", "ja", "newLang"]
```

## RTL Support

```typescript
import { I18nManager } from 'react-native';

// Check if RTL
const isRTL = I18nManager.isRTL;

// Force RTL (requires restart)
I18nManager.forceRTL(true);
```

## Date/Time Formatting

```typescript
// Format date based on locale
const formatted = new Date().toLocaleDateString(i18n.locale);

// Relative time
const timeAgo = i18n.t('common.timeAgo', { time: '2 hours' });
```
