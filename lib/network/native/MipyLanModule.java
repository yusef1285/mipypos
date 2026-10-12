package com.mipypos.lan;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.wifi.WifiConfiguration;
import android.net.wifi.WifiManager;
import android.net.wifi.WifiNetworkSpecifier;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Collections;

public class MipyLanModule extends ReactContextBaseJavaModule {
  private final WifiManager wifi;
  private final ConnectivityManager connectivity;
  private WifiManager.LocalOnlyHotspotReservation reservation;
  private ConnectivityManager.NetworkCallback connection;
  private String ssid;
  private String password;
  private boolean starting = false;
  private final Handler handler = new Handler(Looper.getMainLooper());

  public MipyLanModule(ReactApplicationContext context) {
    super(context);
    wifi = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
    connectivity = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
  }
  @Override public String getName() { return "MipyLan"; }
  private WritableMap credentials() {
    WritableMap value = Arguments.createMap();
    value.putString("ssid", ssid);
    value.putString("password", password);
    return value;
  }
  @ReactMethod public void startHotspot(Promise promise) {
    if (Build.VERSION.SDK_INT < 26) { promise.reject("UNSUPPORTED", "Crear una red local requiere Android 8 o posterior."); return; }
    if (reservation != null) { promise.resolve(credentials()); return; }
    if (starting) { promise.reject("BUSY", "La red local ya se está iniciando."); return; }
    starting = true;
    try {
      wifi.startLocalOnlyHotspot(new WifiManager.LocalOnlyHotspotCallback() {
        @Override public void onStarted(WifiManager.LocalOnlyHotspotReservation value) {
          reservation = value;
          starting = false;
          if (Build.VERSION.SDK_INT >= 30) {
            ssid = value.getSoftApConfiguration().getSsid();
            password = value.getSoftApConfiguration().getPassphrase();
          } else {
            WifiConfiguration configuration = value.getWifiConfiguration();
            ssid = configuration.SSID;
            password = configuration.preSharedKey;
          }
          if (ssid == null || password == null) {
            value.close(); reservation = null;
            promise.reject("CONFIGURATION", "Android no entregó las credenciales de la red local."); return;
          }
          promise.resolve(credentials());
        }
        @Override public void onStopped() { reservation = null; ssid = null; password = null; starting = false; }
        @Override public void onFailed(int reason) {
          starting = false;
          promise.reject("HOTSPOT", "Android no pudo crear la red local. Desactiva el hotspot del sistema y revisa los permisos y la ubicación.");
        }
      }, handler);
    } catch (Exception error) { starting = false; promise.reject("HOTSPOT", "No se pudo crear la red local. Revisa los permisos y activa la ubicación si Android lo requiere.", error); }
  }
  @ReactMethod public void getHotspot(Promise promise) { promise.resolve(reservation == null ? null : credentials()); }
  @ReactMethod public void stopHotspot(Promise promise) {
    if (reservation != null) reservation.close();
    reservation = null; ssid = null; password = null;
    promise.resolve(null);
  }
  private int interfaceScore(String name) {
    if (name.startsWith("ap") || name.contains("swlan")) return 3;
    if (name.contains("wlan1")) return 2;
    return 1;
  }
  @ReactMethod public void getHostIp(Promise promise) {
    try {
      // Enumerate actual Wi-Fi/AP interfaces: no assumed tethering gateway address.
      java.util.List<NetworkInterface> interfaces = Collections.list(NetworkInterface.getNetworkInterfaces());
      if (reservation != null) Collections.sort(interfaces, (a, b) -> Integer.compare(interfaceScore(b.getName()), interfaceScore(a.getName())));
      for (NetworkInterface item : interfaces) {
        String name = item.getName().toLowerCase();
        if (!item.isUp() || item.isLoopback() || !(name.startsWith("ap") || name.contains("wlan") || name.contains("swlan") || name.contains("wifi"))) continue;
        for (InetAddress address : Collections.list(item.getInetAddresses())) {
          if (address instanceof Inet4Address && address.isSiteLocalAddress()) { promise.resolve(address.getHostAddress()); return; }
        }
      }
      promise.resolve(null);
    } catch (Exception error) { promise.reject("ADDRESS", "No se pudo leer la dirección de la red local.", error); }
  }
  private void releaseConnection() {
    ConnectivityManager.NetworkCallback previous = connection;
    connection = null;
    connectivity.bindProcessToNetwork(null);
    if (previous != null) { try { connectivity.unregisterNetworkCallback(previous); } catch (IllegalArgumentException ignored) { /* Android may already have removed it. */ } }
  }
  @ReactMethod public void disconnect(Promise promise) {
    try { releaseConnection(); promise.resolve(null); } catch (Exception error) { promise.reject("DISCONNECT", "No se pudo liberar la conexión Wi-Fi.", error); }
  }
  @ReactMethod public void connect(String networkName, String networkPassword, Promise promise) {
    if (Build.VERSION.SDK_INT < 29) { promise.reject("UNSUPPORTED", "La conexión por QR requiere Android 10 o posterior. Conecta el Wi-Fi en Ajustes y escanea el QR de conexión."); return; }
    try {
      releaseConnection();
      WifiNetworkSpecifier specifier = new WifiNetworkSpecifier.Builder().setSsid(networkName).setWpa2Passphrase(networkPassword).build();
      NetworkRequest request = new NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).setNetworkSpecifier(specifier).build();
      ConnectivityManager.NetworkCallback callback = new ConnectivityManager.NetworkCallback() {
        private boolean settled = false;
        private Network boundNetwork;
        private void bind(Network network) {
          if (connection != this) return;
          LinkProperties properties = connectivity.getLinkProperties(network);
          if (properties == null || properties.getLinkAddresses().isEmpty()) return;
          if (connectivity.bindProcessToNetwork(network)) {
            boundNetwork = network;
            if (!settled) { settled = true; promise.resolve(null); }
          } else if (!settled) { settled = true; releaseConnection(); promise.reject("CONNECT", "No se pudo usar la red local."); }
        }
        @Override public void onAvailable(Network network) { bind(network); }
        @Override public void onLinkPropertiesChanged(Network network, LinkProperties properties) { bind(network); }
        @Override public void onUnavailable() {
          if (connection != this) return;
          if (!settled) { settled = true; promise.reject("CONNECT", "No se pudo conectar al Wi-Fi del administrador. Acepta la solicitud de Android e inténtalo de nuevo."); }
          releaseConnection();
        }
        @Override public void onLost(Network network) {
          if (connection != this || (boundNetwork != null && !boundNetwork.equals(network))) return;
          if (!settled) { settled = true; promise.reject("CONNECT", "Se perdió la red local. Escanea nuevamente el QR."); }
          releaseConnection();
        }
      };
      connection = callback;
      connectivity.requestNetwork(request, callback, 45000);
    } catch (Exception error) { releaseConnection(); promise.reject("CONNECT", "No se pudo conectar. Revisa los permisos de dispositivos cercanos y Wi-Fi.", error); }
  }
  @Override public void invalidate() {
    if (reservation != null) reservation.close();
    try { releaseConnection(); } catch (Exception ignored) { /* System may already have released the callback. */ }
    super.invalidate();
  }
}
