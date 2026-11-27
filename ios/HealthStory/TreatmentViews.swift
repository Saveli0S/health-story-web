import SwiftUI

struct CoursePeriod: Equatable {
    var start: String, planned: String, end: String, closed: Bool, unknown: Bool, note: String
    init(_ record: JournalObject = [:]) {
        start=caption(record,"start"); planned=caption(record,"planned"); end=caption(record,"end")
        closed=record["closed"] as? Bool == true; unknown=record["unknown"] as? Bool == true; note=caption(record,"note")
    }
    var json: JournalObject { ["start":start,"planned":planned,"end":end,"closed":closed,"unknown":unknown,"note":note] }
    var summary: String {
        let finish = closed ? (end.isEmpty ? "окончание неизвестно" : "по "+end) : (planned.isEmpty ? "окончание не указано" : "по плану до "+planned)
        return [start.isEmpty ? "начало не указано" : "с "+start,finish].joined(separator:" · ")
    }
    var validationIssues:[JournalFieldIssue] {
        let today=dayString()
        let validStart=start.isEmpty || (Self.date(start) != nil && start<=today)
        return [
            validStart ? nil : JournalFieldIssue(field:"course-start",message:"Укажите дату начала не позже сегодняшнего дня."),
            !planned.isEmpty && (Self.date(planned)==nil || (validStart && start>planned)) ?
                JournalFieldIssue(field:"course-planned",message:"Плановое окончание должно быть не раньше начала курса.") : nil,
            !end.isEmpty && (Self.date(end)==nil || end>today || (validStart && start>end)) ?
                JournalFieldIssue(field:"course-end",message:"Укажите дату окончания от начала курса до сегодняшнего дня.") : nil,
            closed && !unknown && end.isEmpty ?
                JournalFieldIssue(field:"course-end",message:"Укажите дату окончания или выберите «Дата неизвестна».") : nil
        ].compactMap{$0}
    }
    func validate() throws {
        if let issue=validationIssues.first {throw JournalError(issue.message)}
    }
    static func date(_ value:String) -> Date? {
        let formatter=DateFormatter(); formatter.locale=Locale(identifier:"en_US_POSIX")
        formatter.calendar=Calendar(identifier:.gregorian); formatter.dateFormat="yyyy-MM-dd"; formatter.isLenient=false
        guard let result=formatter.date(from:value), formatter.string(from:result)==value else {return nil};return result
    }
}
struct CourseSource: Hashable {
    enum Container: Hashable {case visit, file, change}
    let type:Container, id:String, medicine:String
}
struct NativeCourse: Identifiable {
    let id:CourseSource, visit:String, episode:String, date:String, visitTitle:String, medicine:JournalObject
    var change:JournalObject?, continued=false
    var period:CoursePeriod { CoursePeriod(medicine["period"] as? JournalObject ?? [:]) }
    var title:String { [caption(medicine,"name"),caption(medicine,"strength")].filter{!$0.isEmpty}.joined(separator:" · ") }
    var active:Bool { !period.closed && change==nil && !continued }
    var status:String {
        if let change {
            let status=["stop":"Отменён","replace":"Заменён","dose":"Доза изменена"][caption(change,"kind")] ?? "Схема изменена"
            return status+" · "+caption(change,"date")
        }
        if continued{return "Продолжение предыдущей схемы"}
        return period.closed ? "Завершён":"Курс идёт"
    }
}
enum NativeTreatments {
    static func visits(_ p:JournalObject)->[[Any]] {(p["addedVisits"] as? [[Any]] ?? []).filter{$0.count>=6}}
    static func field(_ row:[Any],_ index:Int)->String {row.indices.contains(index) ? row[index] as? String ?? "" : ""}
    static func episode(_ row:[Any],_ p:JournalObject)->String {
        let id=field(row,7)
        if !id.isEmpty{return id}
        let matches=entries(p,"episodes").filter{caption($0,"name")==field(row,4)}
        return matches.count==1 ? caption(matches[0],"id") : "visit:"+field(row,0)
    }
    static func episodes(_ p:JournalObject)->[(id:String,name:String)] {
        var result=entries(p,"episodes").map{(id:caption($0,"id"),name:caption($0,"name"))}
        for row in visits(p) {
            let id=episode(row,p)
            if !result.contains(where:{$0.id==id}) {result.append((id,field(row,4).isEmpty ? field(row,2):field(row,4)))}
        }
        return result
    }
    static func signature(_ m:JournalObject)->String {
        ["name","strength","form","instructions"].map{caption(m,$0).lowercased().split(whereSeparator:\.isWhitespace).joined(separator:" ")}.joined(separator:"|")
    }
    static func medicineID(_ m:JournalObject)->String {
        let id=caption(m,"id");return id.isEmpty ? "legacy:"+signature(m):id
    }
    static func all(_ p:JournalObject)->[NativeCourse] {
        let changes=entries(p,"changes"),files=entries(p,"files")
        var courses:[NativeCourse]=[]
        for v in visits(p) {
            let visit=field(v,0)
            var originals:[(CourseSource,JournalObject)]=[]
            func add(_ list:[JournalObject],_ type:CourseSource.Container,_ id:String) {
                for m in list where !caption(m,"name").isEmpty {
                    originals.append((CourseSource(type:type,id:id,medicine:medicineID(m)),m))
                }
            }
            if v.count>8 {add(v[8] as? [JournalObject] ?? [],.visit,visit)}
            for f in files where caption(f,"visit")==visit && (f["checked"] as? Bool==true || !caption(f,"lastConfirmed").isEmpty) {
                add(entries(f,"meds"),.file,caption(f,"id"))
            }
            for c in changes where caption(c,"visit")==visit {
                if let m=c["replacement"] as? JournalObject {add([m],.change,caption(c,"id"))}
            }
            var unique:[String:NativeCourse]=[:],order:[String]=[]
            for (source,m) in originals {
                let sig=signature(m)
                if unique[sig]==nil {order.append(sig)}
                let stop=changes.first{!caption(m,"id").isEmpty && caption($0,"source")==visit && caption($0,"medId")==caption(m,"id") && caption($0,"kind") != "continue"}
                let inherited=changes.contains{caption($0,"visit")==visit && caption($0,"kind")=="continue" && signature($0["before"] as? JournalObject ?? [:])==sig}
                unique[sig]=NativeCourse(id:source,visit:visit,episode:episode(v,p),date:field(v,1),visitTitle:field(v,2),medicine:m,change:stop,continued:inherited)
            }
            courses += order.compactMap{unique[$0]}
        }
        return courses
    }
    static func write(period:CoursePeriod,to course:NativeCourse,in p:inout JournalObject)throws {
        try period.validate()
        guard let current=all(p).first(where:{$0.id==course.id}),current.period==course.period,
              signature(current.medicine)==signature(course.medicine),
              current.change==nil,!current.continued else {throw JournalError("Курс изменился. Откройте его заново.")}
        func updated(_ m:JournalObject)->JournalObject {
            var m=m, old=m["period"] as? JournalObject ?? [:]
            old.merge(period.json){_,new in new};m["period"]=old;return m
        }
        func modify(_ meds:inout [JournalObject])throws {
            guard let i=meds.lastIndex(where:{medicineID($0)==course.id.medicine}) else {throw JournalError("Назначение больше недоступно.")}
            meds[i]=updated(meds[i])
        }
        switch course.id.type {
        case .visit:
            var rows=p["addedVisits"] as? [[Any]] ?? []
            guard let i=rows.firstIndex(where:{field($0,0)==course.id.id}),rows[i].count>8 else {throw JournalError("Визит больше недоступен.")}
            var meds=rows[i][8] as? [JournalObject] ?? [];try modify(&meds);rows[i][8]=meds;p["addedVisits"]=rows
        case .file:
            var files=entries(p,"files")
            guard let i=files.firstIndex(where:{caption($0,"id")==course.id.id}) else {throw JournalError("Назначение больше недоступно.")}
            var meds=entries(files[i],"meds");try modify(&meds);files[i]["meds"]=meds;p["files"]=files
        case .change:
            var changes=entries(p,"changes")
            guard let i=changes.firstIndex(where:{caption($0,"id")==course.id.id}),let m=changes[i]["replacement"] as? JournalObject else {throw JournalError("Решение врача больше недоступно.")}
            changes[i]["replacement"]=updated(m);p["changes"]=changes
        }
    }
}
struct TreatmentDecisions:View {
    let rows:[JournalObject], profile:JournalObject
    var body:some View {
        if !rows.isEmpty {
            Section("Что менялось"){ForEach(rows,id:\.selfID){change in
                let before=change["before"] as? JournalObject ?? [:],after=change["replacement"] as? JournalObject
                let verb=["stop":"Отменён","continue":"Продолжен","replace":"Заменён","dose":"Изменена доза"][caption(change,"kind")] ?? "Изменение схемы"
                let doctor=entries(profile,"addedDoctors").first{caption($0,"id")==caption(change,"doctor")}?["values"] as? [String] ?? []
                VStack(alignment:.leading,spacing:4){
                    Text(verb+" · "+[caption(before,"name"),caption(before,"strength")].joined(separator:" ")).font(.headline)
                    if let after{Text([caption(after,"name"),caption(after,"strength"),caption(after,"instructions")].filter{!$0.isEmpty}.joined(separator:" · "))}
                    Text(([caption(change,"date")]+Array(doctor.prefix(2).reversed())).filter{!$0.isEmpty}.joined(separator:" · ")).font(.footnote).foregroundStyle(.secondary)
                }
            }}
        }
    }
}
private struct CourseLabel:View {
    let item:NativeCourse
    var body:some View {
        VStack(alignment:.leading,spacing:4){
            Text(item.title).font(.headline)
            let regimen=[caption(item.medicine,"form"),caption(item.medicine,"instructions")].filter{!$0.isEmpty}.joined(separator:" · ")
            if !regimen.isEmpty{Text(regimen)}
            Text(item.period.summary).font(.subheadline).foregroundStyle(.secondary)
            if !item.active{Text(item.status).font(.subheadline).bold()}
            if !item.period.note.isEmpty{Text(item.period.note).font(.footnote)}
        }
    }
}
enum CourseEditorChoice:Identifiable {
    case period(NativeCourse), finish([NativeCourse])
    var id:String {
        switch self{case .period(let c):return "period:"+c.id.id+":"+c.id.medicine;case .finish(let list):return "finish:"+(list.first?.visit ?? "")}
    }
}
struct CourseEditorDestination:View {
    @ObservedObject var journal:DeviceJournal;let owner:String,choice:CourseEditorChoice
    var body:some View {
        switch choice{
        case .period(let item):CoursePeriodEditor(journal:journal,owner:owner,item:item)
        case .finish(let items):FinishCourses(journal:journal,owner:owner,items:items)
        }
    }
}
struct TreatmentSection:View {
    @ObservedObject var journal:DeviceJournal
    let owner:String
    var visit:String?=nil
    var courses:[NativeCourse]?=nil
    @Binding var editor:CourseEditorChoice?
    var body:some View {
        let p=journal.profile(owner)
        let items=courses ?? NativeTreatments.all(p).filter{visit==nil ? $0.active : $0.visit==visit}
        Section {
            if items.isEmpty{
                Text(visit==nil ? "Сейчас нет активных курсов":"Назначений не внесено")
                    .font(JournalTheme.body).foregroundStyle(JournalTheme.secondary)
            }
            let visitIDs=Array(Set(items.map(\.visit))).sorted{a,b in
                (items.first{$0.visit==a}?.date ?? "",a) > (items.first{$0.visit==b}?.date ?? "",b)
            }
            ForEach(visitIDs,id:\.self){id in
                let group=items.filter{$0.visit==id}
                if visit==nil,let first=group.first,let row=NativeTreatments.visits(p).first(where:{NativeTreatments.field($0,0)==id}){
                    NavigationLink {NativeVisitDetails(journal:journal,owner:owner,row:row)} label:{
                        JournalRowLabel(title:first.visitTitle,symbol:"calendar",subtitle:first.date)
                    }.listRowBackground(JournalTheme.treatment)
                }
                ForEach(group){item in
                    VStack(alignment:.leading,spacing:6){CourseLabel(item:item)
                        if journal.editable && item.change==nil && !item.continued{
                            Button("Изменить даты"){editor = .period(item)}.buttonStyle(.borderless).accessibilityIdentifier("course-period-"+item.id.medicine)
                        }
                    }
                    .listRowBackground(visit == nil ? JournalTheme.treatment : Color.white)
                }
                if journal.editable && group.contains(where:\.active) {
                    Button("Завершить лечение",systemImage:"checkmark.circle"){editor = .finish(group.filter(\.active))}
                        .accessibilityIdentifier("course-finish-"+id)
                        .listRowBackground(visit == nil ? JournalTheme.treatment : Color.white)
                }
            }
        } header: {
            JournalSectionHeading(visit==nil ? "Текущее лечение":"Назначения врача")
        }
    }
}
private struct CoursePeriodEditor:View {
    @ObservedObject var journal:DeviceJournal
    let owner:String,item:NativeCourse
    @State private var period:CoursePeriod
    @State private var error:String?
    @State private var validation=JournalFormValidation()
    @Environment(\.dismiss) private var dismiss
    init(journal:DeviceJournal,owner:String,item:NativeCourse){
        self.journal=journal;self.owner=owner;self.item=item;_period=State(initialValue:item.period)
    }
    private var savedPeriod:CoursePeriod {
        var data=period
        if !data.closed {data.unknown=false;data.end=""}
        else if data.unknown {data.end=""}
        else if data.end.isEmpty {data.end=dayString()}
        return data
    }
    private func optionalDate(_ title:String,_ key:WritableKeyPath<CoursePeriod,String>,field:String,issues:[JournalFieldIssue],future:Bool=false)->some View {
        let day=Binding<Date>(get:{CoursePeriod.date(period[keyPath:key]) ?? Date()},set:{period[keyPath:key]=dayString($0)})
        return Group {
            Toggle(title,isOn:Binding(get:{!period[keyPath:key].isEmpty},set:{period[keyPath:key]=$0 ? dayString() : ""}))
            if !period[keyPath:key].isEmpty{
                if future {DatePicker(title,selection:day,displayedComponents:.date).journalField(field,issues)}
                else {DatePicker(title,selection:day,in:...Date(),displayedComponents:.date).journalField(field,issues)}
            }
        }
    }
    var body:some View {
        let data=savedPeriod,issues=data.validationIssues
        let visible=validation.visible(issues)
        NavigationStack{Form{
        Section(item.title){Text(caption(item.medicine,"instructions"))}
        Section("Период приёма"){
            optionalDate("Фактическое начало",\CoursePeriod.start,field:"course-start",issues:visible)
            optionalDate("Плановое окончание",\CoursePeriod.planned,field:"course-planned",issues:visible,future:true)
            Toggle("Курс завершён",isOn:$period.closed)
            if period.closed{
                Toggle("Дата неизвестна",isOn:$period.unknown)
                if !period.unknown{
                    DatePicker("Фактическое окончание",selection:Binding(get:{CoursePeriod.date(period.end) ?? Date()},set:{period.end=dayString($0)}),in:...Date(),displayedComponents:.date)
                        .journalField("course-end",visible)
                }
            }
            TextField("Пометка при прерывании",text:$period.note,axis:.vertical)
        }
        if let error{Text(error).foregroundStyle(.red)}
        Button("Сохранить даты"){
            guard validation.submit(issues) else{return}
            do{
                try journal.changeProfile(owner){try NativeTreatments.write(period:data,to:item,in:&$0)}
                dismiss()
            }catch{self.error=error.localizedDescription}
        }.disabled(journal.busy || !journal.editable)
    }.journalValidation(validation).navigationTitle("Период приёма").toolbar{Button("Закрыть"){dismiss()}}}}
}
private struct FinishCourses:View {
    enum Choice:String,CaseIterable{case common="Общая дата",custom="Другая дата",unknown="Дата неизвестна"}
    @ObservedObject var journal:DeviceJournal
    let owner:String,items:[NativeCourse]
    @State private var common=Date()
    @State private var choices:[CourseSource:Choice]=[:]
    @State private var dates:[CourseSource:Date]=[:]
    @State private var error:String?
    @State private var validation=JournalFormValidation()
    @Environment(\.dismiss) private var dismiss
    private func endField(_ item:NativeCourse)->String {"finish-\(item.id.type)-\(item.id.id)-\(item.id.medicine)"}
    private func completedPeriod(_ item:NativeCourse)->CoursePeriod {
        var period=item.period
        period.closed=true
        period.unknown=choices[item.id] == .unknown
        period.end=period.unknown ? "" : dayString(choices[item.id] == .custom ? dates[item.id] ?? common : common)
        return period
    }
    private var validationIssues:[JournalFieldIssue] {
        let commonIssues=items.filter{(choices[$0.id] ?? .common) == .common && completedPeriod($0).validationIssues.contains{$0.field=="course-end"}}
        var issues=commonIssues.isEmpty ? [] : [JournalFieldIssue(field:"finish-common",message:"Общая дата раньше начала одного из курсов. Измените её или укажите отдельную дату для этого курса.")]
        for item in items {
            if choices[item.id] == .custom,let issue=completedPeriod(item).validationIssues.first(where:{$0.field=="course-end"}) {
                issues.append(JournalFieldIssue(field:endField(item),message:issue.message))
            }
        }
        return issues
    }
    var body:some View {
        let issues=validationIssues,visible=validation.visible(issues)
        NavigationStack{Form{
        DatePicker("Общая дата окончания",selection:$common,in:...Date(),displayedComponents:.date).journalField("finish-common",visible)
        ForEach(items){item in Section(item.title){
            Picker("Окончание курса",selection:Binding(get:{choices[item.id] ?? .common},set:{choices[item.id]=$0})){
                ForEach(Choice.allCases,id:\.self){Text($0.rawValue).tag($0)}
            }
            if choices[item.id] == .custom {
                DatePicker("Фактическое окончание",selection:Binding(get:{dates[item.id] ?? common},set:{dates[item.id]=$0}),in:...Date(),displayedComponents:.date)
                    .journalField(endField(item),visible)
            }
        }}
        if let error {Text(error).foregroundStyle(.red)}
        Button("Подтвердить завершение"){
            guard validation.submit(issues) else{return}
            do{
            try journal.changeProfile(owner){p in
                for item in items {
                    try NativeTreatments.write(period:completedPeriod(item),to:item,in:&p)
                }
            };dismiss()
        }catch{self.error=error.localizedDescription}}.disabled(!journal.editable || journal.busy)
    }.journalValidation(validation).navigationTitle("Завершить лечение").toolbar{Button("Закрыть"){dismiss()}}}}
}
struct VisitNotes:View {
    @ObservedObject var journal:DeviceJournal
    let owner:String, visit:String
    private func localTimestamp(_ raw:String)->String {
        let parser=ISO8601DateFormatter();parser.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
        let date=parser.date(from:raw) ?? ISO8601DateFormatter().date(from:raw)
        return date?.formatted(date:.numeric,time:.shortened) ?? raw
    }
    var body:some View {
        let p=journal.profile(owner)
        Section("Пометки к визиту"){
            ForEach(entries(p,"notes").filter{caption($0,"visit")==visit},id:\.selfID){row in
                VStack(alignment:.leading){Text(caption(row,"text"));Text([caption(row,"author"),localTimestamp(caption(row,"time"))].filter{!$0.isEmpty}.joined(separator:" · ")).font(.footnote).foregroundStyle(.secondary)}
            }
            if journal.editable {
                NavigationLink("Добавить пометку"){VisitNoteEditor(journal:journal,owner:owner,visit:visit)}
            }
        }
    }
}
private struct VisitNoteEditor:View {
    @ObservedObject var journal:DeviceJournal;let owner:String,visit:String
    @State private var message=""
    @State private var error:String?
    @State private var validation=JournalFormValidation()
    @Environment(\.dismiss) private var dismiss
    var body:some View {
        let issues=[JournalFieldIssue.required("note",message,"Введите текст пометки.") ?? .length("note",message,limit:800)].compactMap{$0}
        Form{
            Text("Увидят все, кому доступен этот профиль.")
            TextField("Текст пометки",text:$message,axis:.vertical).journalField("note",validation.visible(issues))
            if let error{Text(error).foregroundStyle(.red)}
            Button("Сохранить пометку"){
                guard validation.submit(issues) else{return}
                do{
                let actor=journal.admin ? caption(journal.data["family"] as? JournalObject ?? [:],"adminId") : caption(journal.access,"member")
                let author=journal.members.first{caption($0,"id")==actor}.map{caption($0,"name")} ?? ""
                try journal.changeProfile(owner){p in p["notes"]=entries(p,"notes")+[["id":UUID().uuidString,"visit":visit,"text":message.trim,"author":author,"time":ISO8601DateFormatter().string(from:Date())]]}
                dismiss()
            }catch{self.error=error.localizedDescription}}.disabled(journal.busy || !journal.editable)
        }.journalValidation(validation).navigationTitle("Пометка к визиту")
    }
}
private extension Dictionary where Key==String,Value==Any {
    var selfID:String {self["id"] as? String ?? ""}
}
struct VisitBrief:View {
    @ObservedObject var journal:DeviceJournal
    let owner:String
    var episodeID:String?=nil
    @State private var selected=""
    var body:some View {
        let p=journal.profile(owner),episodes=NativeTreatments.episodes(p)
        let id=episodeID ?? (selected.isEmpty ? (episodes.count==1 ? episodes[0].id:""):selected)
        List {
            if episodeID==nil && episodes.count>1 {
                Picker("Эпизод болезни",selection:$selected){Text("Выберите эпизод").tag("");ForEach(episodes,id:\.id){e in Text(e.name).tag(e.id)}}
            }
            if let e=episodes.first(where:{$0.id==id}) {
                EpisodeBriefContent(journal:journal,owner:owner,id:e.id,name:e.name)
            }else if episodes.isEmpty{Text("Здесь появятся эпизоды с визитами.")}
        }.journalBackground().navigationTitle("Сводка к приёму").navigationBarTitleDisplayMode(.inline)
    }
}
private struct EpisodeBriefContent:View {
    @ObservedObject var journal:DeviceJournal;let owner:String,id:String,name:String
    @State private var editing=false
    @State private var revised=""
    @State private var notice=""
    @State private var validation=JournalFormValidation()
    var body:some View {
        let p=journal.profile(owner),visits=NativeTreatments.visits(p).filter{NativeTreatments.episode($0,p)==id}.sorted{NativeTreatments.field($0,1)<NativeTreatments.field($1,1)}
        let ids=Set(visits.map{NativeTreatments.field($0,0)})
        let active=NativeTreatments.all(p).filter{$0.episode==id && $0.active}
        let issues=[JournalFieldIssue.required("episode-name",revised,"Введите название эпизода.")].compactMap{$0}
        Section {
            JournalHero(title:name,label:"Сводка к приёму",symbol:"list.bullet.clipboard") {
                EmptyView()
            }
        }
        Section {
            if journal.editable {
                Button("Редактировать эпизод"){revised=name;notice="";validation=JournalFormValidation();editing=true}
                    .disabled(journal.busy || !entries(p,"episodes").contains{caption($0,"id")==id})
                    .sheet(isPresented:$editing){NavigationStack{Form{
                        TextField("Название эпизода",text:$revised).journalField("episode-name",validation.visible(issues))
                        if !notice.isEmpty {Text(notice).foregroundStyle(.red)}
                    }.journalValidation(validation).navigationTitle("Редактировать эпизод").toolbar{
                        ToolbarItem(placement:.cancellationAction){Button("Отмена"){editing=false}}
                        ToolbarItem(placement:.confirmationAction){Button("Сохранить эпизод"){
                            guard validation.submit(issues) else{return}
                            do {try journal.renameEpisode(owner:owner,id:id,name:revised);editing=false}
                            catch {notice=error.localizedDescription}
                        }.disabled(journal.busy || !journal.editable)}
                    }}}
            }
            if let v=visits.first{let reason=NativeTreatments.field(v,5);Text(reason.isEmpty ? NativeTreatments.field(v,2):reason)}
            ForEach(entries(p,"fields").filter{["allergy","chronic"].contains(caption($0,"id")) && !caption($0,"value").isEmpty},id:\.selfID){f in LabeledContent(caption(f,"label"),value:caption(f,"value"))}
        } header: {
            JournalSectionHeading("Эпизод")
        }
        Section("Визиты"){ForEach(visits.indices,id:\.self){i in
            let v=visits[i];NavigationLink(NativeTreatments.field(v,1)+" · "+NativeTreatments.field(v,2)){NativeVisitDetails(journal:journal,owner:owner,row:v)}
        }}
        Section("Действующие назначения"){if active.isEmpty{Text("Нет активных курсов")};ForEach(active){CourseLabel(item:$0)}}
        let changes=entries(p,"changes").filter{caption($0,"episode")==id || ids.contains(caption($0,"visit"))}
        TreatmentDecisions(rows:changes,profile:p)
        let files=entries(p,"files").filter{ids.contains(caption($0,"visit")) && $0["lab"] != nil}
        Section("Последние анализы"){ForEach(files.sorted{caption($0["lab"] as? JournalObject ?? [:],"date")>caption($1["lab"] as? JournalObject ?? [:],"date")}.prefix(3),id:\.selfID){f in
            let lab=f["lab"] as? JournalObject ?? [:]
            NavigationLink{DeviceAttachment(journal:journal,owner:owner,id:caption(f,"id"),name:caption(f,"name"))}label:{
                VStack(alignment:.leading){Text(caption(lab,"date")+" · "+caption(lab,"name"));Text(entries(lab,"rows").map{r in [caption(r,"name"),caption(r,"value"),caption(r,"unit")].joined(separator:" ")}.joined(separator:" · ")).font(.footnote)}
            }
        }}
        Section("Результаты обследований"){ExamLinks(journal:journal,owner:owner,rows:entries(p,"exams").filter{ids.contains(caption($0,"visit"))})}
        let measurements=entries(p,"measurements").filter{caption($0,"episode")==id}
        if !measurements.isEmpty {Section("Домашние измерения"){ForEach(measurements,id:\.selfID){r in Text([caption(r,"time"),caption(r,"name"),caption(r,"value"),caption(r,"unit")].joined(separator:" "))}}}
        EpisodeQuestions(journal:journal,owner:owner,episode:id)
        Section("Документы без сети"){
            OfflineSaveButton(journal:journal,owner:owner,files:DeviceSyncRules.scopedFiles(profile:p,episode:id),title:"Сохранить весь эпизод без сети")
        }
    }
}


