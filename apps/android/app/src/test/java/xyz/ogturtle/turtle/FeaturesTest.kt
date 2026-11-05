package xyz.ogturtle.turtle

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import xyz.ogturtle.turtle.data.ServerEvent
import xyz.ogturtle.turtle.data.parseServerEvent

/** Funções padrão do app: convites, eventos de canal novo, edição e exclusão de mensagens. */
class FeaturesTest {
    @Test
    fun inviteAcceptsCodeOrLink() {
        assertEquals("abc123", inviteCode("abc123"))
        assertEquals("abc123", inviteCode("  https://ogturtle.xyz/invite/abc123/ "))
        assertEquals("", inviteCode("   "))
    }

    @Test
    fun newChannelEventRefreshes() {
        assertEquals(ServerEvent.Refresh, parseServerEvent("""{"t":"channel","channel":{"id":"c1","serverId":"s1","name":"geral","kind":"text"}}"""))
    }

    @Test
    fun editAndDeleteEventsParse() {
        val msg = """{"id":"m1","channelId":"c1","userId":"u1","username":"kai","content":"oi","createdAt":"2026-11-05T10:00:00.000Z","editedAt":"2026-11-05T10:01:00.000Z","attachments":[]}"""
        val upd = parseServerEvent("""{"t":"messageUpdate","message":$msg}""")
        assertTrue(upd is ServerEvent.MessageUpdate && upd.message.editedAt != null)
        assertEquals(ServerEvent.MessageDelete("c1", "m1"), parseServerEvent("""{"t":"messageDelete","channelId":"c1","id":"m1"}"""))
    }
}
