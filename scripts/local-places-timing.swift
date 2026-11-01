// Standalone simulator measurement. Does not launch or modify the Aresium app or read its store.
import Foundation
import JavaScriptCore
import CryptoKit
import zlib

func summary(_ values: [Double]) -> [String: Double] {
    let sorted = values.sorted()
    return ["medianMs": sorted[sorted.count / 2], "p95Ms": sorted[Int(ceil(Double(sorted.count) * 0.95)) - 1],
            "minMs": sorted.first!, "maxMs": sorted.last!]
}
guard CommandLine.arguments.count == 4 else { fatalError("Supply baseline bundle, optional bundle and data JSON") }
let paths = Array(CommandLine.arguments.dropFirst())
let baseline = try String(contentsOfFile: paths[0], encoding: .utf8)
let optional = try String(contentsOfFile: paths[1], encoding: .utf8)
let storedData = try Data(contentsOf: URL(fileURLWithPath: paths[2]))
let compressed = storedData.starts(with: [0x1f, 0x8b])
func decodeData() throws -> String {
    if !compressed { return String(decoding: storedData, as: UTF8.self) }
    var stream = z_stream()
    guard inflateInit2_(&stream, 15 + 16, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) == Z_OK else { fatalError("gzip init failed") }
    defer { inflateEnd(&stream) }
    var decoded = Data()
    try storedData.withUnsafeBytes { input in
        stream.next_in = UnsafeMutablePointer<Bytef>(mutating: input.bindMemory(to: Bytef.self).baseAddress!)
        stream.avail_in = uInt(input.count)
        var status: Int32 = Z_OK
        repeat {
            var buffer = [UInt8](repeating: 0, count: 65536)
            let produced = buffer.withUnsafeMutableBufferPointer { output -> Int in
                stream.next_out = output.baseAddress!
                stream.avail_out = uInt(output.count)
                status = inflate(&stream, Z_NO_FLUSH)
                return output.count - Int(stream.avail_out)
            }
            guard status == Z_OK || status == Z_STREAM_END else { throw NSError(domain: "TimingGzip", code: Int(status)) }
            decoded.append(contentsOf: buffer.prefix(produced))
        } while status != Z_STREAM_END
    }
    return String(decoding: decoded, as: UTF8.self)
}
let data = try decodeData()
var start = [[Double](), [Double]()]
var parsing = [Double]()
for trial in 0..<22 {
    for variant in trial % 2 == 0 ? [0, 1] : [1, 0] {
        try autoreleasepool {
            let t0 = CFAbsoluteTimeGetCurrent()
            guard let context = JSContext() else { fatalError("No JavaScriptCore context") }
            context.evaluateScript(variant == 0 ? baseline : optional)
            let t1 = CFAbsoluteTimeGetCurrent()
            if variant == 1 {
                let loadedData = try decodeData()
                context.setObject(loadedData, forKeyedSubscript: "localPlacesJSON" as NSString)
                context.evaluateScript("globalThis.localPlaces = JSON.parse(localPlacesJSON)")
            }
            if let exception = context.exception { throw NSError(domain: "TimingJavaScript", code: 1, userInfo: [NSLocalizedDescriptionKey: exception.toString() ?? "exception"]) }
            let t2 = CFAbsoluteTimeGetCurrent()
            if trial >= 2 {
                start[variant].append((t2 - t0) * 1000)
                if variant == 1 { parsing.append((t2 - t1) * 1000) }
            }
        }
    }
}
func sha256(_ value: String) -> String { SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined() }
let result: [String: Any] = ["method": "Standalone iOS simulator JavaScriptCore, fresh JSContext including creation and evaluateScript, then optional gzip inflation, UTF-8 decoding, Swift string bridge and JSON.parse. File reads excluded. Not PhoneEngineTests or an app launch.",
                           "gzip": compressed, "storedBytes": storedData.count,
                           "runtime": ProcessInfo.processInfo.operatingSystemVersionString,
                           "model": ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] ?? "unknown",
                           "baselineBundleSha256": sha256(baseline), "optionalBundleSha256": sha256(optional), "dataSha256": sha256(data),
                           "samples": 20, "warmups": 2, "baselineStartup": summary(start[0]),
                           "optionalStartupWithData": summary(start[1]), "dataBridgeAndParse": summary(parsing),
                           "addedStartupPaired": summary(zip(start[1], start[0]).map { $0 - $1 }),
                           "addedStartupMedianMs": summary(start[1])["medianMs"]! - summary(start[0])["medianMs"]!]
let json = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys, .prettyPrinted])
print(String(decoding: json, as: UTF8.self))
