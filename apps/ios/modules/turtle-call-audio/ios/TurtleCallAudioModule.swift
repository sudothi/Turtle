import AVFAudio
import ExpoModulesCore
import LiveKitWebRTC

public final class TurtleCallAudioModule: Module {
  private var observer: NSObjectProtocol?
  private var callActive = false
  private var interrupted = false
  private var interruptionId = 0
  private var held = false
  private var previousManualAudio = false
  private var previousAudioEnabled = true

  public func definition() -> ModuleDefinition {
    Name("TurtleCallAudio")
    Events("onInterruption")

    OnCreate {
      self.observer = NotificationCenter.default.addObserver(
        forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
      ) { [weak self] notification in
        self?.handle(notification)
      }
    }
    OnDestroy {
      if let observer = self.observer { NotificationCenter.default.removeObserver(observer) }
      self.releaseAudio()
    }
    AsyncFunction("setCallActive") { (active: Bool) in
      self.callActive = active
      if !active { self.releaseAudio() }
      else if self.interrupted { self.holdAudio() }
    }.runOnQueue(.main)
    AsyncFunction("snapshot") { self.snapshot() }.runOnQueue(.main)
    AsyncFunction("acknowledge") { (id: Int) -> Bool in
      guard id == self.interruptionId, !self.interrupted else { return false }
      self.releaseAudio()
      return true
    }.runOnQueue(.main)
  }

  private func handle(_ notification: Notification) {
    guard let value = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
          let type = AVAudioSession.InterruptionType(rawValue: value) else { return }
    interrupted = type == .began
    if interrupted && callActive {
      holdAudio()
    }
    sendEvent("onInterruption", snapshot())
  }

  private func holdAudio() {
    interruptionId += 1
    guard !held else { return }
    let audio = LKRTCAudioSession.sharedInstance()
    previousManualAudio = audio.useManualAudio
    previousAudioEnabled = audio.isAudioEnabled
    // Hold native capture through interruption-end until JS has muted the local track.
    audio.useManualAudio = true
    audio.isAudioEnabled = false
    held = true
  }

  private func snapshot() -> [String: Any] {
    return ["id": interruptionId, "interrupted": interrupted, "held": held]
  }

  private func releaseAudio() {
    guard held else { return }
    let audio = LKRTCAudioSession.sharedInstance()
    audio.isAudioEnabled = previousAudioEnabled
    audio.useManualAudio = previousManualAudio
    held = false
  }
}
