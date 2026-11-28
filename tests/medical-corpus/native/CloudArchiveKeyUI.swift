import XCTest

final class CloudArchiveKeyUI: XCTestCase {
    func testSaveReopenAndRemoveCloudKey() {
        continueAfterFailure = false
        let app = XCUIApplication()
        let input = app.secureTextFields["Семейный ключ восстановления"]
        let openFromCloud = app.buttons["Открыть ключом из iCloud"]
        let profile = app.navigationBars["Профиль"]
        let settings = app.buttons["Ключ восстановления в iCloud"]
        let close = app.buttons["Закрыть архив"]
        let remove = app.buttons["Удалить сохранённые ключи из iCloud"]
        let saveInCloud = app.switches["Сохранить ключ в iCloud"]

        func reveal(_ element: XCUIElement) {
            for _ in 0..<5 where !element.isHittable { app.swipeUp() }
            XCTAssertTrue(element.isHittable,app.debugDescription)
        }

        func enterKey() {
            XCTAssertTrue(input.waitForExistence(timeout: 15))
            input.tap()
            input.typeText("QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI")
            app.buttons["Открыть архив"].tap()
            XCTAssertTrue(profile.waitForExistence(timeout: 10))
        }

        app.launch()
        XCTAssertTrue(openFromCloud.waitForExistence(timeout: 10))
        openFromCloud.tap()
        let noKeys = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Ключей из iCloud пока нет")).firstMatch
        XCTAssertTrue(noKeys.waitForExistence(timeout: 10))
        XCTAssertEqual(saveInCloud.value as? String, "0")
        for offset in [0.88, 0.85, 0.93] where saveInCloud.value as? String != "1" {
            saveInCloud.coordinate(withNormalizedOffset: CGVector(dx: offset, dy: 0.5)).tap()
        }
        XCTAssertEqual(saveInCloud.value as? String, "1")
        enterKey()
        reveal(app.staticTexts["Ключ сохранён в связке ключей. Его перенос на другие устройства выполняет iCloud."])
        app.terminate()
        app.launch()
        XCTAssertTrue(openFromCloud.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["Открыть через Face ID или код iPhone"].exists)
        openFromCloud.tap()
        XCTAssertTrue(profile.waitForExistence(timeout: 10))
        app.buttons["Моя семья"].tap()
        reveal(settings)
        settings.tap()
        reveal(remove)
        remove.tap()
        app.buttons["Удалить ключи из iCloud"].tap()
        reveal(app.staticTexts["Ключи удалены из связки ключей iCloud."])
        app.navigationBars.buttons.element(boundBy: 0).tap()
        reveal(close)
        close.tap()
        openFromCloud.tap()
        XCTAssertTrue(noKeys.waitForExistence(timeout: 10))
        enterKey()
    }
}
