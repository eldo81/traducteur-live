package com.dioneo.call

import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.linphone.core.Account
import org.linphone.core.AudioDevice
import org.linphone.core.Call
import org.linphone.core.Core
import org.linphone.core.CoreListenerStub
import org.linphone.core.Factory
import org.linphone.core.MediaEncryption
import org.linphone.core.RegistrationState
import org.linphone.core.TransportType

data class Registration(val ok: Boolean, val label: String)

data class CallInfo(
    val number: String,
    val state: String,
    val connected: Boolean,
    val incoming: Boolean,
    val paused: Boolean,
    val finished: Boolean,
)

/** Enveloppe du moteur Linphone : compte SIP, appels, journal. À utiliser sur le thread principal. */
object Sip {
    private const val TAG = "DioneoSip"
    lateinit var core: Core
        private set
    private lateinit var app: Context
    lateinit var prefs: Prefs
        private set

    private val _registration = MutableStateFlow(Registration(false, "Compte non configuré"))
    val registration: StateFlow<Registration> = _registration

    private val _call = MutableStateFlow<CallInfo?>(null)
    val call: StateFlow<CallInfo?> = _call

    private val _logsVersion = MutableStateFlow(0)
    val logsVersion: StateFlow<Int> = _logsVersion

    /** Numéro E.164 du dernier appel sortant (pour l'estimation de coût). */
    var lastDialedE164: String = ""
        private set

