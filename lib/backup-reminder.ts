import AsyncStorage from '@react-native-async-storage/async-storage';

// Remembers when the full business archive last left the phone, to nudge a daily off-device copy.
const KEY = 'mipypos.last-archive-share.v1';
export const markArchiveShared = () => AsyncStorage.setItem(KEY, new Date().toISOString());
export async function hoursSinceArchiveShare() {
  const value = await AsyncStorage.getItem(KEY).catch(() => null);
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? (Date.now() - time) / 3_600_000 : Number.POSITIVE_INFINITY;
}
