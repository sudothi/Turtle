package xyz.ogturtle.turtle

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
        setContent { TurtleTheme { Root(vm) } }
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
