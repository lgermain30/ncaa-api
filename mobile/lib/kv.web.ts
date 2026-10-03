export const kv = {
  get: (key: string): string | null =>
    typeof localStorage === 'undefined' ? null : localStorage.getItem(key),
  set: (key: string, value: string) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  },
};
