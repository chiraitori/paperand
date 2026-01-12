import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { t } from '../services/i18nService';

export const DownloadManagerScreen: React.FC = () => {
    const { theme } = useTheme();

    return (
        <View style={[styles.container, { backgroundColor: theme.background }]}>
            <ScrollView contentContainerStyle={styles.content}>
                <View style={[styles.emptyContainer, { backgroundColor: theme.card }]}>
                    <Text style={[styles.emptyTitle, { color: theme.text }]}>
                        {t('downloadManager.title')}
                    </Text>
                    <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                        {t('downloadManager.emptyMessage')}
                    </Text>
                </View>
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    content: {
        flexGrow: 1,
        padding: 16,
    },
    emptyContainer: {
        flex: 1,
        borderRadius: 12,
        padding: 24,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 200,
    },
    emptyTitle: {
        fontSize: 18,
        fontWeight: '600',
        marginBottom: 8,
    },
    emptyText: {
        fontSize: 14,
        textAlign: 'center',
    },
});
