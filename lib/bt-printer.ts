import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import { z } from 'zod';

import { escposTicket, testPage, toBase64 } from '@/lib/escpos';
import type { LineaVenta, Venta } from '@/lib/models';
import type { TicketNumbering } from '@/lib/ticket';

const KEY = 'mipypos.bt-printer.v1';
const configSchema = z.object({
  address: z.string().min(1),
  name: z.string(),
  columns: z.union([z.literal(32), z.literal(48)]),
});
export type PrinterConfig = z.infer<typeof configSchema>;
const pairedSchema = z.array(z.object({ name: z.string(), address: z.string() }));

interface PrinterBridge {
  listPaired(): Promise<unknown>;
  print(address: string, base64: string): Promise<null>;
}
function isBridge(value: unknown): value is PrinterBridge {
  return (
    !!value &&
    typeof value === 'object' &&
    'listPaired' in value &&
    typeof value.listPaired === 'function' &&
    'print' in value &&
    typeof value.print === 'function'
  );
}
function bridge(): PrinterBridge {
  const value: unknown = NativeModules.MipyPrinter;
  if (Platform.OS !== 'android' || !isBridge(value))
    throw new Error('La impresora Bluetooth requiere la compilación Android de MipyPOS.');
  return value;
}
export const printerSupported = () =>
  Platform.OS === 'android' && isBridge(NativeModules.MipyPrinter);

async function ensurePermission() {
  if (Platform.OS !== 'android' || Platform.Version < 31) return;
  const result = await PermissionsAndroid.request('android.permission.BLUETOOTH_CONNECT');
  if (result !== PermissionsAndroid.RESULTS.GRANTED)
    throw new Error('Permite a MipyPOS usar dispositivos cercanos para imprimir.');
}

export async function listPairedPrinters() {
  const printer = bridge();
  await ensurePermission();
  return pairedSchema.parse(await printer.listPaired());
}
export async function loadPrinter(): Promise<PrinterConfig | null> {
  try {
    const parsed = configSchema.safeParse(JSON.parse((await AsyncStorage.getItem(KEY)) ?? 'null'));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export const savePrinter = (config: PrinterConfig | null) =>
  config ? AsyncStorage.setItem(KEY, JSON.stringify(config)) : AsyncStorage.removeItem(KEY);

async function send(bytes: Uint8Array, config: PrinterConfig) {
  const printer = bridge();
  await ensurePermission();
  await printer.print(config.address, toBase64(bytes));
}
export async function printTestPage(config: PrinterConfig) {
  await send(testPage(config.columns), config);
}
export async function printSaleTicket(
  sale: Venta,
  lines: LineaVenta[],
  numbering: TicketNumbering | null | undefined,
) {
  const config = await loadPrinter();
  if (!config) throw new Error('Configura la impresora Bluetooth en Configuración.');
  await send(escposTicket(sale, lines, numbering, config.columns), config);
}
