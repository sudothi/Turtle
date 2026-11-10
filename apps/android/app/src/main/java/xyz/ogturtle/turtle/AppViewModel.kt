package xyz.ogturtle.turtle

import android.app.Application
import android.net.Uri
import android.provider.OpenableColumns
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import xyz.ogturtle.turtle.data.Activity
import xyz.ogturtle.turtle.data.text
import xyz.ogturtle.turtle.data.Api
import xyz.ogturtle.turtle.data.ApiException
import xyz.ogturtle.turtle.data.Channel
import xyz.ogturtle.turtle.data.Dm
import xyz.ogturtle.turtle.data.Friend
import xyz.ogturtle.turtle.data.Member
import xyz.ogturtle.turtle.data.Message
import xyz.ogturtle.turtle.data.Realtime
import xyz.ogturtle.turtle.data.ServerEvent
import xyz.ogturtle.turtle.data.Server
import xyz.ogturtle.turtle.data.Session
import xyz.ogturtle.turtle.data.CallUi
import xyz.ogturtle.turtle.data.Unread
import xyz.ogturtle.turtle.data.User
import xyz.ogturtle.turtle.data.VoiceController
import xyz.ogturtle.turtle.data.VoiceState

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
    /** Mensagens carregadas por canal/conversa (ordem cronológica). */
    val messages: Map<String, List<Message>> = emptyMap(),
    /** Canais cujo histórico inteiro já foi carregado (não há mais mensagens antigas). */
    val fullyLoaded: Set<String> = emptySet(),
    /** Conversa aberta na tela agora (para não marcar como não lida). */
    val openChannelId: String? = null,
    val connected: Boolean = false,
    /** Membros por servidor (carregados quando a pessoa entra no servidor). */
    val members: Map<String, List<Member>> = emptyMap(),
    val online: Set<String> = emptySet(),
    /** Quem está em Não perturbe. */
    val dnd: Set<String> = emptySet(),
    /** Jogo de quem está jogando (vem na presença; o Android não informa o próprio). */
    val activities: Map<String, Activity> = emptyMap(),
    /** Enviando anexos (mostra a barra de progresso no chat). */
    val uploading: Boolean = false,
    /** Quem está em cada chamada de voz (de todos os meus servidores e conversas). */
    val voiceStates: List<VoiceState> = emptyList(),
    /** Chamadas tocando agora (DM e grupo). */
    val ringing: List<ServerEvent.Ring> = emptyList(),
    /** A chamada em que estou agora (null = fora de chamada). */
    val call: CallUi? = null,
)

/** Limites do servidor (packages/protocol): 25 MB por arquivo, 10 por mensagem. */
internal const val MAX_FILE_BYTES = 25 * 1024 * 1024
internal const val MAX_FILES = 10

/** Aceita o código puro ou o link inteiro do convite (pega o que vem depois da última barra). */
internal fun inviteCode(text: String): String = text.trim().trimEnd('/').substringAfterLast('/').trim()

/** Anexa uma mensagem sem duplicar (o servidor pode reenviar após reconectar). */
/** Envio esperando a confirmação do servidor (reenviado com o mesmo nonce se a conexão cair). */
internal data class PendingSend(val channelId: String, val content: String, val attachments: List<String>, val replyTo: String?)

internal fun List<Message>.withMessage(m: Message): List<Message> = if (any { it.id == m.id }) this else this + m

/**
 * Linha de atividade: jogo, ou "Em chamada" (só chamadas que o servidor já me mostra).
 * Com [place] (no perfil), diz onde: "Em chamada em #sala · Servidor"; nas listas fica só "Em chamada".
 */
fun UiState.activityOf(userId: String, place: Boolean = false): String? {
    activities[userId]?.let { a -> return a.text() }
    val v = voiceStates.firstOrNull { it.userId == userId } ?: return null
    if (!place) return "Em chamada"
    val sid = v.serverId ?: return "Em chamada em uma conversa"
    val ch = channels[sid]?.firstOrNull { it.id == v.channelId }?.name ?: "voz"
    val srv = servers.firstOrNull { it.id == sid }?.name
    return "Em chamada em #$ch" + (srv?.let { " · $it" } ?: "")
}

class AppViewModel(app: Application) : AndroidViewModel(app) {
    private val session = Session(app)
    val api = Api(BuildConfig.SERVER_URL, onUnauthorized = ::clearSession) { session.token }

