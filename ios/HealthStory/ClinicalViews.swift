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
        let indicators=trendCards(profile).filter{$0.isLab && $0.matches(query,tags:tags)}
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
        if !indicators.isEmpty {
            Section("Показатели анализов") {
                ForEach(indicators){card in TrendCardLink(journal:journal,owner:owner,card:card)}
            }
        }
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
    var key="", marker="", material="", rawName="", rawValue="", rawUnit="", range="", search="", report="", laboratory=""
    var dateSource=""
    var numeric:Double? {
        guard let number=Double(value.replacingOccurrences(of:",",with:".")),number.isFinite else {return nil}
        return number
    }
}

struct TrendSeries:Identifiable {
    let id:String,points:[TrendPoint]
    var name:String {points[0].name}
    var unit:String {points[0].unit}
    var isLab:Bool {points[0].source != nil}
    var material:String {points[0].material}
    var details:String {[material,unit,"Результатов: \(points.count)"].filter{!$0.isEmpty}.joined(separator:" · ")}

    func matches(_ query:String,tags:RecordTags) -> Bool {
        points.contains {point in
            let key=point.source.map{"lab:"+$0} ?? ""
            return tags.matches(query,key:key,fields:[name,material,unit,point.search,point.rawName,point.report,point.laboratory])
        }
    }
}

func trendSeries(_ profile:JournalObject) -> [TrendSeries] {
    Dictionary(grouping:trendPoints(profile),by:\.key)
        .map{TrendSeries(id:$0.key,points:$0.value)}
        .sorted{a,b in a.name==b.name ? a.id<b.id : a.name.localizedStandardCompare(b.name) == .orderedAscending}
}

struct TrendCard:Identifiable {
    let id:String,series:[TrendSeries]
    var name:String {series[0].name}
    var isLab:Bool {series[0].isLab}
    var details:String {
        if series.count==1 {return series[0].details}
        return "Разные биоматериалы или единицы · Результатов: \(series.reduce(0){$0+$1.points.count})"
    }
    func matches(_ query:String,tags:RecordTags) -> Bool {
        series.contains{$0.matches(query,tags:tags)}
    }
}

func trendCards(_ profile:JournalObject) -> [TrendCard] {
    Dictionary(grouping:trendSeries(profile)){series in
        let marker=series.points[0].marker
        return marker.isEmpty ? series.id : "indicator:"+marker
    }.map{TrendCard(id:$0.key,series:$0.value)}
        .sorted{a,b in a.name==b.name ? a.id<b.id : a.name.localizedStandardCompare(b.name) == .orderedAscending}
}

func trendPoints(_ profile:JournalObject)->[TrendPoint] {
    var out=entries(profile,"measurements").map{r in
        let storedName=caption(r,"name"),name=MeasurementPreset.find(storedName)?.name ?? storedName
        let unit=MeasurementPreset.unit(for:storedName,stored:caption(r,"unit"))
        return TrendPoint(id:caption(r,"id"),name:name,unit:unit,date:caption(r,"time"),value:caption(r,"value"),source:nil,
                          key:"measurement:"+ClinicalDuplicates.text(name)+"|"+unit)
    }
    let parser=try? ClinicalImport()
    for file in entries(profile,"files") {
        guard let lab=file["lab"] as? JournalObject else {continue}
        let source=caption(file,"id"),title=caption(lab,"name"),sampleDate=caption(lab,"date"),documentDate=caption(lab,"documentDate")
        let date=sampleDate.isEmpty ? documentDate : sampleDate
        let dateSource=sampleDate.isEmpty ? (documentDate.isEmpty ? "" : "Дата по бланку") : (lab["dateEstimated"] as? Bool == true ? "Дата подставлена" : "")
        for (i,r) in entries(lab,"rows").enumerated() {
            // Keep a per-row fallback if the normalization module ever fails; do not merge ambiguous samples.
            let fallbackKey=source+"-"+String(i)
            let n=parser?.seriesPoint(r,title:title) ?? r
            let material=caption(n,"specimen")
            let label=material.isEmpty ? "Биоматериал не уточнён" : material
            out.append(.init(id:fallbackKey,name:caption(n,"name"),unit:caption(n,"unit"),date:date,value:caption(n,"value"),source:source,
                key:n["key"] as? String ?? fallbackKey,marker:caption(n,"marker"),material:label,rawName:caption(r,"name"),rawValue:caption(r,"value"),rawUnit:caption(r,"unit"),
                range:caption(r,"range"),search:caption(n,"search"),report:title,laboratory:caption(lab,"laboratory"),dateSource:dateSource))
        }
    }
    return out.sorted{$0.date<$1.date}
}

