package com.mipypos.lan;

import com.facebook.react.bridge.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

/** PBKDF2-HMAC-SHA256 off the JS thread. The password never leaves the device. */
public class MipyPasswordModule extends ReactContextBaseJavaModule {
  private final ExecutorService executor = Executors.newSingleThreadExecutor();
  public MipyPasswordModule(ReactApplicationContext context) { super(context); }
  @Override public String getName() { return "MipyPassword"; }

  @ReactMethod public void pbkdf2Sha256(String password, String saltHex, double iterations, double length, Promise promise) {
    executor.execute(() -> {
      PBEKeySpec spec = null;
      try {
        if (iterations < 1 || iterations > 5_000_000 || length < 16 || length > 64)
          throw new IllegalArgumentException("Parámetros de contraseña no válidos.");
        byte[] salt = new byte[saltHex.length() / 2];
        for (int i = 0; i < salt.length; i++)
          salt[i] = (byte) Integer.parseInt(saltHex.substring(i * 2, i * 2 + 2), 16);
        spec = new PBEKeySpec(password.toCharArray(), salt, (int) iterations, (int) length * 8);
        byte[] derived = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
        StringBuilder hex = new StringBuilder(derived.length * 2);
        for (byte value : derived) hex.append(String.format("%02x", value));
        promise.resolve(hex.toString());
      } catch (Exception error) {
        promise.reject("PASSWORD", "No se pudo proteger la contraseña.", error);
      } finally {
        if (spec != null) spec.clearPassword();
      }
    });
  }
  @Override public void invalidate() { executor.shutdown(); super.invalidate(); }
}
