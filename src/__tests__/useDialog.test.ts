import { renderHook, act } from '@testing-library/react-native';
import { Alert, Platform } from 'react-native';
import { useDialog, DialogButton } from '../hooks/useDialog';

// Mock react-native Platform and Alert
jest.mock('react-native', () => ({
    Alert: {
        alert: jest.fn(),
    },
    Platform: {
        OS: 'android',
    },
}));

describe('useDialog Hook', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Reset Platform.OS to android by default
        (Platform as any).OS = 'android';
    });

    describe('Initial state', () => {
        it('should have dialog hidden by default', () => {
            const { result } = renderHook(() => useDialog());

            expect(result.current.dialogVisible).toBe(false);
        });

        it('should have empty dialog config initially', () => {
            const { result } = renderHook(() => useDialog());

            expect(result.current.dialogConfig.title).toBe('');
            expect(result.current.dialogConfig.message).toBe('');
            expect(result.current.dialogConfig.buttons).toEqual([]);
        });
    });

    describe('showDialog on Android', () => {
        beforeEach(() => {
            (Platform as any).OS = 'android';
        });

        it('should set dialogVisible to true', () => {
            const { result } = renderHook(() => useDialog());

            act(() => {
                result.current.showDialog('Test Title', 'Test Message');
            });

            expect(result.current.dialogVisible).toBe(true);
        });

        it('should set dialog config correctly', () => {
            const { result } = renderHook(() => useDialog());

            act(() => {
                result.current.showDialog('Test Title', 'Test Message');
            });

            expect(result.current.dialogConfig.title).toBe('Test Title');
            expect(result.current.dialogConfig.message).toBe('Test Message');
        });

        it('should use default OK button when no buttons provided', () => {
            const { result } = renderHook(() => useDialog());

            act(() => {
                result.current.showDialog('Title', 'Message');
            });

            expect(result.current.dialogConfig.buttons).toHaveLength(1);
            expect(result.current.dialogConfig.buttons[0].text).toBe('OK');
        });

        it('should use custom buttons when provided', () => {
            const { result } = renderHook(() => useDialog());
            const buttons: DialogButton[] = [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: jest.fn() },
            ];

            act(() => {
                result.current.showDialog('Confirm', 'Are you sure?', buttons);
            });

            expect(result.current.dialogConfig.buttons).toHaveLength(2);
            expect(result.current.dialogConfig.buttons[0].text).toBe('Cancel');
            expect(result.current.dialogConfig.buttons[1].text).toBe('Delete');
            expect(result.current.dialogConfig.buttons[1].style).toBe('destructive');
        });

        it('should not call Alert.alert on Android', () => {
            const { result } = renderHook(() => useDialog());

            act(() => {
                result.current.showDialog('Title', 'Message');
            });

            expect(Alert.alert).not.toHaveBeenCalled();
        });
    });

    describe('showDialog on iOS', () => {
        beforeEach(() => {
            (Platform as any).OS = 'ios';
        });

        it('should call Alert.alert instead of setting state', () => {
            const { result } = renderHook(() => useDialog());

            act(() => {
                result.current.showDialog('iOS Title', 'iOS Message');
            });

            expect(Alert.alert).toHaveBeenCalledWith(
                'iOS Title',
                'iOS Message',
                expect.any(Array)
            );
        });

        it('should not set dialogVisible to true on iOS', () => {
            const { result } = renderHook(() => useDialog());

            act(() => {
                result.current.showDialog('Title', 'Message');
            });

            expect(result.current.dialogVisible).toBe(false);
        });

        it('should pass buttons to Alert.alert', () => {
            const { result } = renderHook(() => useDialog());
            const onPressMock = jest.fn();
            const buttons: DialogButton[] = [
                { text: 'OK', onPress: onPressMock },
            ];

            act(() => {
                result.current.showDialog('Title', 'Message', buttons);
            });

            expect(Alert.alert).toHaveBeenCalledWith(
                'Title',
                'Message',
                [{ text: 'OK', onPress: onPressMock, style: undefined }]
            );
        });

        it('should handle button styles in Alert', () => {
            const { result } = renderHook(() => useDialog());
            const buttons: DialogButton[] = [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive' },
            ];

            act(() => {
                result.current.showDialog('Confirm', 'Are you sure?', buttons);
            });

            const alertCall = (Alert.alert as jest.Mock).mock.calls[0];
            expect(alertCall[2]).toEqual([
                { text: 'Cancel', onPress: undefined, style: 'cancel' },
                { text: 'Delete', onPress: undefined, style: 'destructive' },
            ]);
        });
    });

    describe('hideDialog', () => {
        beforeEach(() => {
            (Platform as any).OS = 'android';
        });

        it('should set dialogVisible to false', () => {
            const { result } = renderHook(() => useDialog());

            // First show the dialog
            act(() => {
                result.current.showDialog('Title', 'Message');
            });
            expect(result.current.dialogVisible).toBe(true);

            // Then hide it
            act(() => {
                result.current.hideDialog();
            });
            expect(result.current.dialogVisible).toBe(false);
        });

        it('should be callable when dialog is already hidden', () => {
            const { result } = renderHook(() => useDialog());

            // Should not throw
            expect(() => {
                act(() => {
                    result.current.hideDialog();
                });
            }).not.toThrow();
        });
    });

    describe('Callback stability', () => {
        it('should maintain stable function references', () => {
            const { result, rerender } = renderHook(() => useDialog());

            const initialShowDialog = result.current.showDialog;
            const initialHideDialog = result.current.hideDialog;

            rerender({});

            expect(result.current.showDialog).toBe(initialShowDialog);
            expect(result.current.hideDialog).toBe(initialHideDialog);
        });
    });

    describe('Multiple showDialog calls', () => {
        beforeEach(() => {
            (Platform as any).OS = 'android';
        });

        it('should update config when called multiple times', () => {
            const { result } = renderHook(() => useDialog());

            act(() => {
                result.current.showDialog('First Title', 'First Message');
            });
            expect(result.current.dialogConfig.title).toBe('First Title');

            act(() => {
                result.current.showDialog('Second Title', 'Second Message');
            });
            expect(result.current.dialogConfig.title).toBe('Second Title');
            expect(result.current.dialogConfig.message).toBe('Second Message');
        });
    });
});
