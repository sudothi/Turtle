package xyz.ogturtle.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin da chamada: serviço em primeiro plano para o áudio continuar com a tela bloqueada.
        registerPlugin(TurtleCallPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
