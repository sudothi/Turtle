package xyz.ogturtle.app;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.view.WindowManager;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Ponte entre o app web e o Android para chamadas: o site chama start() ao entrar numa chamada e
 * stop() ao sair (window.Capacitor.Plugins.TurtleCall).
 */
@CapacitorPlugin(
    name = "TurtleCall",
    permissions = {
        @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone"),
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications")
    }
)
public class TurtleCallPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        // O Android 14+ só deixa um serviço de microfone começar com a permissão já concedida;
        // por isso ela é pedida aqui, antes de o site pedir o microfone.
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "afterMicrophone");
            return;
        }
        askNotifications(call);
    }

    @PermissionCallback
    private void afterMicrophone(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            JSObject out = new JSObject();
            out.put("started", false);
            out.put("reason", "microphone");
            call.resolve(out);
            return;
        }
        askNotifications(call);
    }

    private void askNotifications(PluginCall call) {
        // Sem a permissão de notificações o serviço roda do mesmo jeito, só sem o aviso na barra.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && getPermissionState("notifications") == PermissionState.PROMPT) {
            requestPermissionForAlias("notifications", call, "afterNotifications");
            return;
        }
        begin(call);
    }

    @PermissionCallback
    private void afterNotifications(PluginCall call) {
        begin(call);
    }

    private void begin(PluginCall call) {
        Intent intent = new Intent(getContext(), CallService.class);
        intent.putExtra(CallService.EXTRA_TITLE, call.getString("title", "Turtle"));
        intent.putExtra(CallService.EXTRA_TEXT, call.getString("text", "Chamada em andamento"));
        try {
            ContextCompat.startForegroundService(getContext(), intent);
        } catch (RuntimeException e) {
            call.reject("Não deu para iniciar o serviço da chamada: " + e.getMessage());
            return;
        }
        // Tela acesa enquanto o app está aberto na chamada (travar a tela continua funcionando).
        getActivity().runOnUiThread(() -> getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON));
        JSObject out = new JSObject();
        out.put("started", true);
        call.resolve(out);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), CallService.class));
        getActivity().runOnUiThread(() -> getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON));
        call.resolve();
    }
}