    private val _state = MutableStateFlow(UiState())
    private val pending = LinkedHashMap<String, PendingSend>()
    val state: StateFlow<UiState> = _state.asStateFlow()

    private val realtime = Realtime(
        baseUrl = BuildConfig.SERVER_URL,
        token = { session.token },
        scope = viewModelScope,
        onEvent = ::onEvent,
        onOpen = {
            _state.update { it.copy(connected = true) }
            pushVoice() // o servidor esquece a chamada se a conexão cai; avisa de novo
            // Reenvia o que não foi confirmado (o servidor ignora nonce repetido).
            synchronized(pending) { pending.toMap() }.forEach { (nonce, p) -> realtime.send(p.channelId, p.content, p.attachments, p.replyTo, nonce) }
            // Reabriu a conexão (ou abriu agora): pode ter perdido mensagens enquanto estava fora.
            refresh()
            _state.value.openChannelId?.let { id -> reloadMessages(id) }
        },
        onUnauthorized = ::clearSession,
    )

    val voice = VoiceController(app, viewModelScope)

    init {
        CallService.onHangUp = { leaveCall() }
        voice.onDropped = ::rejoinCall
        // Toda mudança na minha chamada (entrar, sair, mudo, fone, câmera) vai para o servidor e para a tela.
        viewModelScope.launch {
            var last: List<Any?>? = null
            voice.call.collect { c ->
                _state.update { it.copy(call = c) }
                val key = listOf(c?.channelId, c?.muted, c?.deafened, c?.cameraOn)
                if (key != last) {
                    last = key
                    pushVoice()
                }
            }
        }
        viewModelScope.launch {
            if (session.token == null) {
                _state.update { it.copy(booting = false) }
            } else {
                try {
                    val me = api.me()
                    _state.update { it.copy(user = me, booting = false) }
                    refresh()
                    realtime.start()
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
                realtime.start()
            } catch (e: ApiException) {
                _state.update { it.copy(busy = false, error = e.message) }
            }
        }
    }

    private fun pushVoice() {
        val c = voice.call.value
        realtime.sendVoice(c?.channelId, c?.muted ?: false, c?.deafened ?: false, c?.cameraOn ?: false)
    }

    // ---- Chamadas ----

    /** Entra na chamada de voz do canal (as permissões já foram pedidas pela tela). */
    fun joinCall(channelId: String) {
        if (_state.value.call?.channelId == channelId) return
        viewModelScope.launch {
            try {
                val t = api.voiceToken(channelId)
                CallService.start(getApplication())
                voice.join(channelId, t.url, t.token)
            } catch (e: ApiException) {
                CallService.stop(getApplication())
                _state.update { it.copy(error = e.message) }
            } catch (e: Exception) {
                CallService.stop(getApplication())
                _state.update { it.copy(error = "Não foi possível entrar na chamada: ${e.message ?: "erro desconhecido"}") }
            }
        }
    }

    /** A chamada caiu sem a pessoa sair: tenta voltar com espera crescente (pouco mais de 2 min no total, igual ao web). */
    private var rejoin: kotlinx.coroutines.Job? = null
    private fun rejoinCall(channelId: String) {
        rejoin?.cancel()
        rejoin = viewModelScope.launch {
            for (wait in listOf(1_000L, 2_000L, 4_000L, 8_000L, 15_000L, 30_000L, 30_000L, 30_000L)) {
                kotlinx.coroutines.delay(wait)
                if (_state.value.user == null || _state.value.call != null) return@launch
                try {
                    val t = api.voiceToken(channelId)
                    voice.join(channelId, t.url, t.token)
                    return@launch
                } catch (e: ApiException) {
                    if (e.status in 400..499) break // sem permissão ou canal apagado: não adianta insistir
                } catch (_: Exception) {
                }
            }
            CallService.stop(getApplication())
            _state.update { it.copy(error = "A chamada caiu e não deu para voltar.") }
        }
    }

    fun leaveCall() {
        rejoin?.cancel()
        voice.leave()
        CallService.stop(getApplication())
    }

    fun toggleMute() = voice.call.value?.let { voice.setMuted(!it.muted) }
    fun toggleDeafen() = voice.call.value?.let { voice.setDeafened(!it.deafened) }
    fun toggleCamera() {
        val on = voice.call.value?.cameraOn ?: return
        voice.setCamera(!on) { ok -> if (!ok) _state.update { it.copy(error = "Não foi possível ligar a câmera.") } }
    }

    override fun onCleared() {
        voice.leave()
        CallService.stop(getApplication())
    }

    private fun clearSession() {
        leaveCall()
        realtime.stop()
        session.token = null
        _state.value = UiState(booting = false)
    }

    fun logout() {
        val tok = session.token
        clearSession()
        if (tok != null) viewModelScope.launch { runCatching { api.logout(tok) } }
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
                val members = _state.value.members.keys.filter { id -> servers.any { it.id == id } }.associateWith { api.members(it) }
                _state.update { it.copy(servers = servers, channels = channels, dms = dms, friends = friends, unread = unread, members = members, refreshing = false, error = null) }
            } catch (e: ApiException) {
                if (e.status == 401) logout() else _state.update { it.copy(refreshing = false, error = e.message) }
            }
        }
    }

    // ---- Conversas ----

    /** Chamado quando a tela de uma conversa abre (id) ou fecha (null). */
    fun openChannel(id: String?) {
        _state.update { st -> st.copy(openChannelId = id, unread = if (id == null) st.unread else st.unread.filterNot { it.channelId == id }) }
        if (id == null) return
        viewModelScope.launch {
            if (_state.value.messages[id] == null) reloadMessages(id)
            runCatching { api.markRead(id) }
        }
    }

    private fun reloadMessages(id: String) {
        viewModelScope.launch {
            try {
                val list = api.messages(id)
                _state.update { it.copy(messages = it.messages + (id to list), fullyLoaded = if (list.size < 50) it.fullyLoaded + id else it.fullyLoaded - id) }
            } catch (e: ApiException) {
                _state.update { it.copy(error = e.message) }
            }
        }
    }

    /** Busca as mensagens mais antigas que as já carregadas. */
    fun loadOlder(id: String) {
        val st = _state.value
        val current = st.messages[id] ?: return
        if (id in st.fullyLoaded || current.isEmpty()) return
        viewModelScope.launch {
            try {
                val older = api.messages(id, before = current.first().createdAt)
                _state.update {
                    val merged = older + (it.messages[id] ?: emptyList())
                    it.copy(messages = it.messages + (id to merged), fullyLoaded = if (older.size < 50) it.fullyLoaded + id else it.fullyLoaded)
                }
            } catch (e: ApiException) {
                _state.update { it.copy(error = e.message) }
            }
        }
    }

    /** Guarda o envio até o servidor confirmar; sem conexão, sai quando o socket voltar. */
    private fun queueSend(channelId: String, content: String, attachments: List<String>, replyTo: String?) {
        val nonce = java.util.UUID.randomUUID().toString()
        synchronized(pending) { pending[nonce] = PendingSend(channelId, content, attachments, replyTo) }
        if (!realtime.send(channelId, content, attachments, replyTo, nonce)) {
            _state.update { it.copy(error = "Sem conexão. A mensagem sai quando a conexão voltar.") }
        }
    }

    fun send(channelId: String, text: String, files: List<Uri> = emptyList(), replyTo: String? = null) {
        val content = text.trim()
        if (files.isEmpty()) {
            if (content.isEmpty()) return
            queueSend(channelId, content, emptyList(), replyTo)
            return
        }
        if (files.size > MAX_FILES) {
            _state.update { it.copy(error = "No máximo $MAX_FILES arquivos por mensagem.") }
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(uploading = true) }
            try {
                val resolver = getApplication<Application>().contentResolver
                val ids = mutableListOf<String>()
                for (uri in files) {
                    val (name, mime, bytes) = withContext(Dispatchers.IO) {
                        var name = "arquivo"
                        var size = -1L
                        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
                            if (c.moveToFirst()) {
                                c.getColumnIndex(OpenableColumns.DISPLAY_NAME).takeIf { it >= 0 }?.let { i -> c.getString(i)?.takeIf { it.isNotBlank() }?.let { name = it } }
                                c.getColumnIndex(OpenableColumns.SIZE).takeIf { it >= 0 && !c.isNull(it) }?.let { size = c.getLong(it) }
                            }
                        }
                        // Confere o tamanho antes de ler tudo para a memória.
                        if (size > MAX_FILE_BYTES) throw ApiException("Arquivo grande demais (máximo 25 MB): $name")
                        val bytes = runCatching { resolver.openInputStream(uri)?.use { it.readBytes() } }.getOrNull()
                            ?: throw ApiException("Não foi possível ler o arquivo $name.")
                        if (bytes.size > MAX_FILE_BYTES) throw ApiException("Arquivo grande demais (máximo 25 MB): $name")
                        Triple(name, resolver.getType(uri) ?: "application/octet-stream", bytes)
                    }
                    ids += api.uploadAttachment(channelId, name, mime, bytes).id
                }
                queueSend(channelId, content, ids, replyTo)
            } catch (e: ApiException) {
                _state.update { it.copy(error = e.message) }
            } finally {
                _state.update { it.copy(uploading = false) }
            }
        }
    }

    /** Aplica uma mensagem editada na lista carregada do canal. */
    private fun applyUpdate(m: Message) = _state.update { cur ->
        val list = cur.messages[m.channelId] ?: return@update cur
        cur.copy(messages = cur.messages + (m.channelId to list.map { if (it.id == m.id) m else it }))
    }

    private fun applyDelete(channelId: String, id: String) = _state.update { cur ->
        val list = cur.messages[channelId] ?: return@update cur
        cur.copy(messages = cur.messages + (channelId to list.filterNot { it.id == id }))
    }

    fun editMessage(id: String, content: String) {
        val text = content.trim()
        if (text.isEmpty()) return
        launchCatching { applyUpdate(api.editMessage(id, text)) }
    }

    fun deleteMessage(channelId: String, id: String) = launchCatching {
        api.deleteMessage(id)
        applyDelete(channelId, id)
    }

    /** Roda a chamada e mostra o erro (em português, vindo do servidor) na faixa do topo. */
    private fun launchCatching(block: suspend () -> Unit) {
        viewModelScope.launch {
            try {
                block()
            } catch (e: ApiException) {
                if (e.status != 401) _state.update { it.copy(error = e.message) }
            }
        }
    }

    private fun endRing(channelId: String) {
        _state.update { it.copy(ringing = it.ringing.filterNot { r -> r.channelId == channelId }) }
        Ringer.stop(getApplication(), channelId)
    }

    /** Atendi (a tela abre a chamada) ou fechei o cartão: para de tocar aqui. */
    fun dismissRing(channelId: String) = endRing(channelId)

    fun declineRing(channelId: String) {
        realtime.sendRingDecline(channelId)
        endRing(channelId)
    }

    private fun onEvent(e: ServerEvent) {
        when (e) {
            is ServerEvent.NewMessage -> {
                e.nonce?.let { synchronized(pending) { pending.remove(it) } }
                val m = e.message
                val st = _state.value
                val known = st.channels.values.any { list -> list.any { it.id == m.channelId } } || st.dms.any { it.channelId == m.channelId }
                if (!known) refresh()
                _state.update { cur ->
                    val loaded = cur.messages[m.channelId]
                    val isOpen = cur.openChannelId == m.channelId
                    val mine = m.userId == cur.user?.id
                    cur.copy(
                        messages = if (loaded != null) cur.messages + (m.channelId to loaded.withMessage(m)) else cur.messages,
                        unread = if (isOpen || mine) cur.unread else bump(cur, m),
                    )
                }
                if (_state.value.openChannelId == m.channelId) viewModelScope.launch { runCatching { api.markRead(m.channelId) } }
            }
            is ServerEvent.MessageUpdate -> applyUpdate(e.message)
            is ServerEvent.MessageDelete -> applyDelete(e.channelId, e.id)
            is ServerEvent.Read -> _state.update { cur -> cur.copy(unread = cur.unread.filterNot { it.channelId == e.channelId }) }
            is ServerEvent.VoiceStates -> _state.update { it.copy(voiceStates = e.states) }
            is ServerEvent.Ring -> {
                _state.update { it.copy(ringing = it.ringing.filterNot { r -> r.channelId == e.channelId } + e) }
                Ringer.ring(getApplication(), e)
            }
            is ServerEvent.RingEnd -> endRing(e.channelId)
            is ServerEvent.RingDeclined -> _state.update { it.copy(error = "Chamada recusada") }
            is ServerEvent.Presence -> _state.update { it.copy(online = e.online, dnd = e.busy, activities = e.activities) }
            ServerEvent.Refresh -> refresh()
            is ServerEvent.Error -> {
                e.nonce?.let { synchronized(pending) { pending.remove(it) } }
                _state.update { it.copy(error = e.text) }
            }
        }
    }

    private fun bump(cur: UiState, m: Message): List<Unread> {
        val existing = cur.unread.firstOrNull { it.channelId == m.channelId }
        // Resposta a uma mensagem minha conta como menção.
        val mention = if (m.replyTo != null && m.replyTo.userId == cur.user?.id) 1 else 0
        if (existing != null) return cur.unread.map { if (it.channelId == m.channelId) it.copy(count = it.count + 1, mentions = it.mentions + mention) else it }
        val serverId = cur.channels.entries.firstOrNull { (_, list) -> list.any { it.id == m.channelId } }?.key
        return cur.unread + Unread(m.channelId, serverId, 1, mention)
    }

    // ---- Membros e perfis ----

    fun loadMembers(serverId: String) {
        viewModelScope.launch {
            try {
                val list = api.members(serverId)
                _state.update { it.copy(members = it.members + (serverId to list)) }
            } catch (e: ApiException) {
                _state.update { it.copy(error = e.message) }
            }
        }
    }

    /** Abre (ou cria) a conversa direta com a pessoa e devolve o id do canal. */
    fun openDm(userId: String, onReady: (String) -> Unit) {
        viewModelScope.launch {
            try {
                val dm = api.openDm(userId)
                _state.update { st -> st.copy(dms = if (st.dms.any { it.channelId == dm.channelId }) st.dms else listOf(dm) + st.dms) }
                onReady(dm.channelId)
            } catch (e: ApiException) {
                _state.update { it.copy(error = e.message) }
            }
        }
    }

    fun setFriend(userId: String, add: Boolean, onDone: () -> Unit) {
        viewModelScope.launch {
            try {
                if (add) api.addFriend(userId) else api.removeFriend(userId)
                refresh()
                onDone()
            } catch (e: ApiException) {
                _state.update { it.copy(error = e.message) }
            }
        }
    }

    fun addFriendByName(username: String, onDone: (String) -> Unit) {
        val name = username.trim().removePrefix("@")
        if (name.isEmpty()) return
        launchCatching {
            val status = api.addFriendByName(name)
            refresh()
            onDone(status)
        }
    }

    // ---- Minha conta ----

    /** "online" ou "busy" (Não perturbe). */
    fun setStatus(status: String) = launchCatching {
        val me = api.setStatus(status)
        _state.update { it.copy(user = me) }
    }

    /** Campos vazios voltam ao padrão (apaga o nome de exibição / a bio). */
    fun updateProfile(displayName: String, bio: String, onDone: () -> Unit) = launchCatching {
        val me = api.updateProfile(displayName.trim().ifEmpty { null }, bio.trim().ifEmpty { null })
        _state.update { it.copy(user = me) }
        onDone()
    }

    // ---- Servidores e canais ----

    fun createChannel(serverId: String, name: String, kind: String, onDone: (Channel) -> Unit) = launchCatching {
        val ch = api.createChannel(serverId, name.trim(), kind)
        _state.update { cur ->
            val list = cur.channels[serverId].orEmpty()
            cur.copy(channels = cur.channels + (serverId to if (list.any { it.id == ch.id }) list else list + ch))
        }
        onDone(ch)
    }

    fun createServer(name: String, onDone: (Server) -> Unit) = launchCatching {
        val server = api.createServer(name.trim())
        addServer(server)
        onDone(server)
    }

    fun joinInvite(text: String, onDone: (Server) -> Unit) {
        val code = inviteCode(text)
        if (code.isEmpty()) return
        launchCatching {
            val server = api.joinInvite(code)
            addServer(server)
            onDone(server)
        }
    }

    /** Já mostra o servidor novo na barra (com os canais) antes do refresh completo. */
    private suspend fun addServer(server: Server) {
        val channels = runCatching { api.channels(server.id) }.getOrDefault(emptyList())
        _state.update { cur ->
            cur.copy(
                servers = if (cur.servers.any { it.id == server.id }) cur.servers else cur.servers + server,
                channels = cur.channels + (server.id to channels),
            )
        }
        refresh()
    }
}
