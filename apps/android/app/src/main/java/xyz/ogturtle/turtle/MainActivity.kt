package xyz.ogturtle.turtle

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import xyz.ogturtle.turtle.ui.HomeScreen
import xyz.ogturtle.turtle.ui.AuthScreen
import xyz.ogturtle.turtle.ui.theme.TurtleTheme

class MainActivity : ComponentActivity() {
    private val vm: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        vm.openLink(intent?.dataString)
        setContent { TurtleTheme { Root(vm) } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        vm.openLink(intent.dataString)
    }

    override fun onStart() {
        super.onStart()
        AppViewModel.foreground = true
    }

    override fun onStop() {
        AppViewModel.foreground = false
        super.onStop()
    }
}

@Composable
private fun Root(vm: AppViewModel) {
    val state by vm.state.collectAsStateWithLifecycle()
    when {
        state.booting -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
        state.user == null -> AuthScreen(state, vm)
        else -> HomeScreen(state, vm)
    }
}
