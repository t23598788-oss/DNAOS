// หน้าที่: the minimal macOS .app host for Voice Command — microphone ->
// Apple Speech Recognition -> transcript -> ../dispatch-cli.ts (the
// EXISTING, VERIFIED ../dispatcher.ts, invoked as a subprocess — this
// file contains NO Screen Reader, dispatcher, intent-resolver, or
// execution logic of its own; its only real job is turning real
// microphone audio into real transcribed text, classifying it into
// exactly one of STOP (exact/deterministic) / SELF_ECHO (dropped,
// never dispatched) / everything else (handed to the existing
// deterministic intent resolver unchanged), and dispatching accordingly.
//
// Built as a real .app bundle (see ./build.sh) so macOS TCC can show a
// REAL permission dialog for NSMicrophoneUsageDescription /
// NSSpeechRecognitionUsageDescription (see ./Info.plist).
//
// Self-audio-suppression (Option B, 2026-08-21 — replaces
// setVoiceProcessingEnabled/VPIO entirely): real, measured evidence
// showed VPIO dropped real macOS output volume 100 -> 56 and did not
// restore it on its own after the app quit (osascript "get volume
// settings" before/during/after, plus a real acoustic loopback RMS
// drop of ~53x). NO Voice Processing I/O / Core Audio gain mechanism is
// used anywhere in this file — the microphone tap below NEVER mutes or
// gates audio capture. Instead: the mic listens continuously, including
// while DNA OS is speaking, and a transcript is classified as SELF_ECHO
// (dropped) by comparing it against the REAL text DNA OS is currently
// speaking (../os-ui/voice-queue.mjs writes this to
// os-ui/data/active-speech.json for exactly this purpose — a compiled
// Swift binary cannot import a Node .mjs module, so a shared file is
// the real, existing-pattern mechanism, same convention as
// voice-output.lock). STOP is decided FIRST, by an exact/deterministic
// phrase match — self-echo fuzzy matching is never consulted for STOP
// and can never turn ordinary speech into a STOP.
//
// สิ่งที่ห้ามแตะ: never implement read_screen/speak/intent-resolution
// here — always hand off the transcript to dispatch-cli.ts unchanged.
// Never call setVoiceProcessingEnabled or any other API that alters
// system output volume / device gain.

import AppKit
import AVFoundation
import Foundation
import Speech

let repoRoot = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE"
let dispatchCliPath = "\(repoRoot)/connections/voice-command/dispatch-cli.ts"
let tsxPath = "\(repoRoot)/node_modules/.bin/tsx"
let activeSpeechPath = "\(repoRoot)/connections/os-ui/data/active-speech.json"
let recognitionLocale = "th-TH"
let listenWindowSeconds: Double = 4

/** Exact, deterministic — never fuzzy. The ONLY way a transcript becomes STOP.
 * 2026-08-21 addition (Owner instruction — permanent interrupt priority
 * list): "หยุดพูด"/"เงียบ" added as their own explicit entries — this set
 * is matched exactly/by-token (see isExactStop below), so a fused
 * compound word like "หยุดพูด" does NOT already match via "หยุด" the way
 * a substring check would; it needs its own literal entry. */
let exactStopPhrases: Set<String> = ["หยุด", "หยุดอ่าน", "หยุดพูด", "พอ", "เงียบ", "stop"]

let hostLogPath = "\(repoRoot)/connections/voice-command/app-host/host.log"
let fastStopCliPath = "\(repoRoot)/connections/voice-command/fast-stop-cli.mjs"

let logTimestampFormatter: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
}()

func nowMs() -> Double {
    Date().timeIntervalSince1970 * 1000
}

func log(_ message: String) {
    let line = "[\(logTimestampFormatter.string(from: Date()))] \(message)\n"
    FileHandle.standardError.write(line.data(using: .utf8)!)
    if let data = line.data(using: .utf8) {
        if let fh = FileHandle(forWritingAtPath: hostLogPath) {
            fh.seekToEndOfFile()
            fh.write(data)
            fh.closeFile()
        } else {
            FileManager.default.createFile(atPath: hostLogPath, contents: data)
        }
    }
}

func normalize(_ s: String) -> String {
    s.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
}

/**
 * Exact/deterministic only — never a substring/fuzzy match. Matches if
 * the WHOLE transcript is exactly a stop phrase, OR any single
 * whitespace-separated TOKEN within it exactly equals one (catches
 * "หยุด" spoken as one word inside a longer utterance, e.g. "โอเค
 * หยุด", without ever matching a compound word like "สั่งหยุด" that
 * merely CONTAINS the substring "หยุด").
 */
