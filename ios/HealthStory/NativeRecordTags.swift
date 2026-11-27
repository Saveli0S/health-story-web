import SwiftUI

enum NativeRecordTagKind:String {
    case visit,lab,exam

    func exists(in profile:JournalObject,id:String)->Bool {
        switch self {
        case .visit: NativeTreatments.visits(profile).contains{NativeTreatments.field($0,0)==id}
        case .lab: entries(profile,"files").contains {
            caption($0,"id")==id && $0["examDraft"]==nil && ($0["lab"] != nil || caption($0,"category")=="Лаборатория")
        }
        case .exam: entries(profile,"exams").contains{caption($0,"id")==id}
        }
    }
}

struct NativeRecordTags:View {
    @ObservedObject var journal:DeviceJournal
    let owner:String,kind:NativeRecordTagKind,id:String
    @State private var editing=false
    @State private var selection=Set<String>()
    @State private var error=""
    var body:some View {
        let profile=journal.profile(owner),library=entries(journal.data,"tags")
        let tags=RecordTags(profile:profile,library:library),key=kind.rawValue+":"+id
        let names=tags.names(key)
        if kind.exists(in:profile,id:id),!names.isEmpty || (journal.editable && !library.isEmpty) {
            Section("Теги") {
                if !names.isEmpty {Text(names.joined(separator:" · ")).font(JournalTheme.body)}
                if journal.editable {
                    Button(names.isEmpty ? "Добавить теги":"Изменить теги"){
                        selection=tags.selectedIDs(key);error="";editing=true
                    }.disabled(journal.busy).sheet(isPresented:$editing){
                        editor(key,library:library,automatic:tags.inferredIDs(key))
                    }
                }
            }
        }
    }

    private func editor(_ key:String,library:[JournalObject],automatic:Set<String>)->some View {
        NavigationStack {
            Form {
                ForEach(library.indices,id:\.self){index in
                    let row=library[index],tagID=caption(row,"id")
                    Toggle(isOn:Binding(get:{selection.contains(tagID)},set:{enabled in
                        if enabled {selection.insert(tagID)}else{selection.remove(tagID)}
                    })){
                        VStack(alignment:.leading,spacing:4){
                            Text(caption(row,"name"))
                            if automatic.contains(tagID) {Text("По содержанию").font(.caption).foregroundStyle(.secondary)}
                        }
                    }.accessibilityIdentifier("record-tag-"+tagID)
                }
                if !error.isEmpty {Text(error).foregroundStyle(.red)}
            }.navigationTitle("Теги записи").toolbar{
                ToolbarItem(placement:.cancellationAction){Button("Отмена"){editing=false}}
                ToolbarItem(placement:.confirmationAction){
                    Button("Сохранить теги"){save(key,library:library)}.disabled(journal.busy || !journal.editable)
                }
            }
        }
    }

    private func save(_ key:String,library:[JournalObject]) {
        do {
            try journal.changeProfile(owner){profile in
                guard kind.exists(in:profile,id:id) else {throw JournalError("Запись больше недоступна.")}
                let automatic=RecordTags(profile:profile,library:library).inferredIDs(key)
                var edits=entries(profile,"tagEdits")
                let old=edits.first{caption($0,"id")==key}?["values"] as? [String:Bool] ?? [:]
                let values=Dictionary(uniqueKeysWithValues:Set(library.map{caption($0,"id")}).compactMap{ id -> (String,Bool)? in
                    let selected=selection.contains(id)
                    return selected != automatic.contains(id) || old[id] != nil ? (id,selected):nil
                })
                edits.removeAll{caption($0,"id")==key}
                if !values.isEmpty {edits.append(["id":key,"values":values])}
                profile["tagEdits"]=edits
            }
            editing=false
        } catch {self.error=error.localizedDescription}
    }
}
