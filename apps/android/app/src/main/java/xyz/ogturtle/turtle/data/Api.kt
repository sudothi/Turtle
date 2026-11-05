package xyz.ogturtle.turtle.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

/** Erro com a mensagem em português que o servidor devolveu (ou uma de rede). */
class ApiException(message: String, val status: Int = 0) : Exception(message)

/** Cliente HTTP do servidor do Turtle. `token` é lido a cada chamada (muda no login/logout). */
class Api(private val baseUrl: String, private val token: () -> String?) {
    private val http = OkHttpClient()
    private val jsonType = "application/json".toMediaType()

    private suspend fun call(method: String, path: String, body: String? = null): String = withContext(Dispatchers.IO) {
        val builder = Request.Builder().url(baseUrl.trimEnd('/') + path)
        token()?.let { builder.header("authorization", "Bearer $it") }
        val payload = when {
            body != null -> body.toRequestBody(jsonType)
            method == "GET" || method == "DELETE" -> null
            else -> "{}".toRequestBody(jsonType)
        }
        builder.method(method, payload)
        try {
            http.newCall(builder.build()).execute().use { res ->
                val text = res.body?.string().orEmpty()
                if (!res.isSuccessful) {
                    val msg = runCatching {
                        TurtleJson.parseToJsonElement(text).jsonObject["error"]?.jsonPrimitive?.contentOrNull
                    }.getOrNull()
                    throw ApiException(msg ?: "erro ${res.code}", res.code)
                }
                text
            }
        } catch (e: IOException) {
            throw ApiException("Sem conexão com o Turtle. Confira a internet e tente de novo.")
        }
    }

    private suspend fun <T> get(path: String, s: KSerializer<T>): T = TurtleJson.decodeFromString(s, call("GET", path))

    private fun obj(vararg pairs: Pair<String, String>) =
        JsonObject(pairs.associate { it.first to JsonPrimitive(it.second) }).toString()

    suspend fun login(username: String, password: String): AuthResponse =
        TurtleJson.decodeFromString(AuthResponse.serializer(), call("POST", "/auth/login", obj("username" to username, "password" to password)))

    suspend fun register(inviteCode: String, username: String, password: String): AuthResponse =
        TurtleJson.decodeFromString(
            AuthResponse.serializer(),
            call("POST", "/auth/register", obj("inviteCode" to inviteCode, "username" to username, "password" to password)),
        )

    suspend fun me(): User = get("/me", User.serializer())
    suspend fun servers(): List<Server> = get("/servers", ListSerializer(Server.serializer()))
    suspend fun channels(serverId: String): List<Channel> = get("/servers/$serverId/channels", ListSerializer(Channel.serializer()))
    suspend fun dms(): List<Dm> = get("/dms", ListSerializer(Dm.serializer()))
    suspend fun friends(): List<Friend> = get("/friends", ListSerializer(Friend.serializer()))
    /** Mensagens em ordem cronológica; `before` = createdAt da mais antiga já carregada. */
    suspend fun messages(channelId: String, before: String? = null): List<Message> {
        val q = if (before != null) "?before=" + java.net.URLEncoder.encode(before, "UTF-8") else ""
        return get("/channels/$channelId/messages$q", ListSerializer(Message.serializer()))
    }

    suspend fun markRead(channelId: String) {
        call("POST", "/channels/$channelId/read", "{}")
    }

    suspend fun unread(): List<Unread> = get("/unread", ListSerializer(Unread.serializer()))

    /** URL de foto/ícone/banner a partir da chave guardada no perfil. */
    fun fileUrl(key: String?): String? = key?.let { baseUrl.trimEnd('/') + "/files/" + it }
}
