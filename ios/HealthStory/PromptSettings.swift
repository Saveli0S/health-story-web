import SwiftUI
import JavaScriptCore

@MainActor enum NativePromptLibrary {
    static let defaults:[JournalObject]={
        guard let url=Bundle.main.url(forResource:"prompt-defaults",withExtension:"js"),
              let code=try? String(contentsOf:url,encoding:.utf8),let js=JSContext(),
              let templates=js.evaluateScript(code+"\n;builtinPrompts").toArray() as? [JournalObject] else{return []}
        return templates
    }()
    static func actor(_ journal:DeviceJournal)->String {
        journal.admin ? caption(journal.data["family"] as? JournalObject ?? [:],"adminId"):caption(journal.access,"member")
    }
    static func templates(_ journal:DeviceJournal)->[JournalObject] {
        var rows=defaults
        for item in entries(journal.data,"templates")+entries(journal.profile(actor(journal)),"templates"){
            rows.removeAll{caption($0,"id")==caption(item,"id")}
            if item["deleted"] as? Bool != true {rows.append(item)}
        }
        return rows
    }
}
struct NativePromptSettings:View {
    @ObservedObject var journal:DeviceJournal
    let owner:String
    @Environment(\.nativeChatGPT) private var chatGPT
    @State private var notice=""
    var body:some View {
        let p=journal.profile(owner),canChange=owner==NativePromptLibrary.actor(journal) || (journal.admin && journal.members.first{caption($0,"id")==owner}?["role"] as? String=="Ребёнок")
        List {
            Section("Параметры профиля"){
                Toggle("Запускать без подтверждения",isOn:flag("auto",p)).disabled(!canChange||journal.busy)
                Toggle("Автоотправка сверенного лечения в OpenRouter",isOn:flag("directAuto",p)).disabled(!canChange||journal.busy)
                Toggle("Автоотправка сверенного лечения в личный ChatGPT",isOn:flag("chatGPTAuto",p)).disabled(!canChange||journal.busy)
                Text("Разрешения синхронизируются с веб-дневником и действуют там при подключении провайдера.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Section("Личный ChatGPT"){
                Text(chatGPT == nil ? "Подключение на iPhone ожидает допуска OpenAI." : "Доступна отправка в пределах включённой квоты.")
                    .font(.footnote).foregroundStyle(.secondary)
                Link("Управление квотой ChatGPT",destination:URL(string:"https://chatgpt.com/settings/usage")!)
            }
            if !notice.isEmpty {Text(notice)}
            Section("Библиотека промптов"){
                NavigationLink("Создать промпт"){PromptEditor(journal:journal)}
                let rows=NativePromptLibrary.templates(journal)
                ForEach(rows.indices,id:\.self){i in NavigationLink(caption(rows[i],"name")){PromptEditor(journal:journal,original:rows[i])}}
            }
        }.navigationTitle("Промпты и согласие")
    }
    private func flag(_ name:String,_ profile:JournalObject)->Binding<Bool>{Binding(get:{profile[name] as? Bool ?? false},set:{v in
        do{
            guard journal.editable,owner==NativePromptLibrary.actor(journal) || (journal.admin && journal.members.first{caption($0,"id")==owner}?["role"] as? String=="Ребёнок") else {throw JournalError("Параметр недоступен.")}
            try journal.changeProfile(owner){$0[name]=v};notice=""
        }catch{notice=error.localizedDescription}
    })}
}
private struct PromptEditor:View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var journal:DeviceJournal
    let original:JournalObject
    @State private var title:String
    @State private var bodyText:String
    @State private var scope:String
    @State private var message=""
    @State private var confirming=false
    @State private var validation=JournalFormValidation()
    init(journal:DeviceJournal,original:JournalObject=[:]){
        self.journal=journal;self.original=original
        _title=State(initialValue:caption(original,"name"));_bodyText=State(initialValue:caption(original,"text"))
        _scope=State(initialValue:original["scope"] as? String ?? "personal")
    }
    var body:some View {
        let editable=scope=="personal" || journal.hasLocalArchive
        let issues=[
            JournalFieldIssue.required("prompt-name",title,"Введите название промпта."),
            .required("prompt-instruction",bodyText,"Введите инструкцию.")
        ].compactMap{$0}
        let visible=validation.visible(issues)
        Form{
            TextField("Название",text:$title).journalField("prompt-name",visible).disabled(!editable)
            TextField("Инструкция",text:$bodyText,axis:.vertical).journalField("prompt-instruction",visible).disabled(!editable)
            Picker("Доступ",selection:$scope){Text("Личный").tag("personal");Text("Семейный").tag("family")}.disabled(!original.isEmpty || !journal.hasLocalArchive)
            if editable {
                Button("Сохранить"){if validation.submit(issues){store()}}.disabled(journal.busy)
                if !original.isEmpty {Button(builtin==nil ? "Удалить промпт":"Восстановить исходный текст",role:.destructive){confirming=true}}
            }
            if !original.isEmpty {Button("Создать личную копию"){store(copy:true)}}
            if !message.isEmpty {Text(message)}
        }.journalValidation(validation).navigationTitle("Промпт").confirmationDialog("Подтвердить изменение промпта?",isPresented:$confirming){
            Button("Подтвердить",role:.destructive){store(remove:true)};Button("Отмена",role:.cancel){}
        }
    }
    private var builtin:JournalObject?{NativePromptLibrary.defaults.first{caption($0,"id")==caption(original,"id")}}
    private func store(remove:Bool=false,copy:Bool=false){
        let key=copy || original.isEmpty ? UUID().uuidString:caption(original,"id"),access=copy ? "personal":scope
        var item:JournalObject=["id":key,"scope":access,"name":title.trim+(copy ? " · копия":""),"text":bodyText.trim,"version":copy ? 1:(original["version"] as? Int ?? 0)+1]
        let deleting=remove && builtin==nil
        if remove,let builtin {item["name"]=builtin["name"];item["text"]=builtin["text"]}
        do{
            if access=="family"{try journal.saveFamilyTemplate(item,remove:deleting)}
            else{try journal.changeProfile(NativePromptLibrary.actor(journal)){p in var rows=entries(p,"templates").filter{caption($0,"id") != key};if !deleting{rows.append(item)};p["templates"]=rows}}
            dismiss()
        }catch{message=error.localizedDescription}
    }
}
