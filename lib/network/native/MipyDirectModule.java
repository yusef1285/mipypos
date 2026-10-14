package com.mipypos.lan;

import android.content.*;
import android.location.LocationManager;
import android.net.wifi.WpsInfo;
import android.net.wifi.p2p.*;
import android.os.*;
import com.facebook.react.bridge.*;

public class MipyDirectModule extends ReactContextBaseJavaModule {
  private final WifiP2pManager manager;
  private WifiP2pManager.Channel channel;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private Promise pending;
  private boolean expectingOwner;
  private long deadline;
  private String target;
  private boolean connecting;
  private boolean registered;
  private final BroadcastReceiver receiver = new BroadcastReceiver() {
    @Override public void onReceive(Context context, Intent intent) {
      if (WifiP2pManager.WIFI_P2P_STATE_CHANGED_ACTION.equals(intent.getAction()) && intent.getIntExtra(WifiP2pManager.EXTRA_WIFI_STATE, -1) != WifiP2pManager.WIFI_P2P_STATE_ENABLED) fail("Activa Wi-Fi para conectar por Wi-Fi Direct.");
      if (pending != null) poll();
    }
  };
  public MipyDirectModule(ReactApplicationContext context) {
    super(context);
    manager = (WifiP2pManager) context.getSystemService(Context.WIFI_P2P_SERVICE);
  }
  @Override public String getName() { return "MipyDirect"; }
  private void setup() {
    if (manager == null) throw new IllegalStateException("Este teléfono no admite Wi-Fi Direct.");
    if (channel == null) channel = manager.initialize(getReactApplicationContext(), Looper.getMainLooper(), () -> { channel = null; fail("Se perdió el servicio Wi-Fi Direct. Vuelve a conectar."); });
    if (!registered) {
      IntentFilter filter = new IntentFilter();
      filter.addAction(WifiP2pManager.WIFI_P2P_STATE_CHANGED_ACTION);
      filter.addAction(WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION);
      filter.addAction(WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION);
      if (Build.VERSION.SDK_INT >= 33) getReactApplicationContext().registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED);
      else getReactApplicationContext().registerReceiver(receiver, filter);
      registered = true;
    }
  }
  private void fail(String message) {
    Promise promise = pending; pending = null; target = null; connecting = false;
    handler.removeCallbacksAndMessages(null);
    if (promise != null) {
      if (manager != null && channel != null) { manager.cancelConnect(channel, null); manager.removeGroup(channel, null); }
      promise.reject("WIFI_DIRECT", message);
    }
  }
  private WritableMap details(WifiP2pInfo info, WifiP2pGroup group) {
    WritableMap result = Arguments.createMap();
    result.putBoolean("isOwner", info.isGroupOwner);
    result.putString("hostIp", info.groupOwnerAddress.getHostAddress());
    result.putString("deviceAddress", group.getOwner().deviceAddress);
    return result;
  }
  private void poll() {
    if (pending == null || manager == null || channel == null) return;
    if (System.currentTimeMillis() >= deadline) { fail("No se pudo establecer Wi-Fi Direct. Acerca los teléfonos, activa ubicación, acepta la conexión de Android y reintenta."); return; }
    try {
      manager.requestConnectionInfo(channel, info -> {
        if (pending == null) return;
        if (info.groupFormed && info.groupOwnerAddress != null) {
          if (info.isGroupOwner != expectingOwner) { fail("El teléfono vendedor debe ser el propietario de la red. Desconecta y escanea su QR."); return; }
          manager.requestGroupInfo(channel, group -> {
            if (pending == null || group == null || group.getOwner() == null) return;
            if (!expectingOwner && target != null && !target.equalsIgnoreCase(group.getOwner().deviceAddress)) { fail("La red no pertenece al administrador del QR."); return; }
            String address = group.getOwner().deviceAddress;
            if (address == null || address.equals("02:00:00:00:00:00")) { fail("Android no entregó la identidad Wi-Fi Direct. Revisa dispositivos cercanos y ubicación."); return; }
            Promise promise = pending; pending = null; target = null; connecting = false;
            handler.removeCallbacksAndMessages(null);
            manager.stopPeerDiscovery(channel, null);
            promise.resolve(details(info, group));
          });
        } else if (!expectingOwner && target != null && !connecting) {
          manager.requestPeers(channel, peers -> {
            if (pending == null || connecting || target == null) return;
            for (WifiP2pDevice peer : peers.getDeviceList()) if (target.equalsIgnoreCase(peer.deviceAddress)) {
              connecting = true;
              WifiP2pConfig config = new WifiP2pConfig(); config.deviceAddress = target; config.groupOwnerIntent = 0; config.wps.setup = WpsInfo.PBC;
              manager.connect(channel, config, new WifiP2pManager.ActionListener() {
                @Override public void onSuccess() { }
                @Override public void onFailure(int reason) { fail("Android rechazó Wi-Fi Direct (" + reason + "). Revisa permisos y vuelve a escanear."); }
              });
              break;
            }
          });
        }
      });
      handler.removeCallbacks(tick); handler.postDelayed(tick, 500);
    } catch (Exception error) { fail("No se pudo consultar Wi-Fi Direct. Revisa permisos y ubicación."); }
  }
  private final Runnable tick = this::poll;
  @ReactMethod public void createGroup(Promise promise) {
    handler.post(() -> {
      try {
        setup(); if (pending != null) { promise.reject("BUSY", "Ya hay una conexión en curso."); return; }
        pending = promise; expectingOwner = true; target = null; connecting = false; deadline = System.currentTimeMillis() + 45000;
        manager.requestGroupInfo(channel, group -> {
          if (pending == null) return;
          if (group != null) { if (group.isGroupOwner()) poll(); else fail("Desconecta la red anterior antes de crear Wi-Fi Direct."); return; }
          manager.createGroup(channel, new WifiP2pManager.ActionListener() {
            @Override public void onSuccess() { poll(); }
            @Override public void onFailure(int reason) { fail("No se pudo crear Wi-Fi Direct (" + reason + "). Desactiva el hotspot y reintenta."); }
          });
        });
        handler.postDelayed(tick, 500);
      } catch (Exception error) { if (pending == promise) fail("No se pudo crear Wi-Fi Direct. Revisa permisos."); else promise.reject("WIFI_DIRECT", error.getMessage(), error); }
    });
  }
  @ReactMethod public void connectPeer(String address, Promise promise) {
    handler.post(() -> {
      try {
        setup(); if (pending != null) { promise.reject("BUSY", "Ya hay una conexión en curso."); return; }
        LocationManager location = (LocationManager) getReactApplicationContext().getSystemService(Context.LOCATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 28 && location != null && !location.isLocationEnabled()) { promise.reject("LOCATION", "Activa ubicación para descubrir el teléfono vendedor."); return; }
        pending = promise; expectingOwner = false; target = address; connecting = false; deadline = System.currentTimeMillis() + 60000;
        manager.discoverPeers(channel, new WifiP2pManager.ActionListener() {
          @Override public void onSuccess() { poll(); }
          @Override public void onFailure(int reason) { fail("No se pudieron descubrir teléfonos (" + reason + "). Activa Wi-Fi y ubicación."); }
        });
      } catch (Exception error) { if (pending == promise) fail("No se pudo conectar Wi-Fi Direct. Revisa permisos."); else promise.reject("WIFI_DIRECT", error.getMessage(), error); }
    });
  }
  @ReactMethod public void getInfo(Promise promise) {
    handler.post(() -> {
      try {
        setup(); manager.requestConnectionInfo(channel, info -> {
          if (!info.groupFormed || info.groupOwnerAddress == null) { promise.resolve(null); return; }
          manager.requestGroupInfo(channel, group -> { if (group == null || group.getOwner() == null) promise.resolve(null); else promise.resolve(details(info, group)); });
        });
      } catch (Exception error) { promise.reject("WIFI_DIRECT", "No se pudo consultar la red Wi-Fi Direct.", error); }
    });
  }
  @ReactMethod public void disconnect(Promise promise) {
    handler.post(() -> {
      try {
        setup(); fail("Conexión cancelada."); manager.stopPeerDiscovery(channel, null); manager.cancelConnect(channel, null);
        manager.removeGroup(channel, new WifiP2pManager.ActionListener() {
          @Override public void onSuccess() { promise.resolve(null); }
          @Override public void onFailure(int reason) { promise.reject("WIFI_DIRECT", "No se pudo desconectar la red (" + reason + ")."); }
        });
      } catch (Exception error) { promise.reject("WIFI_DIRECT", "No se pudo desconectar Wi-Fi Direct.", error); }
    });
  }
  @Override public void invalidate() {
    fail("Se cerró la conexión.");
    if (manager != null && channel != null) { manager.stopPeerDiscovery(channel, null); manager.cancelConnect(channel, null); manager.removeGroup(channel, null); if (Build.VERSION.SDK_INT >= 27) channel.close(); }
    if (registered) { getReactApplicationContext().unregisterReceiver(receiver); registered = false; }
    super.invalidate();
  }
}
