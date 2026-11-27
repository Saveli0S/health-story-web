// Copied exclusively into the disposable simulator test bundle.
import Foundation

@MainActor enum QASeed {
    static func open() -> DeviceJournal {
        precondition(Bundle.main.bundleIdentifier=="by.healthstory.medicalcorpus.sync")
        let seed=URL.documentsDirectory.appending(path:"synthetic-sync.json")
        if FileManager.default.fileExists(atPath:seed.path){
            do {try DeviceDisk().save(jsonObject(Data(contentsOf:seed)));try FileManager.default.removeItem(at:seed)}
            catch {fatalError("Failed to install synthetic fixture: "+error.localizedDescription)}
        }
        let offline=ProcessInfo.processInfo.arguments.contains("--offline")
        let address=URL.documentsDirectory.appending(path:"qa-relay.txt")
        let endpoint=try? String(contentsOf:address,encoding:.utf8)
        guard let endpoint, let url=URL(string:endpoint), ["127.0.0.1","localhost"].contains(url.host ?? "") else {fatalError("Expected isolated relay")}
        return DeviceJournal(exchangeEndpoint:offline ? URL(string:"http://127.0.0.1:1")! : url)
    }
}