struct TrendCardLink:View {
    @ObservedObject var journal:DeviceJournal
    let owner:String,card:TrendCard
    var body:some View {
        NavigationLink {TrendDetail(journal:journal,owner:owner,key:card.id)} label:{
            JournalRowLabel(title:card.name,symbol:"chart.xyaxis.line",subtitle:card.details)
        }
    }
}

struct TrendDetail:View {
    @ObservedObject var journal:DeviceJournal
    let owner:String,key:String
    @State private var selectedSeries=""
    @State private var measurement:MeasurementDestination?

    var body:some View {
        if let card=trendCards(journal.profile(owner)).first(where:{$0.id==key || $0.series.contains{$0.id==key}}) {
            let series=card.series.first{$0.id==selectedSeries} ?? card.series.first{$0.id==key} ?? card.series[0]
            List {
                if card.series.count>1 {
                    Picker("Ряд для сравнения",selection:Binding(get:{series.id},set:{selectedSeries=$0})) {
                        ForEach(card.series){option in Text(seriesLabel(option)).tag(option.id)}
                    }
                }
                seriesContent(series)
            }.journalBackground().navigationTitle(card.name)
                .sheet(item:$measurement){choice in NativeMeasurementEditor(journal:journal,owner:owner,choice:choice)}
        }else {ContentUnavailableView("Нет результатов",systemImage:"chart.xyaxis.line")}
    }
    private func seriesLabel(_ series:TrendSeries)->String {
        [series.details,series.material=="Биоматериал не уточнён" ? series.points[0].date:""].filter{!$0.isEmpty}.joined(separator:" · ")
    }

    @ViewBuilder private func seriesContent(_ series:TrendSeries) -> some View {
        let values=chartValues(series.points)
        Section {
            if !series.material.isEmpty || !series.unit.isEmpty {
                Text([series.material,series.unit].filter{!$0.isEmpty}.joined(separator:" · "))
            }
            if values.isEmpty {
                Text("Для графика нужны числовые результаты с датой.").foregroundStyle(.secondary)
            }else {
                PointChart(values:values,unit:series.unit)
            }
            if journal.editable { NativeConsultationLink(journal:journal,owner:owner,source:"indicator:"+series.id) }
            Text("Результаты за всё время").font(.headline)
            ForEach(series.points){point in
                if let id=point.source {
                    NavigationLink {DeviceAttachment(journal:journal,owner:owner,id:id,name:point.report)} label:{resultLabel(point)}
                } else if journal.editable {
                    Button {
                        measurement=MeasurementDestination(source:point.id,repeatMeasurement:false)
                    } label:{LabeledContent(point.date,value:point.value+" "+point.unit)}
                } else {LabeledContent(point.date,value:point.value+" "+point.unit)}
            }
            if !series.isLab,journal.editable,let latest=series.points.max(by:{$0.date<$1.date}) {
                Button("Измерить ещё раз",systemImage:"plus"){measurement=MeasurementDestination(source:latest.id)}
            }
        }
    }

