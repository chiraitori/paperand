import AsyncStorage from '@react-native-async-storage/async-storage';
import { getInstalledExtensions } from '../services/extensionStorageService';

jest.mock('@react-native-async-storage/async-storage', () => ({
    getItem: jest.fn(),
    setItem: jest.fn(),
    multiSet: jest.fn(),
}));

const storage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

describe('extensionStorageService migrations', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('removes the YuriGarden extension bundled by 0.0.16 once', async () => {
        storage.getItem.mockImplementation(async key => {
            if (key === '@installed_extensions_data') {
                return JSON.stringify([
                    { id: 'YuriGarden', name: 'YuriGarden' },
                    { id: 'EHentai', name: 'E-Hentai' },
                ]);
            }
            return null;
        });

        const extensions = await getInstalledExtensions();

        expect(extensions.map(extension => extension.id)).toEqual(['EHentai']);
        expect(storage.multiSet).toHaveBeenCalledWith([
            ['@installed_extensions_data', JSON.stringify([{ id: 'EHentai', name: 'E-Hentai' }])],
            ['@removed_built_in_yurigarden_1', 'true'],
        ]);
    });

    it('does not remove a later manual YuriGarden installation', async () => {
        storage.getItem.mockImplementation(async key => {
            if (key === '@installed_extensions_data') {
                return JSON.stringify([{ id: 'YuriGarden', name: 'YuriGarden' }]);
            }
            if (key === '@removed_built_in_yurigarden_1') return 'true';
            return null;
        });

        const extensions = await getInstalledExtensions();

        expect(extensions.map(extension => extension.id)).toEqual(['YuriGarden']);
        expect(storage.multiSet).not.toHaveBeenCalled();
    });
});
