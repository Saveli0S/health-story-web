import SwiftUI

struct NativeDoctorLink:View {
    @ObservedObject var journal:DeviceJournal
    let owner:String,visit:String

    static func values(profile:JournalObject,id:String)->[String] {
        entries(profile,"addedDoctors").first{caption($0,"id")==id}?["values"] as? [String] ?? []
    }

    var body:some View {
        let profile=journal.profile(owner)
        if let row=NativeTreatments.visits(profile).first(where:{NativeTreatments.field($0,0)==visit}) {
            let id=NativeTreatments.field(row,3),doctor=Self.values(profile:profile,id:id)
            if let name=doctor.first,!name.isEmpty {
                let title=doctor.prefix(2).reversed().filter{!$0.isEmpty}.joined(separator:" · ")
                NavigationLink {NativeDoctorCard(journal:journal,owner:owner,id:id)} label:{
                    JournalRowLabel(title:title,symbol:"person.crop.circle.badge.checkmark")
                }.accessibilityIdentifier("doctor-card-"+id)
            }
        }
    }
}

private struct NativeDoctorCard:View {
    @ObservedObject var journal:DeviceJournal
    let owner:String,id:String
    var body:some View {
        let profile=journal.profile(owner),doctor=NativeDoctorLink.values(profile:profile,id:id)
        let visits=NativeTreatments.visits(profile).filter{NativeTreatments.field($0,3)==id}
            .sorted{NativeTreatments.field($0,1)>NativeTreatments.field($1,1)}
        List {
            if let name=doctor.first,!name.isEmpty {
                let specialty=doctor.count>1 ? doctor[1] : ""
                Section {
                    JournalHero(title:name,label:specialty.isEmpty ? "Врач" : specialty,symbol:"person.crop.circle.badge.checkmark"){EmptyView()}
                    if doctor.count>2,!doctor[2].isEmpty {LabeledContent("Клиника",value:doctor[2])}
                }
                Section("Визиты к этому врачу") {
                    ForEach(visits.indices,id:\.self){index in
                        let row=visits[index]
                        NavigationLink {NativeVisitDetails(journal:journal,owner:owner,row:row)} label:{
                            JournalVisitLabel(title:NativeTreatments.field(row,2),day:NativeTreatments.field(row,1),detail:NativeTreatments.field(row,4))
                        }
                    }
                }
            } else {Text("Карточка врача недоступна.")}
        }.journalBackground().navigationTitle("Врач").navigationBarTitleDisplayMode(.inline)
    }
}
