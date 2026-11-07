import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { z } from 'zod';

// Local crash journal. Only the error name/message and the first stack frames are kept:
// never component props, sales, customers or credentials.
const KEY = 'mipypos.error-log.v1';
const LIMIT = 30;
const entriesSchema = z.array(
  z.object({
    at: z.string(),
    kind: z.enum(['render', 'global', 'promise']),
    message: z.string(),
    stack: z.string(),
  }),
);

export interface ErrorEntry {
  at: string;
  kind: 'render' | 'global' | 'promise';
  message: string;
  stack: string;
}

const clean = (text: string) =>
  text
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[correo]')
    .replace(/\b\d{6,}\b/g, '[número]')
    .slice(0, 400);

export async function recordError(kind: ErrorEntry['kind'], error: unknown) {
  try {
    const failure = error instanceof Error ? error : new Error(String(error));
    const entry: ErrorEntry = {
      at: new Date().toISOString(),
      kind,
      message: clean(`${failure.name}: ${failure.message}`),
      stack: clean((failure.stack ?? '').split('\n').slice(1, 6).join('\n')),
    };
    const current = await listErrors();
    await AsyncStorage.setItem(KEY, JSON.stringify([entry, ...current].slice(0, LIMIT)));
  } catch {
    // The journal must never cause a second failure.
  }
}

export async function listErrors(): Promise<ErrorEntry[]> {
  try {
    const parsed = entriesSchema.safeParse(JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]'));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export const clearErrors = () => AsyncStorage.removeItem(KEY);

let installed = false;
// Wraps React Native's global handler so fatal JS errors are journaled before the red screen/exit.
export function installGlobalErrorHandler() {
  if (installed || Platform.OS === 'web') return;
  installed = true;
  const utils = typeof ErrorUtils === 'undefined' ? undefined : ErrorUtils;
  if (!utils) return;
  const previous = utils.getGlobalHandler();
  utils.setGlobalHandler((error, fatal) => {
    void recordError('global', error);
    previous(error, fatal);
  });
}
