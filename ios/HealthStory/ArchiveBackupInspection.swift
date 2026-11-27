import SwiftUI
import UniformTypeIdentifiers

struct ArchiveBackupInspection: View {
    struct Source: Identifiable {
        let name: String
        let bytes: Data
        let id = UUID()
    }

    @State private var source: Source?
    @State private var checked: FamilyArchive?
    @State private var key = ""
    @State private var notice: String?
    @State private var picking = false
    @State private var busy = false
    @State private var validation = JournalFormValidation()
    @State private var keyRejected = false
    @Environment(\.scenePhase) private var phase

    init(source: Source? = nil) {
        _source = State(initialValue: source)
    }

    var body: some View {
        let keyIssues = [JournalFieldIssue.recoveryKey(key, rejected: keyRejected)].compactMap { $0 }
        List {
            Section {
                Text("Копия открывается для проверки на этом iPhone. Можно открыть документы из копии, пока рабочий дневник остаётся доступен.")
                    .foregroundStyle(JournalTheme.secondary)
                if let source {
                    LabeledContent("Файл", value: source.name)
                }
                Button("Выбрать файл копии", systemImage: "folder") { picking = true }
            }
            if let checked {
                Section {
                    Text(checked.family.name).font(JournalTheme.title(22))
                    LabeledContent("Профили", value: String(checked.family.members.count))
                    LabeledContent("Оригиналы", value: String(checked.originals.count))
                    ForEach(checked.family.members) { member in
                        if let profile = checked.profiles[member.id] {
                            NavigationLink(member.name) {
                                ArchiveProfileView(member: member, profile: profile, archive: checked)
                            }
                        }
                    }
                } header: { JournalSectionHeading("Копия проверена") }
            } else if source != nil {
                Section {
                    Button("Проверить ключом из iCloud", systemImage: "icloud.and.arrow.down") { check(fromCloud: true) }
                    SecureField("Семейный ключ восстановления", text: $key)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .journalField("recovery-key", validation.visible(keyIssues))
                    DisclosureGroup("Где взять ключ восстановления?") {
                        Text(familyRecoveryKeyHelp).font(.footnote).foregroundStyle(.secondary)
                    }
                    Button("Проверить копию") { if validation.submit(keyIssues) { check() } }
                }
            }
            if busy { ProgressView("Проверяем копию…") }
            if let notice { Text(notice).foregroundStyle(.red) }
        }
        .journalValidation(validation)
        .journalBackground()
        .navigationTitle("Проверка копии")
        .navigationBarTitleDisplayMode(.inline)
        .disabled(busy)
        .overlay { if phase != .active { JournalTheme.paper.ignoresSafeArea() } }
        .onChange(of: key) { _, _ in keyRejected = false }
        .fileImporter(isPresented: $picking, allowedContentTypes: [.data]) { result in
            guard case .success(let url) = result else { return }
            busy = true
            Task {
                defer { busy = false }
                do {
                    let bytes = try await Task.detached { try readNativeFile(url) }.value
                    source = Source(name: url.lastPathComponent, bytes: bytes)
                    checked = nil
                    key = ""
                    validation = JournalFormValidation()
                    notice = nil
                } catch { notice = "Не удалось прочитать выбранный файл." }
            }
        }
    }

    private func check(fromCloud: Bool = false) {
        guard let source else { return }
        let code = key
        notice = nil
        busy = true
        Task {
            defer { busy = false }
            do {
                if fromCloud {
                    checked = try await CloudArchiveKeys.unlock(source.bytes)
                } else {
                    checked = try await Task.detached {
                        try FamilyArchive(encrypted: source.bytes, recoveryKey: code)
                    }.value
                }
                key = ""
            } catch CloudArchiveKeys.Failure.cancelled {
            } catch FamilyArchive.Failure.decrypt where !fromCloud {
                keyRejected = true
                _ = validation.submit([JournalFieldIssue.recoveryKey(code, rejected: true)].compactMap { $0 })
            } catch { notice = error.localizedDescription }
        }
    }
}
