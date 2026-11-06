package xyz.ogturtle.turtle.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

/** Erro com a mensagem em português que o servidor devolveu (ou uma de rede). */
class ApiException(message: String, val status: Int = 0) : Exception(message)

/** Cliente HTTP do servidor do Turtle. `token` é lido a cada chamada (muda no login/logout). */
class Api(private val baseUrl: String, private val token: () -> String?) {
    private val http = OkHttpClient()
    /** Envio de anexos (até 25 MB) precisa de mais tempo que as chamadas comuns. */
    private val uploadHttp = OkHttpClient.Builder().writeTimeout(60, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).build()
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
        execute(http, builder.build())
    }

    /** Executa a chamada e devolve o corpo; erro do servidor vira ApiException com a mensagem dele. */
    private fun execute(client: OkHttpClient, request: Request): String {
        try {
            return client.newCall(request).execute().use { res ->
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

    private fun obj(vararg pairs: Pair<String, String?>) =
        JsonObject(pairs.associate { (k, v) -> k to (if (v != null) JsonPrimitive(v) else JsonNull) }).toString()

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
        val q = if (before != null) "?before=" + URLEncoder.encode(before, "UTF-8") else ""
        return get("/channels/$channelId/messages$q", ListSerializer(Message.serializer()))
    }

    suspend fun markRead(channelId: String) {
        call("POST", "/channels/$channelId/read", "{}")
    }

    suspend fun members(serverId: String): List<Member> = get("/servers/$serverId/members", ListSerializer(Member.serializer()))
    suspend fun profile(userId: String): ProfileView = get("/users/$userId", ProfileView.serializer())
    suspend fun openDm(userId: String): Dm = TurtleJson.decodeFromString(Dm.serializer(), call("POST", "/dms/$userId"))
    suspend fun addFriend(userId: String) { call("POST", "/friends/$userId") }
    suspend fun removeFriend(userId: String) { call("DELETE", "/friends/$userId") }

    suspend fun editMessage(id: String, content: String): Message =
        TurtleJson.decodeFromString(Message.serializer(), call("PATCH", "/messages/$id", obj("content" to content)))

    suspend fun deleteMessage(id: String) { call("DELETE", "/messages/$id") }

    /** Envia um arquivo (multipart, campo "file"); o id devolvido vai no evento "send". */
    suspend fun uploadAttachment(channelId: String, name: String, mime: String, bytes: ByteArray): Attachment = withContext(Dispatchers.IO) {
        val type = mime.toMediaTypeOrNull() ?: "application/octet-stream".toMediaType()
        val form = MultipartBody.Builder().setType(MultipartBody.FORM).addFormDataPart("file", name, bytes.toRequestBody(type)).build()
        val builder = Request.Builder().url(baseUrl.trimEnd('/') + "/channels/$channelId/attachments").post(form)
        token()?.let { builder.header("authorization", "Bearer $it") }
        TurtleJson.decodeFromString(Attachment.serializer(), execute(uploadHttp, builder.build()))
    }

    /** Pedido de amizade pelo nome de usuário; devolve "friend" (já eram/aceitou) ou "outgoing". */
    suspend fun addFriendByName(username: String): String =
        TurtleJson.parseToJsonElement(call("POST", "/friends", obj("username" to username))).jsonObject["status"]?.jsonPrimitive?.contentOrNull.orEmpty()

    suspend fun setStatus(status: String): User = TurtleJson.decodeFromString(User.serializer(), call("PATCH", "/me", obj("status" to status)))

    /** null apaga o campo. */
    suspend fun updateProfile(displayName: String?, bio: String?): User =
        TurtleJson.decodeFromString(User.serializer(), call("PATCH", "/me", obj("displayName" to displayName, "bio" to bio)))

    suspend fun createChannel(serverId: String, name: String, kind: String): Channel =
        TurtleJson.decodeFromString(Channel.serializer(), call("POST", "/servers/$serverId/channels", obj("name" to name, "kind" to kind)))

    suspend fun createServer(name: String): Server = TurtleJson.decodeFromString(Server.serializer(), call("POST", "/servers", obj("name" to name)))

    suspend fun joinInvite(code: String): Server {
        val encoded = URLEncoder.encode(code, "UTF-8").replace("+", "%20")
        return TurtleJson.decodeFromString(Server.serializer(), call("POST", "/invites/$encoded/join", "{}"))
    }

    suspend fun voiceToken(channelId: String): VoiceToken =
        TurtleJson.decodeFromString(VoiceToken.serializer(), call("POST", "/voice/$channelId/token"))

    suspend fun unread(): List<Unread> = get("/unread", ListSerializer(Unread.serializer()))

    /** URL de foto/ícone/banner a partir da chave guardada no perfil. */
    fun fileUrl(key: String?): String? = key?.let { baseUrl.trimEnd('/') + "/files/" + it }
}
