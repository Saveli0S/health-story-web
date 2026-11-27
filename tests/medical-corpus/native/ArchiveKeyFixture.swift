enum SavedArchiveKey {
    enum Failure: LocalizedError {
        case missing, cancelled, badFixture
        var errorDescription: String? {"Учебный ключ недоступен."}
    }

    private static let marker="archive-unlock-fixture"
    private static let testKey=Data(repeating:66,count:32)

    static func exists() -> Bool {UserDefaults.standard.bool(forKey:marker)}

    static func remember(_ key:Data) throws {
        guard key==testKey else{throw Failure.badFixture}
        UserDefaults.standard.set(true,forKey:marker)
    }
    static func read() throws -> String {
        guard UserDefaults.standard.bool(forKey:marker) else{throw Failure.missing}
        return testKey.base64EncodedString()
    }
    static func forget() throws {
        UserDefaults.standard.removeObject(forKey:marker)
    }
}
