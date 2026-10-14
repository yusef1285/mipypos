package com.mipypos.lan;

import android.net.Uri;
import com.facebook.react.bridge.*;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

public class MipyReceiptModule extends ReactContextBaseJavaModule {
  private final TextRecognizer recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
  public MipyReceiptModule(ReactApplicationContext context) { super(context); }
  @Override public String getName() { return "MipyReceipt"; }
  @ReactMethod public void recognize(String uri, Promise promise) {
    try {
      InputImage image = InputImage.fromFilePath(getReactApplicationContext(), Uri.parse(uri));
      recognizer.process(image).addOnSuccessListener(result -> promise.resolve(result.getText()))
        .addOnFailureListener(error -> promise.reject("OCR", "No se pudo leer el comprobante. Toma otra foto.", error));
    } catch (Exception error) { promise.reject("OCR", "No se pudo abrir la foto del comprobante.", error); }
  }
  @Override public void invalidate() { recognizer.close(); super.invalidate(); }
}
