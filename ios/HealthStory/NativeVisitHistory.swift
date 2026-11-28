import SwiftUI

struct NativeVisitHistory: View {
    @ObservedObject var journal: DeviceJournal
    let owner: String
    @State private var byEpisode = false
    @State private var search = ""
    @State private var creating = false

    var body: some View {
        let profile = journal.profile(owner)
        let tags = RecordTags(profile: profile, library: entries(journal.data, "tags"))
        let rows = NativeTreatments.visits(profile).sorted {
            NativeTreatments.field($0, 1) > NativeTreatments.field($1, 1)
        }
        let filtered = rows.filter { row in
            tags.matches(search, key: "visit:" + NativeTreatments.field(row, 0),
                         fields: [NativeTreatments.field(row, 2), NativeTreatments.field(row, 4)] + doctor(row, profile))
        }
        List {
            Picker("Порядок истории", selection: $byEpisode) {
                Text("По датам").tag(false)
                Text("По эпизодам").tag(true)
            }.pickerStyle(.segmented)
            if byEpisode {
                if journal.editable {
                    Button("Создать эпизод", systemImage: "plus") { creating = true }
                }
                ForEach(NativeTreatments.episodes(profile), id: \.id) { episode in
                    let visits = rows.filter { NativeTreatments.episode($0, profile) == episode.id }
                    if search.trim.isEmpty || episode.name.localizedCaseInsensitiveContains(search.trim)
                        || filtered.contains(where: { NativeTreatments.episode($0, profile) == episode.id }) {
                        NavigationLink {
                            VisitBrief(journal: journal, owner: owner, episodeID: episode.id)
                        } label: {
                            JournalRowLabel(title: episode.name, symbol: "folder", subtitle: "Визитов: \(visits.count)")
                        }
                    }
                }
            } else {
                ForEach(filtered, id: \.visitID) { row in
                    NavigationLink { NativeVisitDetails(journal: journal, owner: owner, row: row) } label: {
                        JournalVisitLabel(title: NativeTreatments.field(row, 2), day: NativeTreatments.field(row, 1),
                                          detail: doctor(row, profile).prefix(2).reversed().joined(separator: " · "))
                    }
                }
            }
        }
        .journalBackground()
        .navigationTitle("История")
        .searchable(text: $search, prompt: "Врач, визит или эпизод")
        .sheet(isPresented: $creating) { NavigationStack { NewEpisode(journal: journal, owner: owner) } }
    }

    private func doctor(_ row: [Any], _ profile: JournalObject) -> [String] {
        entries(profile, "addedDoctors").first { caption($0, "id") == NativeTreatments.field(row, 3) }?["values"] as? [String] ?? []
    }
}

private extension Array where Element == Any {
    var visitID: String { NativeTreatments.field(self, 0) }
}

private struct NewEpisode: View {
    @ObservedObject var journal: DeviceJournal
    let owner: String
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var error = ""
    @State private var validation = JournalFormValidation()

    var body: some View {
        let issues = [JournalFieldIssue.required("episode-name", name, "Введите название эпизода.")].compactMap { $0 }
        Form {
            TextField("Название эпизода", text: $name).journalField("episode-name", validation.visible(issues))
            Button("Сохранить эпизод") {
                guard validation.submit(issues) else { return }
                do {
                    try journal.changeProfile(owner) { profile in
                        let episodes = entries(profile, "episodes")
                        guard !episodes.contains(where: { ClinicalDuplicates.text(caption($0, "name")) == ClinicalDuplicates.text(name) }) else {
                            throw JournalError("Эпизод с таким названием уже есть.")
                        }
                        profile["episodes"] = episodes + [["id": UUID().uuidString, "name": name.trim]]
                    }
                    dismiss()
                } catch { self.error = error.localizedDescription }
            }.disabled(journal.busy || !journal.editable)
            if !error.isEmpty { Text(error).foregroundStyle(.red) }
        }.journalValidation(validation).navigationTitle("Новый эпизод")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } } }
    }
}

struct NativeEpisodeTimeline: View {
    @ObservedObject var journal: DeviceJournal
    let owner: String, episode: String
    let visits: [[Any]]

    var body: some View {
        let profile = journal.profile(owner)
        let ids = Set(visits.map(\.visitID))
        let docs = entries(profile, "files").filter { ids.contains(caption($0, "visit")) && $0["lab"] != nil }
        let measurements = entries(profile, "measurements").filter { caption($0, "episode") == episode }
        let exams = entries(profile, "exams").filter { ids.contains(caption($0, "visit")) }
        let decisions = entries(profile, "changes").filter { caption($0, "episode") == episode || ids.contains(caption($0, "visit")) }
        let all: [Event] = visits.map {
            Event(id: "visit:" + $0.visitID, date: NativeTreatments.field($0, 1), order: 0,
                  title: NativeTreatments.field($0, 2), symbol: "calendar", visit: $0)
        } + decisions.map { change in
            let medicine = change["before"] as? JournalObject ?? [:]
            let title = ["continue": "Продолжение", "dose": "Изменение дозы", "replace": "Замена", "stop": "Отмена"][caption(change, "kind")] ?? "Изменение лечения"
            return Event(id: "change:" + caption(change, "id"), date: caption(change, "date"), order: 1,
                         title: [title, caption(medicine, "name")].filter { !$0.isEmpty }.joined(separator: " · "),
                         symbol: "pills", visit: visits.first { $0.visitID == caption(change, "visit") })
        } + docs.map { file in
            let lab = file["lab"] as? JournalObject ?? [:]
            return Event(id: "lab:" + caption(file, "id"), date: caption(lab, "date"), order: 2, title: caption(lab, "name"),
                         symbol: "testtube.2", lab: caption(file, "id"))
        } + exams.map { exam in
            Event(id: "exam:" + caption(exam, "id"), date: caption(exam, "date"), order: 3,
                  title: nativeExamTitle(exam), symbol: "doc.text", exam: caption(exam, "id"))
        } + measurements.map { measurement in
            Event(id: "measurement:" + caption(measurement, "id"), date: caption(measurement, "time"), order: 4,
                  title: ["name", "value", "unit"].map { caption(measurement, $0) }.filter { !$0.isEmpty }.joined(separator: " · "),
                  symbol: "waveform.path")
        }
        Section("Хронология эпизода") {
            ForEach(all.sorted { ($0.date, $0.order, $0.id) < ($1.date, $1.order, $1.id) }) { event in
                if let visit = event.visit {
                    NavigationLink { NativeVisitDetails(journal: journal, owner: owner, row: visit) } label: { label(event) }
                } else if let lab = event.lab {
                    NavigationLink { LabReport(journal: journal, owner: owner, id: lab) } label: { label(event) }
                } else if let exam = event.exam {
                    NavigationLink { NativeExamDetail(journal: journal, owner: owner, id: exam) } label: { label(event) }
                } else { label(event) }
            }
        }
    }

    private func label(_ event: Event) -> some View {
        JournalRowLabel(title: event.title, symbol: event.symbol, subtitle: event.date)
    }

    private struct Event: Identifiable {
        let id: String, date: String, order: Int, title: String, symbol: String
        var visit: [Any]?
        var lab: String?
        var exam: String?
    }
}
