package com.mipypos.lan;

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;
import java.util.Collections;
import java.util.List;

public class MipyLanPackage implements ReactPackage {
  @Override public List<NativeModule> createNativeModules(ReactApplicationContext context) {
    return java.util.Arrays.asList(new MipyLanModule(context), new MipyTlsModule(context), new MipyReceiptModule(context), new MipyDirectModule(context), new MipyDiscoveryModule(context), new MipyPasswordModule(context));
  }
  @Override public List<ViewManager> createViewManagers(ReactApplicationContext context) {
    return Collections.emptyList();
  }
}
