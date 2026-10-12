package com.mipypos.lan;

import com.facebook.react.bridge.*;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import fi.iki.elonen.NanoHTTPD;
import java.io.*;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.cert.X509Certificate;
import java.security.cert.CertificateException;
import java.util.*;
import java.util.concurrent.*;
import javax.net.ssl.*;

public class MipyTlsModule extends ReactContextBaseJavaModule {
  private static final int LIMIT = 1024 * 1024;
  private static final int MAX_WAITERS = 32;
  private final ExecutorService workers = Executors.newFixedThreadPool(4);
  private final ConcurrentHashMap<String, CompletableFuture<String>> replies = new ConcurrentHashMap<>();
  private NanoHTTPD server;
  private String serverIp;
  private String pin;
  private volatile boolean active = true;
  public MipyTlsModule(ReactApplicationContext context) { super(context); }
  @Override public String getName() { return "MipyTls"; }
  @ReactMethod public void addListener(String event) {}
  @ReactMethod public void removeListeners(double count) {}
  private static boolean privateIp(String ip) {
    String[] parts = ip.split("\\."); if (parts.length != 4) return false;
    int[] n = new int[4];
    try { for (int i=0;i<4;i++) { if (!parts[i].matches("[0-9]{1,3}")) return false; n[i]=Integer.parseInt(parts[i]); if(n[i]>255) return false; } }
    catch (NumberFormatException error) { return false; }
    return n[0]==10 || (n[0]==192 && n[1]==168) || (n[0]==172 && n[1]>=16 && n[1]<=31);
  }
  private void stop() {
    if (server != null) server.stop(); server = null; serverIp = null; pin = null;
    for (CompletableFuture<String> reply : replies.values()) reply.completeExceptionally(new IOException("Servidor detenido"));
    replies.clear();
  }
  @ReactMethod public void start(String ip, int port, Promise promise) {
    workers.execute(() -> {
      synchronized (this) {
        try {
          if (!active || port != 8787 || !privateIp(ip)) throw new IOException("Dirección LAN no válida");
          if (server != null && ip.equals(serverIp)) { promise.resolve(pin); return; }
          stop();
          LanIdentity identity = LanIdentity.load(ip);
          SSLContext tls = SSLContext.getInstance("TLS");
          tls.init(new KeyManager[]{identity}, null, null);
          NanoHTTPD next = new NanoHTTPD(ip, port) {
            @Override public Response serve(IHTTPSession session) {
              String id = UUID.randomUUID().toString();
              CompletableFuture<String> reply = new CompletableFuture<>();
              try {
                if (replies.size() >= MAX_WAITERS) return newFixedLengthResponse(Response.Status.SERVICE_UNAVAILABLE, "application/json", "{}");
                String method = session.getMethod().name();
                String body = "{}";
                if ("POST".equals(method)) {
                  int size = Integer.parseInt(session.getHeaders().getOrDefault("content-length", "0"));
                  if (size <= 0 || size > LIMIT) return newFixedLengthResponse(Response.Status.BAD_REQUEST, "application/json", "{}");
                  byte[] data = new byte[size]; int offset=0;
                  while (offset<size) { int count=session.getInputStream().read(data,offset,size-offset); if(count<0) throw new EOFException(); offset+=count; }
                  body = new String(data, StandardCharsets.UTF_8);
                } else if (!"GET".equals(method)) return newFixedLengthResponse(Response.Status.METHOD_NOT_ALLOWED, "application/json", "{}");
                replies.put(id,reply);
                WritableMap event = Arguments.createMap(); event.putString("id",id); event.putString("method",method); event.putString("path",session.getUri()); event.putString("body",body);
                getReactApplicationContext().getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit("MipyTlsRequest",event);
                Response response = newFixedLengthResponse(Response.Status.OK,"application/json",reply.get(20,TimeUnit.SECONDS));
                response.addHeader("Cache-Control","no-store"); return response;
              } catch (Exception error) {
                return newFixedLengthResponse(Response.Status.SERVICE_UNAVAILABLE,"application/json","{}");
              } finally { replies.remove(id); }
            }
          };
          next.makeSecure(tls.getServerSocketFactory(), new String[]{"TLSv1.2"});
          next.start(10000,false);
          server=next; serverIp=ip; pin=identity.pin(); promise.resolve(pin);
        } catch (Exception error) { stop(); promise.reject("TLS_START","No se pudo iniciar la red segura. Revisa el Wi-Fi y vuelve a intentarlo.",error); }
      }
    });
  }
  @ReactMethod public void stopServer(Promise promise) {
    synchronized (this) { stop(); } promise.resolve(null);
  }
  @ReactMethod public void respond(String id, String body) {
    CompletableFuture<String> reply=replies.get(id); if(reply!=null) reply.complete(body);
  }
  @ReactMethod public void request(String address, String method, String body, String expectedPin, Promise promise) {
    workers.execute(() -> {
      HttpsURLConnection connection=null;
      try {
        URL url=new URL(address);
        if (!"https".equals(url.getProtocol()) || url.getPort()!=8787 || !privateIp(url.getHost()) || url.getUserInfo()!=null || url.getQuery()!=null || url.getRef()!=null || !url.getPath().startsWith("/v1/") || (!"GET".equals(method) && !"POST".equals(method)) || !expectedPin.matches("[A-Za-z0-9+/]{43}=") || body.getBytes(StandardCharsets.UTF_8).length>LIMIT) throw new IOException("Solicitud LAN no válida");
        X509TrustManager trust=new X509TrustManager() {
          @Override public void checkClientTrusted(X509Certificate[] chain,String auth) throws CertificateException { throw new CertificateException("Cliente no admitido"); }
          @Override public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
          @Override public void checkServerTrusted(X509Certificate[] chain,String auth) throws CertificateException {
            try {
              if (chain==null || chain.length!=1 || !MessageDigest.isEqual(LanIdentity.pin(chain[0]).getBytes(StandardCharsets.US_ASCII),expectedPin.getBytes(StandardCharsets.US_ASCII))) throw new CertificateException("La identidad del administrador ha cambiado");
              chain[0].checkValidity(); chain[0].verify(chain[0].getPublicKey());
            } catch (Exception error) { throw new CertificateException("Certificado del administrador no válido",error); }
          }
        };
        SSLContext tls=SSLContext.getInstance("TLSv1.2"); tls.init(null,new TrustManager[]{trust},null);
        connection=(HttpsURLConnection)url.openConnection(); connection.setSSLSocketFactory(tls.getSocketFactory());
        // Keep Android's default hostname verifier: the leaf certificate contains an IP SAN.
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(8000); connection.setReadTimeout(25000); connection.setRequestMethod(method);
        connection.setRequestProperty("Content-Type","application/json");
        if("POST".equals(method)) { connection.setDoOutput(true); byte[] bytes=body.getBytes(StandardCharsets.UTF_8); connection.setFixedLengthStreamingMode(bytes.length); try(OutputStream output=connection.getOutputStream()) { output.write(bytes); } }
        int status=connection.getResponseCode();
        if(status!=200) throw new IOException("Respuesta LAN no válida");
        ByteArrayOutputStream output=new ByteArrayOutputStream();
        try(InputStream input=connection.getInputStream()) { byte[] buffer=new byte[8192]; int count; while((count=input.read(buffer))!=-1) { if(output.size()+count>LIMIT) throw new IOException("Respuesta demasiado grande"); output.write(buffer,0,count); } }
        promise.resolve(output.toString("UTF-8"));
      } catch(Exception error) { promise.reject("TLS_REQUEST","No se pudo confirmar la conexión segura. Revisa la red, la fecha y el QR del administrador.",error); }
      finally { if(connection!=null) connection.disconnect(); }
    });
  }
  @Override public void invalidate() { active=false; synchronized(this) { stop(); } workers.shutdownNow(); super.invalidate(); }
}