    private val listener = object : CoreListenerStub() {
        override fun onAccountRegistrationStateChanged(
            core: Core, account: Account, state: RegistrationState?, message: String
        ) {
            _registration.value = when (state) {
                RegistrationState.Ok -> Registration(true, "Connecté · ${account.params.identityAddress?.asStringUriOnly() ?: ""}")
                RegistrationState.Progress -> Registration(false, "Connexion…")
                RegistrationState.Failed -> Registration(false, "Échec : $message")
                RegistrationState.Cleared, RegistrationState.None -> Registration(false, "Déconnecté")
                else -> Registration(false, state?.name ?: "—")
            }
        }

        override fun onCallStateChanged(core: Core, call: Call, state: Call.State?, message: String) {
            Log.i(TAG, "Call state $state ($message)")
            val number = call.remoteAddress.username ?: call.remoteAddress.asStringUriOnly()
            val incoming = call.dir == Call.Dir.Incoming
            val label = when (state) {
                Call.State.OutgoingInit, Call.State.OutgoingProgress -> "Appel en cours…"
                Call.State.OutgoingRinging -> "Ça sonne…"
                Call.State.OutgoingEarlyMedia -> "Tonalité opérateur…"
                Call.State.IncomingReceived, Call.State.IncomingEarlyMedia -> "Appel entrant"
                Call.State.Connected, Call.State.StreamsRunning -> "En communication"
                Call.State.Pausing, Call.State.Paused -> "En attente"
                Call.State.PausedByRemote -> "Mis en attente par le correspondant"
                Call.State.Resuming -> "Reprise…"
                Call.State.Error -> "Échec : ${humanError(message)}"
                Call.State.End, Call.State.Released -> "Appel terminé"
                else -> state?.name ?: ""
            }
            val finished = state == Call.State.End || state == Call.State.Released || state == Call.State.Error
            val connected = state == Call.State.Connected || state == Call.State.StreamsRunning ||
                state == Call.State.Paused || state == Call.State.PausedByRemote ||
                state == Call.State.Pausing || state == Call.State.Resuming
            val paused = state == Call.State.Paused || state == Call.State.Pausing

            // Ne pas écraser un message d'erreur par « terminé »
            val prev = _call.value
            if (!(finished && prev?.finished == true && prev.state.startsWith("Échec"))) {
                _call.value = CallInfo(number, label, connected, incoming, paused, finished)
            }

            when (state) {
                Call.State.IncomingReceived -> {
                    startService(incoming = true)
                    runCatching {
                        app.startActivity(Intent(app, CallActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    }
                }
                Call.State.Released, Call.State.Error -> {
                    if (core.callsNb == 0) {
                        app.stopService(Intent(app, CallService::class.java))
                    }
                    _logsVersion.value++
                }
                else -> {}
            }
        }
    }

    fun init(context: Context) {
        if (::core.isInitialized) return
        app = context.applicationContext
        prefs = Prefs(app)
        val factory = Factory.instance()
        factory.setDebugMode(BuildConfigLite.DEBUG, "DioneoCall")
        core = factory.createCore(null, null, app)
        core.setUserAgent("DioneoCall", "1.0")
        core.addListener(listener)
        core.start()
        applyAccount(prefs.sip)
    }

    /** (Re)crée le compte SIP à partir de la configuration enregistrée. */
    fun applyAccount(cfg: SipConfig) {
        core.clearAccounts()
        core.clearAllAuthInfo()
        if (!cfg.isComplete) {
            _registration.value = Registration(false, "Compte non configuré → onglet Compte")
            return
        }
        val factory = Factory.instance()
        val transport = when (cfg.transport) {
            Transport.UDP -> TransportType.Udp
            Transport.TCP -> TransportType.Tcp
            Transport.TLS -> TransportType.Tls
        }

        // NAT : STUN pour découvrir l'IP publique (4G / box), sans ICE (non géré par les trunks PSTN)
        val nat = core.createNatPolicy()
        nat.setStunServer("stun.l.google.com:19302")
        nat.setStunEnabled(cfg.stun)
        nat.setIceEnabled(false)
        core.setNatPolicy(nat)

        core.setMediaEncryption(if (cfg.srtp) MediaEncryption.SRTP else MediaEncryption.None)
        core.setMediaEncryptionMandatory(cfg.srtp)

        val authInfo = factory.createAuthInfo(
            cfg.username, cfg.authId.ifBlank { null }, cfg.password, null, null, cfg.domain, null
        )
        core.addAuthInfo(authInfo)

        val params = core.createAccountParams()
        val identity = factory.createAddress("sip:${cfg.username}@${cfg.domain}")
        params.setIdentityAddress(identity)
        val serverHost = cfg.proxy.ifBlank { cfg.domain }
        val server = factory.createAddress("sip:$serverHost")
        server?.setTransport(transport)
        params.setServerAddress(server)
        params.setRegisterEnabled(true)
        params.setExpires(600)

        val account = core.createAccount(params)
        core.addAccount(account)
        core.setDefaultAccount(account)
        _registration.value = Registration(false, "Connexion…")
    }

    fun refreshRegistration() {
        runCatching { core.refreshRegisters() }
    }

    /** Lance un appel vers un numéro E.164 (+32470123456). Retourne un message d'erreur ou null. */
    fun call(e164: String): String? {
        val cfg = prefs.sip
        if (!cfg.isComplete) return "Configurez d'abord votre compte SIP (onglet Compte)."
        if (core.callsNb > 0) return "Un appel est déjà en cours."
        val dial = cfg.format.apply(e164)
        val address = Factory.instance().createAddress("sip:$dial@${cfg.domain}")
            ?: return "Numéro invalide."
        val params = core.createCallParams(null) ?: return "Moteur VoIP indisponible."
        params.setMediaEncryption(if (cfg.srtp) MediaEncryption.SRTP else MediaEncryption.None)
        lastDialedE164 = e164
        _call.value = CallInfo(e164, "Appel en cours…", false, false, false, false)
        startService(incoming = false)
        core.inviteAddressWithParams(address, params) ?: run {
            app.stopService(Intent(app, CallService::class.java))
            _call.value = null
            return "L'appel n'a pas pu démarrer (réseau ?)."
        }
        return null
    }

    fun current(): Call? = core.currentCall ?: core.calls.firstOrNull()

    fun hangup() {
        val c = current()
        if (c != null) c.terminate() else core.terminateAllCalls()
    }

    fun answer() {
        core.calls.firstOrNull { it.state == Call.State.IncomingReceived || it.state == Call.State.IncomingEarlyMedia }
            ?.accept()
    }

    fun setMuted(muted: Boolean) {
        current()?.setMicrophoneMuted(muted)
    }

    fun togglePause() {
        val c = current() ?: return
        if (c.state == Call.State.Paused) c.resume() else c.pause()
    }

    fun dtmf(ch: Char) {
        current()?.sendDtmf(ch)
    }

    fun isSpeaker(): Boolean = current()?.outputAudioDevice?.type == AudioDevice.Type.Speaker

    /** Bascule haut-parleur ⇄ écouteur (ou Bluetooth si connecté). */
    fun toggleSpeaker(): Boolean {
        val c = current() ?: return false
        val wantSpeaker = !isSpeaker()
        val devices = core.audioDevices
        val target = if (wantSpeaker) {
            devices.firstOrNull { it.type == AudioDevice.Type.Speaker }
        } else {
            devices.firstOrNull { it.type == AudioDevice.Type.Bluetooth }
                ?: devices.firstOrNull { it.type == AudioDevice.Type.Headset || it.type == AudioDevice.Type.Headphones }
                ?: devices.firstOrNull { it.type == AudioDevice.Type.Earpiece }
        }
        if (target != null) c.setOutputAudioDevice(target)
        return wantSpeaker
    }

    fun clearCallInfo() {
        if (core.callsNb == 0) _call.value = null
    }

    fun clearLogs() {
        core.clearCallLogs()
        _logsVersion.value++
    }

    private fun startService(incoming: Boolean) {
        runCatching {
            ContextCompat.startForegroundService(
                app, Intent(app, CallService::class.java).putExtra(CallService.EXTRA_INCOMING, incoming)
            )
        }.onFailure { Log.w(TAG, "Service premier plan refusé", it) }
    }

    private fun humanError(message: String): String {
        val m = message.lowercase()
        return when {
            "forbidden" in m || "403" in m -> "refusé par l'opérateur (crédit, destination non autorisée ou caller ID)"
            "not found" in m || "404" in m -> "numéro introuvable"
            "busy" in m || "486" in m -> "occupé"
            "declined" in m || "603" in m -> "refusé"
            "unauthorized" in m || "401" in m || "407" in m -> "identifiants SIP incorrects"
            "payment" in m || "402" in m -> "crédit insuffisant"
            "timeout" in m || "408" in m -> "pas de réponse (réseau)"
            "not acceptable" in m || "488" in m -> "codec/chiffrement refusé (désactivez SRTP)"
            "unavailable" in m || "480" in m -> "injoignable"
            else -> message.ifBlank { "erreur inconnue" }
        }
    }
}

/** Évite de dépendre de la génération de BuildConfig (désactivée par défaut sous AGP 8). */
object BuildConfigLite {
    const val DEBUG = false
}
