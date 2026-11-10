package xyz.ogturtle.turtle.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import xyz.ogturtle.turtle.AppViewModel
import xyz.ogturtle.turtle.R
import xyz.ogturtle.turtle.UiState
import xyz.ogturtle.turtle.ui.theme.Ink

@Composable
fun AuthScreen(state: UiState, vm: AppViewModel) {
    var creating by rememberSaveable { mutableStateOf(false) }
    var invite by rememberSaveable { mutableStateOf("") }
    var username by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }

    Column(
        Modifier
            .fillMaxSize()
            .safeDrawingPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 28.dp, vertical = 24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Image(painterResource(R.drawable.turtle_mark), contentDescription = null, modifier = Modifier.size(112.dp))
        Spacer(Modifier.height(12.dp))
        Text("Turtle", style = MaterialTheme.typography.headlineMedium)
        Text(
            if (creating) "Crie sua conta com um convite." else "Entre para falar com a galera.",
            color = Ink.Muted,
            modifier = Modifier.padding(top = 4.dp, bottom = 24.dp),
        )

        if (creating) {
            Field("Código do convite", invite, { invite = it })
            // Convite de conta com servidor: avisa onde a pessoa vai cair.
            var serverName by remember { mutableStateOf<String?>(null) }
            LaunchedEffect(invite) {
                serverName = null
                val code = xyz.ogturtle.turtle.inviteCode(invite)
                if (code.isEmpty()) return@LaunchedEffect
                kotlinx.coroutines.delay(400)
                serverName = vm.api.accountInviteServer(code)
            }
            serverName?.let { Text("Você vai entrar direto em $it", color = Ink.Paper, modifier = Modifier.padding(bottom = 8.dp)) }
        }
        Field("Usuário", username, { username = it })
        Field("Senha", password, { password = it }, password = true)

        state.error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 4.dp)) }
        Spacer(Modifier.height(16.dp))

        val ready = username.isNotBlank() && password.isNotEmpty() && (!creating || invite.isNotBlank())
        Button(
            onClick = { if (creating) vm.register(invite, username, password) else vm.login(username, password) },
            enabled = ready && !state.busy,
            modifier = Modifier.fillMaxWidth().height(52.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Ink.Paper, contentColor = Ink.Ink0),
        ) {
            if (state.busy) CircularProgressIndicator(Modifier.size(20.dp), color = Ink.Ink0, strokeWidth = 2.dp)
            else Text(if (creating) "Criar conta" else "Entrar", style = MaterialTheme.typography.labelLarge)
        }
        TextButton(onClick = { creating = !creating; vm.clearError() }) {
            Text(if (creating) "Já tenho conta" else "Tenho um convite", color = Ink.PaperDim)
        }
    }
}

@Composable
private fun Field(label: String, value: String, onChange: (String) -> Unit, password: Boolean = false) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label) },
        singleLine = true,
        visualTransformation = if (password) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = if (password) KeyboardType.Password else KeyboardType.Text),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = Ink.Paper,
            unfocusedBorderColor = Ink.Line,
            focusedLabelColor = Ink.Paper,
            unfocusedLabelColor = Ink.Muted,
            cursorColor = Ink.Paper,
            focusedContainerColor = Ink.Ink3,
            unfocusedContainerColor = Ink.Ink3,
        ),
        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
    )
}
