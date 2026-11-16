package xyz.ogturtle.turtle.data

/** Audio choices survive media events; screen reception never depends on conversation silence. */
internal class VoiceAudioState {
    var muted = false
        private set
    var deafened = false
        private set
    private val watching = mutableMapOf<String, String>()

    fun reset(muted: Boolean = false, deafened: Boolean = false) {
        this.muted = muted || deafened
        this.deafened = deafened
        watching.clear()
    }

    fun muteMicrophone(muted: Boolean) {
        this.muted = muted
        if (!muted) deafened = false
    }

    fun silenceConversation(silenced: Boolean) {
        deafened = silenced
        if (silenced) muted = true
    }

    fun watchScreen(identity: String, publication: String?, watch: Boolean) {
        if (!watch) watching.remove(identity)
        else if (publication != null) watching[identity] = publication
    }

    fun reconcileScreens(publications: Map<String, String>) {
        watching.entries.removeAll { publications[it.key] != it.value }
    }

    fun isWatching(identity: String, publication: String?): Boolean =
        publication != null && watching[identity] == publication

    fun voiceVolume(preferred: Float): Double = if (deafened) 0.0 else preferred.coerceIn(0f, 2f).toDouble()

    fun screenVolume(identity: String, publication: String?, preferred: Float): Double =
        if (isWatching(identity, publication)) preferred.coerceIn(0f, 2f).toDouble() else 0.0
}
