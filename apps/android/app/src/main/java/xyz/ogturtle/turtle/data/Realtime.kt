package xyz.ogturtle.turtle.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit

/** Eventos que o servidor manda pelo WebSocket (ver serverEvent em packages/protocol). */
sealed interface ServerEvent {
    data class NewMessage(val message: Message) : ServerEvent
    data class MessageUpdate(val message: Message) : ServerEvent
    data class MessageDelete(val channelId: String, val id: String) : ServerEvent
    data class Read(val channelId: String) : ServerEvent
    /** Servidores, canais, membros, amigos ou conversas mudaram: buscar de novo. */
    data object Refresh : ServerEvent
    /** ids das pessoas conectadas; `busy` = as que estão em Não perturbe. */
    data class Presence(val online: Set<String>, val busy: Set<String>) : ServerEvent
    data class VoiceStates(val states: List<VoiceState>) : ServerEvent
    data class Error(val text: String) : ServerEvent
}

private fun ids(e: kotlinx.serialization.json.JsonElement?): Set<String> =
    (e as? kotlinx.serialization.json.JsonArray)?.mapNotNull { it.jsonPrimitive.contentOrNull }?.toSet() ?: emptySet()

fun parseServerEvent(text: String): ServerEvent? {
    val o = runCatching { TurtleJson.parseToJsonElement(text).jsonObject }.getOrNull() ?: return null
    fun str(k: String) = o[k]?.jsonPrimitive?.contentOrNull
    return runCatching {
        when (str("t")) {
            "message" -> ServerEvent.NewMessage(TurtleJson.decodeFromJsonElement(Message.serializer(), o["message"]!!))
            "messageUpdate" -> ServerEvent.MessageUpdate(TurtleJson.decodeFromJsonElement(Message.serializer(), o["message"]!!))
            "messageDelete" -> ServerEvent.MessageDelete(str("channelId")!!, str("id")!!)
            "read" -> ServerEvent.Read(str("channelId")!!)
            "sync", "friends", "channel" -> ServerEvent.Refresh
            "presence" -> ServerEvent.Presence(ids(o["online"]), ids(o["busy"]))
            "voiceStates" -> ServerEvent.VoiceStates(
                TurtleJson.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(VoiceState.serializer()), o["states"]!!),
            )
            "error" -> ServerEvent.Error(str("error") ?: "erro")
            else -> null
        }
    }.getOrNull()
}

/** Conexão WebSocket com o servidor; reconecta sozinha (com espera crescente) se cair. */
class Realtime(
    private val baseUrl: String,
    private val token: () -> String?,
    private val scope: CoroutineScope,
    private val onEvent: (ServerEvent) -> Unit,
    private val onOpen: () -> Unit,
) {
    private val http = OkHttpClient.Builder().pingInterval(25, TimeUnit.SECONDS).build()
    private var socket: WebSocket? = null
    private var loop: Job? = null

    fun start() {
        if (loop?.isActive == true) return
        loop = scope.launch {
            var wait = 1_000L
            while (isActive) {
                val t = token() ?: return@launch
                val closed = kotlinx.coroutines.CompletableDeferred<Boolean>()
                val url = baseUrl.trimEnd('/').replaceFirst("http", "ws") + "/ws?token=" + java.net.URLEncoder.encode(t, "UTF-8")
                socket = http.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
                    override fun onOpen(webSocket: WebSocket, response: Response) {
                        wait = 1_000L
                        onOpen()
                    }

                    override fun onMessage(webSocket: WebSocket, text: String) {
                        parseServerEvent(text)?.let(onEvent)
                    }

                    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                        closed.complete(code != 4401)
                    }

                    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                        closed.complete(true)
                    }
                })
                val retry = closed.await()
                socket = null
                if (!retry) return@launch
                delay(wait)
                wait = (wait * 2).coerceAtMost(30_000L)
            }
        }
    }

    fun stop() {
        loop?.cancel()
        loop = null
        socket?.close(1000, null)
        socket = null
    }

    /** Envia uma mensagem (texto e/ou ids de anexos já enviados). Devolve false se não está conectado. */
    fun send(channelId: String, content: String, attachments: List<String> = emptyList()): Boolean {
        val json = JsonObject(
            mapOf(
                "t" to JsonPrimitive("send"),
                "channelId" to JsonPrimitive(channelId),
                "content" to JsonPrimitive(content),
                "attachments" to kotlinx.serialization.json.JsonArray(attachments.map { JsonPrimitive(it) }),
            ),
        )
        return socket?.send(json.toString()) ?: false
    }

    /** Diz ao servidor em qual chamada estou (canal null = saí) e o estado do microfone, fone e câmera. */
    fun sendVoice(channelId: String?, muted: Boolean, deafened: Boolean, camera: Boolean): Boolean {
        val json = JsonObject(
            mapOf(
                "t" to JsonPrimitive("voice"),
                "channelId" to (channelId?.let { JsonPrimitive(it) } ?: kotlinx.serialization.json.JsonNull),
                "muted" to JsonPrimitive(muted),
                "deafened" to JsonPrimitive(deafened),
                "camera" to JsonPrimitive(camera),
                "screen" to JsonPrimitive(false),
            ),
        )
        return socket?.send(json.toString()) ?: false
    }
}
