package xyz.ogturtle.turtle

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ServerLinkTest {
    @Test fun normalizaEndereco() {
        assertEquals("https://app.exemplo.com", normalizeServerUrl(" app.exemplo.com/ "))
        assertEquals("https://app.exemplo.com:8443", normalizeServerUrl("https://app.exemplo.com:8443/x"))
        assertEquals("http://10.0.2.2:3000", normalizeServerUrl("http://10.0.2.2:3000"))
        assertNull(normalizeServerUrl("http://app.exemplo.com"))
        assertNull(normalizeServerUrl("semponto"))
        assertNull(normalizeServerUrl(""))
    }

    @Test fun linkTurtle() {
        assertEquals(
            ServerLink("https://app.exemplo.com", "abc 1"),
            parseServerLink("turtle://convite?server=https%3A%2F%2Fapp.exemplo.com&code=abc%201"),
        )
        assertNull(parseServerLink("turtle://convite"))
    }

    @Test fun linkHttps() {
        assertEquals(ServerLink("https://app.exemplo.com", "xyz"), parseServerLink("https://app.exemplo.com/convite/xyz"))
        assertNull(parseServerLink("https://app.exemplo.com/outra"))
        assertNull(parseServerLink("ftp://x"))
    }
}
