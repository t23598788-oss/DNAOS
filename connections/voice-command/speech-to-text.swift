// หน้าที่: the ONE real Speech-to-Text mechanism for Voice Control —
// Apple's own on-device/cloud Speech framework (SFSpeechRecognizer),
// the official macOS mechanism, matching this repo's established
// discipline of using official OS APIs (System Events for screen
// reading, `/usr/bin/say` for speech output — never a third-party
// pip/npm STT engine or an unconfigured cloud API this round).
//
// Usage: swift speech-to-text.swift <wav-file-path> [locale, default th-TH]
// Prints exactly one line to stdout on success: TRANSCRIPT=<text>
// Prints exactly one line to stdout on failure: ERROR=<reason>
// Never prints anything else — the Node caller parses only these two
// prefixes.
//
// สิ่งที่ห้ามแตะ: never log the raw transcript anywhere but stdout (no
// file write, no telemetry) — this file's only job is "audio in, text
// out, once."

import Foundation
import Speech

let arguments = CommandLine.arguments
guard arguments.count >= 2 else {
    print("ERROR=MISSING_WAV_PATH_ARGUMENT")
    exit(1)
}
let wavPath = arguments[1]
let localeIdentifier = arguments.count >= 3 ? arguments[2] : "th-TH"

let semaphore = DispatchSemaphore(value: 0)
var finalOutput = "ERROR=UNKNOWN"

func finish(_ output: String) {
    finalOutput = output
    semaphore.signal()
}

SFSpeechRecognizer.requestAuthorization { authStatus in
    switch authStatus {
    case .authorized:
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeIdentifier)), recognizer.isAvailable else {
            finish("ERROR=RECOGNIZER_UNAVAILABLE_FOR_LOCALE_\(localeIdentifier)")
            return
        }
        let url = URL(fileURLWithPath: wavPath)
        let request = SFSpeechURLRecognitionRequest(url: url)
        request.shouldReportPartialResults = false
        recognizer.recognitionTask(with: request) { result, error in
            if let error = error {
                finish("ERROR=RECOGNITION_FAILED_\(error.localizedDescription.replacingOccurrences(of: "\n", with: " "))")
                return
            }
            guard let result = result, result.isFinal else { return }
            let text = result.bestTranscription.formattedString.replacingOccurrences(of: "\n", with: " ")
            finish("TRANSCRIPT=\(text)")
        }
    case .denied:
        finish("ERROR=AUTHORIZATION_DENIED")
    case .restricted:
        finish("ERROR=AUTHORIZATION_RESTRICTED")
    case .notDetermined:
        finish("ERROR=AUTHORIZATION_NOT_DETERMINED")
    @unknown default:
        finish("ERROR=AUTHORIZATION_UNKNOWN_STATUS")
    }
}

let waitResult = semaphore.wait(timeout: .now() + 20)
if waitResult == .timedOut {
    print("ERROR=TRANSCRIPTION_TIMEOUT")
    exit(1)
}
print(finalOutput)
exit(finalOutput.hasPrefix("TRANSCRIPT=") ? 0 : 1)
