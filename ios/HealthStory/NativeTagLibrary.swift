import SwiftUI

struct NativeTagLibrary:View {
    @ObservedObject var journal:DeviceJournal
    var body:some View {
        let tags=entries(journal.data,"tags")
        List {
            if journal.canManageFamilyTags {
                NavigationLink("Создать тег"){NativeTagDefinition(journal:journal)}
            } else if journal.admin {
                Text("Сначала синхронизируйте обновлённый веб-дневник администратора.").font(.footnote)
            }
            if tags.isEmpty {Text("Справочник тегов пуст.")}
            ForEach(tags.indices,id:\.self){index in
                let tag=tags[index]
                if journal.canManageFamilyTags {
                    NavigationLink(caption(tag,"name")){NativeTagDefinition(journal:journal,tag:tag)}
                } else {Text(caption(tag,"name"))}
            }
        }.journalBackground().navigationTitle("Справочник тегов").navigationBarTitleDisplayMode(.inline)
    }
}

private struct NativeTagDefinition:View {
    @ObservedObject var journal:DeviceJournal
    let original:JournalObject
    @State private var name:String
    @State private var keywords:String
    @State private var error=""
    @State private var confirmsRemoval=false
    @State private var saving=false
    @Environment(\.dismiss) private var dismiss
    init(journal:DeviceJournal,tag:JournalObject=[:]){
        self.journal=journal;original=tag
        _name=State(initialValue:caption(tag,"name"))
        _keywords=State(initialValue:(tag["keywords"] as? [String] ?? []).joined(separator:", "))
    }
    var body:some View {
        let valid = !RecordTags.words(name).isEmpty && name.trim.count<=48 && keywords.count<=400
        Form {
            TextField("Название",text:$name)
            TextField("Ключевые слова через запятую",text:$keywords,axis:.vertical)
            if !error.isEmpty {Text(error).foregroundStyle(.red)}
            Button("Сохранить тег"){save()}.disabled(!valid || saving || journal.busy)
            if !original.isEmpty {
                Button("Удалить из справочника",role:.destructive){confirmsRemoval=true}.disabled(saving || journal.busy)
            }
        }.journalBackground().navigationTitle(original.isEmpty ? "Новый тег":"Редактировать тег")
            .confirmationDialog("Удалить тег «"+caption(original,"name")+"»?",isPresented:$confirmsRemoval,titleVisibility:.visible){
                Button("Удалить тег",role:.destructive){save(remove:true)}
            } message:{Text("Тег исчезнет из карточек и поиска у всей семьи. Медицинские записи сохранятся.")}
    }
    private func save(remove:Bool=false){
        let originalID=caption(original,"id"),id=originalID.isEmpty ? UUID().uuidString:originalID
        let title=name.trim,normalized=RecordTags.words(title)
        var aliases=[String]()
        for word in keywords.split(separator:",").map({String($0).trim}) where !word.isEmpty && !aliases.contains(word) {aliases.append(word)}
        let previousName=caption(original,"name"),previousKey=RecordTags.words(previousName)
        if !previousKey.isEmpty,previousKey != normalized,!aliases.contains(where:{RecordTags.words($0)==previousKey}) {
            aliases.append(previousName)
        }
        saving=true;error=""
        Task {
            defer{saving=false}
            do {
                try await journal.changeFamilyTags{list in
                    let index=list.firstIndex{caption($0,"id")==id}
                    let current=index.map{list[$0]} ?? [:]
                    guard try jsonBytes(current)==jsonBytes(original) else {
                        throw JournalError("Тег изменился на другом устройстве. Откройте справочник заново.")
                    }
                    if remove {return list.filter{caption($0,"id") != id}}
                    guard !normalized.isEmpty,!list.contains(where:{caption($0,"id") != id && RecordTags.words(caption($0,"name"))==normalized}) else {
                        throw JournalError("Проверьте название тега. Такое название уже есть в справочнике.")
                    }
                    var updated=list
                    let item:JournalObject=["id":id,"name":title,"keywords":aliases]
                    if let index {updated[index]=item}else{updated.append(item)}
                    return updated
                }
                dismiss()
            }catch{self.error=error.localizedDescription}
        }
    }
}
