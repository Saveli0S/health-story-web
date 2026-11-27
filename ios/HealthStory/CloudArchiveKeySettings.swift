import SwiftUI

struct CloudArchiveKeySettings: View {
    @ObservedObject var journal: DeviceJournal
    @Environment(\.scenePhase) private var phase
    @State private var picker = false
    @State private var selected: Data?
    @State private var name = ""
    @State private var key = ""
    @State private var busy = false
    @State private var hasKeys = false
    @State private var confirmingRemoval = false
    @State private var status: String?
    @State private var validation = JournalFormValidation()
    @State private var keyRejected = false

    var body: some View {
        let keyIssues = [JournalFieldIssue.recoveryKey(key, rejected: keyRejected)].compactMap { $0 }
        Form {
            Section {
                Text("Сохраните ключ в Связке ключей iCloud, чтобы открыть копию на новом iPhone с тем же Apple Account. Для восстановления понадобится файл копии.")
                Text("На новом iPhone включите синхронизацию «Пароли и связка ключей» в настройках iCloud.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            if journal.admin {
                if journal.hasLocalArchive {
                    Section {
                        Button("Сохранить ключ открытого архива в iCloud", systemImage: "icloud.and.arrow.up") {
                            perform { try await journal.rememberOpenArchiveKeyInCloud(); saved() }
                        }
                    }
                } else {
                    Section("Проверить копию перед сохранением ключа") {
                        Button("Выбрать файл копии", systemImage: "folder") { picker = true }
                        NavigationLink("Копии на Google Диске") {
                            DriveBackupView(journal: journal, receive: select)
                        }
                        if selected != nil {
                            Text(name)
                            SecureField("Семейный ключ восстановления", text: $key)
                                .textInputAutocapitalization(.never).autocorrectionDisabled()
                                .journalField("recovery-key", validation.visible(keyIssues))
                            DisclosureGroup("Где взять ключ восстановления?") {
                                Text(familyRecoveryKeyHelp).font(.footnote).foregroundStyle(.secondary)
                            }
                            Button("Проверить копию и сохранить ключ в iCloud") {
                                if validation.submit(keyIssues) { rememberSelectedKey() }
                            }
                        }
                    }
                }
                if hasKeys {
                    Section {
                        Button("Удалить сохранённые ключи из iCloud", systemImage: "trash", role: .destructive) {
                            confirmingRemoval = true
                        }
                    }
                }
            }
            if busy { ProgressView() }
            if let status { Text(status).foregroundStyle(.secondary) }
        }
        .journalValidation(validation)
        .journalBackground()
        .disabled(busy)
        .navigationTitle("Ключ восстановления в iCloud")
        .navigationBarTitleDisplayMode(.inline)
        .task { hasKeys = CloudArchiveKeys.hasKeys() }
        .onChange(of: key) { _, _ in keyRejected = false }
        .onChange(of: phase) { _, phase in if phase == .active { hasKeys = CloudArchiveKeys.hasKeys() } }
        .fileImporter(isPresented: $picker, allowedContentTypes: [.data]) { result in
            perform {
                let url = try result.get()
                let data = try await Task.detached { try readNativeFile(url) }.value
                select(data, url.lastPathComponent)
            }
        }
        .confirmationDialog("Удалить ключи восстановления из iCloud?", isPresented: $confirmingRemoval, titleVisibility: .visible) {
            Button("Удалить ключи из iCloud", role: .destructive) {
                perform {
                    try await CloudArchiveKeys.forget()
                    hasKeys = false
                    status = "Ключи удалены из связки ключей iCloud."
                }
            }
        } message: {
            Text("Удаление распространяется на устройства с тем же Apple Account. Файлы копий и ключ, запомненный только на этом iPhone, сохранятся.")
        }
    }

    private func select(_ data: Data, _ name: String) {
        selected = data
        self.name = name
        key = ""
        validation = JournalFormValidation()
        status = nil
    }

    private func rememberSelectedKey() {
        guard let selected else { return }
        let code = key
        perform {
            let archive: FamilyArchive
            do {
                archive = try await Task.detached { try FamilyArchive(encrypted: selected, recoveryKey: code) }.value
            } catch FamilyArchive.Failure.decrypt {
                keyRejected = true
                _ = validation.submit([JournalFieldIssue.recoveryKey(code, rejected: true)].compactMap { $0 })
                return
            }
            let activeFamily = journal.data["family"] as? JournalObject
            guard let archiveID = archive.family.id, archiveID == activeFamily?["id"] as? String else {
                throw JournalError("Выберите копию семьи, открытой на этом iPhone.")
            }
            try await CloudArchiveKeys.remember(archive)
            saved()
        }
    }

    private func saved() {
        selected = nil
        name = ""
        key = ""
        hasKeys = true
        status = "Ключ сохранён в связке ключей. Его перенос на другие устройства выполняет iCloud."
    }

    private func perform(_ action: @escaping @MainActor () async throws -> Void) {
        guard journal.admin, !busy else { return }
        busy = true
        status = nil
        Task {
            defer { busy = false }
            do { try await action() }
            catch CloudArchiveKeys.Failure.cancelled {}
            catch { status = error.localizedDescription }
        }
    }
}
