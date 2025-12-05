import React from 'react';
import {
    View,
    Text,
    Modal,
    TouchableOpacity,
    TouchableWithoutFeedback,
    StyleSheet,
    Platform,
    Alert,
    Dimensions,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';

interface DialogButton {
    text: string;
    onPress?: () => void;
    style?: 'default' | 'cancel' | 'destructive';
}

interface DialogProps {
    visible: boolean;
    title: string;
    message?: string;
    buttons?: DialogButton[];
    onDismiss?: () => void;
}

/**
 * Platform-adaptive dialog component
 * - Android: Material You style with rounded corners, surface tint, and proper typography
 * - iOS: Uses native Alert
 */
export const AppDialog: React.FC<DialogProps> = ({
    visible,
    title,
    message,
    buttons = [{ text: 'OK' }],
    onDismiss,
}) => {
    const { theme, isDark } = useTheme();

    // On iOS, we use native Alert for best experience
    // This component should not render on iOS - use showDialog helper instead
    if (Platform.OS === 'ios') {
        return null;
    }

    // Android Material You styled dialog
    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onDismiss}
        >
            <TouchableWithoutFeedback onPress={onDismiss}>
                <View style={styles.overlay}>
                    <TouchableWithoutFeedback>
                        <View style={[
                            styles.dialogContainer,
                            {
                                backgroundColor: isDark ? '#2D2D30' : '#FEFBFF',
                                // Material You surface tint
                                shadowColor: theme.primary,
                            }
                        ]}>
                            {/* Title */}
                            <Text style={[
                                styles.title,
                                { color: isDark ? '#E6E1E5' : '#1D1B20' }
                            ]}>
                                {title}
                            </Text>

                            {/* Message */}
                            {message && (
                                <Text style={[
                                    styles.message,
                                    { color: isDark ? '#CAC4D0' : '#49454F' }
                                ]}>
                                    {message}
                                </Text>
                            )}

                            {/* Buttons */}
                            <View style={styles.buttonContainer}>
                                {buttons.map((button, index) => (
                                    <TouchableOpacity
                                        key={index}
                                        style={styles.button}
                                        onPress={() => {
                                            button.onPress?.();
                                            onDismiss?.();
                                        }}
                                    >
                                        <Text style={[
                                            styles.buttonText,
                                            {
                                                color: button.style === 'destructive'
                                                    ? '#F2B8B5'
                                                    : theme.primary
                                            }
                                        ]}>
                                            {button.text}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>
                    </TouchableWithoutFeedback>
                </View>
            </TouchableWithoutFeedback>
        </Modal>
    );
};

/**
 * Helper function to show platform-adaptive dialog
 * - iOS: Native Alert
 * - Android: Returns props for AppDialog component
 */
export const showDialog = (
    title: string,
    message?: string,
    buttons?: DialogButton[],
): { show: boolean; props: DialogProps } | void => {
    if (Platform.OS === 'ios') {
        // Use native iOS Alert
        Alert.alert(
            title,
            message,
            buttons?.map(btn => ({
                text: btn.text,
                onPress: btn.onPress,
                style: btn.style,
            }))
        );
        return;
    }

    // For Android, return props to be used with AppDialog
    // The calling component should manage the dialog state
    return {
        show: true,
        props: {
            visible: true,
            title,
            message,
            buttons,
        }
    };
};

/**
 * Simple alert function that works on both platforms
 * For Android, shows a Material You styled dialog
 * For iOS, shows native Alert
 */
export const showAlert = (
    title: string,
    message?: string,
    buttons?: DialogButton[],
    onDismiss?: () => void,
) => {
    if (Platform.OS === 'ios') {
        Alert.alert(
            title,
            message,
            buttons?.map(btn => ({
                text: btn.text,
                onPress: btn.onPress,
                style: btn.style,
            }))
        );
    }
    // For Android, the component should be rendered in the tree
    // and controlled via state. This function just triggers the state change.
    // We return the config for the calling component to use.
    return {
        visible: true,
        title,
        message,
        buttons: buttons || [{ text: 'OK' }],
        onDismiss,
    };
};

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.4)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    dialogContainer: {
        width: Math.min(width - 48, 400),
        borderRadius: 28, // Material You large corner radius
        paddingTop: 24,
        paddingHorizontal: 24,
        paddingBottom: 24,
        elevation: 6,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 16,
    },
    title: {
        fontSize: 24,
        fontWeight: '400', // Material You uses regular weight for dialog titles
        letterSpacing: 0,
        marginBottom: 16,
    },
    message: {
        fontSize: 14,
        fontWeight: '400',
        lineHeight: 20,
        letterSpacing: 0.25,
        marginBottom: 24,
    },
    buttonContainer: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: 8,
    },
    button: {
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 20,
        minWidth: 48,
        alignItems: 'center',
    },
    buttonText: {
        fontSize: 14,
        fontWeight: '500',
        letterSpacing: 0.1,
    },
});

export default AppDialog;
