// Compiled only in the isolated QA application by run-device.sh.
import SwiftUI
import PDFKit
@main struct SmokeApp: App {
    var body: some Scene {WindowGroup{SmokeView()}}
}
struct SmokeView:View {
    @State var status="Готовим проверку"
    let doc=URL.documentsDirectory
    func mark(_ name:String,_ bytes:Data) throws {try bytes.write(to:doc.appendingPathComponent(name),options:.atomic)}
    func wait(_ name:String) async throws -> Data {
        for _ in 0..<480 {
            if let bytes=try? Data(contentsOf:doc.appendingPathComponent(name)) {return bytes}
            try await Task.sleep(for:.milliseconds(500))
        }
        throw JournalError("Истекло время ожидания "+name)
    }
    @MainActor func verifyOfflineReadback(_ prefix:String) async throws {
        _=try Data(contentsOf:doc.appending(path:prefix+"passed"))
        let expected=try Data(contentsOf:doc.appending(path:prefix+"pdf"))
        // A fresh process can only read this original from the device.
        let journal=DeviceJournal(exchangeEndpoint:URL(string:"http://127.0.0.1:1/")!)
        let owner="p-child", file="from-web"
        guard journal.cachedIDs(owner).contains(file),
              let visit=(journal.profile(owner)["addedVisits"] as? [[Any]])?.first,
              visit.indices.contains(5),visit[5] as? String=="Проверено в вебе" else {
            throw JournalError("Веб-правка или PDF не сохранились после перезапуска.")
        }
        let original=try await journal.attachment(owner:owner,id:file)
        guard original.bytes==expected,let pdf=PDFDocument(data:original.bytes), let page=pdf.page(at:0),
              let image=page.thumbnail(of:CGSize(width:500,height:700),for:.mediaBox).pngData(),!image.isEmpty else {
            throw JournalError("PDF после перезапуска не совпал или не открылся.")
        }
        try mark(prefix+"offline-preview.png",image)
        try mark(prefix+"offline-passed",Data("PASS: saved web edit and identical original opened by PDFKit after restart with cloud access disabled".utf8))
        status="Сохранённый PDF открылся без облака"
    }
    @MainActor func run() async throws {
        guard Bundle.main.bundleIdentifier=="by.healthstory.devicecheck" else {throw JournalError("Ожидалось тестовое приложение.")}
        let run=String(decoding:try Data(contentsOf:doc.appending(path:"test-run")),as:UTF8.self)
        let prefix=run+"-"
        if CommandLine.arguments.contains("--reinstall-readback") {
            let disk=try DeviceDisk()
            guard try disk.load()==nil,SavedArchiveKey.exists() else {
                throw JournalError("Не подтверждено чистое хранилище или наличие защищённого ключа.")
            }
            let journal=DeviceJournal()
            guard !journal.paired,journal.hasSavedConnection else {throw JournalError("Сохранённый доступ не найден.")}
            await journal.reconnect()
            let rows=journal.profile("p-child")["addedVisits"] as? [[Any]] ?? []
            guard journal.paired,journal.admin,rows.contains(where:{NativeTreatments.field($0,5)=="Проверено в вебе"}) else {
                throw JournalError(journal.message ?? "После переустановки не получена последняя синхронизированная запись.")
            }
            let expected=try await wait(prefix+"pdf")
            let actual=try await journal.attachment(owner:"p-child",id:"from-web")
            guard expected==actual.bytes else {throw JournalError("Оригинал после переустановки отличается.")}
            try mark(prefix+"reinstall-passed",Data("PASS: native app uninstalled and reinstalled; protected key still present; family access and cloud PDF recovered without a new invitation".utf8))
            status="Подключение восстановлено"
            return
        }
        if CommandLine.arguments.contains("--offline-readback") {
            try await verifyOfflineReadback(prefix)
            return
        }
        // This bundle is a disposable fixture. Never reset either storage file in the family application.
        let disk=try DeviceDisk()
        if FileManager.default.fileExists(atPath:disk.url.path){try FileManager.default.removeItem(at:disk.url)}
        let journal=DeviceJournal(), ident=try DeviceIdentity()
        try mark(prefix+"request",try ident.request(revision:0))
        let packet=try await wait(prefix+"packet"),code=String(decoding:try await wait(prefix+"code"),as:UTF8.self)
        try journal.install(packet,code:code,identity:ident)
        let admin=String(decoding:try await wait(prefix+"role"),as:UTF8.self)=="admin"
        let profiles=Set(journal.members.compactMap{$0["id"] as? String})
        let adminID=caption(journal.data["family"] as? JournalObject ?? [:],"adminId")
        let expected:Set<String>=admin ? ["p-adult","p-child",adminID] : ["p-adult","p-child"]
        guard journal.editable,journal.admin==admin,profiles==expected else {throw JournalError("Неверные роли")}
        if admin {
            guard !journal.mayResolve("p-adult",lane:"consent"),journal.mayResolve("p-child",lane:"consent") else {
                throw JournalError("Разрешения согласия не соответствуют роли.")
            }
            try journal.changeProfile("p-child"){p in
                var fields=entries(p,"fields")
                fields.append(["id":"qa-ios-field","label":"Тестовое поле","value":"Проверено на iPhone"]);p["fields"]=fields
            }
        }
        let original=try await wait(prefix+"pdf")
        var draft=NativeVisitDraft(); draft.episode="Эпизод iPhone";draft.title="Визит с iPhone";draft.doctor="Тестовый врач";draft.specialty="Терапевт"
        draft.recommendation="Проверка связи с бланком"
        draft.files.append(NativeUpload(name:"Тестовый анализ.pdf",mime:"application/pdf",bytes:original))
        let visit=try journal.saveVisit(owner:"p-child",draft:draft)
        if admin {
            let attachment=NativeUpload(id:"native-existing-visit",category:"Рекомендации",name:"QA.txt",mime:"text/plain",bytes:Data("QA synthetic attachment".utf8))
            let ids=try journal.addVisitAttachments(owner:"p-child",visit:visit,uploads:[attachment,attachment])
            let known=entries(journal.profile("p-child"),"files").filter{caption($0,"id")==attachment.id}
            guard ids==[attachment.id,attachment.id],known.count==1,known.first?["checked"] as? Bool==false else {
                throw JournalError("Нарушена сверка или защита от повторного вложения.")
            }
        }
        let stored=try DeviceDisk().load()
        guard ((stored?["data"] as? JournalObject)?["access"] as? JournalObject)?["edited"] as? Bool==true else {throw JournalError("Очередь не сохранилась")}
        await journal.sync()
        guard !journal.pending else {throw JournalError(journal.message ?? "Визит не передан")}
        try mark(prefix+"uploaded",Data("ok".utf8))
        _=try await wait(prefix+"web-edited")
        await journal.sync()
        let p=journal.profile("p-child")
        guard let received=(p["addedVisits"] as? [[Any]])?.first,received[5] as? String=="Проверено в вебе",
              let file=(p["files"] as? [JournalObject])?.first(where:{$0["id"] as? String=="from-web"}) else {throw JournalError(journal.message ?? "Обратная правка не получена")}
        let actual=try await journal.attachment(owner:"p-child",id:file["id"] as! String)
        guard actual.bytes==original else {throw JournalError("Байты PDF изменились")}
        if admin {
            let key=Data(repeating:24,count:32).base64EncodedString()
            guard !journal.cachedIDs("p-child").contains("backup-web") else {throw JournalError("Ожидался оригинал только на сервере.")}
            let backup=try await journal.exportAdmin(recoveryKey:key)
            let restored=try FamilyArchive(encrypted:backup,recoveryKey:key)
            guard restored.family.members.count==3,restored.originals["p-child/backup-web"]?.bytes==original,
                  let file=restored.originals["p-child/backup-web"],PDFDocument(data:file.bytes)?.page(at:0) != nil,
                  let body=(try restored.rawPayload())["data"] as? JournalObject,body["sync"]==nil,body["access"]==nil else {
                throw JournalError("Полная копия не восстановила учебный файл.")
            }
            guard let record=try NativeRecordRemoval.records(p).first(where:{$0.id=="backup-web"}) else {
                throw JournalError("Оригинал недоступен для удаления.")
            }
            try journal.changeProfile("p-child",pruneOriginals:true){profile in
                profile=try NativeRecordRemoval.profile(profile,removing:record)
            }
            await journal.sync()
            guard !journal.pending else {throw JournalError(journal.message ?? "Удаление не передано.")}
        }
        let result=admin ? "PASS: administrator pairing, consent scope, profile edit, PDF backup and restore, synchronized deletion" :
            "PASS: pairing, scoped profiles, durable queue, native visit and PDF to web, web edit and PDF to iPhone"
        if FileManager.default.fileExists(atPath:doc.appending(path:prefix+"reinstall").path) {
            try SavedArchiveKey.remember(Data(repeating:66,count:32))
            guard SavedArchiveKey.exists() else {throw JournalError("Защищённый тестовый ключ не найден.")}
        }
        try mark(prefix+"passed",Data(result.utf8))
        status="Визит и PDF проверены"
    }
    var body:some View {Text(status).task {
        do {try await run()}catch {
            status=error.localizedDescription
            if let run=try? String(contentsOf:doc.appending(path:"test-run"),encoding:.utf8) {
                let result=CommandLine.arguments.contains("--offline-readback") ? "-offline-failed" :
                    CommandLine.arguments.contains("--reinstall-readback") ? "-reinstall-failed" : "-failed"
                try? mark(run+result,Data(status.utf8))
            }
        }
    }}
}
