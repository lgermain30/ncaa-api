export function notify(title: string, message: string) {
  window.alert(`${title}\n\n${message}`);
}

export function confirm(title: string, message: string, onConfirm: () => void, _confirmLabel = 'OK') {
  if (window.confirm(`${title}\n\n${message}`)) onConfirm();
}
