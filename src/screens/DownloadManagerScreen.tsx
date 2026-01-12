import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    SafeAreaView,
    Platform,
    StatusBar,
    Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { t } from '../services/i18nService';
import { NativeDropdown } from '../components/NativeDropdown';

export const DownloadManagerScreen: React.FC = () => {
    const { theme } = useTheme();
    const navigation = useNavigation();

    const handleClearAll = () => {
        Alert.alert(
            t('downloadManager.clearAllTitle') || 'Clear All Downloads',
            t('downloadManager.clearAllMessage') || 'Are you sure you want to clear all downloads?',
            [
                { text: t('common.cancel') || 'Cancel', style: 'cancel' },
                {
                    text: t('common.delete') || 'Delete',
                    style: 'destructive',
                    onPress: () => {
                        // TODO: Implement clear all downloads
                    }
                },
            ]
        );
    };

    const menuOptions = [
        { label: t('downloadManager.pauseAll') || 'Pause all', value: 'pauseAll' },
        { label: t('downloadManager.resumeAll') || 'Resume all', value: 'resumeAll' },
        { label: t('downloadManager.clearAll') || 'Clear all', value: 'clearAll' },
    ];

    const handleMenuSelect = (value: string) => {
        switch (value) {
            case 'pauseAll':
                // TODO: Pause all downloads
                break;
            case 'resumeAll':
                // TODO: Resume all downloads
                break;
            case 'clearAll':
                handleClearAll();
                break;
        }
    };

    return (
        <View style={[styles.container, { backgroundColor: theme.background }]}>
            <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
                {/* Header */}
                <View style={[styles.header, { borderBottomColor: theme.border }]}>
                    <TouchableOpacity
                        style={styles.backButton}
                        onPress={() => navigation.goBack()}
                    >
                        <Ionicons name="chevron-back" size={28} color={theme.text} />
                    </TouchableOpacity>
                    <Text style={[styles.headerTitle, { color: theme.text }]}>
                        {t('downloadManager.title')}
                    </Text>
                    <NativeDropdown
                        options={menuOptions}
                        selectedValue=""
                        onSelect={handleMenuSelect}
                        title={t('downloadManager.options') || 'Options'}
                    >
                        <TouchableOpacity style={styles.menuButton}>
                            <Ionicons name="ellipsis-vertical" size={24} color={theme.text} />
                        </TouchableOpacity>
                    </NativeDropdown>
                </View>

                {/* Content */}
                <ScrollView contentContainerStyle={styles.content}>
                    <View style={[styles.emptyContainer, { backgroundColor: theme.card }]}>
                        <Ionicons name="download-outline" size={64} color={theme.textSecondary} />
                        <Text style={[styles.emptyTitle, { color: theme.text }]}>
                            {t('downloadManager.noDownloads') || 'No Downloads'}
                        </Text>
                        <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                            {t('downloadManager.emptyMessage')}
                        </Text>
                    </View>
                </ScrollView>
            </SafeAreaView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    safeArea: {
        flex: 1,
        paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 8,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    backButton: {
        padding: 8,
    },
    headerTitle: {
        fontSize: 17,
        fontWeight: '600',
        flex: 1,
        textAlign: 'center',
    },
    menuButton: {
        padding: 8,
    },
    content: {
        flexGrow: 1,
        padding: 16,
    },
    emptyContainer: {
        flex: 1,
        borderRadius: 12,
        padding: 32,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 300,
        gap: 12,
    },
    emptyTitle: {
        fontSize: 20,
        fontWeight: '600',
        marginTop: 16,
    },
    emptyText: {
        fontSize: 14,
        textAlign: 'center',
        lineHeight: 20,
    },
});
