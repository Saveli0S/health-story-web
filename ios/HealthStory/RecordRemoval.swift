import SwiftUI
import JavaScriptCore

struct RemovableRecord: Decodable {
    let group: String
    let id: String
    let title: String
    let category: String
    let detail: String
    var index: Int?
    var other: String?
    var context: String?

    var identity: String { [group,id,index.map(String.init) ?? "",other ?? ""].map{"\($0.count):\($0)"}.joined() }
    var spec: JournalObject {
        var value:JournalObject=["group":group,"id":id]
        if let index {value["index"]=index}
        if let other {value["other"]=other}
        return value
    }
    static let clear = Self(group:"profile",id:"",title:"Медицинские данные профиля",category:"Медкарта",
                            detail:"Очищаются медицинские записи, вложения, история ИИ и личные шаблоны. Имя, роль и подключение сохраняются.")
}

@MainActor
enum NativeRecordRemoval {
    private static let context: JSContext? = {
        guard let url=Bundle.main.url(forResource:"record-removal",withExtension:"js"),
              let script=try? String(contentsOf:url,encoding:.utf8),let js=JSContext() else {return nil}
        js.evaluateScript(script)
        return js.exception==nil ? js : nil
    }()

    private static func run(_ expression:String,args:[Any]) throws -> Any {
        guard let js=context else {throw JournalError("Правила удаления недоступны.")}
        let data=try JSONSerialization.data(withJSONObject:args)
        js.exception=nil
        guard let function=js.evaluateScript("(function(raw){return JSON.stringify(("+expression+")(...JSON.parse(raw)))})"),
              let json=function.call(withArguments:[String(decoding:data,as:UTF8.self)])?.toString(),
              js.exception==nil else {throw JournalError("Не удалось обработать записи.")}
        return try JSONSerialization.jsonObject(with:Data(json.utf8),options:.fragmentsAllowed)
    }

    static func records(_ profile:JournalObject) throws -> [RemovableRecord] {
        let value=try run("p=>recordRemoval.entries(p)",args:[profile])
        return try JSONDecoder().decode([RemovableRecord].self,from:JSONSerialization.data(withJSONObject:value))
    }

    static func profile(_ profile:JournalObject, removing row:RemovableRecord) throws -> JournalObject {
        let value=try run("(p,spec)=>recordRemoval.remove(p,spec)",args:[profile,row.spec])
        guard let result=value as? JournalObject else {throw JournalError("Запись уже изменилась.")}
        return result
    }
}

struct ManageNativeRecords: View {
    @ObservedObject var journal:DeviceJournal
    let owner:String
    @State private var query=""
    @State private var category=""
    @State private var selection:RemovableRecord?
    @State private var confirming=false
    @State private var baseline:Data?
    @State private var listSnapshot:Data?
    @State private var notice=""
    @State private var records=[RemovableRecord]()

    var body:some View {
        let categories=Array(Set(records.map(\.category))).sorted()
        let filtered=records.filter{ row in
            (category.isEmpty || category==row.category) &&
            (query.trim.isEmpty || [row.title,row.category,row.context ?? ""].joined(separator:" ").localizedCaseInsensitiveContains(query.trim))
        }
        List {
            Picker("Тип записи",selection:$category){
                Text("Все записи").tag("")
                ForEach(categories,id:\.self){Text($0).tag($0)}
            }
            ForEach(filtered,id:\.identity){row in
                Button(role:.destructive){prepare(row)} label:{
                    VStack(alignment:.leading){
                        Text(row.title).foregroundStyle(.primary)
                        Text([row.category,row.context].compactMap{$0}.joined(separator:" · ")).font(.caption).foregroundStyle(.secondary)
                        Text("Удалить").font(.caption)
                    }
                }.accessibilityIdentifier("remove-"+row.group+"-"+row.id).disabled(!journal.editable || journal.busy)
            }
            if filtered.isEmpty {Text("Нет подходящих записей.").foregroundStyle(.secondary)}
            if journal.editable {
                Button("Очистить медицинские данные профиля",role:.destructive){prepare(.clear)}.disabled(journal.busy)
            }
            if !notice.isEmpty {Text(notice)}
        }.searchable(text:$query,placement:.navigationBarDrawer(displayMode:.always),prompt:"Поиск записи").navigationTitle("Управление данными")
            .onAppear{reload()}
            .onReceive(journal.$payload){value in
                let data=value["data"] as? JournalObject ?? [:]
                reload((data["profiles"] as? [String:JournalObject])?[owner])
            }
            .alert(selection?.group=="profile" ? "Очистить медицинские данные?" : "Удалить запись?",
                   isPresented:$confirming,presenting:selection) { row in
                Button(row.group=="profile" ? "Очистить данные" : "Удалить запись",role:.destructive){remove(row)}
                Button("Отмена",role:.cancel){}
            } message:{row in
                Text([row.title,row.detail,"Ранее сохранённые резервные копии содержат данные на момент их создания."].filter{!$0.isEmpty}.joined(separator:"\n\n"))
            }
    }
    private func reload(_ updated:JournalObject?=nil){
        do {
            let profile=updated ?? journal.profile(owner)
            records=try NativeRecordRemoval.records(profile)
            listSnapshot=try JSONSerialization.data(withJSONObject:profile,options:.sortedKeys)
            if !records.contains(where:{$0.category==category}){category=""}
        } catch {notice=error.localizedDescription}
    }
    private func prepare(_ row:RemovableRecord){
        do {
            let latest=try JSONSerialization.data(withJSONObject:journal.profile(owner),options:.sortedKeys)
            guard latest==listSnapshot else {reload();throw JournalError("Данные изменились. Снова выберите запись.")}
            baseline=latest
            selection=row
            confirming=true
        } catch {notice=error.localizedDescription}
    }
    private func remove(_ row:RemovableRecord){
        do {
            try journal.changeProfile(owner,pruneOriginals:true){ profile in
                guard try JSONSerialization.data(withJSONObject:profile,options:.sortedKeys)==baseline else {
                    throw JournalError("Данные изменились. Снова откройте запись для удаления.")
                }
                profile=try NativeRecordRemoval.profile(profile,removing:row)
            }
            reload()
            notice="Данные удалены."
        } catch {notice=error.localizedDescription}
    }
}
