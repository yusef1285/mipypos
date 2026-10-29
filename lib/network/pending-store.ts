import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { z } from 'zod';
import {
  getSecret,
  setSecret,
  removeSecret,
  supportsSecretStorage,
} from '@/lib/network/secure-storage';

const recordSchema = z
  .object({
    version: z.literal(1),
    generation: z.number().int().positive(),
    payload: z.string().nullable(),
  })
  .strict();
type JournalRecord = z.infer<typeof recordSchema>;
interface LegacyStorage {
  get(): Promise<string | null>;
  remove(): Promise<void>;
}

const unreadable = (cause?: unknown) =>
  new Error(
    'No se pudo recuperar el registro pendiente. Se conserva sin reenviarlo. Revisa su confirmación con el administrador original.',
    { cause },
  );

/** Two authenticated copies and durable tombstones retain the command identity after interruptions. */
export function createPendingStore<T>(
  name: string,
  parse: (raw: string) => Promise<T> | T,
  options: { legacySecure?: boolean; allowWeb?: boolean } = {},
) {
  const slots = [`${name}.journal.a`, `${name}.journal.b`];
  const keyName = `${name}.aes-key`;
  const legacy: LegacyStorage = options.legacySecure
    ? { get: () => getSecret(name), remove: () => removeSecret(name) }
    : { get: () => AsyncStorage.getItem(name), remove: () => AsyncStorage.removeItem(name) };
  let queue: Promise<unknown> = Promise.resolve();
  function locked<R>(action: () => Promise<R>): Promise<R> {
    const next = queue.then(action);
    queue = next.catch(() => undefined);
    return next;
  }
  async function encryptionKey(create: boolean) {
    const stored = await getSecret(keyName);
    if (stored) return Crypto.AESEncryptionKey.import(stored, 'base64');
    if (!create) throw unreadable();
    const key = await Crypto.AESEncryptionKey.generate();
    await setSecret(keyName, await key.encoded('base64'));
    return key;
  }
  async function encode(record: JournalRecord) {
    const json = JSON.stringify(record);
    if (!supportsSecretStorage()) {
      if (!options.allowWeb) throw new Error('La conexión segura requiere Android.');
      return JSON.stringify({
        json,
        sha256: await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, json),
      });
    }
    const sealed = await Crypto.aesEncryptAsync(
      new TextEncoder().encode(json),
      await encryptionKey(true),
      { additionalData: new TextEncoder().encode(name) },
    );
    return sealed.combined('base64');
  }
  async function decode(raw: string): Promise<JournalRecord> {
    let json: string;
    if (!supportsSecretStorage()) {
      if (!options.allowWeb) throw unreadable();
      const envelope = z
        .object({ json: z.string(), sha256: z.string() })
        .strict()
        .parse(JSON.parse(raw));
      const hash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        envelope.json,
      );
      if (hash !== envelope.sha256) throw unreadable();
      json = envelope.json;
    } else {
      const bytes = await Crypto.aesDecryptAsync(
        Crypto.AESSealedData.fromCombined(raw),
        await encryptionKey(false),
        { additionalData: new TextEncoder().encode(name) },
      );
      json = new TextDecoder().decode(bytes);
    }
    const record = recordSchema.parse(JSON.parse(json));
    if (record.payload !== null) await parse(record.payload);
    return record;
  }
  async function verifiedWrite(slot: string, raw: string) {
    await AsyncStorage.setItem(slot, raw);
    if ((await AsyncStorage.getItem(slot)) !== raw)
      throw new Error('No se pudo guardar el registro pendiente. No se envió la operación.');
    await decode(raw);
  }
  async function readJournal(): Promise<JournalRecord | null> {
    const raw = await Promise.all(slots.map((slot) => AsyncStorage.getItem(slot)));
    if (raw.every((value) => value === null)) return null;
    const valid: Array<{ record: JournalRecord; raw: string; index: number }> = [];
    for (let index = 0; index < raw.length; index += 1) {
      const value = raw[index];
      if (value === null) continue;
      try {
        valid.push({ record: await decode(value), raw: value, index });
      } catch {
        /* Keep damaged bytes until an authenticated copy is recovered. */
      }
    }
    if (!valid.length) throw unreadable();
    valid.sort((a, b) => b.record.generation - a.record.generation);
    const newest = valid[0];
    if (
      valid.some(
        (item) =>
          item.record.generation === newest.record.generation &&
          item.record.payload !== newest.record.payload,
      )
    )
      throw unreadable();
    for (let index = 0; index < raw.length; index += 1) {
      if (raw[index] === newest.raw) continue;
      if (raw[index] !== null && !valid.some((item) => item.index === index)) {
        const damagedKey = `${slots[index]}.damaged`;
        // Never replace an earlier damaged copy with another one.
        if ((await AsyncStorage.getItem(damagedKey)) === null)
          await AsyncStorage.setItem(damagedKey, raw[index]!);
      }
      await verifiedWrite(slots[index], newest.raw);
    }
    return newest.record;
  }
  async function persist(payload: string | null, current: JournalRecord | null) {
    if (payload !== null) await parse(payload);
    const record: JournalRecord = {
      version: 1,
      generation: (current?.generation ?? 0) + 1,
      payload,
    };
    const raw = await encode(record);
    // Verify decrypted content before accepting a new generation in either slot.
    const verified = await decode(raw);
    if (verified.payload !== payload || verified.generation !== record.generation)
      throw unreadable();
    await verifiedWrite(slots[1], raw);
    await verifiedWrite(slots[0], raw);
    return record;
  }
  async function read(): Promise<JournalRecord | null> {
    const journal = await readJournal();
    if (journal) {
      // A leftover legacy record must not resurrect a command resolved by a tombstone.
      await legacy.remove();
      return journal;
    }
    const raw = await legacy.get();
    if (raw === null) return null;
    try {
      await parse(raw);
    } catch (error) {
      throw unreadable(error);
    }
    const migrated = await persist(raw, null);
    await legacy.remove();
    return migrated;
  }
  return {
    get: () =>
      locked(async () => {
        const record = await read();
        return record?.payload ? parse(record.payload) : null;
      }),
    set: (value: T) =>
      locked(async () => {
        const current = await read();
        await persist(JSON.stringify(value), current);
      }),
    clear: () =>
      locked(async () => {
        const current = await read();
        await persist(null, current);
        await legacy.remove();
      }),
  };
}
