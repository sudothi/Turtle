package xyz.ogturtle.turtle

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import xyz.ogturtle.turtle.data.Channel
import xyz.ogturtle.turtle.data.Dm
import xyz.ogturtle.turtle.data.TurtleJson
import xyz.ogturtle.turtle.data.AuthResponse
import xyz.ogturtle.turtle.data.title
import kotlinx.serialization.builtins.ListSerializer
import org.junit.Test

/** Garante que o app entende o que o servidor responde (formatos de packages/protocol). */
class ModelsTest {
    @Test
    fun loginResponseIgnoresUnknownFieldsAndNulls() {
        val json = """{"token":"abc","user":{"id":"u1","username":"kai","isAdmin":false,"canInvite":false,
            "displayName":null,"bio":null,"avatar":null,"banner":null,"status":"online","extra":1}}"""
        val res = TurtleJson.decodeFromString(AuthResponse.serializer(), json)
        assertEquals("abc", res.token)
        assertEquals("kai", res.user.username)
    }

    @Test
    fun channelsKnowTheirKind() {
        val json = """[{"id":"c1","serverId":"s1","name":"geral","kind":"text"},{"id":"c2","serverId":"s1","name":"Sala","kind":"voice"}]"""
        val list = TurtleJson.decodeFromString(ListSerializer(Channel.serializer()), json)
        assertTrue(list[1].isVoice)
        assertTrue(!list[0].isVoice)
    }

    @Test
    fun dmTitleUsesGroupNameOrPeople() {
        val json = """[{"channelId":"d1","users":[{"id":"u2","username":"ana","displayName":"Ana"},{"id":"u3","username":"leo"}],"group":true,"name":null,"lastMessageAt":null}]"""
        val dm = TurtleJson.decodeFromString(ListSerializer(Dm.serializer()), json).first()
        assertEquals("Ana, leo", dm.title)
        assertEquals("Galera", dm.copy(name = "Galera").title)
    }
}
