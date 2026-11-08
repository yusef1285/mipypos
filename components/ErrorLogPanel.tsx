import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Button, Card, Typography } from 'heroui-native';
import { useEffect, useState } from 'react';
import { Alert, Platform } from 'react-native';

import { clearErrors, listErrors, type ErrorEntry } from '@/lib/error-log';

// Lets the owner send the anonymized crash journal to support without exposing business data.
export function ErrorLogPanel() {
  const [entries, setEntries] = useState<ErrorEntry[]>([]);
  useEffect(() => {
    void listErrors().then(setEntries);
  }, []);
  if (Platform.OS === 'web' || !entries.length) return null;
  const share = async () => {
    try {
      const file = new File(Paths.cache, 'mipypos-errores.txt');
      file.create({ overwrite: true });
      await file.write(
        entries.map((e) => `${e.at} [${e.kind}] ${e.message}\n${e.stack}`).join('\n\n'),
      );
      await Sharing.shareAsync(file.uri, { mimeType: 'text/plain', dialogTitle: 'Enviar errores' });
    } catch (failure) {
      Alert.alert('No se pudo compartir', failure instanceof Error ? failure.message : '');
    }
  };
  return (
    <Card className="gap-3 p-4">
      <Typography.Heading type="h4">Registro de errores</Typography.Heading>
      <Typography.Paragraph type="body-sm" color="muted">
        {entries.length} error(es) guardados. Último: {entries[0]?.message}. No incluye ventas,
        clientes ni contraseñas.
      </Typography.Paragraph>
      <Button variant="secondary" onPress={() => void share()}>
        <Button.Label>Enviar a soporte</Button.Label>
      </Button>
      <Button variant="ghost" onPress={() => void clearErrors().then(() => setEntries([]))}>
        <Button.Label>Borrar registro</Button.Label>
      </Button>
    </Card>
  );
}
