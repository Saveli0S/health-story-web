import AuthenticationServices
import CryptoKit
import Security
import SwiftUI

@MainActor
final class NativeChatGPTAccount: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    enum State {
        case checking, pending, unavailable, disconnected, connected(String)
    }

    private struct Status: Decodable {
        let available: Bool
        let connected: Bool
        let planOnly: Bool
        let account: String?
    }

    private struct Authorization: Decodable { let url: URL }
    private struct Session: Decodable { let session: String; let planOnly: Bool }
    private struct Revocation: Decodable { let revoked: Bool }
    private struct Failure: Decodable { let error: String }

    static let scheme = "by.healthstory.familyjournal.chatgpt"
    private static let origin = "https://health-story-chatgpt.xzx89s.workers.dev"
    private let base = URL(string: NativeChatGPTAccount.origin)!
    private var context: String?
    private var token = ""
    private var signIn: ASWebAuthenticationSession?
    private var window: UIWindow?

    @Published private(set) var state: State = .checking
    @Published private(set) var busy = false
    @Published private(set) var message: String?

    var configured: Bool {
        Bundle.main.bundleIdentifier == "by.healthstory.familyjournal"
    }

    var transport: NativeChatGPTTransport? {
        guard configured, case .connected = state, let context else { return nil }
        return try? .gateway(at: base) { [weak self] in
            guard let self else { throw JournalError("Подключите ChatGPT повторно.") }
            return try await self.planSession(in: context)
        }
    }

    private func planSession(in expected: String) throws -> String {
        guard context == expected, case .connected = state, !token.isEmpty else {
            throw JournalError("Подключите ChatGPT повторно. Вопрос сохранён.")
        }
        return token
    }

    func selection(for journal: DeviceJournal) -> String? {
        let family = (journal.data["family"] as? JournalObject)?["id"] as? String ?? ""
        let actor = NativePromptLibrary.actor(journal)
        return configured && journal.editable && !family.isEmpty && !actor.isEmpty ? family + "/" + actor : nil
    }

    func activate(for journal: DeviceJournal) async {
        let next = selection(for: journal)
        guard context != next else { return }
        signIn?.cancel()
        context = next
        token = next.flatMap(ChatGPTSessionKey.load) ?? ""
        message = nil
        guard next != nil else { state = .checking; return }
        await refresh()
    }

    func refresh() async {
        guard let context else { return }
        let previousToken = token
        do {
            let status: Status = try await request("status")
            guard self.context == context, previousToken == token else { return }
            if !status.available {
                state = .pending
            } else if status.connected && status.planOnly {
                state = .connected(status.account ?? "")
            } else {
                state = .disconnected
                if !token.isEmpty {
                    try ChatGPTSessionKey.remove(context)
                    token = ""
                }
            }
        } catch {
            guard self.context == context, previousToken == token else { return }
            state = .unavailable
        }
    }

    func connect() async {
        guard let context, !busy, case .disconnected = state else { return }
        busy = true
        message = nil
        defer { busy = false }
        do {
            let verifier = try Self.randomToken()
            let challenge = Self.base64(Data(SHA256.hash(data: Data(verifier.utf8))))
            let authorization: Authorization = try await request("connect", body:["challenge":challenge])
            guard authorization.url.scheme == "https", authorization.url.host == "auth.openai.com",
                  authorization.url.port == nil, authorization.url.user == nil, authorization.url.password == nil,
                  authorization.url.path == "/api/accounts/authorize" else {
                throw JournalError("Не удалось открыть официальный вход в ChatGPT.")
            }
            guard self.context == context else { return }
            let callback = try await authenticate(authorization.url)
            guard self.context == context,
                  let parts = URLComponents(url: callback, resolvingAgainstBaseURL: false),
                  parts.scheme == Self.scheme, parts.host == "account", parts.path == "/callback",
                  parts.queryItems?.first(where: { $0.name == "chatgpt" })?.value == "connected",
                  let ticket = parts.queryItems?.first(where: { $0.name == "ticket" })?.value,
                  Self.validToken(ticket) else { throw JournalError("Разрешение на использование ChatGPT не получено.") }
            let session: Session = try await request("redeem", body:["ticket":ticket,"verifier":verifier])
            guard self.context == context, session.planOnly, Self.validToken(session.session) else {
                throw JournalError("Не подтверждён доступ к включённой квоте.")
            }
            try ChatGPTSessionKey.save(session.session, for: context)
            token = session.session
            await refresh()
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            return
        } catch {
            guard self.context == context else { return }
            message = error.localizedDescription
        }
    }

    func disconnect() async {
        guard let context, !busy else { return }
        busy = true
        message = nil
        defer { busy = false }
        let result: Revocation? = try? await request("disconnect", body:[:])
        guard self.context == context else { return }
        do {
            try ChatGPTSessionKey.remove(context)
            token = ""
            await refresh()
            if result?.revoked != true {
                message = "Сессия удалена с iPhone. Отзыв доступа можно проверить в настройках ChatGPT."
            }
        } catch { message = error.localizedDescription }
    }

    private func request<T: Decodable>(_ path: String, body: [String:String]? = nil) async throws -> T {
        var req = URLRequest(url: base.appending(path: "chatgpt/" + path), cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 25)
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if !token.isEmpty { req.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        if let body {
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONEncoder().encode(body)
        }
        let (data, response) = try await ChatGPTHTTP.load(req)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw JournalError((try? JSONDecoder().decode(Failure.self, from: data).error) ?? "Сервис подключения ChatGPT недоступен.")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func authenticate(_ url: URL) async throws -> URL {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        guard let anchor = scenes.filter({ $0.activationState == .foregroundActive }).flatMap(\.windows).first(where: \.isKeyWindow) else {
            throw JournalError("Откройте дневник, чтобы войти в ChatGPT.")
        }
        window = anchor
        defer { signIn = nil; window = nil }
        return try await withCheckedThrowingContinuation { continuation in
            var waiting: CheckedContinuation<URL, Error>? = continuation
            let finish: @MainActor (Result<URL, Error>) -> Void = { result in
                let current = waiting
                waiting = nil
                current?.resume(with: result)
            }
            let completion: ASWebAuthenticationSession.CompletionHandler = { callback, error in
                Task { @MainActor in
                    if let callback { finish(.success(callback)) }
                    else { finish(.failure(error ?? JournalError("Не удалось завершить вход в ChatGPT."))) }
                }
            }
            let session: ASWebAuthenticationSession
            if #available(iOS 17.4, *) {
                session = ASWebAuthenticationSession(url: url, callback: .customScheme(Self.scheme), completionHandler: completion)
            } else {
                session = ASWebAuthenticationSession(url: url, callbackURLScheme: Self.scheme, completionHandler: completion)
            }
            session.presentationContextProvider = self
            signIn = session
            if !session.start() { finish(.failure(JournalError("Не удалось открыть системное окно входа."))) }
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        window ?? ASPresentationAnchor()
    }

    private static func randomToken() throws -> String {
        var bytes = Data(count: 32)
        let status = bytes.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, $0.count, $0.baseAddress!) }
        guard status == errSecSuccess else { throw JournalError("Не удалось подготовить защищённый вход.") }
        return base64(bytes)
    }

    private static func base64(_ bytes: Data) -> String {
        bytes.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    private static func validToken(_ token: String) -> Bool {
        token.utf8.count == 43 && token.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil
    }
}

