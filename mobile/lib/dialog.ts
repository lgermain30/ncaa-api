import { Alert } from 'react-native';

export function notify(title: string, message: string) {
  Alert.alert(title, message);
}

export function confirm(title: string, message: string, onConfirm: () => void, confirmLabel = 'OK') {
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}
