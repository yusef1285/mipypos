package com.mipypos.lan;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Handler;
import android.os.Looper;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import java.net.Inet4Address;
import java.util.ArrayDeque;
import java.util.HashSet;
import java.util.LinkedHashMap;

/** Discovery is an untrusted address hint. JS must verify the previously paired TLS pin. */
public class MipyDiscoveryModule extends ReactContextBaseJavaModule {
  private static final String TYPE = "_mipypos._tcp.";
  private final NsdManager manager;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private NsdManager.RegistrationListener registration;
  private Promise advertisement;
  private Runnable advertisementTimeout;
  private NsdManager.DiscoveryListener discovery;
  private Promise pending;
  private final LinkedHashMap<String, NsdServiceInfo> found = new LinkedHashMap<>();
  private final ArrayDeque<NsdServiceInfo> unresolved = new ArrayDeque<>();
  private final HashSet<String> seen = new HashSet<>();
  private boolean resolving;
  private long scanId;
  private Runnable timeout;

  public MipyDiscoveryModule(ReactApplicationContext context) {
    super(context);
    manager = (NsdManager) context.getSystemService(Context.NSD_SERVICE);
  }
  @Override public String getName() { return "MipyDiscovery"; }
  private void stopAdvertisementInternal() {
    NsdManager.RegistrationListener previous = registration;
    registration = null;
    if (advertisementTimeout != null) handler.removeCallbacks(advertisementTimeout);
    advertisementTimeout = null;
    if (advertisement != null) { advertisement.reject("ADVERTISE", "El anuncio se canceló. Usa el QR del administrador."); advertisement = null; }
    if (previous != null) { try { manager.unregisterService(previous); } catch (IllegalArgumentException ignored) { } }
  }
  @ReactMethod public void advertise(String identity, int port, Promise promise) {
    handler.post(() -> {
      stopAdvertisementInternal();
      if (identity == null || !identity.matches("[A-Za-z0-9-]{1,80}") || port < 1 || port > 65535) { promise.reject("ARGUMENTS", "La identidad del administrador no es válida."); return; }
      NsdServiceInfo info = new NsdServiceInfo();
      info.setServiceName("MipyPOS-" + identity);
      info.setServiceType(TYPE);
      info.setPort(port);
      NsdManager.RegistrationListener listener = new NsdManager.RegistrationListener() {
        @Override public void onServiceRegistered(NsdServiceInfo service) { handler.post(() -> { if (registration != this || advertisement == null) return; if (advertisementTimeout != null) handler.removeCallbacks(advertisementTimeout); advertisementTimeout = null; advertisement.resolve(null); advertisement = null; }); }
        @Override public void onRegistrationFailed(NsdServiceInfo service, int code) { handler.post(() -> { if (registration == this) stopAdvertisementInternal(); }); }
        @Override public void onServiceUnregistered(NsdServiceInfo service) { }
        @Override public void onUnregistrationFailed(NsdServiceInfo service, int code) { }
      };
      registration = listener;
      advertisement = promise;
      advertisementTimeout = () -> { if (registration == listener && advertisement != null) stopAdvertisementInternal(); };
      handler.postDelayed(advertisementTimeout, 5000);
      try { manager.registerService(info, NsdManager.PROTOCOL_DNS_SD, listener); }
      catch (Exception error) { stopAdvertisementInternal(); }
    });
  }
  @ReactMethod public void stopAdvertisement(Promise promise) { handler.post(() -> { stopAdvertisementInternal(); promise.resolve(null); }); }
  private void finish(String error) {
    Promise result = pending;
    pending = null;
    scanId++;
    if (timeout != null) handler.removeCallbacks(timeout);
    timeout = null;
    NsdManager.DiscoveryListener listener = discovery;
    discovery = null;
    if (listener != null) { try { manager.stopServiceDiscovery(listener); } catch (IllegalArgumentException ignored) { } }
    unresolved.clear();
    resolving = false;
    if (result == null) return;
    if (error != null) { result.reject("DISCOVERY", error); return; }
    WritableArray values = Arguments.createArray();
    for (NsdServiceInfo service : found.values()) {
      if (!(service.getHost() instanceof Inet4Address) || !service.getHost().isSiteLocalAddress()) continue;
      WritableMap item = Arguments.createMap();
      item.putString("name", service.getServiceName());
      item.putString("hostUrl", "https://" + service.getHost().getHostAddress() + ":" + service.getPort());
      values.pushMap(item);
    }
    result.resolve(values);
  }
  private void resolveNext(long id) {
    if (pending == null || scanId != id || resolving || unresolved.isEmpty()) return;
    resolving = true;
    NsdServiceInfo service = unresolved.removeFirst();
    try {
      manager.resolveService(service, new NsdManager.ResolveListener() {
        @Override public void onResolveFailed(NsdServiceInfo value, int code) { handler.post(() -> { if (scanId != id) return; resolving = false; resolveNext(id); }); }
        @Override public void onServiceResolved(NsdServiceInfo value) { handler.post(() -> { if (scanId != id) return; found.put(value.getServiceName(), value); resolving = false; resolveNext(id); }); }
      });
    } catch (Exception error) { resolving = false; resolveNext(id); }
  }
  @ReactMethod public void discover(Promise promise) {
    handler.post(() -> {
      if (pending != null) { promise.reject("BUSY", "Ya se está buscando al administrador."); return; }
      pending = promise;
      found.clear(); unresolved.clear(); seen.clear(); resolving = false;
      final long id = ++scanId;
      NsdManager.DiscoveryListener listener = new NsdManager.DiscoveryListener() {
        @Override public void onDiscoveryStarted(String type) { }
        @Override public void onServiceFound(NsdServiceInfo info) { handler.post(() -> { if (scanId != id || !(TYPE.equals(info.getServiceType()) || "_mipypos._tcp".equals(info.getServiceType())) || !info.getServiceName().startsWith("MipyPOS-") || seen.size() >= 12 || !seen.add(info.getServiceName())) return; unresolved.addLast(info); resolveNext(id); }); }
        @Override public void onServiceLost(NsdServiceInfo info) { handler.post(() -> { if (scanId == id) found.remove(info.getServiceName()); }); }
        @Override public void onDiscoveryStopped(String type) { }
        @Override public void onStartDiscoveryFailed(String type, int code) { handler.post(() -> { if (scanId == id) finish("No se pudo buscar en esta red. Conecta el Wi-Fi y usa el QR del administrador."); }); }
        @Override public void onStopDiscoveryFailed(String type, int code) { }
      };
      discovery = listener;
      timeout = () -> { if (scanId == id) finish(null); };
      handler.postDelayed(timeout, 8000);
      try { manager.discoverServices(TYPE, NsdManager.PROTOCOL_DNS_SD, listener); }
      catch (Exception error) { finish("No se pudo buscar en esta red. Revisa los permisos y usa el QR del administrador."); }
    });
  }
  @ReactMethod public void cancelDiscovery(Promise promise) { handler.post(() -> { finish("Búsqueda cancelada."); promise.resolve(null); }); }
  @Override public void invalidate() { handler.post(() -> { finish("Búsqueda cancelada."); stopAdvertisementInternal(); }); super.invalidate(); }
}
