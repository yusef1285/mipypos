import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});
export async function scheduleFiscalReminder(id: string, date: Date) {
  if (date.getTime() <= Date.now()) throw new Error('Selecciona un recordatorio futuro.');
  if (Platform.OS === 'android')
    await Notifications.setNotificationChannelAsync('mipypos-fiscal', {
      name: 'Recordatorios fiscales',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted)
    throw new Error('Activa el permiso de notificaciones para recibir recordatorios.');
  await Notifications.cancelScheduledNotificationAsync(`onat-${id}`);
  return Notifications.scheduleNotificationAsync({
    identifier: `onat-${id}`,
    content: {
      title: 'MipyPOS ONAT',
      body: 'Revisa tus obligaciones tributarias en la aplicación.',
      data: { onatId: id },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date,
      channelId: Platform.OS === 'android' ? 'mipypos-fiscal' : undefined,
    },
  });
}
export async function cancelFiscalReminder(id: string) {
  await Notifications.cancelScheduledNotificationAsync(`onat-${id}`);
}
