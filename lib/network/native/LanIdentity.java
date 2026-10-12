package com.mipypos.lan;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.math.BigInteger;
import java.net.InetAddress;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.security.spec.ECGenParameterSpec;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import javax.net.ssl.X509ExtendedKeyManager;
import javax.net.ssl.SSLEngine;
import java.net.Socket;
import java.security.Principal;

/** Offline CA: the QR-pinned key is non-exportable; the leaf cert has the current IP SAN. */
final class LanIdentity extends X509ExtendedKeyManager {
  private static final String ALIAS = "mipypos.lan.tls.v1";
  private final PrivateKey key;
  private final X509Certificate certificate;
  private LanIdentity(PrivateKey key, X509Certificate certificate) { this.key = key; this.certificate = certificate; }
  static LanIdentity load(String ip) throws Exception {
    KeyStore store = KeyStore.getInstance("AndroidKeyStore");
    store.load(null);
    if (!store.containsAlias(ALIAS)) {
      KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore");
      generator.initialize(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY)
        .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
        .setDigests(KeyProperties.DIGEST_SHA256).build());
      generator.generateKeyPair();
    }
    PrivateKey privateKey = (PrivateKey) store.getKey(ALIAS, null);
    byte[] publicKey = store.getCertificate(ALIAS).getPublicKey().getEncoded();
    byte[] algorithm = seq(der(6, new byte[]{42, (byte)134, 72, (byte)206, 61, 4, 3, 2}));
    byte[] name = seq(der(49, seq(der(6, new byte[]{85, 4, 3}), der(12, "MipyPOS LAN".getBytes(java.nio.charset.StandardCharsets.UTF_8)))));
    byte[] san = seq(der(6, new byte[]{85, 29, 17}), der(4, seq(der(135, InetAddress.getByName(ip).getAddress()))));
    long time = System.currentTimeMillis();
    byte[] tbs = seq(der(160, der(2, new byte[]{2})), der(2, new BigInteger(128, new SecureRandom()).add(BigInteger.ONE).toByteArray()),
      algorithm, name, seq(utc(new Date(time - 86400000L)), utc(new Date(time + 365L * 86400000L))), name, publicKey, der(163, seq(san)));
    Signature signer = Signature.getInstance("SHA256withECDSA");
    signer.initSign(privateKey); signer.update(tbs);
    byte[] signed = signer.sign();
    byte[] bitString = new byte[signed.length + 1];
    System.arraycopy(signed, 0, bitString, 1, signed.length);
    X509Certificate cert = (X509Certificate) CertificateFactory.getInstance("X.509").generateCertificate(new ByteArrayInputStream(seq(tbs, algorithm, der(3, bitString))));
    cert.checkValidity(); cert.verify(cert.getPublicKey());
    return new LanIdentity(privateKey, cert);
  }
  static String pin(X509Certificate cert) throws Exception {
    return Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(cert.getPublicKey().getEncoded()), Base64.NO_WRAP);
  }
  private static byte[] utc(Date date) {
    SimpleDateFormat format = new SimpleDateFormat("yyMMddHHmmss'Z'", Locale.US); format.setTimeZone(TimeZone.getTimeZone("UTC"));
    return der(23, format.format(date).getBytes(java.nio.charset.StandardCharsets.US_ASCII));
  }
  private static byte[] seq(byte[]... values) { return der(48, concat(values)); }
  private static byte[] concat(byte[]... values) {
    ByteArrayOutputStream output = new ByteArrayOutputStream();
    for (byte[] value : values) output.write(value, 0, value.length);
    return output.toByteArray();
  }
  private static byte[] der(int tag, byte[] value) {
    ByteArrayOutputStream output = new ByteArrayOutputStream(); output.write(tag);
    if (value.length < 128) output.write(value.length);
    else if (value.length < 256) { output.write(129); output.write(value.length); }
    else { output.write(130); output.write(value.length >> 8); output.write(value.length); }
    output.write(value, 0, value.length); return output.toByteArray();
  }
  @Override public String[] getClientAliases(String type, Principal[] issuers) { return null; }
  @Override public String chooseClientAlias(String[] types, Principal[] issuers, Socket socket) { return null; }
  @Override public String[] getServerAliases(String type, Principal[] issuers) { return "EC".equals(type) ? new String[]{ALIAS} : null; }
  @Override public String chooseServerAlias(String type, Principal[] issuers, Socket socket) { return "EC".equals(type) ? ALIAS : null; }
  @Override public String chooseEngineServerAlias(String type, Principal[] issuers, SSLEngine engine) { return "EC".equals(type) ? ALIAS : null; }
  @Override public X509Certificate[] getCertificateChain(String alias) { return ALIAS.equals(alias) ? new X509Certificate[]{certificate} : null; }
  @Override public PrivateKey getPrivateKey(String alias) { return ALIAS.equals(alias) ? key : null; }
  String pin() throws Exception { return pin(certificate); }
}
