package xyz.ogturtle.turtle

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import xyz.ogturtle.turtle.data.VoiceAudioState

class VoiceAudioStateTest {
    @Test
    fun silencingVoicesKeepsScreenVolumeAndReturningNeverReopensCapture() {
        val audio = VoiceAudioState()
        audio.watchScreen("friend", "screen-1", true)
        repeat(3) {
            audio.silenceConversation(true)
            assertEquals(0.0, audio.voiceVolume(0.5f), 0.0)
            assertEquals(0.25, audio.screenVolume("friend", "screen-1", 0.25f), 0.0)
            assertTrue(audio.muted)
            audio.silenceConversation(false)
            assertEquals(0.5, audio.voiceVolume(0.5f), 0.0)
            assertEquals(0.25, audio.screenVolume("friend", "screen-1", 0.25f), 0.0)
            assertTrue(audio.muted)
        }
    }

    @Test
    fun newScreenCanBeWatchedWithConversationAlreadySilenced() {
        val audio = VoiceAudioState()
        audio.silenceConversation(true)
        assertEquals(0.0, audio.screenVolume("friend", "screen-1", 0.75f), 0.0)
        audio.watchScreen("friend", "screen-1", true)
        audio.reconcileScreens(mapOf("friend" to "screen-1"))
        assertEquals(0.75, audio.screenVolume("friend", "screen-1", 0.75f), 0.0)
        assertEquals(0.0, audio.voiceVolume(1f), 0.0)
    }

    @Test
    fun zeroScreenVolumeRemainsZeroWhenConversationReturns() {
        val audio = VoiceAudioState()
        audio.watchScreen("friend", "screen-1", true)
        audio.silenceConversation(true)
        assertEquals(0.0, audio.screenVolume("friend", "screen-1", 0f), 0.0)
        audio.silenceConversation(false)
        assertTrue(audio.isWatching("friend", "screen-1"))
        assertEquals(0.0, audio.screenVolume("friend", "screen-1", 0f), 0.0)
        assertEquals(1.0, audio.voiceVolume(1f), 0.0)
    }

    @Test
    fun endingOrReplacingScreenDoesNotLeaveAudioOrResumeWatchingAutomatically() {
        val audio = VoiceAudioState()
        audio.silenceConversation(true)
        audio.watchScreen("friend", "screen-1", true)
        audio.reconcileScreens(emptyMap())
        assertEquals(0.0, audio.screenVolume("friend", "screen-1", 1f), 0.0)
        audio.reconcileScreens(mapOf("friend" to "screen-2"))
        assertFalse(audio.isWatching("friend", "screen-2"))
        audio.watchScreen("friend", "screen-2", true)
        assertEquals(1.0, audio.screenVolume("friend", "screen-2", 1f), 0.0)
        audio.reconcileScreens(mapOf("friend" to "screen-3"))
        assertEquals(0.0, audio.screenVolume("friend", "screen-3", 1f), 0.0)
    }

    @Test
    fun stoppingWatchingCutsOnlyScreenAudio() {
        val audio = VoiceAudioState()
        audio.watchScreen("friend", "screen-1", true)
        audio.watchScreen("friend", "screen-1", false)
        assertEquals(0.0, audio.screenVolume("friend", "screen-1", 1f), 0.0)
        assertEquals(0.5, audio.voiceVolume(0.5f), 0.0)
    }

    @Test
    fun recoveryRestoresSilencingWithoutCaptureAndRequiresAWatchChoiceForNewMedia() {
        val audio = VoiceAudioState()
        audio.watchScreen("friend", "screen-1", true)
        audio.reset(muted = true, deafened = true)
        assertTrue(audio.deafened)
        assertTrue(audio.muted)
        assertFalse(audio.isWatching("friend", "screen-1"))
        assertEquals(0.0, audio.voiceVolume(1f), 0.0)
        audio.watchScreen("friend", "screen-2", true)
        assertEquals(0.25, audio.screenVolume("friend", "screen-2", 0.25f), 0.0)
        audio.silenceConversation(false)
        assertTrue(audio.muted)
    }

    @Test
    fun explicitMicrophoneUnmuteKeepsItsExistingMeaning() {
        val audio = VoiceAudioState()
        audio.silenceConversation(true)
        audio.muteMicrophone(false)
        assertFalse(audio.muted)
        assertFalse(audio.deafened)
        assertEquals(1.0, audio.voiceVolume(1f), 0.0)
        audio.muteMicrophone(true)
        assertFalse(audio.deafened)
    }

    @Test
    fun inconsistentRecoveryFlagsCannotEnableCaptureWhileConversationIsSilenced() {
        val audio = VoiceAudioState()
        audio.reset(muted = false, deafened = true)
        assertTrue(audio.muted)
        assertTrue(audio.deafened)
    }
}
