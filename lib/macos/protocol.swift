import Foundation

/// Driver Protocol — มาตรฐานกลางของ DNA OS
/// ทุก Driver ต้อง implement protocol นี้
protocol Driver {
    var name: String { get }
    var bundleId: String { get }

    func connect() -> [String: Any]
    func status() -> [String: Any]
    func focus() -> [String: Any]
    func close() -> [String: Any]
    func execute(command: String, args: [String: String]) -> [String: Any]
}
