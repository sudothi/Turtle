package xyz.ogturtle.turtle.data

import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer

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
    /** `nonce`: o envio meu que esta mensagem confirma. */
    data class NewMessage(val message: Message, val nonce: String? = null) : ServerEvent
    data class MessageUpdate(val message: Message) : ServerEvent
    data class MessageDelete(val channelId: String, val id: String) : ServerEvent
    data class Read(val channelId: String) : ServerEvent
    /** Servidores, canais, membros, amigos ou conversas mudaram: buscar de novo. */
    data object Refresh : ServerEvent
    /** ids das pessoas conectadas; `busy` = as que estão em Não perturbe. */
    data class Presence(val online: Set<String>, val busy: Set<String>, val activities: Map<String, Activity> = emptyMap()) : ServerEvent
    data class VoiceStates(val states: List<VoiceState>) : ServerEvent
    /** `nonce`: o envio que falhou. */
    data class Error(val text: String, val nonce: String? = null) : ServerEvent
    /** Alguém está te ligando numa DM ou grupo. `silent` = você está em Não perturbe (só notificar). */
    data class Ring(val channelId: String, val fromId: String, val fromName: String, val silent: Boolean) : ServerEvent
    data class RingEnd(val channelId: String) : ServerEvent
    data class RingDeclined(val channelId: String) : ServerEvent
}

private fun ids(e: kotlinx.serialization.json.JsonElement?): Set<String> =
    (e as? kotlinx.serialization.json.JsonArray)?.mapNotNull { it.jsonPrimitive.contentOrNull }?.toSet() ?: emptySet()

private val activityMap = MapSerializer(String.serializer(), Activity.serializer())
/** Jogo de cada pessoa visível; campo ausente ou estranho vira mapa vazio (não derruba o evento). */
private fun activities(e: kotlinx.serialization.json.JsonElement?): Map<String, Activity> =
    if (e == null) emptyMap() else runCatching { TurtleJson.decodeFromJsonElement(activityMap, e) }.getOrDefault(emptyMap())

fun parseServerEvent(text: String): ServerEvent? {
    val o = runCatching { TurtleJson.parseToJsonElement(text).jsonObject }.getOrNull() ?: return null
    fun str(k: String) = o[k]?.jsonPrimitive?.contentOrNull
    return runCatching {
        when (str("t")) {
            "message" -> ServerEvent.NewMessage(TurtleJson.decodeFromJsonElement(Message.serializer(), o["message"]!!), str("nonce"))
            "messageUpdate" -> ServerEvent.MessageUpdate(TurtleJson.decodeFromJsonElement(Message.serializer(), o["message"]!!))
            "messageDelete" -> ServerEvent.MessageDelete(str("channelId")!!, str("id")!!)
            "read" -> ServerEvent.Read(str("channelId")!!)
            "sync", "friends", "channel", "userUpdate" -> ServerEvent.Refresh // userUpdate só chega a quem divide servidor/DM/amizade
            "presence" -> ServerEvent.Presence(ids(o["online"]), ids(o["busy"]), activities(o["activities"]))
            "voiceStates" -> ServerEvent.VoiceStates(
                TurtleJson.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(VoiceState.serializer()), o["states"]!!),
            )
            "error" -> ServerEvent.Error(str("error") ?: "erro", str("nonce"))
            "ring" -> {
                val from = o["from"]!!.jsonObject
                fun f(k: String) = from[k]?.jsonPrimitive?.contentOrNull
                ServerEvent.Ring(
                    str("channelId")!!, f("id")!!,
                    f("displayName")?.takeIf { it.isNotBlank() } ?: f("username") ?: "Alguém",
                    o["silent"]?.jsonPrimitive?.contentOrNull == "true",
                )
            }
            "ringEnd" -> ServerEvent.RingEnd(str("channelId")!!)
            "ringDeclined" -> ServerEvent.RingDeclined(str("channelId")!!)
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
    private val onUnauthorized: () -> Unit = {},
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
                // O token vai na primeira mensagem, não na URL (não aparece em logs de proxy).
                val url = baseUrl.trimEnd('/').replaceFirst("http", "ws") + "/ws"
                socket = http.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
                    override fun onOpen(webSocket: WebSocket, response: Response) {
                        wait = 1_000L
                        webSocket.send(JsonObject(mapOf("t" to JsonPrimitive("auth"), "token" to JsonPrimitive(t))).toString())
                        onOpen()
                    }

                    override fun onMessage(webSocket: WebSocket, text: String) {
                        parseServerEvent(text)?.let(onEvent)
                    }

                    override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                        webSocket.close(code, null)
                        if (code == 4401) {
                            closed.complete(false)
                            onUnauthorized()
                        }
                    }

                    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                        if (code == 4401) onUnauthorized()
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

    /**
     * Envia uma mensagem (texto e/ou ids de anexos já enviados). Devolve false se não está conectado.
     * `nonce` deixa reenviar sem duplicar: o servidor ignora o mesmo nonce repetido.
     */
    fun send(channelId: String, content: String, attachments: List<String> = emptyList(), replyTo: String? = null, nonce: String? = null): Boolean {
        val fields = mutableMapOf<String, kotlinx.serialization.json.JsonElement>(
            "t" to JsonPrimitive("send"),
            "channelId" to JsonPrimitive(channelId),
            "content" to JsonPrimitive(content),
            "attachments" to kotlinx.serialization.json.JsonArray(attachments.map { JsonPrimitive(it) }),
        )
        replyTo?.let { fields["replyTo"] = JsonPrimitive(it) }
        nonce?.let { fields["nonce"] = JsonPrimitive(it) }
        val json = JsonObject(fields)
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

    /** Recusa a chamada que está tocando; quem ligou fica sabendo. */
    fun sendRingDecline(channelId: String): Boolean {
        val json = JsonObject(mapOf("t" to JsonPrimitive("ringDecline"), "channelId" to JsonPrimitive(channelId)))
        return socket?.send(json.toString()) ?: false
    }
}
