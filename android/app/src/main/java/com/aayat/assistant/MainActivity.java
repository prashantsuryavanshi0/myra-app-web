package com.aayat.assistant;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    WakeWordService wake;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DeviceControlPlugin.class);
        super.onCreate(savedInstanceState);
        wake = new WakeWordService(this);
    }

    void emitWake(String rest) {
        if (DeviceControlPlugin.instance != null) DeviceControlPlugin.instance.emitWake(rest);
    }
}
