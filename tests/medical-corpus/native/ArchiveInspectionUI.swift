import XCTest

final class ArchiveInspectionUI: XCTestCase {
    func testInspectSeparateCopyAndOpenPDF() {
        continueAfterFailure = false
        let app = XCUIApplication()
        let key = "QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI"
        let input = app.secureTextFields["Семейный ключ восстановления"]
        func tap(_ item: XCUIElement) {
            for _ in 0..<5 where !item.exists || !item.isHittable { app.swipeUp() }
            XCTAssertTrue(item.exists && item.isHittable)
            item.tap()
        }
        app.launch()
        XCTAssertTrue(input.waitForExistence(timeout: 12))
        tap(input)
        input.typeText(key)
        tap(app.buttons["Открыть архив"])
        XCTAssertTrue(app.buttons["Мая Макетова"].waitForExistence(timeout: 8))
        tap(app.buttons["Проверить файл копии"])
        XCTAssertTrue(app.navigationBars["Проверка копии"].waitForExistence(timeout: 8))
        XCTAssertTrue(input.waitForExistence(timeout: 8))
        tap(input)
        input.typeText("bad-key")
        tap(app.buttons["Проверить копию"])
        let error = app.staticTexts["validation-recovery-key"]
        XCTAssertTrue(error.waitForExistence(timeout: 8))
        XCTAssertGreaterThan(error.frame.minY, input.frame.midY)
        tap(input)
        input.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 7) + key)
        XCTAssertTrue(error.waitForNonExistence(timeout: 3))
        tap(app.buttons["Проверить копию"])
        XCTAssertTrue(app.staticTexts["Семья из копии"].waitForExistence(timeout: 8))
        tap(app.buttons["Профиль из копии"])
        tap(app.buttons["Оригинал из копии.pdf"])
        XCTAssertTrue(app.navigationBars["Оригинал из копии.pdf"].waitForExistence(timeout: 8))
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "PDF from verified backup"
        shot.lifetime = .keepAlways
        add(shot)
        app.terminate()
        app.launch()
        XCTAssertTrue(input.waitForExistence(timeout: 8))
        tap(input)
        input.typeText(key)
        tap(app.buttons["Открыть архив"])
        XCTAssertTrue(app.buttons["Мая Макетова"].waitForExistence(timeout: 8))
    }
}
