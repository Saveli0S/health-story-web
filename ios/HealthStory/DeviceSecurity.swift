import Foundation
import Security
import CryptoKit
import LocalAuthentication

typealias JournalObject = [String: Any]

struct JournalError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

enum SavedArchiveKey {
    enum Failure: LocalizedError {
        case unavailable, missing, cancelled, load, save, remove

        var errorDescription: String? {
            switch self {
            case .unavailable: "Чтобы запомнить ключ, включите код-пароль iPhone."
            case .missing: "Сохранённый ключ недоступен. Введите семейный ключ снова."
            case .cancelled: nil
            case .load: "Не удалось открыть сохранённый ключ. Повторите или введите ключ вручную."
            case .save: "Не удалось запомнить ключ на этом iPhone."
            case .remove: "Не удалось удалить сохранённый ключ."
            }
        }
    }

    private static let item:[String:String] = [
        kSecClass as String:kSecClassGenericPassword as String,
        kSecAttrService as String:"by.healthstory.local-archive",
        kSecAttrAccount as String:"recovery"
    ]

    static func exists() -> Bool {
        let context=LAContext()
        context.interactionNotAllowed=true
        var query:[String:Any]=item
        query[kSecUseAuthenticationContext as String]=context
        let status=SecItemCopyMatching(query as CFDictionary,nil)
        return status==errSecSuccess || status==errSecInteractionNotAllowed
    }

    static func remember(_ key:Data) throws {
        guard LAContext().canEvaluatePolicy(.deviceOwnerAuthentication,error:nil) else {throw Failure.unavailable}
        guard key.count==32,
              let protection=SecAccessControlCreateWithFlags(nil,kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,.userPresence,nil) else {
            throw Failure.save
        }
        try forget()
        var request:[String:Any]=item
        request[kSecAttrAccessControl as String]=protection
        request[kSecValueData as String]=key
        guard SecItemAdd(request as CFDictionary,nil)==errSecSuccess else {throw Failure.save}
    }

    static func read() throws -> String {
        let context=LAContext()
        context.localizedReason="Открыть семейный дневник"
        var request:[String:Any]=item
        request[kSecUseAuthenticationContext as String]=context
        request[kSecReturnData as String]=true
        request[kSecMatchLimit as String]=kSecMatchLimitOne
        var result:CFTypeRef?
        switch SecItemCopyMatching(request as CFDictionary,&result) {
        case errSecSuccess:
            guard let key=result as? Data,key.count==32 else {throw Failure.load}
            return key.base64EncodedString()
        case errSecItemNotFound: throw Failure.missing
        case errSecUserCanceled: throw Failure.cancelled
        default: throw Failure.load
        }
    }

    static func forget() throws {
        let status=SecItemDelete(item as CFDictionary)
        guard status==errSecSuccess || status==errSecItemNotFound else {throw Failure.remove}
    }
}

func jsonObject(_ bytes: Data) throws -> JournalObject {
    guard let value = try JSONSerialization.jsonObject(with: bytes) as? JournalObject else {
        throw JournalError("Файл содержит неверный формат данных.")
    }
    return value
}
func jsonBytes(_ value: Any) throws -> Data {
    try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .fragmentsAllowed])
}
func decodeKey(_ code: String) throws -> SymmetricKey {
    var b64 = code.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    b64 += String(repeating: "=", count: (4 - b64.utf8.count % 4) % 4)
    guard let raw = Data(base64Encoded: b64), raw.count == 32 else { throw JournalError("Некорректный ключ.") }
    return SymmetricKey(data: raw)
}

struct DeviceIdentity {
    let privateKey: SecKey
    let spki: Data
    var id: String { SHA256.hash(data: spki).map { String(format: "%02x", $0) }.joined() }
    var fingerprint: String {
        stride(from: 0, to: 16, by: 4).map { String(id.dropFirst($0).prefix(4)).uppercased() }.joined(separator: " ")
    }