    private func resultLabel(_ point:TrendPoint) -> some View {
        let comparison=point.unit != point.rawUnit && point.value != point.rawValue ?
            "Для сравнения "+point.value.replacingOccurrences(of:".",with:",")+" "+point.unit : ""
        return VStack(alignment:.leading,spacing:4){
            Text([point.date,[point.rawValue,point.rawUnit].filter{!$0.isEmpty}.joined(separator:" ")].filter{!$0.isEmpty}.joined(separator:" · "))
            Text([point.rawName,comparison,point.dateSource,point.laboratory,point.range.isEmpty ? "" : "Диапазон по бланку: "+point.range]
                .filter{!$0.isEmpty}.joined(separator:" · "))
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private struct ChartPoint:Identifiable {let id:String,date:Date,value:Double,reading:String,dateCaption:String}

    private struct PointChart:View {
        let values:[ChartPoint],unit:String
        @State private var overflowRows=0
        private let captionHeight:CGFloat=34, gap:CGFloat=6

        var body:some View {
            Chart(values){point in
                LineMark(x:.value("Дата",point.date),y:.value(unit,point.value))
                PointMark(x:.value("Дата",point.date),y:.value(unit,point.value))
            }.chartXAxis{AxisMarks(values:.automatic(desiredCount:4)) {AxisGridLine();AxisTick();AxisValueLabel(format:.dateTime.month(.abbreviated).year())}}
            .chartYAxisLabel(unit)
            .chartOverlay {proxy in
                GeometryReader {geometry in
                    if let plot=proxy.plotFrame {
                        let (captions,rows)=placements(proxy,frame:geometry[plot])
                        ZStack(alignment:.topLeading) {
                            Path {line in
                                for caption in captions {
                                    let rect=caption.rect,dot=caption.dot
                                    let x=min(rect.maxX-5,max(rect.minX+5,dot.x))
                                    let y=min(rect.maxY,max(rect.minY,dot.y))
                                    line.move(to:CGPoint(x:x,y:y))
                                    line.addLine(to:dot)
                                }
                            }.stroke(JournalTheme.secondary.opacity(0.58),lineWidth:0.75)
                            ForEach(captions){caption in
                                VStack(spacing:1){
                                    Text(caption.point.reading).font(.system(size:14,weight:.semibold))
                                    Text(caption.point.dateCaption).font(.system(size:11)).foregroundStyle(JournalTheme.secondary)
                                }
                                .lineLimit(1).minimumScaleFactor(0.75)
                                .padding(.horizontal,4)
                                .frame(width:caption.rect.width,height:captionHeight)
                                .background(JournalTheme.leaf,in:.rect(cornerRadius:6))
                                .position(x:caption.rect.midX,y:caption.rect.midY)
                            }
                        }.allowsHitTesting(false).accessibilityHidden(true)
                            .onChange(of:rows,initial:true){_,newRows in overflowRows=newRows}
                    }
                }
            }.frame(height:230).padding(.top,CGFloat(overflowRows)*(captionHeight+gap)).accessibilityLabel("График по датам")
        }

        private struct Caption:Identifiable {
            let point:ChartPoint,dot:CGPoint,rect:CGRect
            var id:String {point.id}
        }

        private func placements(_ proxy:ChartProxy,frame:CGRect) -> ([Caption],Int) {
            guard frame.width>20 else {return ([],0)}
            let dots=values.compactMap {point -> (point:ChartPoint,position:CGPoint)? in
                guard let x=proxy.position(forX:point.date),let y=proxy.position(forY:point.value) else {return nil}
                return (point,CGPoint(x:frame.minX+x,y:frame.minY+y))
            }
            let segments=Array(zip(dots.map(\.position),dots.dropFirst().map(\.position)))
            let bounds=frame.insetBy(dx:3,dy:3)
            var result=[Caption](),overflowRows=0,nextOverflowX=bounds.maxX
            for (point,dot) in dots {
                let width=min(bounds.width,max(70,CGFloat(max(point.reading.count*9,point.dateCaption.count*6)+12)))
                let side:CGFloat=dot.y>bounds.midY ? 1 : -1
                let offsets:[(CGFloat,CGFloat)]=[(0,side),(0,-side),(-1,0),(1,0),(-1,side),(1,side),(-1,-side),(1,-side)]
                let candidates=([12,24,36] as [CGFloat]).flatMap { distance in
                    offsets.map{dx,dy in
                        let x=dot.x-width/2+dx*(width/2+distance)
                        let y=dot.y-captionHeight/2+dy*(captionHeight/2+distance)
                        return CGRect(x:min(bounds.maxX-width,max(bounds.minX,x)),y:y,width:width,height:captionHeight)
                    }
                }.filter {rect in
                    let clearance=rect.insetBy(dx:-gap,dy:-gap)
                    return bounds.contains(rect) && !dots.contains{clearance.contains($0.position)} && !result.contains{clearance.intersects($0.rect)}
                }
                let rect:CGRect
                if let near=candidates.first(where:{box in !segments.contains{crosses(box,from:$0.0,to:$0.1)}}) ?? candidates.first {
                    rect=near
                }else{
                    if nextOverflowX+width>bounds.maxX {overflowRows+=1;nextOverflowX=bounds.minX}
                    let x=min(bounds.maxX-width,max(nextOverflowX,dot.x-width/2))
                    rect=CGRect(x:x,y:-(CGFloat(overflowRows)*(captionHeight+gap))+3,width:width,height:captionHeight)
                    nextOverflowX=rect.maxX+gap
                }
                result.append(Caption(point:point,dot:dot,rect:rect))
            }
            return (result,overflowRows)
        }

        private func crosses(_ box:CGRect,from a:CGPoint,to b:CGPoint) -> Bool {
            let left=max(a.x,box.minX),right=min(b.x,box.maxX)
            guard left<=right else {return false}
            if a.x==b.x {return min(a.y,b.y)<box.maxY && max(a.y,b.y)>box.minY}
            let start=a.y+(b.y-a.y)*(left-a.x)/(b.x-a.x)
            let end=a.y+(b.y-a.y)*(right-a.x)/(b.x-a.x)
            return min(start,end)<box.maxY && max(start,end)>box.minY
        }
    }

    private func chartValues(_ points:[TrendPoint]) -> [ChartPoint] {
        let localTime=DateFormatter()
        localTime.locale=Locale(identifier:"en_US_POSIX")
        localTime.calendar=Calendar(identifier:.gregorian)
        localTime.dateFormat="yyyy-MM-dd'T'HH:mm"
        return points.compactMap {point in
            let date=point.source==nil ? localTime.date(from:point.date) : CoursePeriod.date(point.date)
            guard let date,let value=point.numeric else {return nil}
            let day=point.date.prefix(10).split(separator:"-").reversed().joined(separator:".")
            let time=point.date.dropFirst(11).prefix(5)
            let caption=time.isEmpty ? day : day+" "+time
            return ChartPoint(id:point.id,date:date,value:value,reading:point.value.replacingOccurrences(of:".",with:","),dateCaption:caption)
        }
    }
}
struct Trends:View {
    @ObservedObject var journal:DeviceJournal;let owner:String
    private enum Mode: String, CaseIterable { case all = "Все", reports = "Бланки", indicators = "Показатели", prevention = "Профилактика" }
    @State private var query:String
    @State private var mode = Mode.all
    @State private var category = ""
    @State private var measurement:MeasurementDestination?
    init(journal:DeviceJournal,owner:String,initialQuery:String="") {
        self.journal=journal;self.owner=owner;_query=State(initialValue:initialQuery)
    }
    var body:some View {
        let p=journal.profile(owner)
        let tags=RecordTags(profile:p,library:entries(journal.data,"tags"))
        let results=trendCards(p).filter{$0.matches(query,tags:tags)}
        List {
            if journal.editable {
                NavigationLink("Добавить лабораторный бланк"){LabIntake(journal:journal,owner:owner)}
                Button("Добавить измерение"){measurement=MeasurementDestination()}
            }
            Picker("Раздел анализов", selection: $mode) {
                ForEach(Mode.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            if mode == .prevention {
                NavigationLink("Профилактика") { Prevention(journal:journal,owner:owner) }
            }
            if mode == .all || mode == .indicators {
                trendSection("Показатели анализов",results.filter(\.isLab))
                trendSection("Домашние измерения",results.filter{!$0.isLab})
            }
            if mode == .all || mode == .reports {
            if mode == .reports {
                Picker("Категория бланка", selection: $category) {
                    Text("Все").tag("")
                    ForEach(["Гематология","Биохимия","Другое"],id:\.self) { Text($0).tag($0) }
                }
            }
            let reports=entries(p,"files").filter{
                let lab=($0["labDraft"] ?? $0["lab"]) as? JournalObject ?? [:]
                if mode == .reports && !category.isEmpty && caption(lab,"category") != category { return false }
                return ($0["category"] as? String=="Лаборатория" || $0["lab"] != nil) && tags.matches(query,key:"lab:"+caption($0,"id"),fields:[caption($0,"name"),caption(($0["labDraft"] ?? $0["lab"]) as? JournalObject ?? [:],"name")])
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
            }
        }.journalBackground().navigationTitle("Анализы и измерения").navigationBarTitleDisplayMode(.inline)
            .searchable(text:$query,placement:.navigationBarDrawer(displayMode:.always),prompt:"Анализ, показатель или тег")
        .sheet(item:$measurement){choice in NativeMeasurementEditor(journal:journal,owner:owner,choice:choice)}
    }

    @ViewBuilder private func trendSection(_ title:String,_ cards:[TrendCard]) -> some View {
        if !cards.isEmpty {
            Section(title){ForEach(cards){card in TrendCardLink(journal:journal,owner:owner,card:card)}}
        }
    }
}

private struct MeasurementPreset {
    let name:String,unit:String,aliases:[String],unitAliases:[String]
    static let all=[
        Self(name:"Температура",unit:"°C",aliases:["температура тела"],unitAliases:["°с","c","с","градусы цельсия"]),
        Self(name:"Вес",unit:"кг",aliases:["масса тела"],unitAliases:["kg"]),
        Self(name:"Рост",unit:"см",aliases:[],unitAliases:["cm"]),
        Self(name:"Пульс",unit:"уд/мин",aliases:["частота пульса","чсс"],unitAliases:["уд./мин","уд в мин","bpm"]),
        Self(name:"Систолическое давление",unit:"мм рт. ст.",aliases:["верхнее давление"],unitAliases:["мм рт ст","mmhg"]),
        Self(name:"Диастолическое давление",unit:"мм рт. ст.",aliases:["нижнее давление"],unitAliases:["мм рт ст","mmhg"])
    ]
    static func find(_ name:String)->Self? {
        let key=ClinicalDuplicates.text(name)
        return all.first{ClinicalDuplicates.text($0.name)==key || $0.aliases.contains(key)}
    }
    static func unit(for name:String,stored:String)->String {
        guard let preset=find(name) else{return stored}
        let key=stored.trim.lowercased().replacingOccurrences(of:"\\s*/\\s*",with:"/",options:.regularExpression)
        return key==preset.unit.lowercased() || preset.unitAliases.contains(key) ? preset.unit:stored
    }
}

private struct MeasurementDestination:Identifiable {
    let id=UUID()
    var source:String?=nil
    var repeatMeasurement=true
}

private struct NativeMeasurementEditor:View {
    @ObservedObject var journal:DeviceJournal
    let owner:String
    let original:JournalObject?
    @Environment(\.dismiss) private var dismiss
    @State private var name:String
    @State private var unit:String
    @State private var value:String
    @State private var date:Date
    @State private var episode:String
    @State private var error:String?
    @State private var validation=JournalFormValidation()

    init(journal:DeviceJournal,owner:String,choice:MeasurementDestination){
        self.journal=journal;self.owner=owner
        let source=entries(journal.profile(owner),"measurements").first{caption($0,"id")==choice.source} ?? [:]
        original=choice.repeatMeasurement ? nil:source
        let initialName=caption(source,"name")
        _name=State(initialValue:initialName)
        _unit=State(initialValue:MeasurementPreset.unit(for:initialName,stored:caption(source,"unit")))
        _value=State(initialValue:choice.repeatMeasurement ? "":caption(source,"value"))
        _date=State(initialValue:choice.repeatMeasurement ? Date():Self.dateFormatter().date(from:caption(source,"time")) ?? Date())
        _episode=State(initialValue:caption(source,"episode"))
    }
    private static func dateFormatter()->DateFormatter {
        let formatter=DateFormatter()
        formatter.locale=Locale(identifier:"en_US_POSIX");formatter.calendar=Calendar(identifier:.gregorian)
        formatter.dateFormat="yyyy-MM-dd'T'HH:mm"
        return formatter
    }
    var body:some View {
        let episodes=entries(journal.profile(owner),"episodes")
        let numeric=Double(value.trim.replacingOccurrences(of:",",with:"."))?.isFinite == true
        let issues=[
            JournalFieldIssue.required("measurement-name",name,"Введите название показателя."),
            numeric ? nil : JournalFieldIssue(field:"measurement-value",message:"Введите числовое значение."),
            .required("measurement-unit",unit,"Введите единицу измерения.")
        ].compactMap{$0}
        let visible=validation.visible(issues)
        NavigationStack {
            Form {
                Picker("Готовые показатели",selection:Binding(get:{MeasurementPreset.find(name)?.name ?? ""},set:{
                    name=$0;unit=MeasurementPreset.find($0)?.unit ?? ""
                })) {
                    Text("Другое").tag("")
                    ForEach(MeasurementPreset.all,id:\.name){preset in Text(preset.name+" · "+preset.unit).tag(preset.name)}
                }
                TextField("Показатель",text:$name).journalField("measurement-name",visible)
                TextField("Значение",text:$value).keyboardType(.decimalPad).journalField("measurement-value",visible)
                TextField("Единица",text:$unit).journalField("measurement-unit",visible)
                DatePicker("Дата и время",selection:$date,in:...max(Date(),date))
                Picker("Эпизод",selection:$episode){
                    Text("Без привязки").tag("")
                    ForEach(episodes.indices,id:\.self){index in
                        Text(caption(episodes[index],"name")).tag(caption(episodes[index],"id"))
                    }
                }
                if let error {Text(error).foregroundStyle(.red)}
                Button("Сохранить измерение"){
                    if validation.submit(issues){save()}
                }.disabled(journal.busy || !journal.editable)
            }.journalValidation(validation).journalBackground().navigationTitle(original==nil ? "Домашнее измерение":"Редактировать измерение")
                .toolbar{ToolbarItem(placement:.cancellationAction){Button("Отмена"){dismiss()}}}
        }
    }
    private func save(){
        do{
            try journal.changeProfile(owner){profile in
                var rows=entries(profile,"measurements")
                let id=original.map{caption($0,"id")} ?? UUID().uuidString
                let fields:JournalObject=["id":id,"name":name.trim,"value":value.trim,
                    "unit":MeasurementPreset.unit(for:name,stored:unit.trim),"time":Self.dateFormatter().string(from:date),"episode":episode]
                if let original {
                    guard let index=rows.firstIndex(where:{caption($0,"id")==id}),
                          try jsonBytes(original)==jsonBytes(rows[index]) else{throw JournalError("Измерение изменилось. Откройте его снова.")}
                    rows[index].merge(fields){_,new in new}
                } else {rows.append(fields)}
                profile["measurements"]=rows
            }
            dismiss()
        }catch{self.error=error.localizedDescription}
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
