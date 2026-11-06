package xyz.ogturtle.turtle.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** Modelos espelham packages/protocol (apps/server responde exatamente esses formatos). */
@Serializable
data class User(
    val id: String,
    val username: String,
    val isAdmin: Boolean = false,
    val canInvite: Boolean = false,
    val displayName: String? = null,
    val bio: String? = null,
    val avatar: String? = null,
    val banner: String? = null,
    val status: String = "online",
)

@Serializable
data class AuthResponse(val token: String, val user: User)

@Serializable
data class Server(
    val id: String,
    val name: String,
    val ownerId: String,
    val role: String = "member",
    val icon: String? = null,
)

@Serializable
data class Channel(val id: String, val serverId: String, val name: String, val kind: String = "text") {
    val isVoice get() = kind == "voice"
}

@Serializable
data class Person(
    val id: String,
    val username: String,
    val displayName: String? = null,
    val avatar: String? = null,
)

@Serializable
data class Dm(
    val channelId: String,
    val users: List<Person> = emptyList(),
    val group: Boolean = false,
    val name: String? = null,
    val lastMessageAt: String? = null,
)

@Serializable
data class Unread(val channelId: String, val serverId: String? = null, val count: Int = 0, val mentions: Int = 0)

/** Quem está numa chamada de voz (evento `voiceStates` do servidor). */
@Serializable
data class VoiceState(
    val userId: String,
    val username: String,
    val displayName: String? = null,
    val avatar: String? = null,
    val channelId: String,
    val serverId: String? = null,
    val muted: Boolean = false,
    val deafened: Boolean = false,
    val camera: Boolean = false,
    val screen: Boolean = false,
) {
    val shown get() = displayName?.takeIf { it.isNotBlank() } ?: username
}

/** Resposta de POST /voice/:canal/token. */
@Serializable
data class VoiceToken(val url: String, val token: String)

@Serializable
data class Friend(val user: Person, val status: String)

@Serializable
data class Attachment(
    val id: String,
    val key: String,
    val name: String,
    val size: Long = 0,
    val mime: String = "",
    val width: Int? = null,
    val height: Int? = null,
) {
    val isImage get() = Regex("^image/(png|jpeg|gif|webp)$").matches(mime)
}

@Serializable
data class Message(
    val id: String,
    val channelId: String,
    val userId: String,
    val username: String,
    val displayName: String? = null,
    val avatar: String? = null,
    val staff: Boolean = false,
    val content: String = "",
    val createdAt: String,
    val editedAt: String? = null,
    val attachments: List<Attachment> = emptyList(),
) {
    val author get() = displayName?.takeIf { it.isNotBlank() } ?: username
}

@Serializable
data class Member(
    val userId: String,
    val username: String,
    val displayName: String? = null,
    val avatar: String? = null,
    val staff: Boolean = false,
    val role: String = "member",
) {
    val shown get() = displayName?.takeIf { it.isNotBlank() } ?: username
}

@Serializable
data class MutualServer(val id: String, val name: String)

/** Perfil visto por outra pessoa (GET /users/:id). */
@Serializable
data class ProfileView(
    val id: String,
    val username: String,
    val displayName: String? = null,
    val bio: String? = null,
    val avatar: String? = null,
    val banner: String? = null,
    val staff: Boolean = false,
    val createdAt: String = "",
    val mutualServers: List<MutualServer> = emptyList(),
    val mutualFriends: List<Person> = emptyList(),
    /** none | friend | incoming | outgoing (do ponto de vista de quem pede). */
    val friendship: String = "none",
    val blocked: Boolean = false,
) {
    val shown get() = displayName?.takeIf { it.isNotBlank() } ?: username
}

val Person.shownName get() = displayName?.takeIf { it.isNotBlank() } ?: username
val User.shownName get() = displayName?.takeIf { it.isNotBlank() } ?: username

/** Título de uma conversa direta: nome do grupo, ou os nomes das pessoas. */
val Dm.title get() = name?.takeIf { it.isNotBlank() } ?: users.joinToString(", ") { it.shownName }.ifEmpty { "Conversa" }

val TurtleJson = Json {
    ignoreUnknownKeys = true
    coerceInputValues = true
    explicitNulls = false
}
