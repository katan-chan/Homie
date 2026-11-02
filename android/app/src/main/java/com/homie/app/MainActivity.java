package com.homie.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MomentSaverPlugin.class);
        registerPlugin(LocationSharePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
