// หน้าที่: real, offline sound classification over a whole WAV file, using
// Apple's own built-in `SoundAnalysis.framework` (`SNClassifySoundRequest`,
// `.version1` — the system's real, already-installed Core ML sound
// classifier, confirmed present via `find .../SoundAnalysis.framework`,
// never a downloaded model). One classifier window (default ~1.5s step /
// 3s length, Apple's own default) per stdout line, as JSON — the caller
// (../audio-classifier.mjs) aggregates windows into Segmenter segments;
// this binary has no notion of segments, sessions, or SILENCE/SPEECH_CANDIDATE
// at all, only raw classifier windows over the whole file.
//
// Input: argv[1] = path to a WAV file.
// Output: one JSON object per line to stdout:
//   {"start_s":number,"end_s":number,"top":[{"label":string,"confidence":number}, ...]}
// (top 5 labels by confidence, matching what a real test run against this
// exact classifier returned). Errors go to stderr with a nonzero exit code.
import Foundation
import AVFoundation
import SoundAnalysis

let args = CommandLine.arguments
guard args.count >= 2 else {
    FileHandle.standardError.write("usage: classify-tool <wav-path>\n".data(using: .utf8)!)
    exit(1)
}
let url = URL(fileURLWithPath: args[1])

final class Collector: NSObject, SNResultsObserving {
    var failed = false
    func request(_ request: SNRequest, didProduce result: SNResult) {
        guard let r = result as? SNClassificationResult else { return }
        let top = r.classifications.prefix(5).map { c -> [String: Any] in
            return ["label": c.identifier, "confidence": c.confidence]
        }
        let obj: [String: Any] = [
            "start_s": r.timeRange.start.seconds,
            "end_s": r.timeRange.start.seconds + r.timeRange.duration.seconds,
            "top": top,
        ]
        if let data = try? JSONSerialization.data(withJSONObject: obj),
           let line = String(data: data, encoding: .utf8) {
            print(line)
        }
    }
    func request(_ request: SNRequest, didFailWithError error: Error) {
        failed = true
        FileHandle.standardError.write("CLASSIFY_FAILED error=\(error)\n".data(using: .utf8)!)
    }
    func requestDidComplete(_ request: SNRequest) {}
}

do {
    let analyzer = try SNAudioFileAnalyzer(url: url)
    let request = try SNClassifySoundRequest(classifierIdentifier: .version1)
    let collector = Collector()
    try analyzer.add(request, withObserver: collector)
    analyzer.analyze()
    exit(collector.failed ? 1 : 0)
} catch {
    FileHandle.standardError.write("ERROR=\(error)\n".data(using: .utf8)!)
    exit(1)
}
