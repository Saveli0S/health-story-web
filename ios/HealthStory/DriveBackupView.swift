import SwiftUI
import GoogleSignIn

@MainActor final class DriveAccount:ObservableObject {
    static let scope="https://www.googleapis.com/auth/drive.file"
    @Published var email:String?
    private var user:GIDGoogleUser?
    let configured:Bool
    lazy var files=DriveArchives { [weak self] in
        guard let user=self?.user,user.grantedScopes?.contains(Self.scope)==true else {throw DriveFailure("Войдите в Google Диск и разрешите доступ к копиям дневника.")}
        return try await user.refreshTokensIfNeeded().accessToken.tokenString
    }

    init(){
        let id=Bundle.main.object(forInfoDictionaryKey:"GIDClientID") as? String ?? ""
        let types=Bundle.main.object(forInfoDictionaryKey:"CFBundleURLTypes") as? [[String:Any]] ?? []
        let schemes=types.flatMap{$0["CFBundleURLSchemes"] as? [String] ?? []}
        configured=id.hasSuffix(".apps.googleusercontent.com") && schemes.contains(id.split(separator:".").reversed().joined(separator:"."))
    }
    func restore() async {
        guard configured,GIDSignIn.sharedInstance.hasPreviousSignIn() else{return}
        if let account=try? await GIDSignIn.sharedInstance.restorePreviousSignIn(),account.grantedScopes?.contains(Self.scope)==true {select(account)}
    }
    func connect() async throws {
        guard configured else {throw DriveFailure("Для этой сборки требуется OAuth-клиент Google типа iOS.")}
        let scenes=UIApplication.shared.connectedScenes.compactMap{$0 as? UIWindowScene}.filter{$0.activationState == .foregroundActive}
        guard var controller=scenes.flatMap(\.windows).first(where:\.isKeyWindow)?.rootViewController else {throw DriveFailure("Откройте дневник для входа.")}
        while let next=controller.presentedViewController{controller=next}
        let result=try await GIDSignIn.sharedInstance.signIn(withPresenting:controller,hint:nil,additionalScopes:[Self.scope])
        guard result.user.grantedScopes?.contains(Self.scope)==true else {throw DriveFailure("Google не предоставил доступ к файлам дневника.")}
        select(result.user)
    }
    private func select(_ account:GIDGoogleUser){
        if user?.userID != account.userID { files.resetSession() }
        user=account
        email=account.profile?.email ?? "Google Диск"
    }
    func signOut(){GIDSignIn.sharedInstance.signOut();files.resetSession();user=nil;email=nil}
}

struct DriveBackupView:View {
    @ObservedObject var journal:DeviceJournal
    var receive:((Data,String)->Void)?
    @Environment(\.dismiss) private var dismiss
    @StateObject private var account=DriveAccount()
    @State private var copies=[DriveCopy]()
    @State private var busy=false
    @State private var notice=""
    @State private var listed=false
    @State private var requestingKey=false
    @State private var selectedCopy:DriveCopy?
    @State private var confirmingRemoval=false
    @State private var inspection: ArchiveBackupInspection.Source?

    private var canManage:Bool {journal.admin || (!journal.paired && receive != nil)}

    var body:some View {
        Form {
            if let email=account.email {
                Section("Аккаунт"){Text(email);Button("Выйти из Google Диска"){account.signOut();copies=[];listed=false;notice=""}}
                Section("Копии дневника"){
                    if journal.admin {
                        Button("Загрузить зашифрованную копию"){
                            if journal.hasLocalArchive {uploadBackup()}
                            else {requestingKey=true}
                        }.disabled(journal.busy)
                    }
                    Button("Обновить список"){perform {try await refresh()}}
                    if listed && copies.isEmpty {Text("Копий дневника в этом аккаунте пока нет.")}
                    ForEach(copies){file in
                        VStack(alignment:.leading,spacing:8){
                            if receive != nil || journal.admin {
                                Button(file.name) { open(file) }.buttonStyle(.borderless)
                            }else{Text(file.name)}
                            if canManage && file.canTrash {
                                Button("Удалить копию",systemImage:"trash",role:.destructive){
                                    selectedCopy=file;confirmingRemoval=true
                                }.buttonStyle(.borderless).accessibilityLabel("Удалить копию "+file.name)
                            }
                        }
                    }
                }
            }else{
                Section {
                    Button("Войти в Google Диск"){perform {try await account.connect();try await refresh()}}
                    Text("Дневник запрашивает доступ к файлам, созданным приложением или открытым с его помощью. На Диск отправляется зашифрованный архив. Семейный ключ храните отдельно.")
                }
            }
            if busy{ProgressView()}
            if !notice.isEmpty{Text(notice)}
        }.journalBackground().disabled(busy).navigationTitle("Google Диск").navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented:$requestingKey){JournalBackupKeyForm(action:"Собрать и загрузить",submit:uploadBackup)}
        .alert("Удалить резервную копию?",isPresented:$confirmingRemoval,presenting:selectedCopy){file in
            Button("Отмена",role:.cancel){selectedCopy=nil}
            Button("Переместить в корзину",role:.destructive){remove(file)}
        } message:{file in
            Text("«"+file.name+"» будет перемещена в корзину Google Диска."+(copies.count==1 ? " Это последняя копия в списке." : ""))
        }
        .sheet(item: $inspection) { source in
            NavigationStack {
                ArchiveBackupInspection(source: source)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Закрыть") { inspection = nil }
                        }
                    }
            }
        }
        .task {busy=true;await account.restore();if account.email != nil{do{try await refresh()}catch{notice=error.localizedDescription}};busy=false}
    }
    private func open(_ file: DriveCopy) {
        guard journal.admin || receive != nil else { return }
        perform {
            let data = try await account.files.download(file)
            if let receive {
                receive(data, file.name)
                dismiss()
            } else {
                inspection = ArchiveBackupInspection.Source(name: file.name, bytes: data)
            }
        }
    }
    private func uploadBackup(_ code:String=""){
        perform {
            let encrypted=try await journal.exportAdmin(recoveryKey:code)
            try await account.files.upload(encrypted){notice="Передано "+String($0)+" %"}
            notice="Google Диск подтвердил контрольную сумму копии."
            try await refresh()
        }
    }
    private func remove(_ file:DriveCopy){
        selectedCopy=nil
        guard canManage,copies.contains(where:{$0.id==file.id && $0.canTrash}) else{return}
        perform {
            try await account.files.trash(file)
            copies.removeAll{$0.id==file.id}
            notice="Копия перемещена в корзину Google Диска."
        }
    }
    private func refresh() async throws {copies=try await account.files.copies();listed=true}
    private func perform(_ action:@escaping @MainActor () async throws->Void){
        guard !busy else{return}
        busy=true;notice=""
        Task {defer{busy=false};do{try await action()}catch{notice=error.localizedDescription}}
    }
}
