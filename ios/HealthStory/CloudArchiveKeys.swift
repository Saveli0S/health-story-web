import CryptoKit
import Foundation
import LocalAuthentication
import Security

enum CloudArchiveKeys {
    enum Failure: LocalizedError {
        case authentication, cancelled, empty, noMatch, read, save, remove

        var errorDescription: String? {
            switch self {
            case .authentication: "Подтвердите доступ через Face ID или код iPhone."
            case .cancelled: nil
            case .empty: "Ключей из iCloud пока нет на этом iPhone. Если ещё не сохраняли ключ в iCloud, введите его и включите «Сохранить ключ в iCloud». Если уже сохраняли, проверьте Apple Account и синхронизацию связки ключей."
            case .noMatch: "К выбранной копии не подошёл ни один ключ из iCloud. Введите ключ этой копии вручную."
            case .read: "Не удалось прочитать ключи из связки ключей iCloud."
            case .save: "Не удалось сохранить ключ в связке ключей iCloud."
            case .remove: "Не удалось удалить ключи из связки ключей iCloud."
            }
        }
    }

    private static var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "by.healthstory.icloud-archive",
            kSecAttrSynchronizable as String: true
        ]
    }

    @MainActor
    private static func authorize(_ reason: String) async throws {
        let context = LAContext()
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) else { throw Failure.authentication }
        do {
            guard try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) else {
                throw Failure.authentication
            }
        } catch let error as LAError {
            switch error.code {
            case .userCancel, .systemCancel, .appCancel: throw Failure.cancelled
            default: throw Failure.authentication
            }
        }
    }

    @MainActor
    static func remember(_ archive: FamilyArchive) async throws {
        try await authorize("Сохранить проверенный ключ в iCloud")
        try archive.withRecoveryKey { key in
            var item = query
            item[kSecAttrAccount as String] = Data(SHA256.hash(data: key)).base64EncodedString()
            item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlocked
            item[kSecValueData as String] = key
            let status = SecItemAdd(item as CFDictionary, nil)
            guard status == errSecSuccess || status == errSecDuplicateItem else { throw Failure.save }
        }
    }

    @MainActor
    static func unlock(_ encrypted: Data) async throws -> FamilyArchive {
        try await authorize("Проверить зашифрованную копию ключом из iCloud")
        return try await Task.detached {
            var request = query
            request[kSecReturnData as String] = true
            request[kSecMatchLimit as String] = kSecMatchLimitAll
            var result: CFTypeRef?
            switch SecItemCopyMatching(request as CFDictionary, &result) {
            case errSecItemNotFound: throw Failure.empty
            case errSecSuccess:
                guard let keys = result as? [Data], !keys.isEmpty else { throw Failure.read }
                for key in keys where key.count == 32 {
                    do { return try FamilyArchive(encrypted: encrypted, recoveryKey: key.base64EncodedString()) }
                    catch FamilyArchive.Failure.decrypt { continue }
                }
                throw Failure.noMatch
            default: throw Failure.read
            }
        }.value
    }

    static func hasKeys() -> Bool {
        SecItemCopyMatching(query as CFDictionary, nil) == errSecSuccess
    }

    @MainActor
    static func forget() async throws {
        try await authorize("Удалить ключи восстановления дневника из iCloud")
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw Failure.remove }
    }
}
