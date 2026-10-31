export function scheduleFiscalReminder(_id: string, _date: Date): Promise<string> {
  return Promise.reject(
    new Error(
      'Los recordatorios del sistema están disponibles en Android/iOS. Consulta el calendario dentro de la aplicación.',
    ),
  );
}
export function cancelFiscalReminder(_id: string): Promise<void> {
  return Promise.resolve();
}