    init() throws {
        let tag = Data("by.healthstory.pairing.v1".utf8)
        let query: [String: Any] = [kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: tag,
                                     kSecAttrKeyType as String: kSecAttrKeyTypeRSA, kSecReturnRef as String: true]
        var item: CFTypeRef?
        let result = SecItemCopyMatching(query as CFDictionary, &item)
        var error: Unmanaged<CFError>?
        if result == errSecSuccess, let item {
            privateKey = (item as! SecKey)
        } else if result == errSecItemNotFound {
            let attrs: [String: Any] = [kSecAttrKeyType as String: kSecAttrKeyTypeRSA, kSecAttrKeySizeInBits as String: 3072,
                kSecPrivateKeyAttrs as String: [kSecAttrIsPermanent as String: true, kSecAttrApplicationTag as String: tag,
                                                 kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]]
            guard let key = SecKeyCreateRandomKey(attrs as CFDictionary, &error) else { throw JournalError("Не удалось создать ключ устройства.") }
            privateKey = key
        } else { throw JournalError("Разблокируйте iPhone для доступа к ключу.") }
        guard let pub = SecKeyCopyPublicKey(privateKey),
              let raw = SecKeyCopyExternalRepresentation(pub, &error) as Data? else { throw JournalError("Не удалось прочитать открытый ключ.") }
        // Security exports a PKCS#1 RSA key. WebCrypto imports SubjectPublicKeyInfo.
        func der(_ tag: UInt8, _ value: Data) -> Data {
            var n = value.count
            var bytes: [UInt8] = []
            repeat { bytes.insert(UInt8(n & 255), at: 0); n >>= 8 } while n > 0
            let length = value.count < 128 ? bytes : [0x80 | UInt8(bytes.count)] + bytes
            return Data([tag] + length) + value
        }
        let algorithm = Data([0x30,0x0d,0x06,0x09,0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x01,0x05,0x00])
        spki = der(0x30, algorithm + der(0x03, Data([0]) + raw))
    }

    func request(revision: Int) throws -> Data {
        try jsonBytes(["format":"HS-request-1", "spki":spki.base64EncodedString(), "revision":revision, "client":"ios"])
    }

    func openPacket(_ bytes: Data, code: String) throws -> JournalObject {
        let p = try jsonObject(bytes)
        guard p["format"] as? String == "HS-device-1", p["id"] as? String == id,
              let wrapped = Data(base64Encoded:p["wrapped"] as? String ?? ""), wrapped.count == 384,
              let iv = Data(base64Encoded:p["iv"] as? String ?? ""), iv.count == 12,
              let cipher = Data(base64Encoded:p["cipher"] as? String ?? ""), cipher.count >= 16 else {
            throw JournalError("Файл выдан другому устройству или повреждён.")
        }
        var error: Unmanaged<CFError>?
        guard let secret = SecKeyCreateDecryptedData(privateKey,.rsaEncryptionOAEPSHA256,wrapped as CFData,&error) as Data?,
              secret.count == 32 else { throw JournalError("Не удалось открыть ключ устройства.") }
        let aad = Data(("HS-device-1/"+id+"/"+code.trimmingCharacters(in:.whitespacesAndNewlines)).utf8)
        let clear = try AES.GCM.open(AES.GCM.SealedBox(combined:iv+cipher),using:SymmetricKey(data:secret),authenticating:aad)
        return try jsonObject(clear)
    }
}

struct DeviceDisk {
    let url: URL
    let key: SymmetricKey
    init() throws {
        url = URL.applicationSupportDirectory.appending(path:"paired/journal.enc")
        let query: [String:Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:"by.healthstory.local",
                                    kSecAttrAccount as String:"paired-journal-v1"]
        var found: CFTypeRef?
        var read=query; read[kSecReturnData as String]=true
        let status=SecItemCopyMatching(read as CFDictionary,&found)
        if status == errSecSuccess, let data=found as? Data, data.count == 32 { key=SymmetricKey(data:data); return }
        guard status == errSecItemNotFound, !FileManager.default.fileExists(atPath:url.path) else {
            throw JournalError("Не удалось открыть локальный ключ дневника.")
        }
        let fresh=SymmetricKey(size:.bits256)
        var add=query; add[kSecValueData as String]=fresh.withUnsafeBytes { Data($0) }
        add[kSecAttrAccessible as String]=kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        guard SecItemAdd(add as CFDictionary,nil)==errSecSuccess else { throw JournalError("Не удалось сохранить ключ на iPhone.") }
        key=fresh
    }
    func load() throws -> JournalObject? {
        guard FileManager.default.fileExists(atPath:url.path) else {return nil}
        return try jsonObject(AES.GCM.open(AES.GCM.SealedBox(combined:Data(contentsOf:url)),using:key))
    }
    func save(_ data: JournalObject) throws {
        var folder=url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
        var flags=URLResourceValues(); flags.isExcludedFromBackup=true
        try folder.setResourceValues(flags)
        guard let encrypted=try AES.GCM.seal(jsonBytes(data),using:key).combined else {throw JournalError("Не удалось зашифровать дневник.")}
        try encrypted.write(to:url,options:[.atomic,.completeFileProtection])
    }
}
