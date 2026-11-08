package com.mipypos.lan;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.util.Base64;
import com.facebook.react.bridge.*;
import java.io.OutputStream;
import java.util.Set;
import java.util.UUID;

// Classic Bluetooth (SPP) bridge for ESC/POS thermal printers paired in Android settings.
public class MipyPrinterModule extends ReactContextBaseJavaModule {
  private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
  public MipyPrinterModule(ReactApplicationContext context) { super(context); }
  @Override public String getName() { return "MipyPrinter"; }

  private BluetoothAdapter adapter() {
    BluetoothManager manager = (BluetoothManager) getReactApplicationContext().getSystemService(Context.BLUETOOTH_SERVICE);
    return manager == null ? null : manager.getAdapter();
  }

  @ReactMethod public void listPaired(Promise promise) {
    try {
      BluetoothAdapter adapter = adapter();
      if (adapter == null) { promise.reject("BT", "Este teléfono no tiene Bluetooth."); return; }
      if (!adapter.isEnabled()) { promise.reject("BT", "Activa el Bluetooth del teléfono."); return; }
      WritableArray result = Arguments.createArray();
      Set<BluetoothDevice> devices = adapter.getBondedDevices();
      if (devices != null) for (BluetoothDevice device : devices) {
        WritableMap item = Arguments.createMap();
        String name = device.getName();
        item.putString("name", name == null ? device.getAddress() : name);
        item.putString("address", device.getAddress());
        result.pushMap(item);
      }
      promise.resolve(result);
    } catch (SecurityException error) {
      promise.reject("BT_PERMISSION", "Permite a MipyPOS usar dispositivos cercanos (Bluetooth).", error);
    } catch (Exception error) {
      promise.reject("BT", "No se pudieron leer las impresoras emparejadas.", error);
    }
  }

  @ReactMethod public void print(String address, String base64, Promise promise) {
    new Thread(() -> {
      BluetoothSocket socket = null;
      try {
        BluetoothAdapter adapter = adapter();
        if (adapter == null || !adapter.isEnabled()) throw new IllegalStateException("Activa el Bluetooth del teléfono.");
        byte[] data = Base64.decode(base64, Base64.DEFAULT);
        BluetoothDevice device = adapter.getRemoteDevice(address);
        try { adapter.cancelDiscovery(); } catch (SecurityException ignored) { }
        socket = device.createRfcommSocketToServiceRecord(SPP);
        socket.connect();
        OutputStream out = socket.getOutputStream();
        // Small chunks keep cheap printers from dropping bytes when their buffer fills.
        for (int offset = 0; offset < data.length; offset += 512) {
          out.write(data, offset, Math.min(512, data.length - offset));
          out.flush();
          Thread.sleep(20);
        }
        Thread.sleep(300);
        promise.resolve(null);
      } catch (SecurityException error) {
        promise.reject("BT_PERMISSION", "Permite a MipyPOS usar dispositivos cercanos (Bluetooth).", error);
      } catch (IllegalStateException error) {
        promise.reject("BT", error.getMessage(), error);
      } catch (Exception error) {
        promise.reject("BT", "No se pudo imprimir. Enciende la impresora y verifica que esté emparejada.", error);
      } finally {
        if (socket != null) try { socket.close(); } catch (Exception ignored) { }
      }
    }).start();
  }
}
