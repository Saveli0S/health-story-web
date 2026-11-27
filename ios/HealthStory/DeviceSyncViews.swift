import SwiftUI

struct ProfileSyncLinks:View {
    @ObservedObject var journal:DeviceJournal
    let owner:String
    var body:some View {
        let count=journal.conflicts(owner).count
        Section("Обмен и хранение"){
            NavigationLink("Оригиналы без сети"){OfflineOriginals(journal:journal,owner:owner)}
            NavigationLink(count>0 ? "Расхождения · "+String(count) : "Расхождения"){ProfileConflicts(journal:journal,owner:owner)}
        }
    }
}

private struct ProfileConflicts:View {
    @ObservedObject var journal:DeviceJournal
    let owner:String
    @State private var error=""
    private func title(_ c:JournalObject) -> String {
        let path=c["path"] as? [Any] ?? [],slot=path.first as? String ?? ""
        let groups=["fields":"Медкарта","addedVisits":"Визиты","files":"Вложения","measurements":"Измерения","auto":"Автоанализ","directAuto":"Автоотправка в OpenRouter","chatGPTAuto":"Автоотправка в ChatGPT","consultations":"Консультации","notes":"Пометки"]
        let recordID=path.compactMap{($0 as? JournalObject)?["id"] as? String}.first
        let profile=journal.profile(owner)
        let record=entries(profile,slot).first{caption($0,"id")==recordID}
        let named=record.flatMap{r in ["label","title","name"].map{caption(r,$0)}.first{!$0.isEmpty}}
        return [groups[slot] ?? slot,named ?? (path.count>1 ? path.last as? String ?? "" : "")].filter{!$0.isEmpty}.joined(separator:" · ")
    }
    private func display(_ variant:JournalObject) -> String {
        if variant["removed"] as? Bool==true{return "Удалено"}
        if let s=variant["value"] as? String{return s}
        guard let value=variant["value"],let encoded=try? jsonBytes(value) else {return "Пустое значение"}
        return String(decoding:encoded,as:UTF8.self)
    }
    var body:some View {
        let conflicts=journal.conflicts(owner)
        List {
            ForEach(conflicts.indices,id:\.self){i in
                let c=conflicts[i],lane=caption(c,"lane"),queued=journal.queuedSide(owner,conflict:c)
                Section(title(c)){
                    ForEach(["local","remote"],id:\.self){side in
                        let v=c[side] as? JournalObject ?? [:]
                        VStack(alignment:.leading,spacing:6){
                            Text(display(v));Text(caption(v,"author")+" · "+caption(v,"time")).font(.caption).foregroundStyle(.secondary)
                            if queued==side {Text("Выбрано · ожидает обмена").font(.caption)}
                            else if journal.mayResolve(owner,lane:lane) {
                                Button("Выбрать это значение"){
                                    do{try journal.resolve(owner,id:caption(c,"id"),lane:lane,side:side);error=""}catch{self.error=error.localizedDescription}
                                }.buttonStyle(.borderless).disabled(journal.busy)
                            }
                        }
                    }
                }
            }
            if conflicts.isEmpty {Text("Все расхождения разрешены.")}
            if !error.isEmpty {Text(error).foregroundStyle(.red)}
        }.navigationTitle("Расхождения")
    }
}

private struct OfflineOriginals:View {
    @ObservedObject var journal:DeviceJournal
    let owner:String
    var body:some View {
        let p=journal.profile(owner),files=entries(p,"files").filter{$0["examDraft"] == nil},cached=journal.cachedIDs(owner)
        let episodes=NativeTreatments.episodes(p).map{(id:$0.id,name:$0.name,files:DeviceSyncRules.scopedFiles(profile:p,episode:$0.id))}
            .filter{!$0.files.isEmpty}
        List {
            if !episodes.isEmpty {
                Section("Сохранить эпизод"){
                    ForEach(episodes,id:\.id){ep in
                        OfflineSaveButton(journal:journal,owner:owner,files:ep.files,title:ep.name)
                    }
                }
            }
            Section("Отдельные вложения"){
                ForEach(files.indices,id:\.self){i in
                    let f=files[i],saved=cached.contains(caption(f,"id"))
                    if saved {
                        NavigationLink {DeviceAttachment(journal:journal,owner:owner,id:caption(f,"id"),name:caption(f,"name"))} label:{
                            VStack(alignment:.leading,spacing:4){
                                Label(caption(f,"name"),systemImage:"checkmark.circle")
                                Text("Доступно без сети").font(.caption).foregroundStyle(.secondary)
                            }
                        }.accessibilityLabel(caption(f,"name")).accessibilityHint("Доступно без сети")
                    }else{OfflineSaveButton(journal:journal,owner:owner,files:[f],title:caption(f,"name"))}
                }
            }
        }.navigationTitle("Без сети")
    }
}

struct OfflineSaveButton:View {
    @ObservedObject var journal:DeviceJournal
    let owner:String,files:[JournalObject],title:String
    @State private var completed:Int?
    @State private var error=""
    var body:some View {
        let ids=files.map{caption($0,"id")}.filter{!$0.isEmpty}
        let cached=journal.cachedIDs(owner),ready=ids.filter(cached.contains).count
        VStack(alignment:.leading,spacing:4){
            Button {
                completed=0;error=""
                Task {
                    defer{completed=nil}
                    do {try await journal.saveOffline(owner:owner,ids:ids){completed=$0}}
                    catch {self.error=error.localizedDescription}
                }
            } label:{
                Label(title,systemImage:ready==ids.count && !ids.isEmpty ? "checkmark.circle" : "arrow.down.circle")
            }.disabled(ids.isEmpty || ready==ids.count || completed != nil || journal.busy)
            if let completed {
                ProgressView("Сохранение \(completed) из \(ids.count)",value:Double(completed),total:Double(ids.count))
            } else if ids.isEmpty {
                Text("Вложений пока нет").font(.caption).foregroundStyle(.secondary)
            } else {
                let status=ready==ids.count ? "Доступно без сети · \(ready)" : "На устройстве · \(ready) из \(ids.count)"
                Text(status).font(.caption).foregroundStyle(.secondary)
            }
            if !error.isEmpty {Text(error).font(.caption).foregroundStyle(.secondary)}
        }
    }
}