private enum ChatGPTSessionKey {
    private static let service = "by.healthstory.chatgpt-session"
    static func load(_ context: String) -> String? { NativeAIKeychain.load(context, service: service) }
    static func save(_ value: String, for context: String) throws { try NativeAIKeychain.save(value, for: context, service: service) }
    static func remove(_ context: String) throws { try NativeAIKeychain.remove(context, service: service) }
}

enum NativeAIKeychain {
    private static func query(_ context: String, service: String) -> [String:Any] {
        [
            kSecClass as String:kSecClassGenericPassword,
            kSecAttrService as String:service,
            kSecAttrAccount as String:context,
            kSecAttrSynchronizable as String:false
        ]
    }

    static func load(_ context: String, service: String) -> String? {
        var request = query(context, service: service)
        request[kSecReturnData as String] = true
        var item: CFTypeRef?
        guard SecItemCopyMatching(request as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data:data,encoding:.utf8)
    }

    static func save(_ value: String, for context: String, service: String) throws {
        var request = query(context, service: service)
        let data = Data(value.utf8)
        request[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        request[kSecValueData as String] = data
        let result = SecItemAdd(request as CFDictionary,nil)
        if result == errSecDuplicateItem {
            let updates = [kSecValueData as String:data]
            guard SecItemUpdate(query(context, service: service) as CFDictionary,updates as CFDictionary) == errSecSuccess else {
                throw JournalError("Не удалось сохранить подключение в Связке ключей iPhone.")
            }
        } else if result != errSecSuccess {
            throw JournalError("Не удалось сохранить подключение в Связке ключей iPhone.")
        }
    }

    static func remove(_ context: String, service: String) throws {
        let status = SecItemDelete(query(context, service: service) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw JournalError("Не удалось удалить подключение из Связки ключей iPhone.")
        }
    }
}

struct NativeChatGPTSettings: View {
    let account: NativeChatGPTAccount?
    @Environment(\.nativeAPIKeys) private var keys

