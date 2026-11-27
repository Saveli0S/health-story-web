import Foundation
import CryptoKit

struct FamilyArchive {
    struct Member: Decodable, Identifiable {
        let id, name, role: String
    }
    struct Family: Decodable {
        let kind, name, adminId: String
        let id: String?
        let members: [Member]
    }
    struct Field: Decodable, Identifiable {
        let id, label, value: String
    }
    struct Entry: Decodable, Identifiable {
        let id: String
        let name, category, date: String?
    }
    struct Visit: Decodable, Identifiable {
        let id, date, title: String
        init(from decoder: Decoder) throws {
            var items = try decoder.unkeyedContainer()
            id = try items.decode(String.self)
            date = try items.decode(String.self)
            title = try items.decode(String.self)
        }
    }
    struct Profile: Decodable {
        let fields: [Field]?
        let addedVisits: [Visit]?
        let files: [Entry]
        let visitDrafts: [Entry]?
    }
    struct Original: Decodable {
        let id, type: String
        let bytes: Data
    }
    private struct Payload: Decodable {
        struct Journal: Decodable {
            let schemaVersion: Int
            let family: Family
            let profiles: [String: Profile]
            let access: Access?
            struct Access: Decodable {}
        }
        let version: Int
        let data: Journal
        let files: [Original]
    }
    enum Failure: LocalizedError {
        case format, key, decrypt, incomplete
        var errorDescription: String? {
            switch self {
            case .format: "Выберите полную семейную копию .health версии 2, созданную администратором."
            case .key: "Проверьте ключ восстановления. Вставьте его целиком."
            case .decrypt: "Не удалось расшифровать копию. Проверьте файл и семейный ключ."
            case .incomplete: "Состав профилей или оригиналов в копии не совпадает с записями."
            }
        }
    }

    private let sessionKey: SymmetricKey
    private let decoded: Data
    func withRecoveryKey<T>(_ action:(Data)throws->T) rethrows -> T {
        try sessionKey.withUnsafeBytes{try action(Data($0))}
    }
    func rawPayload() throws -> [String: Any] {
        guard let payload=try JSONSerialization.jsonObject(with:decoded) as? [String:Any] else {throw Failure.format}
        return payload
    }
    func validateBackup(_ data:Data) throws {
        let key=sessionKey.withUnsafeBytes{Data($0).base64EncodedString()}
        _=try FamilyArchive(encrypted:data,recoveryKey:key)
    }
    func seal(_ payload: [String:Any]) throws -> Data {
        try Self.seal(payload,key:sessionKey)
    }
    static func seal(_ payload:[String:Any],key:SymmetricKey) throws -> Data {
        let clear=try JSONSerialization.data(withJSONObject:payload)
        guard let sealed=try AES.GCM.seal(clear,using:key).combined else {throw Failure.decrypt}
        return Data("HS01".utf8)+sealed
    }
    let family: Family
    let profiles: [String: Profile]
    let originals: [String: Original]

    init(encrypted: Data, recoveryKey: String) throws {
        guard encrypted.count >= 32, encrypted.starts(with: Data("HS01".utf8)) else { throw Failure.format }
        var code = recoveryKey.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        code += String(repeating: "=", count: (4 - code.utf8.count % 4) % 4)
        guard let raw = Data(base64Encoded: code), raw.count == 32 else { throw Failure.key }

        let clear: Data
        do {
            let box = try AES.GCM.SealedBox(combined: encrypted.dropFirst(4))
            clear = try AES.GCM.open(box, using: SymmetricKey(data: raw))
        } catch { throw Failure.decrypt }
        guard let payload = try? JSONDecoder().decode(Payload.self, from: clear),
              payload.version == 2, payload.data.schemaVersion == 2,
              payload.data.access == nil, payload.data.family.kind == "family" else { throw Failure.format }

        sessionKey=SymmetricKey(data:raw);decoded=clear
        family = payload.data.family
        profiles = payload.data.profiles
        let members = Set(family.members.map(\.id))
        guard !members.isEmpty, members.count == family.members.count, members == Set(profiles.keys),
              family.members.contains(where: { $0.id == payload.data.family.adminId && $0.role == "Взрослый" }) else { throw Failure.incomplete }

        var expected = Set<String>()
        for (owner, profile) in profiles {
            guard owner.hasPrefix("p-"), !owner.contains("/") else { throw Failure.incomplete }
            for entry in profile.files + (profile.visitDrafts ?? []) {
                guard !entry.id.isEmpty, !entry.id.contains("/"), expected.insert(owner + "/" + entry.id).inserted else { throw Failure.incomplete }
            }
        }
        var checked: [String: Original] = [:]
        for original in payload.files {
            guard expected.remove(original.id) != nil, !original.bytes.isEmpty else { throw Failure.incomplete }
            checked[original.id] = original
        }
        guard expected.isEmpty else { throw Failure.incomplete }
        originals = checked
    }
}