func isExactStop(_ transcript: String) -> Bool {
    let normalized = normalize(transcript)
    if exactStopPhrases.contains(normalized) { return true }
    let tokens = normalized.split(separator: " ").map(String.init)
    return tokens.contains { exactStopPhrases.contains($0) }
}

/** The real text DNA OS is speaking right now, if any — read directly from the shared file ../os-ui/voice-queue.mjs writes/clears around each real `say` call. */
func readActiveSpeechText() -> String? {
    guard let data = FileManager.default.contents(atPath: activeSpeechPath),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let text = obj["text"] as? String else { return nil }
    return text
}

/** Fuzzy, deterministic word-overlap check — used ONLY to decide SELF_ECHO (drop), never STOP. A transcript sharing most of its words with what DNA OS is currently speaking is classified as an echo of that speech. */
func isSelfEcho(transcript: String, activeSpeechText: String) -> Bool {
    let transcriptWords = Set(normalize(transcript).split(separator: " ").map(String.init)).filter { !$0.isEmpty }
    guard !transcriptWords.isEmpty else { return false }
    let activeWords = Set(normalize(activeSpeechText).split(separator: " ").map(String.init))
    let overlap = transcriptWords.intersection(activeWords)
    let ratio = Double(overlap.count) / Double(transcriptWords.count)
    if normalize(activeSpeechText).contains(normalize(transcript)) { return true } // transcript is a literal substring of what's being spoken.
    return ratio >= 0.6
}

/**
 * FAST INTERRUPT PATH (Owner instruction, 2026-08-21 — real trace
 * evidence showed STOP arriving too late because it only ever acted on
 * the FINAL transcript, after the fixed listen window + endAudio() +
 * a `tsx` subprocess cold start ~400ms, per real measurement). Called
 * the instant a PARTIAL transcript exact-matches a deterministic STOP
 * phrase — never for READ or any other command, which still wait for
 * the final transcript as before. Reuses the EXISTING
 * `cancelActiveSpeech()` (../os-ui/voice-queue.mjs) via a plain-JS
 * (never tsx) invocation — ~30ms cold start, measured, vs ~400ms for
 * tsx — never a new cancellation mechanism, only a faster path to the
 * same real function. The full, unchanged dispatch (audit/state
 * transition via ../dispatcher.ts's handleTranscript) still runs
 * afterward, asynchronously, so STOP still produces real evidence —
 * it just never blocks the actual speech termination on that first.
 */