private struct EpisodeQuestions:View {
    @ObservedObject var journal:DeviceJournal
    let owner:String,episode:String
    var body:some View {
        let rows=entries(journal.profile(owner),"questions").filter{caption($0,"episode")==episode}
        Section("Вопросы врачу"){
            ForEach(rows,id:\.selfID){row in
                if journal.editable {
                    NavigationLink(caption(row,"text")){QuestionEditor(journal:journal,owner:owner,episode:episode,row:row)}
                }else{Text(caption(row,"text"))}
            }
            if journal.editable{NavigationLink("Добавить вопрос"){QuestionEditor(journal:journal,owner:owner,episode:episode)}}
        }
    }
}
private struct QuestionEditor:View {
    @ObservedObject var journal:DeviceJournal
    let owner:String,episode:String,row:JournalObject?
    @State private var question:String
    @State private var error:String?
    @State private var validation=JournalFormValidation()
    @Environment(\.dismiss) private var dismiss
    init(journal:DeviceJournal,owner:String,episode:String,row:JournalObject?=nil){
        self.journal=journal;self.owner=owner;self.episode=episode;self.row=row
        _question=State(initialValue:row.map{caption($0,"text")} ?? "")
    }
    var body:some View {
        let issues=[JournalFieldIssue.required("question",question,"Введите вопрос врачу.") ?? .length("question",question,limit:800)].compactMap{$0}
        Form{
            TextField("Вопрос врачу",text:$question,axis:.vertical).journalField("question",validation.visible(issues))
            if let error{Text(error).foregroundStyle(.red)}
            Button("Сохранить вопрос"){
                guard validation.submit(issues) else{return}
                do{
                try journal.changeProfile(owner){p in
                    var questions=entries(p,"questions")
                    if let row{
                        guard let i=questions.firstIndex(where:{caption($0,"id")==caption(row,"id") && caption($0,"episode")==episode}) else {throw JournalError("Вопрос изменился. Откройте сводку заново.")}
                        questions[i]["text"]=question.trim
                    }else{questions.append(["id":UUID().uuidString,"episode":episode,"text":question.trim])}
                    p["questions"]=questions
                };dismiss()
            }catch{self.error=error.localizedDescription}}.disabled(journal.busy || !journal.editable)
        }.journalValidation(validation).navigationTitle("Вопрос врачу")
    }
}
