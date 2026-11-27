import Foundation

@main struct TagLibraryVerify {
    static func main() async throws {
        let args=CommandLine.arguments
        guard args.count==6,let endpoint=URL(string:args[1]),endpoint.host=="127.0.0.1" else {
            throw JournalError("Use an isolated local exchange.")
        }
        let script=try String(contentsOfFile:args[2],encoding:.utf8)
        func connect(_ path:String) async throws -> JournalObject {
            let payload=try jsonObject(Data(contentsOf:URL(fileURLWithPath:path)))
            let exchange=DeviceExchange(endpoint:endpoint)
            let active=try await exchange.sync(payload,mergeScript:script)
            guard let data=active["data"] as? JournalObject,
                  let tags=data["tags"] as? [JournalObject],
                  tags.contains(where:{$0["name"] as? String=="Справочник из веба"}) else {
                throw JournalError("The updated roster did not deliver the web tag.")
            }
            return data
        }
        func exchangeState(_ data:JournalObject) throws -> (JournalObject,JournalObject) {
            guard let ctx=data["sync"] as? JournalObject,let keys=ctx["tagLibrary"] as? JournalObject else {
                throw JournalError("Missing authenticated family tag configuration.")
            }
            return (ctx,keys)
        }
        let tag:JournalObject=["id":"ios-corpus","name":"Тег с iPhone","keywords":["Проверка QA"]]
        let admin=try await connect(args[3]),(ctx,keys)=try exchangeState(admin)
        _=try await DeviceExchange(endpoint:endpoint).changeFamilyTags(ctx,keys:keys){$0+[tag]}
        for packet in args[4...] {
            let data=try await connect(packet)
            guard (data["tags"] as? [JournalObject])?.contains(where:{$0["id"] as? String=="ios-corpus"})==true else {
                throw JournalError("A family member did not receive the new tag.")
            }
            let (restricted,publicKeys)=try exchangeState(data)
            do {
                _=try await DeviceExchange(endpoint:endpoint).changeFamilyTags(restricted,keys:publicKeys){_ in []}
                throw JournalError("A non-administrator changed the family library.")
            } catch let failure as ExchangeError where failure.status==403 {}
        }
        print("PASS native administrator publication, authorized family read, adult and child writes refused")
    }
}
