import SwiftUI
import Charts

func entries(_ p:JournalObject,_ key:String)->[JournalObject] {p[key] as? [JournalObject] ?? []}
func dayString(_ d:Date=Date())->String {
    let f=DateFormatter();f.calendar=Calendar(identifier:.gregorian);f.locale=Locale(identifier:"en_US_POSIX");f.dateFormat="yyyy-MM-dd";return f.string(from:d)
}
func caption(_ row:JournalObject,_ key:String)->String {row[key] as? String ?? ""}
struct NativeClinicalLinks:View {
    @ObservedObject var journal:DeviceJournal;let owner:String
    var body:some View {
        Section {
            NavigationLink {Trends(journal:journal,owner:owner)} label:{
                JournalRowLabel(title:"Анализы и измерения",symbol:"chart.xyaxis.line")
            }
            NavigationLink {NativeExams(journal:journal,owner:owner)} label:{
                JournalRowLabel(title:"Результаты обследований",symbol:"stethoscope")
            }
            NavigationLink {Prevention(journal:journal,owner:owner)} label:{
                JournalRowLabel(title:"Прививки и профилактика",symbol:"cross.case")
            }
            NavigationLink {Consultations(journal:journal,owner:owner)} label:{
                JournalRowLabel(title:"ИИ-консультация",symbol:"sparkles")
            }
            NavigationLink {VisitBrief(journal:journal,owner:owner)} label:{
                JournalRowLabel(title:"Сводка к приёму",symbol:"list.bullet.clipboard")
            }
        } header: {
            JournalSectionHeading("Разделы профиля")
        }
    }
}

