import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    Switch,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';

export const GeneralSettingsScreen: React.FC = () => {
    const { theme } = useTheme();
    const navigation = useNavigation();

    const [portraitColumns, setPortraitColumns] = useState(3);
    const [landscapeColumns, setLandscapeColumns] = useState(7);
    const [interactiveUpdates, setInteractiveUpdates] = useState(false);
    const [libraryAuth, setLibraryAuth] = useState(false);

    const renderStepper = (
        value: number,
        onIncrement: () => void,
        onDecrement: () => void
    ) => (
        <View style={styles.stepperContainer}>
            <TouchableOpacity
                style={[styles.stepperButton, { backgroundColor: '#333' }]}
                onPress={onDecrement}
            >
                <Ionicons name="remove" size={18} color="#FFF" />
            </TouchableOpacity>
            <View style={styles.stepperDivider} />
            <TouchableOpacity
                style={[styles.stepperButton, { backgroundColor: '#333' }]}
                onPress={onIncrement}
            >
                <Ionicons name="add" size={18} color="#FFF" />
            </TouchableOpacity>
        </View>
    );

    const renderSectionHeader = (title: string) => (
        <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>
            {title}
        </Text>
    );

    const renderFooter = (text: string) => (
        <Text style={[styles.footerText, { color: theme.textSecondary }]}>
            {text}
        </Text>
    );

    const renderItem = ({
        title,
        rightElement,
        value,
        onPress,
        disabled = false,
        showChevron = false,
        valueColor,
    }: {
        title: string;
        rightElement?: React.ReactNode;
        value?: string | number;
        onPress?: () => void;
        disabled?: boolean;
        showChevron?: boolean;
        valueColor?: string;
    }) => (
        <TouchableOpacity
            style={[
                styles.itemContainer,
                { borderBottomColor: theme.border },
                disabled && { opacity: 0.5 }
            ]}
            onPress={onPress}
            disabled={disabled || !onPress}
            activeOpacity={0.7}
        >
            <Text style={[styles.itemTitle, { color: theme.text }]}>{title}</Text>
            <View style={styles.rightContainer}>
                {value !== undefined && (
                    <Text style={[styles.itemValue, { color: valueColor || theme.textSecondary }]}>
                        {value}
                    </Text>
                )}
                {rightElement}
                {showChevron && (
                    <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} style={styles.chevron} />
                )}
            </View>
        </TouchableOpacity>
    );

    return (
        <View style={[styles.container, { backgroundColor: theme.background }]}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <Ionicons name={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'} size={28} color={theme.primary} />
                    <Text style={[styles.backText, { color: theme.primary }]}>Settings</Text>
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: theme.text }]}>General Settings</Text>
                <View style={{ width: 80 }} />
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>

                {/* Items Per Row */}
                <View style={styles.section}>
                    {renderSectionHeader('ITEMS PER ROW')}
                    <View style={[styles.sectionContent, { backgroundColor: theme.card }]}>
                        {renderItem({
                            title: 'Portrait',
                            value: portraitColumns,
                            valueColor: theme.error,
                            rightElement: renderStepper(
                                portraitColumns,
                                () => setPortraitColumns(p => p + 1),
                                () => setPortraitColumns(p => Math.max(1, p - 1))
                            )
                        })}
                        {renderItem({
                            title: 'Landscape',
                            value: landscapeColumns,
                            valueColor: theme.error,
                            rightElement: renderStepper(
                                landscapeColumns,
                                () => setLandscapeColumns(l => l + 1),
                                () => setLandscapeColumns(l => Math.max(1, l - 1))
                            )
                        })}
                    </View>
                </View>

                {/* Chapter List Sort */}
                <View style={styles.section}>
                    {renderSectionHeader('CHAPTER LIST SORT')}
                    <View style={[styles.sectionContent, { backgroundColor: theme.card }]}>
                        {renderItem({
                            title: 'Chapter List Sort',
                            value: 'Descending',
                            showChevron: true,
                            onPress: () => { }
                        })}
                    </View>
                </View>

                {/* Content Filtering */}
                <View style={styles.section}>
                    {renderSectionHeader('CONTENT FILTERING')}
                    <View style={[styles.sectionContent, { backgroundColor: theme.card }]}>
                        {renderItem({
                            title: 'Content Settings Unavailable',
                            disabled: true
                        })}
                    </View>
                    {renderFooter('Manage content filtering on your Paperback account')}
                </View>

                {/* Interactive Update Checking */}
                <View style={styles.section}>
                    {renderSectionHeader('INTERACTIVE UPDATE CHECKING')}
                    <View style={[styles.sectionContent, { backgroundColor: theme.card }]}>
                        {renderItem({
                            title: 'Interactive Updates',
                            rightElement: (
                                <Switch
                                    value={interactiveUpdates}
                                    onValueChange={setInteractiveUpdates}
                                    trackColor={{ false: theme.border, true: theme.success }}
                                    thumbColor={'#FFFFFF'}
                                />
                            )
                        })}
                    </View>
                    {renderFooter('Run the updater in the background to allow browsing the app normally (STILL REQUIRES THE APP TO BE OPEN).\n\nNOTE: This creates a new instance of the source in order to bypass request manager saturation. This might break sources which store in-memory data per their lifecycle.')}
                </View>

                {/* Security */}
                <View style={styles.section}>
                    {renderSectionHeader('SECURITY')}
                    <View style={[styles.sectionContent, { backgroundColor: theme.card }]}>
                        {renderItem({
                            title: 'Library Requires Authentication',
                            rightElement: (
                                <Switch
                                    value={libraryAuth}
                                    onValueChange={setLibraryAuth}
                                    trackColor={{ false: theme.border, true: theme.success }}
                                    thumbColor={'#FFFFFF'}
                                />
                            )
                        })}
                    </View>
                    {renderFooter('Ask for Pin/TouchID/FaceID when opening library')}
                </View>

            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 8,
        paddingTop: 50,
        paddingBottom: 12,
    },
    backButton: {
        flexDirection: 'row',
        alignItems: 'center',
        width: 80,
    },
    backText: {
        fontSize: 17,
        marginLeft: -4,
    },
    headerTitle: {
        fontSize: 17,
        fontWeight: '600',
    },
    content: {
        paddingBottom: 40,
    },
    section: {
        marginBottom: 24,
    },
    sectionTitle: {
        fontSize: 13,
        fontWeight: '600',
        marginLeft: 16,
        marginBottom: 8,
        textTransform: 'uppercase',
    },
    sectionContent: {
        marginHorizontal: 16,
        borderRadius: 10,
        overflow: 'hidden',
    },
    itemContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderBottomWidth: StyleSheet.hairlineWidth,
        minHeight: 44,
    },
    itemTitle: {
        fontSize: 17,
        flex: 1,
    },
    rightContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    itemValue: {
        fontSize: 17,
    },
    chevron: {
        opacity: 0.5,
    },
    footerText: {
        fontSize: 13,
        marginHorizontal: 16,
        marginTop: 8,
        lineHeight: 18,
    },
    stepperContainer: {
        flexDirection: 'row',
        backgroundColor: '#333',
        borderRadius: 8,
        overflow: 'hidden',
    },
    stepperButton: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        alignItems: 'center',
        justifyContent: 'center',
    },
    stepperDivider: {
        width: 1,
        backgroundColor: '#000',
    },
});
