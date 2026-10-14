import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as MediaLibrary from 'expo-media-library';
import { NativeModules, Platform } from 'react-native';
import { receiptAmount } from '@/lib/settlement';

interface ReceiptBridge {
  recognize(uri: string): Promise<string>;
}
function isReceiptBridge(value: unknown): value is ReceiptBridge {
  return (
    !!value &&
    typeof value === 'object' &&
    'recognize' in value &&
    typeof value.recognize === 'function'
  );
}
function bridge(): ReceiptBridge {
  const value: unknown = NativeModules.MipyReceipt;
  if (Platform.OS !== 'android' || !isReceiptBridge(value))
    throw new Error('La lectura offline requiere la nueva compilación Android de MipyPOS.');
  return value;
}
export async function captureReceipt(fromLibrary = false) {
  const recognizer = bridge();
  const gallery = await MediaLibrary.requestPermissionsAsync(true, ['photo']);
  if (!gallery.granted) throw new Error('Permite guardar el comprobante en la galería.');
  if (!fromLibrary && !(await ImagePicker.requestCameraPermissionsAsync()).granted)
    throw new Error('Permite usar la cámara para captar el comprobante.');
  const result = fromLibrary
    ? await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 })
    : await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
  if (result.canceled) return null;
  const uri = result.assets[0].uri;
  const rawText = await recognizer.recognize(uri);
  if (!rawText.trim()) throw new Error('No se pudo leer el texto. Toma otra foto con buena luz.');
  const context = ImageManipulator.ImageManipulator.manipulate(uri);
  context.resize({ width: 1100 });
  const image = await context.renderAsync();
  const compressed = await image.saveAsync({
    format: ImageManipulator.SaveFormat.JPEG,
    compress: 0.6,
    base64: true,
  });
  if (!compressed.base64 || compressed.base64.length > 600000)
    throw new Error('El comprobante es demasiado grande. Recorta la imagen y vuelve a captarlo.');
  await MediaLibrary.Asset.create(compressed.uri);
  const reference =
    rawText.match(/(?:referencia|operaci[oó]n|transacci[oó]n)\s*[:#]?\s*([A-Z0-9-]{4,})/i)?.[1] ??
    '';
  const receiptDate =
    rawText.match(/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}(?:\s+\d{1,2}:\d{2})?\b/)?.[0] ?? '';
  return {
    imageBase64: compressed.base64,
    rawText: rawText.slice(0, 20000),
    amount: receiptAmount(rawText),
    reference,
    receiptDate,
  };
}
