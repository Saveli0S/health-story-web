import SwiftUI
import UniformTypeIdentifiers
import PDFKit
import GoogleSignIn

let familyRecoveryKeyHelp = "В веб-дневнике администратора откройте «Настройки → Синхронизация и резервная копия → Ключ восстановления семьи». Если при создании файла указали другой ключ, используйте его."

@main
struct HealthStoryApp: App {
    @StateObject private var journal = DeviceJournal()
    @StateObject private var chatGPT = NativeChatGPTAccount()
    @State private var apiKeys = NativeAPIKeys()
    var body: some Scene {
        WindowGroup {
            Group {
                if journal.paired || journal.admin {
                    if chatGPT.configured && journal.editable {
                        DeviceHome(journal: journal, chatGPTAccount: chatGPT).environment(\.nativeChatGPT, chatGPT.transport)
                    } else { DeviceHome(journal: journal) }
                } else { ArchiveHome().environmentObject(journal) }
            }
                .preferredColorScheme(.light)
                .tint(JournalTheme.green)
                .environment(\.nativeAPIKeys, apiKeys)
                .task(id: NativeAPIKeys.selection(journal)) { apiKeys.activate(NativeAPIKeys.selection(journal)) }
                .task(id: chatGPT.selection(for: journal)) { await chatGPT.activate(for: journal) }
                .onOpenURL {url in _=GIDSignIn.sharedInstance.handle(url)}
        }
    }
}

struct ArchiveHome: View {
    private enum UnlockSource { case manual, device, iCloud }

    @EnvironmentObject private var journal: DeviceJournal
    @Environment(\.scenePhase) private var phase
    @State private var archive: FamilyArchive?
    @State private var selected: Data?
    @State private var preview: FamilyArchive?
    @State private var recoveryKey = ""
    @State private var fileName = ""
    @State private var error: String?
    @State private var picker = false
    @State private var busy = false
    @State private var hasSaved = false
    @State private var rememberKey = false
    @State private var hasRememberedKey = false
    @State private var rememberInCloud = false
    @State private var keyValidation = JournalFormValidation()
    @State private var keyRejected = false

    private let localFile = URL.applicationSupportDirectory.appending(path: "family.health")