struct NativeClinicalSearch:View {
    @ObservedObject var journal:DeviceJournal
    let owner:String,query:String,tags:RecordTags
    var body:some View {
        let profile=journal.profile(owner)
        let reports=entries(profile,"files").compactMap { file -> (file:JournalObject, lab:JournalObject, match:String?)? in
            guard let lab=file["lab"] as? JournalObject else {return nil}
            let fields=[caption(lab,"name"),caption(file,"name"),caption(lab,"laboratory"),caption(lab,"date")]
            let reading=entries(lab,"rows").map{row in
                [caption(row,"name"),caption(row,"value"),caption(row,"unit")].filter{!$0.isEmpty}.joined(separator:" ")
            }.first{tags.matches(query,key:"",fields:[$0])}
            guard reading != nil || tags.matches(query,key:"lab:"+caption(file,"id"),fields:fields) else {return nil}
            return (file,lab,reading)
        }
        let exams=entries(profile,"exams").filter{exam in
            let fields=[nativeExamTitle(exam),caption(exam,"conclusion"),caption(exam,"date"),caption(exam,"clinic")]
            return tags.matches(query,key:"exam:"+caption(exam,"id"),fields:fields+entries(exam,"parameters").map{caption($0,"name")})
        }
        let measurements=entries(profile,"measurements").filter{row in tags.matches(query,key:"",fields:[caption(row,"name")])}
        if !reports.isEmpty {
            Section("Найденные анализы") {
                ForEach(reports.indices,id:\.self){index in
                    let hit=reports[index]
                    NavigationLink {LabReport(journal:journal,owner:owner,id:caption(hit.file,"id"))} label:{
                        VStack(alignment:.leading,spacing:4){
                            Text(caption(hit.lab,"name"))
                            Text([caption(hit.lab,"date"),hit.match ?? caption(hit.file,"name")].filter{!$0.isEmpty}.joined(separator:" · "))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        if !exams.isEmpty {Section("Найденные обследования"){ExamLinks(journal:journal,owner:owner,rows:exams)}}
        if !measurements.isEmpty {
            Section("Домашние измерения") {
                ForEach(Array(Set(measurements.map{caption($0,"name")})).sorted(),id:\.self){name in
                    NavigationLink(name){Trends(journal:journal,owner:owner,initialQuery:name)}
                }
            }
        }
    }
}

struct PatientFields:View {
    @ObservedObject var journal:DeviceJournal;let owner:String
    @State private var editing:MedicalFieldDestination?
    @State private var error:String?
    var body:some View {
        let fields=entries(journal.profile(owner),"fields").filter{journal.editable || !caption($0,"value").isEmpty}
        List {
            Section {
                if fields.isEmpty {
                    Text("Поля медкарты пока не заполнены.").foregroundStyle(JournalTheme.secondary)
                }
                ForEach(fields.indices,id:\.self){i in
                    let f=fields[i], value=caption(f,"value"), label=caption(f,"label")
                    if journal.editable {
                        Button {editing=MedicalFieldDestination(field:f)} label:{
                            LabeledContent(label,value:value.isEmpty ? "Заполнить" : value)
                                .foregroundStyle(JournalTheme.ink)
                        }
                        .disabled(journal.busy)
                        .swipeActions {Button("Удалить",role:.destructive){removeField(caption(f,"id"))}.disabled(journal.busy)}
                    } else {
                        LabeledContent(label,value:value)
                    }
                }
                if journal.editable {
                    Button("Добавить поле",systemImage:"plus"){editing=MedicalFieldDestination(field:[:])}
                        .disabled(journal.busy)
                }
            } header: {
                JournalSectionHeading("Поля профиля")
            }
            if let error {Text(error).foregroundStyle(.red)}
        }.journalBackground().navigationTitle("Медкарта").navigationBarTitleDisplayMode(.inline)
            .sheet(item:$editing){MedicalFieldEditor(journal:journal,owner:owner,destination:$0)}
    }
    private func removeField(_ id:String){
        do {
            try journal.changeProfile(owner){p in p["fields"]=entries(p,"fields").filter{caption($0,"id") != id}}
            error=nil
        } catch {self.error=error.localizedDescription}
    }
}
struct TrendPoint:Identifiable {
    let id:String,name:String,unit:String,date:String,value:String,source:String?
    var key="", material="", rawName="", rawValue="", rawUnit="", range=""
    var series:String { [name,unit,material].filter{!$0.isEmpty}.joined(separator:" · ") }
    var numeric:Double? {
        guard let number=Double(value.replacingOccurrences(of:",",with:".")),number.isFinite else {return nil}
        return number
    }
}
func trendPoints(_ profile:JournalObject)->[TrendPoint] {
    var out=entries(profile,"measurements").map{r in
        let name=caption(r,"name"),unit=caption(r,"unit")
        return TrendPoint(id:caption(r,"id"),name:name,unit:unit,date:caption(r,"time"),value:caption(r,"value"),source:nil,key:"measurement:"+name+"|"+unit)
    }
    let parser=try? ClinicalImport()
    for file in entries(profile,"files") {
        guard let lab=file["lab"] as? JournalObject else {continue}
        let source=caption(file,"id"),title=caption(lab,"name")
        for (i,r) in entries(lab,"rows").enumerated() {
            // Keep a per-row fallback if the normalization module ever fails; do not merge ambiguous samples.
            let fallbackKey=source+"-"+String(i)
            let n=parser?.seriesPoint(r,title:title,source:source) ?? r
            let material=caption(n,"specimen")
            out.append(.init(id:fallbackKey,name:caption(n,"name"),unit:caption(n,"unit"),date:caption(lab,"date"),value:caption(n,"value"),source:source,key:n["key"] as? String ?? fallbackKey,material:material.isEmpty ? "Материал не уточнён · "+caption(lab,"date") : material,rawName:caption(r,"name"),rawValue:caption(r,"value"),rawUnit:caption(r,"unit"),range:caption(r,"range")))
        }
    }
    return out.sorted{$0.date<$1.date}
}
struct Trends:View {
    @ObservedObject var journal:DeviceJournal;let owner:String
    @State private var query:String
    @State private var adding=false
    @State private var name=""
    @State private var unit=""
    @State private var value=""
    @State private var date=Date()
    @State private var episode=""
    @State private var error:String?
    @State private var validation=JournalFormValidation()
    init(journal:DeviceJournal,owner:String,initialQuery:String="") {
        self.journal=journal;self.owner=owner;_query=State(initialValue:initialQuery)
    }
    var body:some View {
        let p=journal.profile(owner), points=trendPoints(p)
        let tags=RecordTags(profile:p,library:entries(journal.data,"tags"))
        let numeric=Double(value.trim.replacingOccurrences(of:",",with:"."))?.isFinite == true
        let issues=[
            JournalFieldIssue.required("measurement-name",name,"Введите название показателя."),
            numeric ? nil : JournalFieldIssue(field:"measurement-value",message:"Введите числовое значение."),
            .required("measurement-unit",unit,"Введите единицу измерения.")
        ].compactMap{$0}
        let visible=validation.visible(issues)
        List {
            if journal.editable {
                NavigationLink("Добавить лабораторный бланк"){LabIntake(journal:journal,owner:owner)}
                Button("Добавить измерение"){validation=JournalFormValidation();error=nil;adding=true}
            }
            let groups=Dictionary(grouping:points,by:\.key)
            ForEach(groups.keys.sorted(),id:\.self){key in
                let rows=groups[key] ?? [],series=rows.first?.series ?? ""
                if query.isEmpty || rows.contains(where:{ tags.matches(query,key:"lab:"+($0.source ?? ""),fields:[$0.series,$0.rawName]) }) {
                    NavigationLink(series){List {
                        let numericRows=rows.filter{$0.numeric != nil}
                        if !numericRows.isEmpty {
                            Chart(numericRows){r in
                                if let v=r.numeric {LineMark(x:.value("Дата",r.date),y:.value(series,v));PointMark(x:.value("Дата",r.date),y:.value(series,v))}
                            }.frame(height:200)
                        }
                        ForEach(rows){r in
                            if let id=r.source {
                                NavigationLink {DeviceAttachment(journal:journal,owner:owner,id:id,name:"Исходный бланк")}
                                    label:{VStack(alignment:.leading){
                                        Text(r.date+" · "+r.value+" "+r.unit)
                                        Text("В бланке · "+[r.rawName,r.rawValue,r.rawUnit,r.range].filter{!$0.isEmpty}.joined(separator:" · ")).font(.caption)
                                    }}
                            } else {LabeledContent(r.date,value:r.value+" "+r.unit)}
                        }
                    }.navigationTitle(series)}
                }
            }
            let reports=entries(p,"files").filter{
                ($0["category"] as? String=="Лаборатория" || $0["lab"] != nil) && tags.matches(query,key:"lab:"+caption($0,"id"),fields:[caption($0,"name"),caption(($0["labDraft"] ?? $0["lab"]) as? JournalObject ?? [:],"name")])
            }
            if journal.editable {
                let pending=reports.filter{$0["labDraft"] != nil || $0["lab"] == nil}
                if !pending.isEmpty {Section("Требуют сверки"){
                    ForEach(pending.indices,id:\.self){i in
                        NavigationLink(caption(pending[i],"name")){LabReview(journal:journal,owner:owner,file:pending[i])}
                    }
                }}
            }
            Section("Лабораторные бланки"){
                ForEach(reports.indices,id:\.self){i in
                    let file=reports[i],id=caption(file,"id")
                    if let lab=file["lab"] as? JournalObject {
                        NavigationLink {LabReport(journal:journal,owner:owner,id:id)} label:{
                            VStack(alignment:.leading){Text(caption(lab,"name"));Text(caption(lab,"date")+" · "+caption(file,"name")).font(.caption)}
                        }
                    } else if !journal.editable {
                        NavigationLink(caption(file,"name")){DeviceAttachment(journal:journal,owner:owner,id:id,name:caption(file,"name"))}
                    }
                }
            }
        }.journalBackground().navigationTitle("Анализы и измерения").navigationBarTitleDisplayMode(.inline)
            .searchable(text:$query,placement:.navigationBarDrawer(displayMode:.always),prompt:"Анализ, показатель или тег")
        .sheet(isPresented:$adding){NavigationStack {Form {
            TextField("Показатель",text:$name).journalField("measurement-name",visible)
            TextField("Значение",text:$value).journalField("measurement-value",visible)
            TextField("Единица",text:$unit).journalField("measurement-unit",visible)
            DatePicker("Дата и время",selection:$date,in:...Date())
            Picker("Эпизод",selection:$episode){Text("Без привязки").tag("");ForEach(entries(p,"episodes").indices,id:\.self){i in let e=entries(p,"episodes")[i];Text(caption(e,"name")).tag(caption(e,"id"))}}
            if let error {Text(error).foregroundStyle(.red)}
            Button("Сохранить"){
                guard validation.submit(issues) else{return}
                do{
                let fmt=DateFormatter();fmt.locale=Locale(identifier:"en_US_POSIX");fmt.dateFormat="yyyy-MM-dd'T'HH:mm"
                try journal.changeProfile(owner){v in v["measurements"]=entries(v,"measurements")+[["id":UUID().uuidString,"name":name.trim,"value":value.trim,"unit":unit.trim,"time":fmt.string(from:date),"episode":episode]]}
                adding=false;value=""
            }catch{self.error=error.localizedDescription}}.disabled(journal.busy || !journal.editable)
        }.journalValidation(validation).navigationTitle("Домашнее измерение")}}
    }
}
struct Prevention:View {
    @ObservedObject var journal:DeviceJournal;let owner:String
    @State private var edit=false
    @State private var key=""
    @State private var name=""
    @State private var kind="vaccine"
    @State private var period=""
    @State private var planned=false
    @State private var next=Date()
    @State private var done=false
    @State private var actual=Date()
    @State private var note=""
    @State private var error:String?
    @State private var validation=JournalFormValidation()
    var body:some View {
        let list=entries(journal.profile(owner),"prevention")
        let issues=[
            key.isEmpty ? JournalFieldIssue.required("prevention-name",name,"Введите название.") : nil,
            done && planned && dayString(actual)>dayString(next) ?
                JournalFieldIssue(field:"prevention-next",message:"Следующая дата должна быть не раньше даты выполнения.") : nil
        ].compactMap{$0}
        let visible=validation.visible(issues)
        List {
            ForEach(list.indices,id:\.self){i in let r=list[i];Section(caption(r,"title")){
                if !caption(r,"next").isEmpty {LabeledContent("Следующая дата",value:caption(r,"next"))}
                if !caption(r,"period").isEmpty {Text(caption(r,"period"))}
                ForEach(entries(r,"history").indices,id:\.self){j in Text("Выполнено · "+caption(entries(r,"history")[j],"date"))}
                if journal.editable {Button("Отметить выполнение"){key=caption(r,"id");name=caption(r,"title");kind=caption(r,"kind");period=caption(r,"period");done=true;planned=false;note="";edit=true}}
            }}
            if journal.editable {Button("Добавить прививку или процедуру"){key="";name="";kind="vaccine";period="";planned=false;done=false;note="";edit=true}}
        }.journalBackground().navigationTitle("Профилактика").navigationBarTitleDisplayMode(.inline).sheet(isPresented:$edit){NavigationStack{Form{
            if key.isEmpty {
                TextField("Название",text:$name).journalField("prevention-name",visible)
                Picker("Вид",selection:$kind){Text("Прививка").tag("vaccine");Text("Плановый анализ").tag("lab");Text("Процедура").tag("procedure")}
            }
            TextField("Периодичность",text:$period)
            Toggle("Выполнено",isOn:$done);if done {DatePicker("Дата",selection:$actual,in:...Date(),displayedComponents:.date)}
            Toggle("Указать следующую дату",isOn:$planned)
            if planned {DatePicker("По плану",selection:$next,displayedComponents:.date).journalField("prevention-next",visible)}
            TextField("Примечание",text:$note)
            if let error {Text(error).foregroundStyle(.red)}
            Button("Сохранить"){
                guard validation.submit(issues) else{return}
                do{try journal.changeProfile(owner){p in
                var records=entries(p,"prevention"),r=records.first{caption($0,"id")==key} ?? ["id":UUID().uuidString,"title":name.trim,"kind":kind,"note":note,"next":"","history":[]] as JournalObject
                r["period"]=period;if planned{r["next"]=dayString(next)}
                if done {r["history"]=(entries(r,"history")+[["id":UUID().uuidString,"date":dayString(actual),"source":"","note":note]]).sorted{caption($0,"date")<caption($1,"date")}}
                if let i=records.firstIndex(where:{caption($0,"id")==key}){records[i]=r}else{records.append(r)};p["prevention"]=records
            };edit=false}catch{self.error=error.localizedDescription}}.disabled(journal.busy || !journal.editable)
        }.journalValidation(validation).onAppear{validation=JournalFormValidation();error=nil}.navigationTitle("Профилактика")}}
    }
}
