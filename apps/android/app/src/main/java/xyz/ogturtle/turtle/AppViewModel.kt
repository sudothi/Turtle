package xyz.ogturtle.turtle

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import xyz.ogturtle.turtle.data.Api
import xyz.ogturtle.turtle.data.ApiException
import xyz.ogturtle.turtle.data.Channel
import xyz.ogturtle.turtle.data.Dm
import xyz.ogturtle.turtle.data.Friend
import xyz.ogturtle.turtle.data.Server
import xyz.ogturtle.turtle.data.Session
import xyz.ogturtle.turtle.data.Unread
import xyz.ogturtle.turtle.data.User

data class UiState(
    val booting: Boolean = true,
    val user: User? = null,
    val busy: Boolean = false,
    val error: String? = null,
    val servers: List<Server> = emptyList(),
    val channels: Map<String, List<Channel>> = emptyMap(),
    val dms: List<Dm> = emptyList(),
    val friends: List<Friend> = emptyList(),
    val unread: List<Unread> = emptyList(),
    val refreshing: Boolean = false,
)

class AppViewModel(app: Application) : AndroidViewModel(app) {
    private val session = Session(app)
    val api = Api(BuildConfig.SERVER_URL) { session.token }

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            if (session.token == null) {
                _state.update { it.copy(booting = false) }
            } else {
                try {
                    val me = api.me()
                    _state.update { it.copy(user = me, booting = false) }
                    refresh()
                } catch (e: ApiException) {
                    // Token recusado: volta para o login. Falha de rede (status 0): mantém a sessão e mostra o erro.
                    if (e.status == 401 || e.status == 403) session.token = null
                    _state.update { it.copy(booting = false, error = if (e.status == 0) e.message else null) }
                }
            }
        }
    }

    fun clearError() = _state.update { it.copy(error = null) }

    fun login(username: String, password: String) = auth { api.login(username.trim(), password) }

    fun register(inviteCode: String, username: String, password: String) =
        auth { api.register(inviteCode.trim(), username.trim(), password) }

    private fun auth(block: suspend () -> xyz.ogturtle.turtle.data.AuthResponse) {
        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null) }
            try {
                val res = block()
                session.token = res.token
                _state.update { it.copy(user = res.user, busy = false) }
                refresh()
            } catch (e: ApiException) {
                _state.update { it.copy(busy = false, error = e.message) }
            }
        }
    }

    fun logout() {
        session.token = null
        _state.value = UiState(booting = false)
    }

    /** Busca servidores, canais, conversas diretas, amigos e não lidas. */
    fun refresh() {
        viewModelScope.launch {
            _state.update { it.copy(refreshing = true) }
            try {
                val servers = api.servers()
                val channels = servers.associate { it.id to api.channels(it.id) }
                val dms = api.dms()
                val friends = api.friends()
                val unread = runCatching { api.unread() }.getOrDefault(emptyList())
                _state.update { it.copy(servers = servers, channels = channels, dms = dms, friends = friends, unread = unread, refreshing = false, error = null) }
            } catch (e: ApiException) {
                if (e.status == 401) logout() else _state.update { it.copy(refreshing = false, error = e.message) }
            }
        }
    }
}