    var body: some View {
        List {
            if let keys {
                Section {
                    Picker("Провайдер по умолчанию", selection: Binding(
                        get: { keys.preferredProvider }, set: { keys.setPreferredProvider($0) }
                    )) {
                        Text("Автоматически").tag(nil as NativeAIProvider?)
                        ForEach(NativeAIProvider.allCases, id: \.self) { provider in
                            Text(provider.label).tag(Optional(provider))
                        }
                    }
                } footer: {
                    Text("Для новых консультаций и разборов лечения. В переписке подставляется провайдер последнего ответа, если он доступен.")
                }
            }
            if let account { ChatGPTAccountRows(account: account) }
            if let keys {
                Section { Text(NativeAIProvider.cost + " Проверка ключа выполняется без запроса к модели.").font(.footnote) }
                ForEach(NativeAIProvider.keyed, id: \.self) { NativeAPIKeyRows(provider: $0, keys: keys) }
            }
        }.journalBackground().navigationTitle("ИИ-провайдеры")
    }
}

private struct ChatGPTAccountRows: View {
    @ObservedObject var account: NativeChatGPTAccount
    var body: some View {
        Group {
            Section("Личный ChatGPT") {
                switch account.state {
                case .checking:
                    ProgressView("Проверяем подключение…")
                case .pending:
                    Text("Подключение на iPhone ожидает допуска OpenAI.")
                case .unavailable:
                    Text("Сервис подключения ChatGPT недоступен.")
                case .disconnected:
                    Button("Продолжить с ChatGPT") { Task { await account.connect() } }
                case .connected(let email):
                    Text(email.isEmpty ? "Личный ChatGPT подключён" : "Подключён аккаунт " + email)
                    Button("Отключить аккаунт", role: .destructive) { Task { await account.disconnect() } }
                }
                Button("Обновить статус") { Task { await account.refresh() } }.disabled(account.busy)
                Link("Управление квотой ChatGPT",destination:URL(string:"https://chatgpt.com/settings/usage")!)
            }.disabled(account.busy)
            if account.busy { ProgressView() }
            if let message = account.message { Text(message).foregroundStyle(.secondary) }
        }.task { await account.refresh() }
    }
}
