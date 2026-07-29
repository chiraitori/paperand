import {
  detectPaperbackApiVersion,
  getExtensionBundleUrl,
  getExtensionIconUrl,
  normalizeExtensionSource,
} from '../services/extensionService';
import {
  getInstalledExtensionBundleUrl,
  getInstalledExtensionIconUrl,
} from '../services/extensionStorageService';
import { appendPaperbackRequestParams } from '../services/paperbackRequestUtils';

describe('Paperback extension compatibility', () => {
  it('keeps 0.8 alpha repositories on the source.js format', () => {
    expect(detectPaperbackApiVersion({
      toolchain: '0.8.0-alpha.47',
      types: '0.8.0-alpha.47',
    })).toBe('0.8');
  });

  it('recognizes Paperback 0.9 repositories built with the 1.0 alpha toolchain', () => {
    expect(detectPaperbackApiVersion({
      toolchain: '1.0.0-alpha.53',
      types: '1.0.0-alpha.53',
    })).toBe('0.9');
  });

  it('normalizes a Paperback 0.9 info entry for the existing extension UI', () => {
    const extension = normalizeExtensionSource({
      id: 'Mitaku',
      name: 'Mitaku',
      description: 'Extension that pulls content from mitaku.net',
      version: '1.0.1',
      icon: 'icon.png',
      contentRating: 'ADULT',
      capabilities: 117,
      developers: [{ name: 'Netsky', github: 'https://github.com/TheNetsky' }],
      badges: [{ text: '18+', type: 'warning' }],
    }, '0.9');

    expect(extension).toMatchObject({
      id: 'Mitaku',
      author: 'Netsky',
      desc: 'Extension that pulls content from mitaku.net',
      website: 'https://github.com/TheNetsky',
      intents: 117,
      apiVersion: '0.9',
      bundleFilename: 'index.js',
      assetDirectory: 'static',
    });
    expect(getExtensionBundleUrl('https://example.com/0.9/', extension))
      .toBe('https://example.com/0.9/Mitaku/index.js');
    expect(getExtensionIconUrl('https://example.com/0.9/', extension))
      .toBe('https://example.com/0.9/Mitaku/static/icon.png');
  });

  it('uses source.js/includes for legacy installed extensions without migration metadata', () => {
    const legacy = {
      id: 'MangaFox',
      name: 'MangaFox',
      author: 'Netsky',
      desc: '',
      website: '',
      version: '3.0.6',
      icon: 'icon.png',
      repoBaseUrl: 'https://example.com/0.8/',
    };

    expect(getInstalledExtensionBundleUrl(legacy))
      .toBe('https://example.com/0.8/MangaFox/source.js');
    expect(getInstalledExtensionIconUrl(legacy))
      .toBe('https://example.com/0.8/MangaFox/includes/icon.png');
  });

  it('appends official Paperback 0.8 request.param values', () => {
    expect(appendPaperbackRequestParams('https://example.com/api', {
      page: 2,
      query: 'girls love',
      genre: ['romance', 'drama'],
    })).toBe(
      'https://example.com/api?page=2&query=girls%20love&genre=romance&genre=drama'
    );

    expect(appendPaperbackRequestParams('https://example.com/api?limit=20', '?page=3'))
      .toBe('https://example.com/api?limit=20&page=3');
  });
});
