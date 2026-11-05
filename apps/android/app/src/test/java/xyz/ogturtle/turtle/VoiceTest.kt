package xyz.ogturtle.turtle

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import xyz.ogturtle.turtle.data.ServerEvent
import xyz.ogturtle.turtle.data.TurtleJson
import xyz.ogturtle.turtle.data.VoiceToken
import xyz.ogturtle.turtle.data.parseServerEvent

class VoiceTest {
    @Test
    fun parsesVoiceStates() {
        val json = """{"t":"voiceStates","states":[
            {"userId":"u1","username":"kai","displayName":"Kai","avatar":null,"staff":false,"channelId":"c1","serverId":"s1",
             "muted":true,"deafened":false,"camera":false,"screen":true},
            {"userId":"u2","username":"bia","channelId":"c1","serverId":null,"muted":false,"deafened":false}]}"""
        val e = parseServerEvent(json) as ServerEvent.VoiceStates
        assertEquals(2, e.states.size)
        assertEquals("Kai", e.states[0].shown)
        assertTrue(e.states[0].muted && e.states[0].screen)
        assertEquals("bia", e.states[1].shown)
        assertEquals(false, e.states[1].camera)
    }

    @Test
    fun emptyVoiceStatesMeansNobodyInCalls() {
        assertEquals(emptyList<Any>(), (parseServerEvent("""{"t":"voiceStates","states":[]}""") as ServerEvent.VoiceStates).states)
    }

    @Test
    fun parsesVoiceToken() {
        val t = TurtleJson.decodeFromString(VoiceToken.serializer(), """{"url":"wss://lk.ogturtle.xyz","token":"abc"}""")
        assertEquals("wss://lk.ogturtle.xyz", t.url)
        assertEquals("abc", t.token)
    }
}