func dispatchFastStop(matchedAt: Double, transcript: String) {
    log("STOP_MATCH_PARTIAL phrase=\(transcript) t_ms=\(matchedAt)")
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    process.arguments = ["node", fastStopCliPath]
    process.currentDirectoryURL = URL(fileURLWithPath: repoRoot)
    let stdoutPipe = Pipe()
    process.standardOutput = stdoutPipe
    do {
        try process.run()
        process.waitUntilExit()
        let terminatedAt = nowMs()
        let outData = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
        let out = String(data: outData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        log("SAY_PROCESS_TERMINATED result=\(out) t_ms=\(terminatedAt) latency_ms=\(terminatedAt - matchedAt)")
    } catch {
        log("FAST_STOP_FAILED error=\(error)")
    }
}

func dispatchTranscript(_ text: String) {
    log("DISPATCH transcript=\(text)")
    let process = Process()
    process.executableURL = URL(fileURLWithPath: tsxPath)
    process.arguments = [dispatchCliPath, text]
    process.currentDirectoryURL = URL(fileURLWithPath: repoRoot)
    let stdoutPipe = Pipe()
    process.standardOutput = stdoutPipe
    do {
        try process.run()
        process.waitUntilExit()
        let outData = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
        let out = String(data: outData, encoding: .utf8) ?? ""
        log("DISPATCH exit=\(process.terminationStatus) result=\(out.trimmingCharacters(in: .whitespacesAndNewlines))")
    } catch {
        log("DISPATCH_FAILED error=\(error)")
    }
}

final class Listener {
    private let audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: recognitionLocale))
    /** Guards against firing the fast STOP path more than once for the same utterance — partial results often repeat the same matched word across several callbacks. */
    private var hasFastStoppedThisRequest = false
    private var micAudioStartMs: Double = 0

    func start() {
        guard let recognizer = recognizer, recognizer.isAvailable else {
            log("RECOGNIZER_UNAVAILABLE locale=\(recognitionLocale)")
            return
        }
        hasFastStoppedThisRequest = false
        let newRequest = SFSpeechAudioBufferRecognitionRequest()
        newRequest.shouldReportPartialResults = true // required for the fast STOP path — READ/other commands still only act on the final transcript.
        if recognizer.supportsOnDeviceRecognition { newRequest.requiresOnDeviceRecognition = true }
        request = newRequest

        // No VPIO, no setVoiceProcessingEnabled, no gain/volume-affecting
        // API of any kind — the tap below unconditionally appends every
        // buffer. Continuous listening, including while DNA OS speaks,
        // is achieved by NEVER muting capture; self-echo is filtered at
        // the TRANSCRIPT level after recognition (see the completion
        // handler below), not at the audio level.
        let inputNode = audioEngine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        inputNode.removeTap(onBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.request?.append(buffer)
        }

        do {
            audioEngine.prepare()
            try audioEngine.start()
            micAudioStartMs = nowMs()
            log("LISTENING t_ms=\(micAudioStartMs)")
        } catch {
            log("AUDIO_ENGINE_START_FAILED error=\(error)")
            return
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + listenWindowSeconds) { [weak self] in
            guard let self = self, self.request === newRequest else { return }
            self.request?.endAudio()
        }

        task = recognizer.recognitionTask(with: newRequest) { [weak self] result, error in
            guard let self = self else { return }
            if let result = result, !result.isFinal {
                let partialText = result.bestTranscription.formattedString
                log("PARTIAL_TRANSCRIPT=\(partialText)")
                if !self.hasFastStoppedThisRequest && isExactStop(partialText) {
                    self.hasFastStoppedThisRequest = true
                    let matchedAt = nowMs()
                    log("MIC_TO_STOP_PARTIAL_LATENCY_MS=\(matchedAt - self.micAudioStartMs)")
                    dispatchFastStop(matchedAt: matchedAt, transcript: partialText)
                    // The real audit/state transition still happens through the existing, unchanged dispatcher — on a background queue, so it never delays or blocks the actual speech termination above.
                    DispatchQueue.global(qos: .userInitiated).async {
                        dispatchTranscript(partialText)
                    }
                }
            }
            if let result = result, result.isFinal {
                let text = result.bestTranscription.formattedString
                log("FINAL_TRANSCRIPT=\(text)")
                let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                if trimmed.isEmpty {
                    log("EMPTY_TRANSCRIPT_SKIPPED")
                } else if isExactStop(trimmed) {
                    // Tier 1 — exact/deterministic STOP, highest priority, checked BEFORE self-echo filtering.
                    log("STOP_MATCHED_EXACT phrase=\(trimmed)")
                    dispatchTranscript(text)
                } else if let activeText = readActiveSpeechText(), isSelfEcho(transcript: trimmed, activeSpeechText: activeText) {
                    // Tier 2 — fuzzy, but ONLY ever produces a drop, never a STOP or a fabricated intent.
                    log("SELF_ECHO_DETECTED transcript=\(trimmed) active=\(activeText)")
                } else {
                    // Tier 3 — everything else goes to the existing, unchanged, deterministic intent resolver.
                    dispatchTranscript(text)
                }
                self.restart()
                return
            }
            if let error = error {
                log("RECOGNITION_ERROR=\(error.localizedDescription)")
                self.restart()
            }
        }
    }

    func stop() {
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        request = nil
        task?.cancel()
        task = nil
    }

    func restart() {
        stop()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
            self?.start()
        }
    }
}

let listener = Listener()

func requestPermissionsThenListen() {
    log("REQUESTING_SPEECH_AUTHORIZATION")
    SFSpeechRecognizer.requestAuthorization { speechStatus in
        DispatchQueue.main.async {
            log("SPEECH_AUTH_STATUS=\(speechStatus.rawValue)") // 0=notDetermined 1=denied 2=restricted 3=authorized
            guard speechStatus == .authorized else {
                log("SPEECH_AUTH_NOT_GRANTED status=\(speechStatus.rawValue)")
                return
            }
            log("REQUESTING_MICROPHONE_AUTHORIZATION")
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                DispatchQueue.main.async {
                    log("MIC_AUTH_GRANTED=\(granted)")
                    guard granted else {
                        log("MIC_AUTH_DENIED")
                        return
                    }
                    listener.start()
                }
            }
        }
    }
}

class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        log("APP_DID_FINISH_LAUNCHING bundle=\(Bundle.main.bundleIdentifier ?? "unknown")")
        requestPermissionsThenListen()
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
