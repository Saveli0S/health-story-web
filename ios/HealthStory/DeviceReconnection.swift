import Foundation
import Security

struct DeviceReconnection: Codable {
    let familyID, deviceID, memberID, role: String
    let revision: Int
    let space, token, rosterKey: String

    init?(journal:JournalObject) {
        guard let data=journal["data"] as? JournalObject,
              let access=data["access"] as? JournalObject,
              let family=data["family"] as? JournalObject,
              let sync=data["sync"] as? JournalObject,
              let familyID=family["id"] as? String,
              let deviceID=access["deviceId"] as? String,
              let memberID=access["member"] as? String,
              let role=access["role"] as? String,["admin","adult","child"].contains(role),
              let revision=access["revision"] as? Int,revision>0,
              let space=sync["space"] as? String,let token=sync["token"] as? String,
              let rosterKey=sync["rosterKey"] as? String,
              !familyID.isEmpty,!deviceID.isEmpty,!memberID.isEmpty,!space.isEmpty,!token.isEmpty,
              (try? decodeKey(rosterKey)) != nil else {return nil}
        self.familyID=familyID;self.deviceID=deviceID;self.memberID=memberID;self.role=role
        self.revision=revision;self.space=space;self.token=token;self.rosterKey=rosterKey
    }

    // A fresh installation has no local edits. Sync reads the signed-in device's current
    // roster and both record lanes before this payload can be opened by the journal.
    var emptyJournal:JournalObject {
        let access:JournalObject=["deviceId":deviceID,"member":memberID,"role":role,"revision":revision,"edited":false]
        let sync:JournalObject=["space":space,"token":token,"rosterKey":rosterKey,"profiles":[String:JournalObject]()]
        let data:JournalObject=["schemaVersion":2,"generation":UUID().uuidString,
                                "family":["id":familyID],"access":access,"sync":sync,"profiles":[String:JournalObject]()]
        return ["version":2,"data":data,"files":[JournalObject]()]
    }

    private static let query:[String:Any]=[
        kSecClass as String:kSecClassGenericPassword,
        kSecAttrService as String:"by.healthstory.local",
        kSecAttrAccount as String:"paired-reconnection-v1"
    ]

    static func read() throws -> Self? {
        var request=query
        request[kSecReturnData as String]=true
        var result:CFTypeRef?
        switch SecItemCopyMatching(request as CFDictionary,&result) {
        case errSecItemNotFound:return nil
        case errSecSuccess:
            guard let bytes=result as? Data else {throw JournalError("Не удалось прочитать сохранённое подключение.")}
            return try JSONDecoder().decode(Self.self,from:bytes)
        default:throw JournalError("Не удалось прочитать сохранённое подключение.")
        }
    }

    static func save(_ access:Self?) throws {
        if let access {
            let bytes=try JSONEncoder().encode(access)
            let changes=[kSecValueData as String:bytes] as CFDictionary
            let status=SecItemUpdate(query as CFDictionary,changes)
            if status==errSecSuccess {return}
            guard status==errSecItemNotFound else {throw JournalError("Не удалось запомнить подключение на iPhone.")}
            var item=query
            item[kSecAttrAccessible as String]=kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            item[kSecValueData as String]=bytes
            guard SecItemAdd(item as CFDictionary,nil)==errSecSuccess else {
                throw JournalError("Не удалось запомнить подключение на iPhone.")
            }
        } else {
            let status=SecItemDelete(query as CFDictionary)
            guard status==errSecSuccess || status==errSecItemNotFound else {
                throw JournalError("Не удалось забыть прежнее подключение.")
            }
        }
    }
}
