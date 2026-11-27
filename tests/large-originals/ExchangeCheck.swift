// Simulator-only interoperability check. Read a temporary, synthetic relay grant.
import Foundation
import CryptoKit

@main struct ExchangeCheck {
    static func main() async throws {
        let argv=CommandLine.arguments
        guard argv.count==4,
              let settings=try JSONSerialization.jsonObject(with:Data(contentsOf:URL(fileURLWithPath:argv[1]))) as? JournalObject,
              let endpoint=URL(string:settings["endpoint"] as? String ?? ""),
              ["127.0.0.1","localhost"].contains(endpoint.host ?? ""),
              let owner=settings["owner"] as? String,let ctx=settings["ctx"] as? JournalObject,let keys=settings["keys"] as? JournalObject
        else {throw JournalError("Expected an isolated local test relay.")}
        let input=try Data(contentsOf:URL(fileURLWithPath:argv[2])), id=argv[3], exchange=DeviceExchange(endpoint:endpoint)
        if settings["write"] as? Bool==true {
            try await exchange.publishOriginal(input,type:"application/zip",ctx:ctx,keys:keys,owner:owner,id:id)
        }
        let entry=try await exchange.original(ctx,keys,owner,id)
        guard entry["type"] as? String=="application/zip",let result=Data(base64Encoded:entry["bytes"] as? String ?? ""), result==input else {throw JournalError("Cross-platform original mismatch.")}
        print("PASS native ZIP",result.count,SHA256.hash(data:result).map{String(format:"%02x",$0)}.joined())
    }
}