    var body: some View {
        let keyIssues = [JournalFieldIssue.recoveryKey(recoveryKey, rejected: keyRejected)].compactMap { $0 }
        NavigationStack {
            List {
                if preview == nil && selected == nil {
                    Section {
                        JournalHero(title: "Лист здоровья", label: "Семейный дневник", symbol: "heart.text.square") {
                            EmptyView()
                        }
                    }
                }
                if let preview {
                    Section("Проверенная копия") {
                        Text(preview.family.name).font(.headline)
                        LabeledContent("Профили", value: String(preview.family.members.count))
                        LabeledContent("Оригиналы", value: String(preview.originals.count))
                        Button(hasSaved ? "Заменить сохранённый архив" : "Сохранить на iPhone") { commit(preview) }
                        Button("Отмена") { cancelImport() }
                    }
                } else if selected != nil || (archive == nil && hasSaved) {
                    Section(selected == nil ? "Сохранённый архив" : fileName) {
                        if hasRememberedKey {
                            Button(selected == nil ? "Открыть через Face ID или код iPhone" : "Проверить через Face ID или код iPhone",systemImage:"lock.open") { unlock(from:.device) }
                        }
                        Button("Открыть ключом из iCloud", systemImage:"icloud.and.arrow.down") { unlock(from:.iCloud) }
                        SecureField("Семейный ключ восстановления", text: $recoveryKey)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                            .journalField("recovery-key", keyValidation.visible(keyIssues))
                        DisclosureGroup("Где взять ключ восстановления?"){
                            Text(familyRecoveryKeyHelp).font(.footnote).foregroundStyle(.secondary)
                        }
                        if selected != nil || !hasRememberedKey {
                            Toggle("Запомнить ключ на этом iPhone",isOn:$rememberKey)
                        }
                        Toggle("Сохранить ключ в iCloud", isOn: $rememberInCloud)
                        if rememberInCloud {
                            Text("Ключ сохранится после проверки копии и подтверждения Face ID или кодом iPhone.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                        Button(selected == nil ? "Открыть архив" : "Проверить копию") {
                            if keyValidation.submit(keyIssues) { unlock() }
                        }
                        if selected != nil { Button("Отмена") { cancelImport() } }
                        else if hasRememberedKey { Button("Забыть ключ на этом iPhone",role:.destructive) { forgetKey() } }
                    }
                } else if let archive {
                    Section(archive.family.name) {
                        ForEach(archive.family.members) { member in
                            if let profile = archive.profiles[member.id] {
                                NavigationLink {
                                    ArchiveProfileView(member: member, profile: profile, archive: archive)
                                } label: {
                                    VStack(alignment: .leading) {
                                        Text(member.name).font(.headline)
                                        Text(member.id == archive.family.adminId ? "Администратор" : member.role)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                } else {
                    Section {
                        ContentUnavailableView("Семейный архив", systemImage: "cross.case",
                            description: Text("Выберите зашифрованную копию на Google Диске или в «Файлах». Откройте её семейным ключом из iCloud или введите ключ вручную."))
                    }
                }
                if selected == nil && preview == nil {
                    if journal.hasSavedConnection {
                        Button("Восстановить подключение к семье",systemImage:"arrow.clockwise"){
                            Task {await journal.reconnect()}
                        }
                    }
                    NavigationLink("Подключиться к семье") { PairDeviceView(journal: journal) }
                }
                if selected == nil && preview == nil {
                    Section {
                        Button("Выбрать файл копии", systemImage:"folder"){picker=true}
                        NavigationLink("Копии на Google Диске"){
                            DriveBackupView(journal:journal, receive: selectCopy)
                        }
                    }
                }
                if busy { ProgressView("Проверяем архив…") }
                if journal.busy {ProgressView("Восстанавливаем подключение…")}
                if let message=journal.message {Text(message).foregroundStyle(.secondary)}
                if let error { Text(error).foregroundStyle(.red).accessibilityLabel("Ошибка. " + error) }
            }
            .journalValidation(keyValidation)
            .journalBackground()
            .disabled(busy || journal.busy)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if archive != nil {
                    Button("Закрыть архив", systemImage: "lock") { archive = nil; cancelImport() }.disabled(busy)
                }
            }
            .fileImporter(isPresented: $picker, allowedContentTypes: [.data]) { result in
                guard case .success(let url) = result else { return }
                busy = true
                Task {
                    do {
                        let data = try await Task.detached {
                            let access = url.startAccessingSecurityScopedResource()
                            defer { if access { url.stopAccessingSecurityScopedResource() } }
                            return try Data(contentsOf: url)
                        }.value
                        selectCopy(data, url.lastPathComponent)
                    } catch { self.error = "Не удалось прочитать выбранный файл." }
                    busy = false
                }
            }
            .task {
                hasSaved=FileManager.default.fileExists(atPath:localFile.path)
                hasRememberedKey=SavedArchiveKey.exists()
                if !hasSaved {await journal.reconnect()}
            }
            .onChange(of: recoveryKey) { _, _ in keyRejected = false }
        }
        .overlay { if phase != .active { Color(uiColor: .systemBackground).ignoresSafeArea() } }
    }

    private func selectCopy(_ data: Data, _ name: String) {
        cancelImport()
        selected = data
        fileName = name
    }

    private func cancelImport() {
        preview = nil
        selected = nil
        recoveryKey = ""
        rememberKey = false
        rememberInCloud = false
        keyValidation = JournalFormValidation()
        keyRejected = false
        error = nil
    }
    private func unlock(from source:UnlockSource = .manual) {
        let imported = selected, key = recoveryKey, url = localFile
        busy = true; error = nil
        Task {
            defer{busy=false}
            do {
                let checked: FamilyArchive
                if source == .iCloud {
                    let data = try await Task.detached { try imported ?? Data(contentsOf: url) }.value
                    checked = try await CloudArchiveKeys.unlock(data)
                } else {
                    checked = try await Task.detached {
                        let candidate = source == .device ? try SavedArchiveKey.read() : key
                        return try FamilyArchive(encrypted: imported ?? Data(contentsOf: url), recoveryKey: candidate)
                    }.value
                }
                if imported != nil {
                    if source == .device {rememberKey=true}
                    preview=checked
                }
                else {
                    let cloudNotice = await saveCloudKeyIfRequested(for: checked)
                    try journal.openAdmin(checked,url:localFile)
                    if rememberKey { storeKey(for:checked) }
                    addCloudNotice(cloudNotice)
                }
                recoveryKey = ""
            } catch SavedArchiveKey.Failure.cancelled, CloudArchiveKeys.Failure.cancelled {
                return
            } catch SavedArchiveKey.Failure.missing {
                hasRememberedKey=false
                error=SavedArchiveKey.Failure.missing.errorDescription
            } catch FamilyArchive.Failure.decrypt where source == .manual {
                keyRejected = true
                _ = keyValidation.submit([JournalFieldIssue.recoveryKey(key, rejected: true)].compactMap { $0 })
            } catch { self.error = error.localizedDescription }
        }
    }
    private func storeKey(for archive:FamilyArchive) {
        do {
            try archive.withRecoveryKey(SavedArchiveKey.remember)
            hasRememberedKey=true
        } catch {
            hasRememberedKey=false
            journal.message=error.localizedDescription
        }
    }
    private func forgetKey() {
        do {try SavedArchiveKey.forget();hasRememberedKey=false;error=nil}
        catch {self.error=error.localizedDescription}
    }
    private func saveCloudKeyIfRequested(for archive: FamilyArchive) async -> String? {
        guard rememberInCloud else { return nil }
        do {
            try await CloudArchiveKeys.remember(archive)
            return "Ключ сохранён в связке ключей. Его перенос на другие устройства выполняет iCloud."
        } catch CloudArchiveKeys.Failure.cancelled {
            return "Сохранение ключа в iCloud отменено."
        } catch {
            return error.localizedDescription
        }
    }

    private func addCloudNotice(_ notice: String?) {
        guard let notice else { return }
        journal.message = [journal.message, notice].compactMap { $0 }.joined(separator: "\n")
    }

    private func commit(_ checked: FamilyArchive) {
        guard let selected else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                var folder = localFile.deletingLastPathComponent()
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                var flags = URLResourceValues(); flags.isExcludedFromBackup = true
                try folder.setResourceValues(flags)
                try selected.write(to: localFile, options: [.atomic, .completeFileProtection])
                let cloudNotice = await saveCloudKeyIfRequested(for: checked)
                try journal.openAdmin(checked,url:localFile)
                if rememberKey {storeKey(for:checked)}
                else if hasRememberedKey {
                    hasRememberedKey=false
                    do {try SavedArchiveKey.forget()}
                    catch {journal.message=error.localizedDescription}
                }
                addCloudNotice(cloudNotice)
                hasSaved=true;cancelImport()
            } catch { self.error = "Не удалось сохранить зашифрованный файл на iPhone." }
        }
    }
}

struct ArchiveProfileView: View {
    let member: FamilyArchive.Member
    let profile: FamilyArchive.Profile
    let archive: FamilyArchive
    var body: some View {
        List {
            let fields = (profile.fields ?? []).filter { !$0.value.isEmpty }
            if !fields.isEmpty {
                Section("Медкарта") { ForEach(fields) { LabeledContent($0.label, value: $0.value) } }
            }
            Section("Последние визиты") {
                let visits = (profile.addedVisits ?? []).sorted { $0.date > $1.date }
                if visits.isEmpty { Text("Пока нет визитов").foregroundStyle(.secondary) }
                ForEach(visits) { visit in LabeledContent(visit.title, value: visit.date) }
            }
            attachments("Документы", profile.files)
            if let drafts = profile.visitDrafts, !drafts.isEmpty { attachments("Черновики визитов", drafts) }
        }.journalBackground().navigationTitle(member.name).navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder private func attachments(_ title: String, _ entries: [FamilyArchive.Entry]) -> some View {
        Section(title) {
            if entries.isEmpty { Text("Пока нет документов").foregroundStyle(.secondary) }
            ForEach(entries) { entry in
                if let original = archive.originals[member.id + "/" + entry.id] {
                    let name = entry.name ?? "Вложение"
                    NavigationLink {
                        AttachmentView(original: original, name: name)
                    } label: { Label(name, systemImage: "doc") }
                }
            }
        }
    }
}

struct AttachmentView: View {
    let original: FamilyArchive.Original
    let name: String
    @State private var exporting=false
    var body: some View {
        Group {
            if let document = PDFDocument(data: original.bytes), document.pageCount > 0 {
                PDFPreview(document: document)
            } else if let photo = UIImage(data: original.bytes) {
                Image(uiImage: photo).resizable().scaledToFit().accessibilityLabel(name)
            } else if original.type.hasPrefix("text/"), let text = String(data: original.bytes, encoding: .utf8) {
                ScrollView { Text(text).padding().textSelection(.enabled) }
            } else { VStack(spacing:12) {
                Text(name)
                Button("Сохранить оригинал для внешнего просмотра"){exporting=true}
            } }
        }.navigationTitle(name).navigationBarTitleDisplayMode(.inline)
        .fileExporter(isPresented:$exporting,document:BinaryDocument(original.bytes),contentType:UTType(filenameExtension:URL(fileURLWithPath:name).pathExtension) ?? .data,defaultFilename:name){_ in}
    }
}

private struct PDFPreview: UIViewRepresentable {
    let document: PDFDocument
    func makeUIView(context: Context) -> PDFView {
        let view = PDFView(); view.autoScales = true; view.document = document; return view
    }
    func updateUIView(_ uiView: PDFView, context: Context) {}
}
